import AppKit
import OSLog
import QuickLookUI
import WebKit

/// The extension's own log. `subsystem` is the bundle id, so it streams with
/// `log stream --predicate 'subsystem == "com.felixfischer.HPGLViewer.PreviewExtension"'`.
/// (`NSLog` output from this sandboxed appex did not reach the unified log here;
/// an `os.Logger` does — see the package README.)
private let previewLog = Logger(
    subsystem: "com.felixfischer.HPGLViewer.PreviewExtension",
    category: "Preview"
)

/// One file, one shot: load the bundled preview shell, hand it the previewed
/// file's text, done. A thin shell by design (ADR-0009) — all HP-GL knowledge
/// stays in the web bundle staged at `Resources/preview/` (ADR-0010).
///
/// The completion-handler form of `preparePreviewOfFile` is used deliberately:
/// it makes the success / failure outcomes explicit (an un-thrown error in the
/// `async` form is an easy way to leave Quick Look's spinner running).
final class PreviewViewController: NSViewController, QLPreviewingController {

    private let webView = WKWebView(frame: .zero)
    private var pageReady = false
    private var pending: [(Result<Void, Error>) -> Void] = []

    // MARK: View

    override func loadView() {
        webView.navigationDelegate = self
        view = webView
        if let index = Self.previewIndexURL() {
            // Read scope = the BUNDLED preview directory only. Never the previewed
            // file's parent directory: the sandbox covers the single file Quick Look
            // handed us, not its folder.
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        } else {
            previewLog.error("preview/index.html missing from the extension bundle")
        }
    }

    private static func previewIndexURL() -> URL? {
        // Matches the XcodeGen folder reference staged at Resources/preview/.
        Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "preview")
    }

    // MARK: QLPreviewingController

    /// Quick Look hands us one file URL. Read it, wait for the page, push the text
    /// in, then tell Quick Look we are ready. Errors go through the handler.
    func preparePreviewOfFile(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        loadViewIfNeeded()

        let text: String
        do {
            // Apple: do not hold the descriptor open — slurp once, then close.
            let data = try Data(contentsOf: url)
            previewLog.info("read \(data.count, privacy: .public) bytes from \(url.path, privacy: .public)")
            // HP-GL is ASCII; fall back so a Latin-1 plot still renders something.
            text = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1)
                ?? ""
        } catch {
            // A plain Cocoa error: a custom error type can make Quick Look misbehave.
            previewLog.error("read failed \(error as NSError, privacy: .public) for \(url.path, privacy: .public)")
            completionHandler(error as NSError)
            return
        }

        whenPageReady { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                previewLog.error("page failed to load: \(error as NSError, privacy: .public)")
                completionHandler(error)
            case .success:
                self.render(text, completionHandler: completionHandler)
            }
        }
    }

    private func render(_ text: String, completionHandler: @escaping (Error?) -> Void) {
        webView.callAsyncJavaScript(
            "window.renderPreview(plotText);", // global exported by preview.js
            arguments: ["plotText": text],
            in: nil, // main frame
            in: .page // page world: sees the classic <script>
        ) { result in // Swift-refined: a single Result<Any, Error>
            switch result {
            case .failure(let error):
                previewLog.error("renderPreview failed \(error as NSError, privacy: .public)")
                completionHandler(error)
            case .success:
                // Quick Look sizes the view asynchronously (after this handler fires)
                // and the page re-renders itself on resize, so report ready now.
                completionHandler(nil)
            }
        }
    }

    /// Runs `body` once the bundled page has finished its first navigation.
    private func whenPageReady(_ body: @escaping (Result<Void, Error>) -> Void) {
        if pageReady {
            body(.success(()))
            return
        }
        pending.append(body)
    }
}

extension PreviewViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        for body in pending { body(.success(())) }
        pending.removeAll()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        previewLog.error("didFailProvisionalNavigation \(error as NSError, privacy: .public)")
        for body in pending { body(.failure(error)) }
        pending.removeAll()
    }
}
