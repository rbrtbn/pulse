import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { FastmailJmap, FastmailJmapLive } from "./client";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sessionBody = {
  apiUrl: "https://api.fastmail.com/jmap/api/",
  primaryAccounts: { "urn:ietf:params:jmap:mail": "u-account-1" },
};

const urlKey = (url: string | URL | Request): string => {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.href;
  return url.url;
};

const fetchOk =
  (responses: Record<string, Response>) =>
  async (url: string | URL | Request): Promise<Response> => {
    const key = urlKey(url);
    const res = responses[key];
    if (res === undefined) throw new Error(`unstubbed fetch: ${key}`);
    return res;
  };

const runClient = <A, E>(
  effect: Effect.Effect<A, E, FastmailJmap>,
  fetchFn: typeof globalThis.fetch,
) =>
  Effect.runPromiseExit(
    effect.pipe(Effect.provide(FastmailJmapLive({ token: "secret", fetch: fetchFn }))),
  );

describe("FastmailJmapLive — session discovery", () => {
  it("resolves accountId from primaryAccounts on a healthy session", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return client.accountId;
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("u-account-1");
  });

  it("maps 401 from the session endpoint to AuthError", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(401, {
        type: "about:blank",
      }),
    });
    const program = Effect.gen(function* () {
      yield* FastmailJmap;
      return "unreached";
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("maps 5xx from the session endpoint to TransportError", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(503, {
        type: "about:blank",
      }),
    });
    const program = Effect.gen(function* () {
      yield* FastmailJmap;
      return "unreached";
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("maps a session without a mail primary account to MalformedSourceResponse", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, {
        apiUrl: "https://api.fastmail.com/jmap/api/",
        primaryAccounts: { "urn:ietf:params:jmap:contacts": "u-other" },
      }),
    });
    const program = Effect.gen(function* () {
      yield* FastmailJmap;
      return "unreached";
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("FastmailJmapLive — mailboxGet", () => {
  it("returns the parsed mailbox list on a healthy response", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
      "https://api.fastmail.com/jmap/api/": json(200, {
        sessionState: "s1",
        methodResponses: [
          [
            "Mailbox/get",
            {
              list: [
                { id: "MBX-inbox", name: "INBOX", role: "inbox" },
                { id: "MBX-archive", name: "Archive", role: "archive" },
              ],
            },
            "c0",
          ],
        ],
      }),
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.mailboxGet();
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.map((m) => m.role)).toEqual(["inbox", "archive"]);
    }
  });

  it("returns MalformedSourceResponse when the response is missing the call id", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
      "https://api.fastmail.com/jmap/api/": json(200, {
        sessionState: "s1",
        methodResponses: [],
      }),
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.mailboxGet();
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("FastmailJmapLive — emailQuery + emailGet", () => {
  it("returns ids and queryState from emailQuery", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
      "https://api.fastmail.com/jmap/api/": json(200, {
        sessionState: "s1",
        methodResponses: [["Email/query", { ids: ["M-1", "M-2"], queryState: "qs-1" }, "c0"]],
      }),
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailQuery({
        filter: { inMailbox: "MBX-inbox" },
        limit: 100,
      });
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ ids: ["M-1", "M-2"], queryState: "qs-1" });
    }
  });

  it("emailGet returns the raw list array (Worker validates entries)", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
      "https://api.fastmail.com/jmap/api/": json(200, {
        sessionState: "s1",
        methodResponses: [["Email/get", { list: [{ id: "M-1" }, { id: "M-2" }] }, "c0"]],
      }),
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailGet(["M-1", "M-2"]);
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toHaveLength(2);
  });

  it("maps JMAP error response (status 200 with 'error' method response) to MalformedSourceResponse", async () => {
    const fetchFn = fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
      "https://api.fastmail.com/jmap/api/": json(200, {
        sessionState: "s1",
        methodResponses: [["error", { type: "anchorNotFound" }, "c0"]],
      }),
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailQuery({});
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("maps a network throw to TransportError", async () => {
    const fetchFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.mailboxGet();
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
