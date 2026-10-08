# macOS Preview surface

The macOS **Preview** surface (spec #12): a carrier application and a Quick Look
Preview app extension that draw an HP-GL plot in Finder, reusing the same core
renderer as the browser **Viewer**. See `GLOSSARY.md` (*Preview*) and ADR-0009 /
ADR-0010.

This package has **no `package.json`**, so neither pnpm's workspace nor the
repo-wide `pnpm -r build` (which runs on Linux CI) ever touches it.

The Xcode project is generated from `project.yml` by [XcodeGen]. The generated
`HPGLViewer.xcodeproj`, the build output, the staged web bundle, and the derived
`Info.plist` / `.entitlements` files are gitignored — `project.yml` is the source
of truth.

## Build

One command, from the repo root:

```sh
pnpm package:macos
```

It runs `scripts/package-macos.sh`, which:

1. builds the worker-less classic preview web bundle (`pnpm --filter
   @hpgl-viewer/web build:preview`),
2. stages `packages/web/dist/preview/` into `PreviewExtension/Resources/preview/`,
3. runs `xcodegen generate`,
4. runs `xcodebuild` (Release, ad-hoc signed).

It is deliberately **not** named `build` so CI never invokes it.

## Install and verify locally

```sh
BUNDLE=packages/macos/build/Build/Products/Release/HPGLViewer.app
APPEX=$BUNDLE/Contents/PlugIns/HPGLPreviewExtension.appex

# signature + entitlements (ad-hoc; no/on this machine)
codesign --verify --deep --strict -v "$BUNDLE"
codesign -d --entitlements - --xml "$APPEX"

# register the extension, then confirm the system sees it
lsregister -f "$BUNDLE" 2>/dev/null   # see the full path below if needed
pluginkit -a "$APPEX"
pluginkit -m -p com.apple.quicklook.preview

# preview a plot (force the content type if LaunchServices has not resolved it)
qlmanage -r && qlmanage -r cache
qlmanage -p hpgl/plotter.hpgl
qlmanage -p -c com.felixfischer.hpgl hpgl/plotter.hpgl
```

Watch the extension's own log while it runs:

```sh
log stream --level debug \
  --predicate 'subsystem == "com.felixfischer.HPGLViewer.PreviewExtension"'
```

`lsregister` is at
`/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister`.
Note `qlmanage -m plugins` does **not** list appex preview extensions; use
`pluginkit`.

## Deviation: the extension carries `com.apple.security.network.client`

The spec and ticket call for the extension to request no capability it does not
need, and specifically **no network entitlement**. In practice a sandboxed
`WKWebView` will not render inside an app extension without
`com.apple.security.network.client`, so the extension carries it. The carrier app
does **not**.

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
(`loadFileURL`) and the extension makes no network requests. The entitlement is
present solely to let WebKit spin up its sandboxed helper processes.

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
