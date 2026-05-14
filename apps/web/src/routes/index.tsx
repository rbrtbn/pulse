import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Root path redirects to /inbox. M1.1 has one user-facing route; the home
 * is just an alias.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
