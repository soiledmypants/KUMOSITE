import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteChrome } from "../components/SiteChrome";

function NotFoundComponent() {
  return (
    <SiteChrome>
      <div className="box p-6 text-center">
        <pre className="text-[10px] leading-none mb-4 opacity-70">{`
   ██╗  ██╗ ██████╗ ██╗  ██╗
   ██║  ██║██╔═████╗██║  ██║
   ███████║██║██╔██║███████║
   ╚════██║████╔╝██║╚════██║
        ██║╚██████╔╝     ██║
        ╚═╝ ╚═════╝      ╚═╝`}</pre>
        <h1 className="uppercase tracking-widest">signal lost</h1>
        <p className="dim mt-2 lowercase text-sm">the page you're looking for slipped off the wire. moss will sweep it up eventually.</p>
        <div className="mt-4"><Link to="/" className="box inline-block px-3 py-1 hover:box-inv">[ return to green room ]</Link></div>
      </div>
    </SiteChrome>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <SiteChrome>
      <div className="box p-6">
        <div className="uppercase tracking-widest">!! transmission error !!</div>
        <p className="dim mt-2 text-sm lowercase">a packet fell off the switch. moss is sweeping. try again in a moment.</p>
        <pre className="text-xs mt-3 opacity-60">{String(error?.message || "unknown fault")}</pre>
        <div className="mt-4 flex gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="box px-3 py-1 hover:box-inv">[ retry ]</button>
          <a href="/" className="box px-3 py-1 hover:box-inv">[ home ]</a>
        </div>
      </div>
    </SiteChrome>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "the green room :: moss is sweeping" },
      { name: "description", content: "the green room — an archive of packets that fell off the internet. maintained by moss, signal janitor." },
      { name: "author", content: "moss" },
      { property: "og:title", content: "the green room" },
      { property: "og:description", content: "sweeping the wires since before you logged on." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <SiteChrome>
        <Outlet />
      </SiteChrome>
    </QueryClientProvider>
  );
}
