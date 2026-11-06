import Foundation

/// Length units. Internally every length is in INCHES, exactly like the web app.
/// Parsing accepts what woodworkers and metal workers type:
///   12   12"   3/4   1 1/2   1-1/2"   2'   2' 6"   2'6-1/2"   30mm   2.5cm   1.2m
public struct UnitSettings: Codable, Equatable, Sendable {
    public enum System: String, Codable, Sendable { case imperial, metric }
    public var system: System
    /// Imperial: denominator of the smallest fraction shown (16 => 1/16").
    public var fraction: Int
    /// Metric: decimal places shown for millimetres.
    public var mmDecimals: Int

    public init(system: System = .imperial, fraction: Int = 16, mmDecimals: Int = 0) {
        self.system = system
        self.fraction = fraction
        self.mmDecimals = mmDecimals
    }

    public static let `default` = UnitSettings()
}

public let mmPerInch = 25.4

public enum Units {
    private static func number(_ raw: String) -> Double? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return nil }
        // "1 1/2" or "1-1/2"
        if let m = s.wholeMatch(of: /(-?\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)/),
           let whole = Double(m.1), let n = Double(m.2), let d = Double(m.3), d != 0 {
            return whole < 0 ? whole - n / d : whole + n / d
        }
        if let m = s.wholeMatch(of: /(-?)(\d+)\/(\d+)/), let n = Double(m.2), let d = Double(m.3), d != 0 {
            return m.1.isEmpty ? n / d : -n / d
        }
        if s.wholeMatch(of: /-?(\d+\.?\d*|\.\d+)/) != nil { return Double(s) }
        return nil
    }

    /// Parse a typed length. Returns inches, or nil if the text is not a length.
    /// A bare number is read in the current unit system (inches or millimetres).
    public static func parse(_ text: String, units: UnitSettings = .default) -> Double? {
        var s = text.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: "\u{2032}", with: "'")
            .replacingOccurrences(of: "\u{2033}", with: "\"")
            .replacingOccurrences(of: "''", with: "\"")
            .replacingOccurrences(of: "\u{201D}", with: "\"")
            .replacingOccurrences(of: "\u{2019}", with: "'")
        if s.isEmpty { return nil }
        if let m = s.wholeMatch(of: /(-?[\d.]+)\s*(mm|cm|m)/), let v = Double(m.1) {
            let mm = m.2 == "mm" ? v : m.2 == "cm" ? v * 10 : v * 1000
            return mm / mmPerInch
        }
        if let m = s.wholeMatch(of: /(-?[\d.]+)\s*(?:'|ft)\s*(.*)/), let f = Double(m.1) {
            var rest = String(m.2).trimmingCharacters(in: .whitespaces)
            if rest.hasSuffix("\"") { rest.removeLast() } else if rest.hasSuffix("in") { rest.removeLast(2) }
            rest = rest.trimmingCharacters(in: .whitespaces)
            var inches = 0.0
            if !rest.isEmpty {
                guard let v = number(rest) else { return nil }
                inches = v
            }
            let sign: Double = m.1.hasPrefix("-") ? -1 : 1
            return sign * (abs(f) * 12 + inches)
        }
        if s.hasSuffix("\"") || s.hasSuffix("in") {
            s.removeLast(s.hasSuffix("\"") ? 1 : 2)
            return number(s)
        }
        guard let bare = number(s) else { return nil }
        return units.system == .metric ? bare / mmPerInch : bare
    }

    /// "24, 48" or "24;48" or "2'x4'".
    public static func parseList(_ text: String, units: UnitSettings = .default) -> [Double]? {
        let normalized = text.replacing(/\s+x\s+|(?<=['"\d])x(?=[\d.-])/, with: ",")
        let parts = normalized.split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if parts.isEmpty { return nil }
        var out: [Double] = []
        for p in parts {
            guard let v = parse(p, units: units) else { return nil }
            out.append(v)
        }
        return out
    }

    private static func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? a : gcd(b, a % b) }

    private static func trimmed(_ v: Double, _ decimals: Int) -> String {
        var s = String(format: "%.\(decimals)f", v)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s == "-0" ? "0" : s
    }

    /// Format inches for display: 1 1/2", 2' 6 1/2", 38 mm.
    public static func format(_ inches: Double, units: UnitSettings = .default) -> String {
        if units.system == .metric {
            let mm = inches * mmPerInch
            if abs(mm) >= 1000, units.mmDecimals == 0 { return "\(trimmed(mm / 1000, 3)) m" }
            return "\(trimmed(mm, units.mmDecimals)) mm"
        }
        let sign = inches < 0 ? "-" : ""
        let den = units.fraction
        var n = Int((abs(inches) * Double(den)).rounded())
        let approx = abs(Double(n) / Double(den) - abs(inches)) > 1e-4 ? "~ " : ""
        let ft = n / (12 * den)
        n -= ft * 12 * den
        let whole = n / den
        var num = n - whole * den
        var d = den
        if num != 0 {
            let g = gcd(num, d)
            num /= g
            d /= g
        }
        let inchStr = num != 0 ? (whole != 0 ? "\(whole) \(num)/\(d)" : "\(num)/\(d)") : "\(whole)"
        if ft != 0 { return "\(approx)\(sign)\(ft)' \(inchStr)\"" }
        return "\(approx)\(sign)\(inchStr)\""
    }

    /// Format square inches.
    public static func formatArea(_ sqIn: Double, units: UnitSettings = .default) -> String {
        if units.system == .metric {
            let mm2 = sqIn * mmPerInch * mmPerInch
            return mm2 > 1e5 ? "\(trimmed(mm2 / 1e6, 3)) m²" : "\(trimmed(mm2, 0)) mm²"
        }
        return sqIn >= 144 ? "\(trimmed(sqIn / 144, 2)) ft²" : "\(trimmed(sqIn, 2)) in²"
    }
}
