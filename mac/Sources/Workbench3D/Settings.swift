import SwiftUI
import simd
import Workbench3DKit

/// App preferences (not saved in models), in UserDefaults. Views read them with @AppStorage.
nonisolated enum AppSettings {
    enum Keys {
        static let units = "units.system"
        static let fraction = "units.fraction"
        static let scroll = "navigation.scroll"
        static let invertZoom = "navigation.invertZoom"
        static let rightDragOrbits = "navigation.rightDragOrbits"
    }

    /// What a two-finger trackpad scroll does in the 3D view.
    enum Scroll: String, CaseIterable, Identifiable {
        case pan, orbit, zoom
        var id: String { rawValue }
        var title: String {
            switch self {
            case .pan: "Pan"
            case .orbit: "Orbit"
            case .zoom: "Zoom"
            }
        }
    }

    static var unitsForNewModels: UnitSettings {
        let d = UserDefaults.standard
        let system = UnitSettings.System(rawValue: d.string(forKey: Keys.units) ?? "") ?? .imperial
        let fraction = d.integer(forKey: Keys.fraction)
        return UnitSettings(system: system, fraction: fraction == 0 ? 16 : fraction, mmDecimals: 0)
    }

    static var scroll: Scroll { Scroll(rawValue: UserDefaults.standard.string(forKey: Keys.scroll) ?? "") ?? .pan }
    static var invertZoom: Bool { UserDefaults.standard.bool(forKey: Keys.invertZoom) }
    static var rightDragOrbits: Bool { UserDefaults.standard.bool(forKey: Keys.rightDragOrbits) }
}
