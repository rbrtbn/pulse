import { resolve } from "node:path";

import { TransportError } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { PulseDbTest } from "@pulse/database";
import { FastmailJmapStub } from "@pulse/jmap";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { runFastmailSync } from "./sync";

const migrationsFolder = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "database",
  "migrations",
);

const inboxMailbox = { id: "MBX-inbox", name: "INBOX", role: "inbox" };

describe("runFastmailSync", () => {
  it("triggers a Run end-to-end and returns a succeeded result", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () => Effect.succeed([inboxMailbox]),
      emailQuery: () => Effect.succeed({ ids: [], queryState: "qs-1" }),
    });
    const result = await runTest(runFastmailSync(Layer.merge(jmap, PulseDbTest(migrationsFolder))));
    expect(result.status).toBe("succeeded");
    expect(result.runId).toBeGreaterThan(0);
  });

  it("records a failed Run when the Source transport fails", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new TransportError({ source: "fastmail", detail: "ECONNRESET" })),
    });
    const result = await runTest(runFastmailSync(Layer.merge(jmap, PulseDbTest(migrationsFolder))));
    // A Source-side failure still resolves — the Run row exists, carrying
    // the failure; the /inbox banner reads it on the next loader pass.
    expect(result.status).toBe("failed");
    expect(result.runId).toBeGreaterThan(0);
  });
});
