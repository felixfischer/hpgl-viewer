# The Preview ships a classic, worker-less web build loaded over `file://`

The Preview bundles its own minimal web entry — not the Viewer's `dist/` — built as a single classic (IIFE) script with no Web Worker, and loads it with `WKWebView.loadFileURL`. WKWebView refuses ES modules and module workers on a `file://` origin (an opaque `null` origin), so bundling the Viewer's module-based `dist/` verbatim would not run when loaded from disk. The preview renders the plot once, fitted and static, with no pan/zoom; at that scope the module graph and the worker buy nothing, and dropping them is what lets the page load from disk without a local server or a custom URL scheme. The entry reuses `core` and the canvas renderer, but not the Viewer's `main.ts` bootstrap.

## Considered Options

- **Bundle the Viewer's `dist/` as-is** — rejected: ES modules and the module worker are blocked on `file://`.
- **A data-based preview returning HTML** — rejected: it forfeits the WKWebView we control (and its worker/canvas behaviour).
- **Serve `dist/` through a custom `WKURLSchemeHandler`** — rejected for the skeleton: it buys a real origin for modules and the worker, which the static preview does not need. Held in reserve if we later want the worker or live interactivity.
- **A classic, worker-less build loaded via `loadFileURL`** — chosen.

## Consequences

The Preview entry is a code path distinct from the site's entry — it shares `core` and `render.ts` but not `main.ts`. Parsing runs on the main thread, which is fine for a one-shot static render.
