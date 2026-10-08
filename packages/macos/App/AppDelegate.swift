import Cocoa

/// The carrier app for the Preview surface.
///
/// It does nothing itself: it exists to be a registered application bundle that
/// ships (and therefore registers) the Quick Look Preview app extension under
/// `Contents/PlugIns`. There is deliberately no native viewer here — the Preview
/// extension draws the plot in a web view (spec #12, ADR-0009).
@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSLog("HPGLViewer: carrier app launched; the Preview extension registers via this bundle")
    }
}
