import type { UnreadThread } from "@pulse/database";
import { Badge, Spinner } from "@pulse/ui-shadcn";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { formatHybrid, formatTooltip } from "../lib/time-format";
import { markRead } from "../server/actions";

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
export const ThreadRow = ({ thread }: { thread: UnreadThread }) => {
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
