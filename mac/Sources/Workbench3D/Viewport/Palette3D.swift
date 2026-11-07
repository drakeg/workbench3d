import AppKit
import SwiftUI

/// Colors for the 3D view, a light and a dark palette (dark mode is its own palette, not inverted).
/// Read at draw time, so the view follows the system appearance.
enum Palette3D {
    static var isDark: Bool {
        NSApp?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }

    private static func c(_ hex: UInt32, _ a: Float = 1) -> SIMD4<Float> {
        SIMD4(Float((hex >> 16) & 0xFF) / 255, Float((hex >> 8) & 0xFF) / 255, Float(hex & 0xFF) / 255, a)
    }

    private static func pick(_ light: UInt32, _ dark: UInt32, _ a: Float = 1) -> SIMD4<Float> { c(isDark ? dark : light, a) }

    static var background: SIMD4<Float> { pick(0xEEF1F4, 0x24292F) }
    static var face: SIMD4<Float> { pick(0xF4F1EA, 0xE9E5DC) }
    static var back: SIMD4<Float> { pick(0x9FB0C6, 0x7D8DA3) }
    static var edge: SIMD4<Float> { pick(0x1D1F22, 0x0B0D10) }
    static var edgeDim: SIMD4<Float> { pick(0xB4B8BE, 0x59616B) }
    /// Loose lines (not on a face) must read on the background itself.
    static var loose: SIMD4<Float> { pick(0x1D1F22, 0xD7DCE2) }
    static var selection: SIMD4<Float> { pick(0x1A73E8, 0x4C9BFF) }
    static var selectionFill: SIMD4<Float> { pick(0x1A73E8, 0x4C9BFF, 0.3) }
    static var hover: SIMD4<Float> { pick(0xF2A900, 0xF5B82E) }
    static var hoverFill: SIMD4<Float> { pick(0xF2A900, 0xF5B82E, 0.25) }
    static var grid: SIMD4<Float> { pick(0xD5DAE0, 0x30363D) }
    static var gridMajor: SIMD4<Float> { pick(0xC3CAD3, 0x3D444D) }
    static var ink: SIMD4<Float> { pick(0x111111, 0xEEF1F4) }
    static var muted: SIMD4<Float> { pick(0x6B7280, 0x9AA4AF) }
    static var guide: SIMD4<Float> { pick(0x0D9488, 0x2DD4BF) }
    static var cyan: SIMD4<Float> { pick(0x0891B2, 0x22D3EE) }
    static var magenta: SIMD4<Float> { pick(0xC026D3, 0xE879F9) }

    static func axisRGBA(_ a: Axis) -> SIMD4<Float> {
        switch a {
        case .x: pick(0xD93025, 0xF2564B)
        case .y: pick(0x188038, 0x3FB950)
        case .z: pick(0x1A5FD0, 0x5B9DFF)
        }
    }

    static func axisColor(_ a: Axis) -> Color {
        let v = axisRGBA(a)
        return Color(red: Double(v.x), green: Double(v.y), blue: Double(v.z))
    }

    /// "#c8a26b" -> RGBA.
    static func rgba(hex: String?) -> SIMD4<Float>? {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
        s.removeFirst()
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return c(v)
    }
}
