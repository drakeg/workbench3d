import SwiftUI
import simd
import Workbench3DKit

/// The Settings window (Command-Comma). One tab per topic; each tab is a grouped Form that sizes
/// to its content.
struct SettingsView: View {
    @AppStorage("settings.tab") private var tab = SettingsTab.general

    var body: some View {
        TabView(selection: $tab) {
            ForEach(SettingsTab.allCases) { t in
                page(t)
                    .tabItem { Label(t.title, systemImage: t.symbol) }
                    .tag(t)
            }
        }
        .noInitialFocus()
    }

    @ViewBuilder
    private func page(_ tab: SettingsTab) -> some View {
        Form {
            switch tab {
            case .general: GeneralSettings()
            case .navigation: NavigationSettings()
            case .appearance: AppearanceSettings()
            case .shortcuts: ShortcutSettings()
            }
        }
        .formStyle(.grouped)
        .fitsContent()
        .frame(width: 520)
    }
}

/// The Settings tabs. Snapshot mode walks through every case.
enum SettingsTab: String, CaseIterable, Identifiable {
    case general, navigation, appearance, shortcuts

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "General"
        case .navigation: "Navigation"
        case .appearance: "Appearance"
        case .shortcuts: "Shortcuts"
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape"
        case .navigation: "rotate.3d"
        case .appearance: "paintpalette"
        case .shortcuts: "keyboard"
        }
    }
}

struct GeneralSettings: View {
    @AppStorage(AppSettings.Keys.units) private var units = UnitSettings.System.imperial.rawValue
    @AppStorage(AppSettings.Keys.fraction) private var fraction = 16

    var body: some View {
        Section {
            Picker("Units", selection: $units) {
                Text("Inches").tag(UnitSettings.System.imperial.rawValue)
                Text("Millimetres").tag(UnitSettings.System.metric.rawValue)
            }
            if units == UnitSettings.System.imperial.rawValue {
                Picker("Round to", selection: $fraction) {
                    Text("1/8″").tag(8)
                    Text("1/16″").tag(16)
                    Text("1/32″").tag(32)
                    Text("1/64″").tag(64)
                }
            }
        } header: {
            Text("New models")
        } footer: {
            Text("Each model keeps its own units. You can always type either: 2' 6\", 30in or 762mm.")
                .foregroundStyle(.secondary)
        }
    }
}

struct NavigationSettings: View {
    @AppStorage(AppSettings.Keys.scroll) private var scroll = AppSettings.Scroll.pan.rawValue
    @AppStorage(AppSettings.Keys.invertZoom) private var invertZoom = false
    @AppStorage(AppSettings.Keys.rightDragOrbits) private var rightDragOrbits = false

    var body: some View {
        Section("Trackpad") {
            Picker("Two-finger scroll", selection: $scroll) {
                ForEach(AppSettings.Scroll.allCases) { Text($0.title).tag($0.rawValue) }
            }
            LabeledContent("Pinch", value: "Zoom")
            LabeledContent("Option + scroll", value: "Orbit")
            LabeledContent("Smart zoom (double tap)", value: "Zoom Extents")
        }
        Section("Mouse") {
            Toggle("Right-drag orbits instead of panning", isOn: $rightDragOrbits)
            Toggle("Invert scroll-wheel zoom", isOn: $invertZoom)
            LabeledContent("Middle-drag", value: "Orbit, with Shift: Pan")
        }
    }
}

struct ShortcutSettings: View {
    var body: some View {
        Section("Tools (type in the 3D view)") {
            ForEach(allTools().filter { $0.shortcut != nil }, id: \.id.rawValue) { t in
                LabeledContent(t.name) {
                    Text(t.shortcutLabel ?? "").monospaced().foregroundStyle(.secondary)
                }
            }
        }
        Section("While drawing") {
            LabeledContent("Lock to the red, green, blue axis", value: "→ ← ↑")
            LabeledContent("Unlock", value: "↓")
            LabeledContent("Lock the current direction", value: "Hold ⇧")
            LabeledContent("Copy (Move, Rotate)", value: "Tap ⌥")
            LabeledContent("Type a length or value, then", value: "Return")
            LabeledContent("Cancel", value: "Esc")
        }
    }
}
