# macOS Preview surface

The macOS **Preview** surface (spec #12): a carrier application and a Quick Look
Preview app extension that draw an HP-GL plot in Finder, reusing the same core
renderer as the browser **Viewer**. See `GLOSSARY.md` (*Preview*) and ADR-0009 /
ADR-0010.

This package has **no `package.json`**, so neither pnpm's workspace nor the
repo-wide `pnpm -r build` (which runs on Linux CI) ever touches it.

The Xcode project is **generated** from the checked-in `project.yml` by
[XcodeGen]; `project.yml` is the source of truth. The generated
`HPGLViewer.xcodeproj`, the build output, the staged web bundle, and the derived
`Info.plist` / `.entitlements` files are gitignored — never edit them by hand.

## Prerequisites

- **Xcode** (its command-line tools provide `xcodebuild`).
- **[XcodeGen]**, installed with Homebrew:

  ```sh
  brew install xcodegen
  ```

## Build

One command, from the repo root:

```sh
pnpm package:macos
```

It runs `scripts/package-macos.sh`, which:

1. builds the worker-less classic preview web bundle (`pnpm --filter
   @hpgl-viewer/web build:preview`),
2. stages `packages/web/dist/preview/` into `PreviewExtension/Resources/preview/`,
3. generates `HPGLViewer.xcodeproj` from `project.yml` (`xcodegen generate`),
4. runs `xcodebuild` (Release, ad-hoc signed).

It is deliberately **not** named `build`, so the repo-wide `pnpm -r build` (which
runs on Linux CI) never invokes it.

The built app lands at
`packages/macos/build/Build/Products/Release/HPGLViewer.app`.

## Install and verify locally

This is a walking skeleton built and run on the developer's Mac; nothing is
signed for distribution. Install the app, register it, then preview a file.

```sh
BUNDLE=packages/macos/build/Build/Products/Release/HPGLViewer.app
APPEX="$BUNDLE/Contents/PlugIns/HPGLPreviewExtension.appex"

# --- sanity-check the artefact (ad-hoc; no codesigning identities on this machine) ---
codesign --verify --deep --strict -v "$BUNDLE"
codesign -d --entitlements - --xml "$APPEX"

# --- install + register ---
ditto "$BUNDLE" /Applications/HPGLViewer.app          # copy into /Applications
open -a /Applications/HPGLViewer.app                  # launch once: macOS discovers the extension
pluginkit -a "$APPEX"                                 # or register explicitly, no launch needed

# --- confirm the system sees it ---
pluginkit -m -p com.apple.quicklook.preview           # one line per installed Preview appex
pluginkit -m -A -v -p com.apple.quicklook.preview \
  -i com.felixfischer.HPGLViewer.PreviewExtension     # path + registration date, including disabled

# --- reset caches, then preview ---
qlmanage -r                                           # reload the generator list
qlmanage -r cache                                     # clear the preview/thumbnail disk cache
killall QuickLookUIService 2>/dev/null; killall quicklookd 2>/dev/null  # drop stale daemon state
qlmanage -p hpgl/plotter.hpgl                         # the acceptance test
qlmanage -p -c com.felixfischer.hpgl hpgl/plotter.hpgl  # force the content type if .hpgl has not resolved

# --- uninstall / clean registration ---
pluginkit -r /Applications/HPGLViewer.app/Contents/PlugIns/HPGLPreviewExtension.appex
rm -rf /Applications/HPGLViewer.app
```

Notes:

- `ditto` (not `cp -R`) preserves the bundle's metadata and signature; it is also
  what `scripts/package-macos.sh` prints.
- Launching the carrier app once is what makes macOS discover its embedded
  extension. `pluginkit -a "$APPEX"` does the same registration explicitly,
  without a launch (verified to work even from a non-`/Applications`, ad-hoc
  build).
- `pluginkit -m -p com.apple.quicklook.preview` lists **Preview** extensions;
  `qlmanage -m plugins` does **not** (it lists legacy `.qlgenerator` bundles
  only).
- `qlmanage -p` opens the Quick Look window for a file; adding
  `-c com.felixfischer.hpgl` forces the content type — the escape hatch while
  LaunchServices has not resolved `.hpgl` yet.
- Each build produces a fresh ad-hoc signature, so macOS treats the rebuilt app
  as new; re-run `pluginkit -a` and `qlmanage -r` after every rebuild.
- If Finder still shows the generic preview, enable the extension under
  **System Settings > General > Login Items & Extensions > Quick Look**
  (it appears as **HP-GL Preview**).

Watch the extension's own log while it runs:

```sh
log stream --level debug \
  --predicate 'subsystem == "com.felixfischer.HPGLViewer.PreviewExtension"'
```

`lsregister` is at
`/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister`;
use it to force-register the app (`lsregister -f "$BUNDLE"`) when diagnosing UTI
resolution.

## Deviation: the extension carries `com.apple.security.network.client`

The spec and ticket call for the extension to request no capability it does not
need, and specifically **no network entitlement**. In practice a sandboxed
`WKWebView` will not launch its web content process inside an app extension
without `com.apple.security.network.client`, so the extension carries it. This is
the **one** deviation from the spec's "no network entitlement". The carrier app
does **not** carry it. Recorded as ADR-0011
(`docs/adr/0011-preview-appex-carries-network-client.md`).

This was resolved empirically on the build machine (macOS 26.7.1 / Xcode 27.0),
not guessed. With only `app-sandbox` + `files.user-selected.read-only`:

- `preparePreviewOfFile` runs and the file reads fine, but the web page never
  finishes loading — `WKNavigationDelegate.didFinish` never fires;
- WebKit logs `WebProcessProxy::didFinishLaunching: Invalid connection identifier
  (web process failed to launch)` and `GPUProcessProxy::gpuProcessExited:
  reason=Crash`.

Adding `com.apple.security.network.client` to the appex alone makes the same
preview complete: `didFinish` fires, `renderPreview` returns no error, and the
canvas paints (a diagnostic read back 72,717 non-transparent pixels at the
800×600 preview size for `hpgl/plotter.hpgl`).

**Why this is safe:** the page is loaded from a bundled `file://` URL
(`loadFileURL`) and the extension makes **no network requests**. The entitlement
is present solely to let WebKit spin up its sandboxed helper processes.

## The sandbox can read the URL Quick Look hands us

The spec flagged a risk that the extension's sandbox might refuse the URL from
`preparePreviewOfFile(at:)`. It does **not**: with the two sandbox entitlements
above, `Data(contentsOf: url)` succeeds (observed reading 47,181 bytes from
`hpgl/plotter.hpgl`). No `WKUIDelegate` open-panel fallback is used.

## Logging note

The extension logs through `os.Logger` (subsystem =
`com.felixfischer.HPGLViewer.PreviewExtension`). `NSLog` from this sandboxed,
ad-hoc-signed appex did not surface in the unified log on the build machine, so
`Logger` is used for the one permanent "read N bytes / read failed" line.

[XcodeGen]: https://github.com/yonaskolb/XcodeGen
