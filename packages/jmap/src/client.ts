import { AuthError, MalformedSourceResponse, newTraceId, TransportError } from "@cerebro/core";
import { Context, Effect, Layer, Schema } from "effect";

import type {
  EmailQueryParams,
  EmailQueryResult,
  JmapError,
  JmapMethodCall,
  JmapResponse,
  Mailbox,
} from "./types";

const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
const CORE_CAPABILITY = "urn:ietf:params:jmap:core";

/**
 * Public interface of the JMAP client provided via Effect Layer. Consumers
 * (Fastmail Worker) inject this via `Effect.provide(FastmailJmapLive(...))`
 * in production and `FastmailJmapStub(...)` in tests.
 */
export type FastmailJmapClient = {
  readonly accountId: string;
  readonly mailboxGet: (
    ids?: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<Mailbox>, JmapError>;
  readonly emailQuery: (params: EmailQueryParams) => Effect.Effect<EmailQueryResult, JmapError>;
  /**
   * Returns the raw JSON entries from JMAP Email/get. Callers (the Worker)
   * validate each entry against `JmapEmail` from @cerebro/core — keeping
   * the boundary check in one place rather than splitting it across
   * transport and consumer.
   */
  readonly emailGet: (
    ids: ReadonlyArray<string>,
    properties?: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<unknown>, JmapError>;
};

/** Effect Context tag. Imported by the Worker; provided by the Layer. */
export class FastmailJmap extends Context.Tag("@cerebro/jmap/FastmailJmap")<
  FastmailJmap,
  FastmailJmapClient
>() {}

export type FastmailJmapConfig = {
  readonly token: string;
  /** Defaults to https://api.fastmail.com — override for tests or alternate servers. */
  readonly baseUrl?: string;
  /** Injectable for tests so we don't hit the real Fastmail API. */
  readonly fetch?: typeof globalThis.fetch;
};

const SOURCE = "fastmail";

/** Session shape — only the fields we use. */
const SessionSchema = Schema.Struct({
  apiUrl: Schema.String,
  primaryAccounts: Schema.Record({ key: Schema.String, value: Schema.String }),
});

const MailboxSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.String),
});

const MailboxGetResponseSchema = Schema.Struct({
  list: Schema.Array(MailboxSchema),
});

const EmailQueryResponseSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  queryState: Schema.String,
});

const EmailGetResponseSchema = Schema.Struct({
  list: Schema.Array(Schema.Unknown),
});

/** Build the production Layer for the Fastmail JMAP client. */
export const FastmailJmapLive = (
  config: FastmailJmapConfig,
): Layer.Layer<FastmailJmap, JmapError> => Layer.effect(FastmailJmap, makeClient(config));

const makeClient = (config: FastmailJmapConfig): Effect.Effect<FastmailJmapClient, JmapError> =>
  Effect.gen(function* () {
    const baseUrl = config.baseUrl ?? "https://api.fastmail.com";
    const fetchFn = config.fetch ?? globalThis.fetch;

    const session = yield* fetchSession(baseUrl, config.token, fetchFn);
    const accountId = session.primaryAccounts[MAIL_CAPABILITY];
    if (accountId === undefined) {
      return yield* new MalformedSourceResponse({
        source: SOURCE,
        detail: `session has no primary account for ${MAIL_CAPABILITY}`,
      });
    }

    const callApi = (
      methodCalls: ReadonlyArray<JmapMethodCall>,
    ): Effect.Effect<JmapResponse, JmapError> =>
      Effect.gen(function* () {
        const body = JSON.stringify({
          using: [CORE_CAPABILITY, MAIL_CAPABILITY],
          methodCalls,
        });
        const res = yield* httpFetch(fetchFn, session.apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          body,
        });
        if (res.status === 401 || res.status === 403) {
          return yield* new AuthError({
            source: SOURCE,
            detail: `JMAP API returned ${res.status.toString()}`,
          });
        }
        if (!res.ok) {
          return yield* new TransportError({
            source: SOURCE,
            detail: `JMAP API returned ${res.status.toString()}`,
          });
        }
        return yield* parseJson<JmapResponse>(res);
      });

    const findResponse = (
      response: JmapResponse,
      method: string,
      callId: string,
    ): Effect.Effect<Record<string, unknown>, JmapError> => {
      for (const triple of response.methodResponses) {
        const [name, payload, id] = triple;
        if (name === method && id === callId) return Effect.succeed(payload);
        if (name === "error" && id === callId) {
          // The raw payload can contain Fastmail account IDs or other
          // internals we don't want crossing the network boundary via
          // sync_runs.error_message. Log it server-side keyed by a trace
          // ID; surface only the trace ID in the error detail.
          const traceId = newTraceId();
          console.error(`[trace=${traceId}] JMAP error for ${method}:`, payload);
          return new MalformedSourceResponse({
            source: SOURCE,
            detail: `JMAP returned error for ${method} (trace=${traceId})`,
          });
        }
      }
      return new MalformedSourceResponse({
        source: SOURCE,
        detail: `JMAP response missing call ${method}#${callId}`,
      });
    };

    return {
      accountId,
      mailboxGet: (ids) =>
        Effect.gen(function* () {
          const args: Record<string, unknown> = { accountId };
          if (ids !== undefined) args.ids = ids;
          const response = yield* callApi([["Mailbox/get", args, "c0"]]);
          const payload = yield* findResponse(response, "Mailbox/get", "c0");
          const parsed = yield* decodeOrFail(MailboxGetResponseSchema, payload);
          return parsed.list as ReadonlyArray<Mailbox>;
        }),
      emailQuery: (params) =>
        Effect.gen(function* () {
          const args: Record<string, unknown> = { accountId };
          if (params.filter !== undefined) args.filter = params.filter;
          if (params.sort !== undefined) args.sort = params.sort;
          if (params.limit !== undefined) args.limit = params.limit;
          if (params.position !== undefined) args.position = params.position;
          const response = yield* callApi([["Email/query", args, "c0"]]);
          const payload = yield* findResponse(response, "Email/query", "c0");
          const parsed = yield* decodeOrFail(EmailQueryResponseSchema, payload);
          return {
            ids: parsed.ids as ReadonlyArray<string>,
            queryState: parsed.queryState,
          };
        }),
      emailGet: (ids, properties) =>
        Effect.gen(function* () {
          const args: Record<string, unknown> = { accountId, ids };
          if (properties !== undefined) args.properties = properties;
          const response = yield* callApi([["Email/get", args, "c0"]]);
          const payload = yield* findResponse(response, "Email/get", "c0");
          const parsed = yield* decodeOrFail(EmailGetResponseSchema, payload);
          return parsed.list;
        }),
    };
  });

const fetchSession = (
  baseUrl: string,
  token: string,
  fetchFn: typeof globalThis.fetch,
): Effect.Effect<typeof SessionSchema.Type, JmapError> =>
  Effect.gen(function* () {
    const res = yield* httpFetch(fetchFn, `${baseUrl}/jmap/session`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return yield* new AuthError({
        source: SOURCE,
        detail: `session endpoint returned ${res.status.toString()}`,
      });
    }
    if (!res.ok) {
      return yield* new TransportError({
        source: SOURCE,
        detail: `session endpoint returned ${res.status.toString()}`,
      });
    }
    const json = yield* parseJson<unknown>(res);
    return yield* decodeOrFail(SessionSchema, json);
  });

const httpFetch = (
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Effect.Effect<Response, TransportError> =>
  Effect.tryPromise({
    try: () => fetchFn(url, init),
    catch: (err) =>
      new TransportError({
        source: SOURCE,
        detail: err instanceof Error ? err.message : String(err),
      }),
  });

const parseJson = <T>(res: Response): Effect.Effect<T, MalformedSourceResponse> =>
  Effect.tryPromise({
    try: () => res.json() as Promise<T>,
    catch: (err) =>
      new MalformedSourceResponse({
        source: SOURCE,
        detail: `response body is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }),
  });

const decodeOrFail = <A>(
  schema: Schema.Schema<A, unknown> | Schema.Schema<A>,
  input: unknown,
): Effect.Effect<A, MalformedSourceResponse> =>
  Schema.decodeUnknown(schema as Schema.Schema<A, unknown>)(input).pipe(
    Effect.mapError(
      (err) =>
        new MalformedSourceResponse({
          source: SOURCE,
          detail: err.message,
        }),
    ),
  );
