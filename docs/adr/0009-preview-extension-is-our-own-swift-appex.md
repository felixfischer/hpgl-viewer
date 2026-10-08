# The Preview extension is our own thin Swift appex, not quicklookjs

The Quick Look Preview extension is a small Swift app extension we write and maintain: an `NSViewController` hosting a `WKWebView` that loads a bundled preview page and hands it the file being previewed. We deliberately do not depend on `quicklookjs`, the npm package that pioneered this web-view approach. `quicklookjs` would save almost no Swift — our extension's whole job is to load one bundled page and pass it one file's text — while adding a low-traffic, single-maintainer dependency, an MPL-2.0 obligation, and reliance on undocumented WebKit behaviour (a hidden `<input type=file>` plus an intercepted open panel). Writing our own keeps the extension exactly as thin as the job requires. ADR-0003 already rejected a second native renderer; this refines it: reuse the renderer, but own the host.

## Considered Options

- **Depend on `quicklookjs`** — rejected: little Swift saved, and the dependency is low-traffic and leans on undocumented APIs.
- **Write the extension ourselves** — chosen.

## Consequences

We own the Swift target, its Info.plist, entitlements and signing, and the file-handoff code — all things `quicklookjs` would otherwise have shipped for us.
