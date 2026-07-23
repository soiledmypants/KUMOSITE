// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Fully static: TanStack Start prerenders every route into dist/client and
  // Netlify publishes that folder as-is (see netlify.toml). Nitro is skipped
  // entirely — an all-static site needs no server bundle, and nitro's
  // *-static presets currently break against TanStack Start's SSR entry
  // ("rolldownOptions.input should not be an html file").
  nitro: false,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
    prerender: {
      enabled: true,
      crawlLinks: true,
    },
    // Setting `pages` replaces the default [{ path: "/" }], so "/" must stay listed.
    pages: [{ path: "/" }, { path: "/sitemap.xml" }],
  },
});
