import AppKit
import SwiftUI
import Workbench3DKit

// Workbench3D
//   Workbench3D                          the app (opens .wb3d models)
//   APP_SNAPSHOT=<dir> Workbench3D       render the sample model (or APP_SNAPSHOT_FILE) in light and dark, then quit
//   Workbench3D --selftest               run the self-test and quit with 0 or 1 (tools/selftest.sh)
//   APP_ACCENT=<id> Workbench3D          run with another accent from Theme.all (UI/Theme.swift)
//   APP_GRID=1 Workbench3D               draw the 4 pt grid and the layout probes over the window

@main
struct Workbench3DApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        DocumentGroup(newDocument: { ModelDocument() }) { file in
            ContentView(document: file.document)
                .themed()
                .overlay { if GridOverlay.enabled { GridOverlay() } }
        }
        .defaultSize(width: 1280, height: 800)
        .windowToolbarStyle(.unified)
        .commands { ModelCommands() }

        Settings {
            SettingsView()
                .themed()
        }
        .windowResizability(.contentSize)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        // Snapshot and self-test runs open no document windows.
        if Snapshot.requested || SelfTest.requested {
            UserDefaults.standard.set(false, forKey: "NSShowAppCentricOpenPanelInsteadOfUntitledFile")
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Started from a terminal, the process is not a foreground app yet.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        Snapshot.runIfRequested()
        SelfTest.runIfRequested()
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        !(Snapshot.requested || SelfTest.requested)
    }

    /// The self-test's result becomes the exit code, after a normal quit.
    func applicationWillTerminate(_ notification: Notification) {
        if SelfTest.requested { exit(SelfTest.exitCode) }
    }
}

/// Menu bar commands for the frontmost model window.
struct ModelCommands: Commands {
    @FocusedValue(\.editor) private var editor

    var body: some Commands {
        SidebarCommands()
        ToolbarCommands()
        InspectorCommands()

        CommandGroup(after: .importExport) {
            Button("Export STL…") { editor?.export(.stl, window: NSApp.keyWindow) }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(editor == nil)
            Button("Export OBJ…") { editor?.export(.obj, window: NSApp.keyWindow) }
                .keyboardShortcut("e", modifiers: [.command, .shift, .option])
                .disabled(editor == nil)
        }

        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Select None") { editor?.selectNone() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(editor?.selection.isEmpty ?? true)
            Button("Duplicate Group") { editor?.duplicateSelection() }
                .keyboardShortcut("d")
                .disabled(editor?.selectedGroups.isEmpty ?? true)
            Divider()
            Button("Make Group") { editor?.makeGroup() }
                .keyboardShortcut("g")
                .disabled(!(editor?.canMakeGroup ?? false))
            Button("Make Component") { editor?.makeComponent() }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(!(editor?.canMakeGroup ?? false))
            Button("Explode") { editor?.explodeSelection() }
                .keyboardShortcut("g", modifiers: [.command, .option])
                .disabled(!(editor?.canExplode ?? false))
            Button("Edit Group") { editor?.editSelectedGroup() }
                .keyboardShortcut(.downArrow, modifiers: .command)
                .disabled(!(editor?.canEditGroup ?? false))
            Button("Close Group") { editor?.exitGroup() }
                .keyboardShortcut(.upArrow, modifiers: .command)
                .disabled(!(editor?.isInsideGroup ?? false))
            Divider()
            Button("Hide") { editor?.hideSelection() }
                .keyboardShortcut("h", modifiers: [.command, .control])
                .disabled(editor?.selectedGroups.isEmpty ?? true)
            Button("Unhide All") { editor?.unhideAll() }
                .keyboardShortcut("h", modifiers: [.command, .control, .shift])
                .disabled(editor == nil)
        }

        CommandGroup(before: .toolbar) {
            Menu("Camera") {
                ForEach(Array(Camera.StandardView.allCases.enumerated()), id: \.offset) { i, v in
                    Button(v.title) { editor?.setView(v) }
                        .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
                }
            }
            .disabled(editor == nil)
            Button("Zoom Extents") { editor?.zoomExtents() }
                .keyboardShortcut("0")
                .disabled(editor == nil)
            Button(editor?.camera.perspective ?? true ? "Use Parallel Projection" : "Use Perspective") { editor?.togglePerspective() }
                .keyboardShortcut("p", modifiers: [.command, .option])
                .disabled(editor == nil)
            Button(editor?.xray ?? false ? "Turn Off X-Ray" : "Turn On X-Ray") { editor?.toggleXray() }
                .keyboardShortcut("x", modifiers: [.command, .option])
                .disabled(editor == nil)
            Button(editor?.showGrid ?? true ? "Hide Grid" : "Show Grid") { editor?.toggleGrid() }
                .keyboardShortcut("'", modifiers: [.command, .option])
                .disabled(editor == nil)
            Divider()
        }

        // Tools have single-key shortcuts typed in the 3D view (shown in brackets); a menu key
        // equivalent with no modifier would swallow typing in the Measurements box.
        CommandMenu("Draw") { toolButtons([.line, .arc, .rect, .circle]) }
        CommandMenu("Tools") { toolButtons([.select, .eraser, .paint, .pushpull, .offset, .move, .rotate, .tape, .orbit, .pan, .zoom]) }
    }

    @ViewBuilder
    private func toolButtons(_ ids: [ToolID]) -> some View {
        ForEach(ids) { id in
            if let t = editor?.tools[id] {
                Toggle(isOn: Binding(get: { editor?.toolId == id }, set: { _ in editor?.setTool(id) })) {
                    Text(t.shortcutLabel.map { "\(t.name)  [\($0)]" } ?? t.name)
                }
            } else {
                Text(id.rawValue.capitalized)
            }
        }
        .disabled(editor == nil)
    }
}
