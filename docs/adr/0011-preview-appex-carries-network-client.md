# The Preview appex carries `com.apple.security.network.client`

The Quick Look Preview app extension carries the `com.apple.security.network.client` entitlement even though spec #12 / ticket #14 called for "no network entitlement". The deviation is empirical, not a change of mind: inside an app extension a sandboxed `WKWebView` cannot launch its web content process without it. With only `com.apple.security.app-sandbox` and `com.apple.security.files.user-selected.read-only`, WebKit logs `WebProcessProxy::didFinishLaunching: Invalid connection identifier` (web process failed to launch) alongside a GPU-process crash, and `WKNavigationDelegate.didFinish` never fires, so the preview stays blank. Adding the entitlement to the appex alone makes the identical local `file://` preview paint. The page is loaded from a bundled `file://` URL and opens no socket, so no network capability is actually exercised — the entitlement is present solely to let WebKit spin up its sandboxed helper processes. It is scoped to the appex: the carrier app, which does nothing but register the extension, carries no network entitlement. See ADR-0010 for the worker-less `file://` preview build this entitlement lets run.

## Considered Options

- **No network entitlement, as the spec and ticket asked** — rejected: the sandboxed `WKWebView` never launches its web content process and the preview renders nothing.
- **Change the load path instead (e.g. bundle the Viewer's `dist/`)** — rejected: the failure is WebKit's helper-process launch, not the page's module graph, so no bundle change avoids it.
- **Carry `com.apple.security.network.client` on the appex alone** — chosen.

## Consequences

The extension asks for one capability it does not use, and this is the one deviation from the spec's "no network entitlement"; it is recorded here and pointed to from the *Deviation* section of `packages/macos/README.md`. The load remains a local `file://` page that opens no socket, and the carrier app stays entitlement-free apart from the sandbox and the read-only file access the extension host needs.
