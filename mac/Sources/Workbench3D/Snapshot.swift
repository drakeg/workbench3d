import AppKit
import IOKit.pwr_mgt
import ImageIO
import Metal
import SwiftUI
import UniformTypeIdentifiers
import simd
import Workbench3DKit

/// Screenshot mode for agents and CI.
///   APP_SNAPSHOT=/tmp/Workbench3D-shots Workbench3D
/// renders the sample model (or the .wb3d in APP_SNAPSHOT_FILE) offscreen with Metal from several
/// views, light and dark: model-<view>-<mode>.png. Then it opens a model window and every Settings
/// tab and captures them: window-<mode>.png and settings-<tab>-<mode>.png (with -layout.json probe
/// files for tools/check-layout.swift), and quits.
/// APP_SNAPSHOT_PAGES=model,window,settings limits what is captured.
enum Snapshot {
    static var dir: String? {
        let d = ProcessInfo.processInfo.environment["APP_SNAPSHOT"] ?? ""
        return d.isEmpty ? nil : d
    }
    static var requested: Bool { dir != nil }

    static func loadModel() -> WBDocument {
        if let path = ProcessInfo.processInfo.environment["APP_SNAPSHOT_FILE"], !path.isEmpty,
           let data = FileManager.default.contents(atPath: path), let doc = try? WBDocument(data: data) {
            return doc
        }
        return SampleModel.make()
    }

    @MainActor
    static func runIfRequested() {
        guard let dir else { return }
        setvbuf(stdout, nil, _IOLBF, 0)
        let env = ProcessInfo.processInfo.environment
        let only = env["APP_SNAPSHOT_PAGES"].map { Set($0.split(separator: ",").map(String.init)) }
        func wants(_ s: String) -> Bool { only?.contains(s) ?? true }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        Task { @MainActor in
            var activity: IOPMAssertionID = 0
            IOPMAssertionDeclareUserActivity("Snapshots" as CFString, kIOPMUserActiveLocal, &activity)
            let document = ModelDocument(model: loadModel())
            let editor = document.sharedEditor

            if wants("model"), let device = MTLCreateSystemDefaultDevice(), let renderer = Renderer(device: device) {
                let size = CGSize(width: 1200, height: 800)
                editor.camera.size = size
                for mode in ["light", "dark"] {
                    NSApp.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
                    for view in [Camera.StandardView.iso, .top, .front] {
                        editor.setView(view)
                        if view == .iso, let g = editor.doc.root.children.first { editor.select(Selection(groups: [g.id])) } else { editor.select(Selection()) }
                        if let img = renderer.image(editor: editor, size: size) { writePNG(img, to: "\(dir)/model-\(view.rawValue)-\(mode).png") }
                    }
                    editor.xray = true
                    editor.setView(.iso)
                    if let img = renderer.image(editor: editor, size: size) { writePNG(img, to: "\(dir)/model-xray-\(mode).png") }
                    editor.xray = false
                }
                editor.select(Selection())
            }

            if wants("window") {
                let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                                      backing: .buffered, defer: false)
                window.title = "Workbench Sample"
                window.toolbarStyle = .unified
                window.contentView = NSHostingView(rootView: ContentView(document: document).themed())
                window.center()
                window.makeKeyAndOrderFront(nil)
                try? await Task.sleep(for: .seconds(1.5))
                editor.zoomExtents()
                for mode in ["light", "dark"] {
                    NSApp.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
                    if let g = editor.doc.root.children.first { editor.select(Selection(groups: [g.id])) }
                    try? await Task.sleep(for: .seconds(0.8))
                    capture(window, to: "\(dir)/window-\(mode).png")
                }
                window.close()
            }

            if wants("settings") {
                let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 400), styleMask: [.titled, .closable],
                                      backing: .buffered, defer: false)
                window.title = "Settings"
                let host = NSHostingController(rootView: SettingsView().themed())
                host.sizingOptions = [.preferredContentSize]
                window.contentViewController = host
                window.center()
                window.makeKeyAndOrderFront(nil)
                for mode in ["light", "dark"] {
                    NSApp.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
                    for tab in SettingsTab.allCases {
                        UserDefaults.standard.set(tab.rawValue, forKey: "settings.tab")
                        try? await Task.sleep(for: .seconds(0.8))
                        capture(window, to: "\(dir)/settings-\(tab.rawValue)-\(mode).png")
                    }
                }
                UserDefaults.standard.removeObject(forKey: "settings.tab")
                window.close()
            }
            print("SNAPSHOT done \(dir)")
            NSApp.terminate(nil)
        }
    }

    static func writePNG(_ image: CGImage, to path: String) {
        let url = URL(fileURLWithPath: path) as CFURL
        guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        if CGImageDestinationFinalize(dest) { print("SNAPSHOT \(path)") }
    }

    /// Captures the real window with screencapture, so glass and materials look as on screen.
    /// That needs Screen Recording permission for the app that started this one. Without it,
    /// falls back to drawing the view hierarchy (the 3D view and glass come out blank).
    private static func capture(_ window: NSWindow, to path: String) {
        if NSApp.isHidden { NSApp.unhideWithoutActivation() }
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
        let size = window.contentView?.bounds.size ?? .zero
        GridProbes.shared.write(to: path.replacingOccurrences(of: ".png", with: "-layout.json"), window: size)
        try? FileManager.default.removeItem(atPath: path)
        for _ in 1...3 {
            let shot = Process()
            shot.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            shot.arguments = ["-x", "-o", "-l", String(window.windowNumber), path]
            try? shot.run()
            shot.waitUntilExit()
            if FileManager.default.fileExists(atPath: path) {
                print("SNAPSHOT \(path)")
                return
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        guard let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: path))
            print("SNAPSHOT \(path) (fallback: no Screen Recording permission)")
        }
    }
}
