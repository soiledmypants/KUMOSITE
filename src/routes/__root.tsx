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
        <h1 className="uppercase tracking-widest">block not found</h1>
        <p className="dim mt-2 lowercase text-sm">the page you're looking for dropped out of the mempool. bibo will pick it up on the next sync.</p>
        <div className="mt-4"><Link to="/" className="box inline-block px-3 py-1 hover:box-inv">[ return to bibo ]</Link></div>
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
        <div className="uppercase tracking-widest">!! tx reverted !!</div>
        <p className="dim mt-2 text-sm lowercase">a packet fell out of the mempool. bibo is re-syncing. try again in a moment.</p>
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
      { title: "BIBO" },
      { name: "description", content: "a tiny on-chain companion on BNB Chain" },
      { name: "author", content: "bibo" },
      { property: "og:title", content: "BIBO" },
      { property: "og:description", content: "a tiny on-chain companion on BNB Chain" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "BIBO" },
      { name: "twitter:description", content: "a tiny on-chain companion on BNB Chain" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d56f920b-2a20-47be-a323-92e3091f4064/id-preview-08a88d74--0e02100e-d2fc-49bd-9d1b-51b4c8969bec.lovable.app-1783797657586.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d56f920b-2a20-47be-a323-92e3091f4064/id-preview-08a88d74--0e02100e-d2fc-49bd-9d1b-51b4c8969bec.lovable.app-1783797657586.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
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
