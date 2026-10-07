# hpgl-viewer

View classic HP-GL plotter files (`.hpgl`, `.plt`) in the browser. Drop a file on
the page (or pick one) and its vectors are drawn, fitted to the window. Everything
runs client-side: parsing happens in a Web Worker, nothing is uploaded.

Live site: https://felixfischer.github.io/hpgl-viewer/ (deployed from `main` by
GitHub Actions).

## Layout

- `packages/core` — parser: `parseHpgl(text)` → `{ pages, warnings }`, a
  renderer-neutral geometry stream in plotter units (see `docs/adr/`).
- `packages/web` — static Vite site: file drop/picker → worker → Canvas 2D.
- `hpgl/` — sample plots; their parse goldens live in `packages/core/goldens/`.

## Develop

```sh
pnpm install
pnpm dev          # local site
pnpm check        # typecheck + lint + unit/golden tests — the one command
pnpm test:e2e     # headless-browser smoke test (once: pnpm --filter @hpgl-viewer/web exec playwright install chromium)
pnpm build        # production site in packages/web/dist
```

After an intentional parser change, refresh goldens with `pnpm test -u` and review the diff.
