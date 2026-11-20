import Foundation
import simd

// Cut list and cutting layout: the parts of a model, and how to cut them from sheets and boards.
// Same rules as the web app's Cut List add-on (addons/cutlist.ts, src/core/cutlayout.ts), so a
// model gives the same parts and stock on every platform.

// MARK: - Layout

/// A piece of stock: `width` across the grain (a sheet's 48", a board's width), `length` along it.
public struct StockSize: Equatable, Sendable, Codable {
    public var width: Double
    public var length: Double
    public init(width: Double, length: Double) {
        self.width = width
        self.length = length
    }
}

public struct LayoutPart: Sendable {
    public var name: String
    public var width: Double
    public var length: Double
    public var qty: Int
    /// May the part turn 90°? (No grain to respect, or the user allows it.)
    public var canRotate: Bool
    public init(name: String, width: Double, length: Double, qty: Int, canRotate: Bool) {
        self.name = name
        self.width = width
        self.length = length
        self.qty = qty
        self.canRotate = canRotate
    }
}

/// Where a part goes: x across the width, y along the length, from the stock's corner.
public struct Placement: Equatable, Sendable {
    public var name: String
    public var x: Double
    public var y: Double
    public var width: Double
    public var length: Double
    public var rotated: Bool
}

public struct StockPiece: Sendable {
    public var placements: [Placement] = []
    /// Area of the parts over the area of the stock, 0...1.
    public var used: Double = 0
}

public struct LayoutResult: Sendable {
    public var stock: StockSize
    public var pieces: [StockPiece]
    /// Parts too big for the stock even turned.
    public var tooBig: [(name: String, width: Double, length: Double)]
}

/// Lay parts out on as few pieces of stock as it can, with guillotine cuts (every cut goes straight
/// across the piece being cut, as on a table saw or panel saw), the saw kerf between parts and a
/// trim margin along every edge. Biggest parts first, each into the free rectangle it fits best.
public func layoutParts(_ parts: [LayoutPart], stock: StockSize, kerf: Double, margin: Double = 0) -> LayoutResult {
    struct Free { var x, y, w, l: Double }
    let eps = 1e-6
    let usableW = stock.width - 2 * margin
    let usableL = stock.length - 2 * margin
    var tooBig: [(String, Double, Double)] = []

    var queue: [LayoutPart] = []
    for p in parts { for _ in 0..<max(0, p.qty) { queue.append(p) } }
    queue.sort { a, b in
        let aa = a.width * a.length, bb = b.width * b.length
        return aa != bb ? aa > bb : max(a.width, a.length) > max(b.width, b.length)
    }

    var sheets: [(free: [Free], piece: StockPiece)] = []
    func fits(_ w: Double, _ l: Double, _ f: Free) -> Bool { w <= f.w + eps && l <= f.l + eps }

    for p in queue {
        var orients: [(w: Double, l: Double, rot: Bool)] = [(p.width, p.length, false)]
        if p.canRotate, abs(p.width - p.length) > eps { orients.append((p.length, p.width, true)) }
        guard orients.contains(where: { $0.w <= usableW + eps && $0.l <= usableL + eps }) else {
            tooBig.append((p.name, p.width, p.length))
            continue
        }
        var best: (s: Int, fi: Int, w: Double, l: Double, rot: Bool, short: Double, long: Double)?
        for (s, sh) in sheets.enumerated() {
            for (fi, f) in sh.free.enumerated() {
                for o in orients where fits(o.w, o.l, f) {
                    let short = min(f.w - o.w, f.l - o.l), long = max(f.w - o.w, f.l - o.l)
                    if best == nil || short < best!.short - eps || (abs(short - best!.short) <= eps && long < best!.long) {
                        best = (s, fi, o.w, o.l, o.rot, short, long)
                    }
                }
            }
        }
        if best == nil {
            sheets.append(([Free(x: margin, y: margin, w: usableW, l: usableL)], StockPiece()))
            let f = sheets[sheets.count - 1].free[0]
            if let o = orients.first(where: { fits($0.w, $0.l, f) }) { best = (sheets.count - 1, 0, o.w, o.l, o.rot, 0, 0) }
        }
        guard let b = best else { continue }
        let f = sheets[b.s].free.remove(at: b.fi)
        sheets[b.s].piece.placements.append(Placement(name: p.name, x: f.x, y: f.y, width: b.w, length: b.l, rotated: b.rot))
        // Guillotine split; cut across the shorter leftover first so the bigger offcut stays whole.
        let acrossWidth = f.w - b.w < f.l - b.l
        let right = Free(x: f.x + b.w + kerf, y: f.y, w: f.w - b.w - kerf, l: acrossWidth ? b.l : f.l)
        let top = Free(x: f.x, y: f.y + b.l + kerf, w: acrossWidth ? f.w : b.w, l: f.l - b.l - kerf)
        for r in [right, top] where r.w > eps && r.l > eps { sheets[b.s].free.append(r) }
    }

    let area = stock.width * stock.length
    let pieces = sheets.map { sh -> StockPiece in
        var p = sh.piece
        p.used = p.placements.reduce(0) { $0 + $1.width * $1.length } / area
        return p
    }
    return LayoutResult(stock: stock, pieces: pieces, tooBig: tooBig.map { (name: $0.0, width: $0.1, length: $0.2) })
}

/// Standard dressed widths of dimensional lumber.
public let boardWidths: [Double] = [1.5, 2.5, 3.5, 5.5, 7.25, 9.25, 11.25]

/// The narrowest standard board a part `width` wide can be cut from (or the width itself if wider).
public func boardWidth(for width: Double) -> Double {
    boardWidths.first { $0 >= width - 1e-6 } ?? (width * 4).rounded(.up) / 4
}

// MARK: - Cut list

/// One line of the cut list: identical parts counted together.
public struct CutRow: Identifiable, Sendable {
    public var id: String { "\(name)|\(material)|\(k(t))|\(k(w))|\(k(l))" }
    public var name: String
    public var material: String
    /// What it's cut from when an add-on made it ("2x4", "3/4\" plywood").
    public var stock: String
    /// Thickness ≤ width ≤ length; the grain runs along the length.
    public var t, w, l: Double
    public var qty: Int
    public var boardFeet: Double { t * w * l * Double(qty) / 144 }
}

private func k(_ x: Double) -> Int { Int((x * 64).rounded()) }

/// Parts of one material and thickness, cut from the same kind of stock.
public struct StockGroup: Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case sheet, board }
    public var id: String { key }
    public var key: String
    public var material: String
    public var t: Double
    public var rows: [CutRow]
    public var kind: Kind
    public var size: StockSize
    /// MDF and the like have no grain, so parts may turn.
    public var grainless: Bool
}

/// A stock choice the user made for a group (kept per model).
public struct StockChoice: Codable, Equatable, Sendable {
    public var kind: StockGroup.Kind
    public var size: StockSize
    public init(kind: StockGroup.Kind, size: StockSize) {
        self.kind = kind
        self.size = size
    }
}

public enum CutList {
    private static func text(_ v: JSONValue?) -> String {
        switch v {
        case .string(let s): s
        case .number(let n): String(n)
        default: ""
        }
    }

    /// Every visible group with faces of its own is a part; its size is its own bounding box.
    public static func rows(_ doc: WBDocument) -> [CutRow] {
        var rows: [CutRow] = []
        for g in doc.root.all where g !== doc.root && !g.mesh.faces.isEmpty && !doc.isHidden(g) {
            let s = g.mesh.bounds().size
            let d = [s.x, s.y, s.z].sorted()
            let material = text(g.attributes["material"]), stock = text(g.attributes["stock"])
            let row = CutRow(name: g.name, material: material, stock: stock, t: d[0], w: d[1], l: d[2], qty: 1)
            if let i = rows.firstIndex(where: { $0.id == row.id }) { rows[i].qty += 1 } else { rows.append(row) }
        }
        return rows.sorted { a, b in
            a.material != b.material ? a.material < b.material : a.t != b.t ? a.t > b.t : a.l > b.l
        }
    }

    /// Group rows by material and thickness, with default stock: sheets for plywood/MDF and parts
    /// wider than a 2x12, boards for solid wood, 20' sticks for steel. `choices` override.
    public static func stockGroups(_ rows: [CutRow], choices: [String: StockChoice] = [:]) -> [StockGroup] {
        var order: [String] = []
        var groups: [String: StockGroup] = [:]
        for r in rows {
            let key = "\(r.material)|\(k(r.t))"
            if groups[key] == nil {
                let words = "\(r.stock) \(r.material)"
                let sheetish = words.range(of: "plywood|mdf|osb|particle|sheet|melamine", options: [.regularExpression, .caseInsensitive]) != nil
                let grainless = words.range(of: "mdf|particle|melamine|hardboard", options: [.regularExpression, .caseInsensitive]) != nil
                groups[key] = StockGroup(key: key, material: r.material, t: r.t, rows: [], kind: sheetish ? .sheet : .board,
                                         size: StockSize(width: 48, length: 96), grainless: grainless)
                order.append(key)
            }
            groups[key]!.rows.append(r)
        }
        return order.map { key in
            var g = groups[key]!
            let words = g.rows.map { "\($0.stock) \($0.material)" }.joined(separator: " ")
            let metal = words.range(of: "steel|alumin|metal|tube|angle|channel", options: [.regularExpression, .caseInsensitive]) != nil
            let widest = g.rows.map(\.w).max() ?? 0
            let longest = g.rows.map(\.l).max() ?? 0
            if metal {
                g.kind = .board
                g.size = StockSize(width: widest, length: 240)
            } else {
                if g.kind == .board, widest > 11.25 + 1e-6 { g.kind = .sheet }
                if g.kind == .board {
                    let length = [96.0, 120, 144, 192].first { $0 >= longest - 1e-6 } ?? (longest / 12).rounded(.up) * 12
                    g.size = StockSize(width: boardWidth(for: widest), length: length)
                }
            }
            if let c = choices[key] {
                g.kind = c.kind
                g.size = c.size
            }
            return g
        }
    }

    public static func layout(_ g: StockGroup, kerf: Double, margin: Double, respectGrain: Bool) -> LayoutResult {
        layoutParts(g.rows.map { LayoutPart(name: $0.name, width: $0.w, length: $0.l, qty: $0.qty, canRotate: g.grainless || !respectGrain) },
                    stock: g.size, kerf: kerf, margin: margin)
    }

    /// The cut list as CSV, sizes formatted and in decimal inches.
    public static func csv(_ rows: [CutRow], units: UnitSettings) -> String {
        func q(_ s: String) -> String { "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\"" }
        func f(_ x: Double) -> String { Units.format(x, units: units) }
        var lines = ["Qty,Part,Material,Thickness,Width,Length,Thickness (in),Width (in),Length (in)"]
        for r in rows {
            lines.append([String(r.qty), q(r.name), q(r.material), q(f(r.t)), q(f(r.w)), q(f(r.l)),
                          String(format: "%.4f", r.t), String(format: "%.4f", r.w), String(format: "%.4f", r.l)].joined(separator: ","))
        }
        return lines.joined(separator: "\n") + "\n"
    }
}
