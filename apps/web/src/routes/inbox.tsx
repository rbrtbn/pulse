import type { SyncRun } from "@cerebro/core";
import type { UnreadThread } from "@cerebro/store";
import { Badge } from "@cerebro/ui-shadcn";
import { createFileRoute } from "@tanstack/react-router";

import { formatHybrid, formatTooltip } from "../lib/time-format";
import { fetchLatestSyncRun, fetchUnreadThreads } from "../server/queries";

export const Route = createFileRoute("/inbox")({
  loader: async () => {
    const [threads, latestSuccess] = await Promise.all([
      fetchUnreadThreads(),
      fetchLatestSyncRun("fastmail"),
    ]);
    return { threads, latestSuccess };
  },
  component: InboxPage,
});

function InboxPage() {
  const { threads, latestSuccess } = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <FreshnessLine latestSuccess={latestSuccess} />
      </header>
      {threads.length === 0 ? (
        <EmptyState latestSuccess={latestSuccess} />
      ) : (
        <ThreadList threads={threads} />
      )}
    </main>
  );
}

const FreshnessLine = ({ latestSuccess }: { latestSuccess: SyncRun | null }) => {
  if (latestSuccess === null) return null;
  return (
    <span className="text-xs text-neutral-500" title={formatTooltip(latestSuccess.startedAt)}>
      Last synced {formatHybrid(latestSuccess.startedAt)}
    </span>
  );
};

const EmptyState = ({ latestSuccess }: { latestSuccess: SyncRun | null }) => {
  if (latestSuccess === null) {
    return (
      <section className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
        <p className="text-neutral-700">No sync yet.</p>
        <p className="mt-2 text-sm text-neutral-500">
          Run <code className="rounded bg-neutral-100 px-1 py-0.5">bin/sync-fastmail</code> to
          populate your inbox.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
      <p className="text-neutral-700">No unread threads. ✓</p>
    </section>
  );
};

const ThreadList = ({ threads }: { threads: UnreadThread[] }) => (
  <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
    {threads.map((thread) => (
      <li key={thread.threadId} className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <SenderDisplay thread={thread} />
          <time
            className="shrink-0 text-xs text-neutral-500"
            dateTime={thread.receivedAt.toISOString()}
            title={formatTooltip(thread.receivedAt)}
          >
            {formatHybrid(thread.receivedAt)}
          </time>
        </div>
        <p className="mt-1 text-sm font-medium text-neutral-800">
          {thread.subject || "(no subject)"}
        </p>
        <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{thread.preview}</p>
        {thread.messageCount > 1 ? (
          <div className="mt-2">
            <Badge variant="secondary">{thread.messageCount} msgs</Badge>
          </div>
        ) : null}
      </li>
    ))}
  </ul>
);

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
