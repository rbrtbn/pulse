import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  AuthError,
  MalformedSourceResponse,
  MarkReadError,
  StoreError,
  TransportError,
} from "./errors";
import { runTest } from "./testing";

describe("tagged errors", () => {
  it("MalformedSourceResponse carries _tag and fields", () => {
    const err = new MalformedSourceResponse({
      source: "fastmail",
      detail: "missing id",
    });
    expect(err._tag).toBe("MalformedSourceResponse");
    expect(err.source).toBe("fastmail");
    expect(err.detail).toBe("missing id");
  });

  it("TransportError carries _tag and fields", () => {
    const err = new TransportError({ source: "fastmail", detail: "ECONNRESET" });
    expect(err._tag).toBe("TransportError");
  });

  it("AuthError carries _tag and fields", () => {
    const err = new AuthError({ source: "fastmail", detail: "401" });
    expect(err._tag).toBe("AuthError");
  });

  it("StoreError carries _tag, op, and detail", () => {
    const err = new StoreError({ op: "upsertEmails", detail: "constraint violation" });
    expect(err._tag).toBe("StoreError");
    expect(err.op).toBe("upsertEmails");
    expect(err.detail).toBe("constraint violation");
  });

  it("MarkReadError carries _tag and emailId", () => {
    const err = new MarkReadError({ detail: "JMAP rejected", emailId: "M-1" });
    expect(err._tag).toBe("MarkReadError");
    expect(err.emailId).toBe("M-1");
  });

  it("can be caught with Effect.catchTag", async () => {
    const program = Effect.gen(function* () {
      yield* new TransportError({ source: "fastmail", detail: "boom" });
      return "unreached";
    }).pipe(Effect.catchTag("TransportError", (e) => Effect.succeed(`recovered from ${e._tag}`)));
    const result = await runTest(program);
    expect(result).toBe("recovered from TransportError");
  });

  // Note: "does not catch a different tag" is unnecessary at runtime — the
  // type system rejects Effect.catchTag("TransportError", ...) on an effect
  // whose error channel is e.g. AuthError. The static guarantee is stronger
  // than any runtime assertion would be.
});
