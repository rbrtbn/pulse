import type { Run } from "@pulse/core";
import type { UnreadThread } from "@pulse/database";
import { Button, Spinner } from "@pulse/ui-shadcn";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { ThreadRow } from "../components/thread-row";
import { formatHybrid, formatTooltip } from "../lib/time-format";
import { fetchInboxData, syncNow } from "../server/actions";
import type { SyncFailure } from "../server/queries";

export const Route = createFileRoute("/inbox")({
  loader: () => fetchInboxData(),
  component: InboxPage,
});

function InboxPage() {
  const { threads, latestSuccess, failure } = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <div className="flex flex-col items-end gap-1.5">
          <SyncButton />
          <FreshnessLine latestSuccess={latestSuccess} />
        </div>
      </header>
      {failure !== null ? <FailureBanner failure={failure} /> : null}
      {threads.length === 0 ? (
        <EmptyState latestSuccess={latestSuccess} />
      ) : (
        <ThreadList threads={threads} />
      )}
    </main>
  );
}

/**
 * Triggers a Run via the `syncNow` server function, then invalidates the
 * route loader so the freshness line, banner, and list re-render. The
 * spinner stays up until the loader refetch resolves. A Source-side
 * failure surfaces in the banner after invalidation; only an infra
 * failure (unreachable Database, missing token) lands in the inline error.
 */
const SyncButton = () => {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setSyncing(true);
    setError(null);
    void syncNow()
      .then(() => router.invalidate())
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Sync failed");
      })
      .finally(() => {
        setSyncing(false);
      });
  };

  return (
    <div className="flex items-center gap-2">
      {error !== null ? <span className="text-xs text-red-600">{error}</span> : null}
      <Button variant="outline" onClick={handleClick} disabled={syncing}>
        {syncing ? <Spinner /> : null}
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
};

/**
 * Calm-by-default sync health: renders nothing unless the latest Run
 * attempt failed and no later success cleared it (the loader's
 * `deriveFailure` decides — this component only paints).
 */
const FailureBanner = ({ failure }: { failure: SyncFailure }) => (
  <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm">
    <p className="font-medium text-red-800">Last sync failed — {failure.errorTag}</p>
    {failure.errorMessage !== "" ? (
      <p className="mt-0.5 text-red-700">{failure.errorMessage}</p>
    ) : null}
  </div>
);

const FreshnessLine = ({ latestSuccess }: { latestSuccess: Run | null }) => {
  if (latestSuccess === null) return null;
  return (
    <span className="text-xs text-neutral-500" title={formatTooltip(latestSuccess.startedAt)}>
      Last synced {formatHybrid(latestSuccess.startedAt)}
    </span>
  );
};

/**
 * Two distinct empty cells per issue #15. State A — no successful sync
 * exists: invite a first sync. State B — synced, nothing unread: confirm
 * with the last-sync time. No shared "nothing to show" fallback.
 */
const EmptyState = ({ latestSuccess }: { latestSuccess: Run | null }) => {
  if (latestSuccess === null) {
    return (
      <section className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
        <p className="text-neutral-700">No sync yet.</p>
        <p className="mt-2 text-sm text-neutral-500">
          Run <code className="rounded bg-neutral-100 px-1 py-0.5">bin/sync-fastmail</code> or click
          Sync now to populate your inbox.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
      <p className="text-neutral-700">No unread threads. ✓</p>
      <p className="mt-2 text-sm text-neutral-500" title={formatTooltip(latestSuccess.startedAt)}>
        Last synced {formatHybrid(latestSuccess.startedAt)}.
      </p>
    </section>
  );
};

const ThreadList = ({ threads }: { threads: UnreadThread[] }) => (
  <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
    {threads.map((thread) => (
      <ThreadRow key={thread.threadId} thread={thread} />
    ))}
  </ul>
);
