import { AuthError, MalformedSourceResponse, TransportError } from "@cerebro/core";

/**
 * Union of all errors the JMAP client surfaces. Mapped from underlying
 * causes (network, HTTP status, schema validation) to the tagged-error
 * inventory in @cerebro/core so callers handle them with `Effect.catchTag`.
 */
export type JmapError = AuthError | MalformedSourceResponse | TransportError;

/** A JMAP method call triple: ["Method/name", arguments, clientCallId]. */
export type JmapMethodCall = readonly [string, Record<string, unknown>, string];

/** Server's response to one method call. */
export type JmapMethodResponse = readonly [string, Record<string, unknown>, string];

/** The full JMAP HTTP response body. */
export type JmapResponse = {
  readonly sessionState: string;
  readonly methodResponses: ReadonlyArray<JmapMethodResponse>;
};

/** JMAP Mailbox object — the subset we read for INBOX discovery. */
export type Mailbox = {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
};

/** Filter passed to Email/query. The PRD only needs inMailbox + after. */
export type EmailFilter = {
  readonly inMailbox?: string;
  readonly after?: string;
};

/** Sort spec passed to Email/query. */
export type EmailSort = {
  readonly property: string;
  readonly isAscending?: boolean;
};

export type EmailQueryParams = {
  readonly filter?: EmailFilter;
  readonly sort?: ReadonlyArray<EmailSort>;
  readonly limit?: number;
  readonly position?: number;
};

export type EmailQueryResult = {
  readonly ids: ReadonlyArray<string>;
  readonly queryState: string;
};
