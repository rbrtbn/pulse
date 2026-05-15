import appCss from "@pulse/ui-shadcn/styles.css?url";
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Pulse" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Router-wide fallback for unmatched paths. Without it TanStack Router
 * logs a warning and renders its bare `<p>Not Found</p>`; this keeps a
 * stray URL on the same calm surface as the rest of Pulse.
 */
function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
        <p className="text-neutral-700">Page not found.</p>
        <Link to="/inbox" className="mt-2 inline-block text-sm text-neutral-500 underline">
          Go to your inbox
        </Link>
      </section>
    </main>
  );
}
