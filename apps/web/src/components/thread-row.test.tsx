// @vitest-environment happy-dom
import type { UnreadThread } from "@pulse/database";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the (hoisted) vi.mock factories below can close over them.
const { markReadMock, invalidate } = vi.hoisted(() => ({
  markReadMock: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ invalidate }),
}));

vi.mock("../server/actions", () => ({ markRead: markReadMock }));

import { ThreadRow } from "./thread-row";

const thread: UnreadThread = {
  threadId: "T-1",
  latestEmailId: "M-1",
  latestFromName: "Mira Patel",
  latestFromEmail: "mira@example.com",
  subject: "Q2 planning",
  preview: "let's push to Thursday",
  receivedAt: new Date("2026-05-14T14:00:00Z"),
  messageCount: 1,
  distinctOthers: 0,
};

const rowButton = () => screen.getByRole("button", { name: /Mark .* read/ });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadRow — mark-read interaction", () => {
  it("calls markRead with the row's email id, shows a spinner in flight, then invalidates", async () => {
    let resolveMarkRead: (r: { ok: true }) => void = () => {};
    markReadMock.mockReturnValue(
      new Promise<{ ok: true }>((res) => {
        resolveMarkRead = res;
      }),
    );
    const user = userEvent.setup();
    render(<ThreadRow thread={thread} />);

    await user.click(rowButton());

    expect(markReadMock).toHaveBeenCalledWith({ data: { emailId: "M-1" } });
    // In flight: the row shows a spinner and disables against a double-click.
    expect(screen.getByRole("status")).toBeTruthy();
    expect((rowButton() as HTMLButtonElement).disabled).toBe(true);

    resolveMarkRead({ ok: true });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  it("renders the MarkReadError inline and keeps the row on failure", async () => {
    markReadMock.mockResolvedValue({
      ok: false,
      errorTag: "MarkReadError",
      errorMessage: "Fastmail refused to mark 1 message(s) read",
    });
    const user = userEvent.setup();
    render(<ThreadRow thread={thread} />);

    await user.click(rowButton());

    const errorLine = await screen.findByText(/MarkReadError/);
    expect(errorLine.textContent).toContain("Fastmail refused to mark 1 message(s) read");
    expect(invalidate).not.toHaveBeenCalled();
    // The row stays put and is interactive again for a retry.
    expect((rowButton() as HTMLButtonElement).disabled).toBe(false);
  });
});
