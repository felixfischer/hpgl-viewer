# The QuickLook plugin reuses the web renderer through an embedded web view

macOS deprecated QuickLook Generator plugins in macOS 15; previews now use a Quick Look Preview Extension. Rather than write a second, native Swift renderer, the extension hosts a web view that runs the same TypeScript core the web viewer ships (the approach pioneered by `quicklookjs`). One renderer and one test corpus serve both surfaces; the cost is embedding a web view inside an app extension.
