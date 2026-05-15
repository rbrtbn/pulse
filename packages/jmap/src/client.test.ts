import { runTestExit } from "@pulse/core/testing";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  runTestExit(effect.pipe(Effect.provide(FastmailJmapLive({ token: "secret", fetch: fetchFn }))));

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

  it("emailGet returns the raw list array (Connector validates entries)", async () => {
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

  describe("JMAP error response", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("maps a status-200 'error' method response to MalformedSourceResponse, redacting the payload", async () => {
      const fetchFn = fetchOk({
        "https://api.fastmail.com/jmap/session": json(200, sessionBody),
        "https://api.fastmail.com/jmap/api/": json(200, {
          sessionState: "s1",
          methodResponses: [["error", { type: "anchorNotFound", accountId: "u-secret-1" }, "c0"]],
        }),
      });
      const program = Effect.gen(function* () {
        const client = yield* FastmailJmap;
        return yield* client.emailQuery({});
      });
      const exit = await runClient(program, fetchFn);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const detail = JSON.stringify(exit.cause);
        // The raw payload must not appear in the typed error.
        expect(detail).not.toContain("anchorNotFound");
        expect(detail).not.toContain("u-secret-1");
        // The trace ID surface should be present so logs can be correlated.
        expect(detail).toMatch(/trace=[0-9a-f]{8}/);
        // The full payload must have been logged server-side.
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [logMessage, loggedPayload] = errorSpy.mock.calls[0] ?? [];
        expect(String(logMessage)).toMatch(/^\[trace=[0-9a-f]{8}\] JMAP error for Email\/query:/);
        expect(loggedPayload).toEqual({ type: "anchorNotFound", accountId: "u-secret-1" });
      }
    });
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

describe("FastmailJmapLive — emailChanges", () => {
  // emailChanges has bespoke response handling (does NOT use the shared
  // findResponse helper) so the `cannotCalculateChanges` JMAP method error
  // routes to its own tagged type instead of MalformedSourceResponse. The
  // Connector's Catchup fallback depends on that routing — these tests guard
  // against a silent regression that would record failed Runs forever
  // instead of recovering.

  const apiCall = (body: unknown) =>
    fetchOk({
      "https://api.fastmail.com/jmap/session": json(200, sessionBody),
      "https://api.fastmail.com/jmap/api/": json(200, body),
    });

  it("parses created/updated/destroyed/newState/hasMoreChanges on a healthy response", async () => {
    const fetchFn = apiCall({
      sessionState: "s1",
      methodResponses: [
        [
          "Email/changes",
          {
            created: ["M-c1", "M-c2"],
            updated: ["M-u1"],
            destroyed: ["M-d1"],
            newState: "state-2",
            hasMoreChanges: false,
          },
          "c0",
        ],
      ],
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailChanges("state-1");
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        created: ["M-c1", "M-c2"],
        updated: ["M-u1"],
        destroyed: ["M-d1"],
        newState: "state-2",
        hasMoreChanges: false,
      });
    }
  });

  it("maps `cannotCalculateChanges` to its own tag, NOT MalformedSourceResponse", async () => {
    const fetchFn = apiCall({
      sessionState: "s1",
      methodResponses: [["error", { type: "cannotCalculateChanges" }, "c0"]],
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailChanges("stale-state");
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const cause = JSON.stringify(exit.cause);
      expect(cause).toContain("CannotCalculateChanges");
      expect(cause).not.toContain("MalformedSourceResponse");
    }
  });

  describe("non-cannotCalculateChanges JMAP method error", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("redacts the payload, logs it server-side with a trace ID, surfaces MalformedSourceResponse", async () => {
      const fetchFn = apiCall({
        sessionState: "s1",
        methodResponses: [["error", { type: "anchorNotFound", accountId: "u-secret-2" }, "c0"]],
      });
      const program = Effect.gen(function* () {
        const client = yield* FastmailJmap;
        return yield* client.emailChanges("state-1");
      });
      const exit = await runClient(program, fetchFn);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = JSON.stringify(exit.cause);
        expect(cause).toContain("MalformedSourceResponse");
        expect(cause).not.toContain("anchorNotFound");
        expect(cause).not.toContain("u-secret-2");
        expect(cause).toMatch(/trace=[0-9a-f]{8}/);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [logMessage, loggedPayload] = errorSpy.mock.calls[0] ?? [];
        expect(String(logMessage)).toMatch(/^\[trace=[0-9a-f]{8}\] JMAP error for Email\/changes:/);
        expect(loggedPayload).toEqual({ type: "anchorNotFound", accountId: "u-secret-2" });
      }
    });
  });

  it("returns MalformedSourceResponse when the method response is missing", async () => {
    const fetchFn = apiCall({ sessionState: "s1", methodResponses: [] });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailChanges("state-1");
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const cause = JSON.stringify(exit.cause);
      expect(cause).toContain("MalformedSourceResponse");
      expect(cause).toContain("missing call Email/changes");
    }
  });

  it("returns MalformedSourceResponse when the response shape fails schema validation", async () => {
    const fetchFn = apiCall({
      sessionState: "s1",
      methodResponses: [
        // hasMoreChanges missing — required by EmailChangesResponseSchema
        ["Email/changes", { created: [], updated: [], destroyed: [], newState: "s2" }, "c0"],
      ],
    });
    const program = Effect.gen(function* () {
      const client = yield* FastmailJmap;
      return yield* client.emailChanges("state-1");
    });
    const exit = await runClient(program, fetchFn);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("MalformedSourceResponse");
    }
  });
});
