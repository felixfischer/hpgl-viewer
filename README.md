# hpgl-viewer

View classic HP-GL plotter files (`.hpgl`, `.plt`) in the browser. The viewer opens with
the bundled sample plot, so there's something to see right away — drag another file onto
the page, or pick one, to replace it and draw its vectors fitted to the window. Everything
runs client-side: parsing happens in a Web Worker and nothing is uploaded.

Live site: https://felixfischer.github.io/hpgl-viewer/ (deployed from `main` by GitHub
Actions).

![The viewer rendering the bundled showcase plot: a reference sheet of
vectors, line types, circles, arcs, wedges, rectangles, polygons, fills and labels](screenshot.webp)

## What it does

- **Load** by drag-and-drop or file picker; drop another file to replace the first.
- **Render** every primitive — lines, circles, arcs, filled and outlined polygons,
  rectangles and wedges, and labels — with a distinct colour per pen and the file's line
  types.
- **View** fitted to the window by default; wheel to zoom about the cursor, drag to pan,
  reset to fit, and toggle **actual page size** (honours `IP`/`PS`).
- **Pens**: a legend lists the pens the file actually uses; recolour any pen or reset the
  palette.
- **Pages**: multi-page files get a page selector.
- **Export** as SVG (from the geometry stream — labels stay text, circles and arcs stay
  curves) or PNG (from the canvas).
- **Tolerate** unsupported commands: they're skipped to the next terminator, parsing
  continues, and a dismissable banner lists them. HP-GL/2 input renders what it can with a
  specific notice.

The same input always produces the same output, so the goldens stay stable.

## Supported commands

v1 targets **classic HP-GL** only. Every command that affects output is implemented:

| Group | Commands |
| --- | --- |
| Setup | `IN`, `DF`, `IP`, `SC` |
| Vectors | `PU`, `PD`, `PA`, `PR`, `LT` |
| Pen | `SP` |
| Arcs & circles | `CI`, `AA`, `AR`, `CT` |
| Polygons & fills | `PM`, `FP`, `EP`, `RA`, `RR`, `EA`, `ER`, `WG`, `EW`, `FT`, `PT` |
| Labels | `LB`, `BL`, `PB`, `DT`, `SI`, `SR`, `SU`, `SL`, `DI`, `DR`, `DU`, `DV`, `LO`, `CP`, `ES`, `CS`, `CA`, `SS`, `SA` |
| Page & window | `IW`, `RO`, `PG`, `AF`, `NR`, `PS` |

`VS` is accepted without effect. Any other mnemonic is skipped to the next terminator and
recorded as a warning.

**Out of scope for v1:** HP-GL/2 and HP RTL (detected and warned, not rendered — ADR-0001),
a command-line tool, PDF export, and anything server-side. The macOS QuickLook plugin is
phase 2 (ADR-0003) and will reuse the same renderer.

## Layout

```text
packages/core   parser and geometry stream (no DOM)
packages/web    static Vite site: worker → Canvas 2D, SVG/PNG export
hpgl/           sample plots (fixtures); parse goldens in packages/core/goldens/
docs/adr/       architecture decisions
GLOSSARY.md     the domain language (dialects, units, pen, polygon buffer, …)
```

`core` exposes `parseHpgl(text)` → `{ pages, warnings, scalingPoints }`: a renderer-neutral
stream of primitives (polyline, circle, arc, wedge, rectangle, polygon, label), each tagged
with its pen, line type and input window, in plotter units (0.025 mm, bottom-left origin,
Y up). Renderers flip Y once and tessellate curves with the shared `tessellate`/`arcPoints`.
`core` also exports the pen palette (`penColour`, `usedPens`, `DEFAULT_PALETTE`). ADR-0005
explains why the stream preserves primitives instead of flattening to line segments.

## Develop

```sh
pnpm install
pnpm dev          # local site
pnpm check        # typecheck + lint + unit/golden tests — the one command
pnpm build        # production site in packages/web/dist
pnpm test:e2e     # headless-browser smoke test (once: pnpm --filter @hpgl-viewer/web exec playwright install chromium)
```

TypeScript (strict), Vite, Vitest, Biome, Playwright, on pnpm.

## Testing

Tests live at two seams, plus a browser smoke test:

- **Parse boundary** (`packages/core/src/parse.test.ts`): every fixture in `hpgl/` is parsed
  and compared against a committed golden in `packages/core/goldens/`. This covers the whole
  language surface — commands, units, modes, pens, line types, error tolerance.
- **SVG export** (`packages/web/src/svg.test.ts`): the geometry stream rendered to SVG and
  compared against `packages/web/goldens/`, one golden per primitive.
- **Smoke test** (`packages/web/e2e/smoke.spec.ts`): loads fixtures in a headless browser
  and asserts the canvas painted, that warnings/legend/page-selector/view controls wire up,
  and that SVG and PNG downloads are produced.

When a parser or exporter change intentionally alters output, refresh the affected goldens
with `pnpm test -u` and review the diff before committing.

## Deploy

Pushing to `main` runs `pnpm check`, `pnpm test:e2e` and `pnpm build` on GitHub Actions; a
successful build is published to GitHub Pages (`.github/workflows/deploy.yml`).
