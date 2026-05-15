import type { Run } from "@pulse/core";
import type { UnreadThread } from "@pulse/database";
import { Badge, Button, Spinner } from "@pulse/ui-shadcn";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { formatHybrid, formatTooltip } from "../lib/time-format";
import { fetchInboxData, markRead, syncNow } from "../server/actions";
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

/**
 * One /inbox thread row. Clicking it marks the whole thread read — the
 * first App→Connector write (ADR 0003). Pessimistic per issue #16: the
 * spinner holds until the server confirms, then the loader refetch drops
 * the row; a failure keeps the row and renders MarkReadError inline.
 * Each row owns its in-flight state, so marking one never blocks another.
 *
 * The row content is built from <span>s, not <div>/<p>, so the whole row
 * is one valid, focusable <button>.
 */
const ThreadRow = ({ thread }: { thread: UnreadThread }) => {
  const router = useRouter();
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (marking) return;
    setMarking(true);
    setError(null);
    void markRead({ data: { emailId: thread.latestEmailId } })
      .then((result) => {
        if (result.ok) return router.invalidate();
        setError(`${result.errorTag}: ${result.errorMessage}`);
        setMarking(false);
        return undefined;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Mark-read failed");
        setMarking(false);
      });
  };

  return (
    <li className="p-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={marking}
        aria-label={`Mark "${thread.subject || "(no subject)"}" read`}
        className="block w-full text-left transition-opacity hover:opacity-70 disabled:opacity-50"
      >
        <span className="flex items-baseline justify-between gap-2">
          <SenderDisplay thread={thread} />
          {marking ? (
            <Spinner className="shrink-0 text-neutral-400" />
          ) : (
            <time
              className="shrink-0 text-xs text-neutral-500"
              dateTime={thread.receivedAt.toISOString()}
              title={formatTooltip(thread.receivedAt)}
            >
              {formatHybrid(thread.receivedAt)}
            </time>
          )}
        </span>
        <span className="mt-1 block text-sm font-medium text-neutral-800">
          {thread.subject || "(no subject)"}
        </span>
        <span className="mt-1 block line-clamp-1 text-sm text-neutral-500">{thread.preview}</span>
        {thread.messageCount > 1 ? (
          <span className="mt-2 block">
            <Badge variant="secondary">{thread.messageCount} msgs</Badge>
          </span>
        ) : null}
      </button>
      {error !== null ? (
        <p className="mt-2 text-xs text-red-600">Couldn’t mark read — {error}</p>
      ) : null}
    </li>
  );
};

const SenderDisplay = ({ thread }: { thread: UnreadThread }) => {
  const primary = thread.latestFromName ?? thread.latestFromEmail;
  return (
    <span className="truncate text-sm font-semibold text-neutral-900">
      {primary}
      {thread.distinctOthers > 0 ? (
        <span className="ml-1 text-xs font-normal text-neutral-500">
          +{thread.distinctOthers.toString()} other{thread.distinctOthers === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
};
