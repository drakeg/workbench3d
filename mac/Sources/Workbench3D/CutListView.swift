import AppKit
import SwiftUI
import UniformTypeIdentifiers
import Workbench3DKit

/// The Cut List sheet: every part with T × W × L, the layout of the parts on sheets and boards
/// (saw kerf, trim, grain), and exports: a printable PDF cutting plan and CSV.
/// Same parts and stock rules as the web app's Cut List add-on (Workbench3DKit/CutList.swift).
struct CutListView: View {
    let editor: Editor
    @Environment(\.dismiss) private var dismiss
    @AppStorage("cutlist.kerf") private var kerf = 0.125
    @AppStorage("cutlist.margin") private var margin = 0.0
    @AppStorage("cutlist.grain") private var respectGrain = true
    @AppStorage("cutlist.tab") private var tab = Tab.parts
    @State private var choices: [String: StockChoice] = [:]

    enum Tab: String { case parts, layout }

    private var units: UnitSettings { editor.doc.units }
    private func f(_ x: Double) -> String { Units.format(x, units: units) }

    var body: some View {
        let rows = CutList.rows(editor.doc)
        let groups = CutList.stockGroups(rows, choices: choices)
        let layouts = groups.map { CutList.layout($0, kerf: kerf, margin: margin, respectGrain: respectGrain) }
        VStack(spacing: 0) {
            Picker("View", selection: $tab) {
                Text("Parts").tag(Tab.parts)
                Text("Layout").tag(Tab.layout)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .padding(Space.md)
            Divider()
            if rows.isEmpty {
                ContentUnavailableView("No Parts", systemImage: "list.bullet.rectangle",
                                       description: Text("Each part is its own group. Select a part's geometry and press ⌘G."))
            } else if tab == .parts {
                partsTable(rows)
            } else {
                layoutList(groups, layouts)
            }
            Divider()
            HStack {
                Button("Export CSV…") { exportCSV(rows) }
                    .disabled(rows.isEmpty)
                Spacer()
                Button("Export PDF…") { exportPDF(rows, groups, layouts) }
                    .disabled(rows.isEmpty)
                    .keyboardShortcut("p", modifiers: .command)
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(Space.md)
        }
        .frame(minWidth: 760, idealWidth: 900, minHeight: 520, idealHeight: 680)
        .onAppear { choices = editor.cutListChoices }
        .onChange(of: choices) { _, c in editor.cutListChoices = c }
        .noInitialFocus()
    }

    // MARK: parts

    private func partsTable(_ rows: [CutRow]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Table(rows) {
                TableColumn("Qty") { Text("\($0.qty)").monospacedDigit() }.width(40)
                TableColumn("Part", value: \.name)
                TableColumn("Material", value: \.material)
                TableColumn("T") { Text(f($0.t)).monospacedDigit() }.width(70)
                TableColumn("W") { Text(f($0.w)).monospacedDigit() }.width(90)
                TableColumn("L") { Text(f($0.l)).monospacedDigit() }.width(90)
                TableColumn("Bd ft") { Text(String(format: "%.2f", $0.boardFeet)).monospacedDigit() }.width(60)
            }
            HStack {
                Text("Sizes are each part's own box: thickness, width, then length (the grain runs along the length).")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Total \(String(format: "%.2f", rows.reduce(0) { $0 + $1.boardFeet })) bd ft")
                    .monospacedDigit()
            }
            .font(.callout)
            .padding(Space.md)
        }
    }

    // MARK: layout

    private func lengthField(_ label: String, _ value: Binding<Double>) -> some View {
        LengthField(label: label, value: value, units: units)
    }

    private func layoutList(_ groups: [StockGroup], _ layouts: [LayoutResult]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.lg) {
                HStack(spacing: Space.lg) {
                    lengthField("Saw kerf", $kerf)
                    lengthField("Trim each edge", $margin)
                    Toggle("Keep grain along each part's length", isOn: $respectGrain)
                }
                ForEach(Array(groups.enumerated()), id: \.element.key) { i, g in
                    stockGroupView(g, layouts[i])
                }
            }
            .padding(Space.lg)
        }
    }

    private func stockGroupView(_ g: StockGroup, _ lay: LayoutResult) -> some View {
        let n = lay.pieces.count
        let avg = n == 0 ? 0 : lay.pieces.reduce(0) { $0 + $1.used } / Double(n)
        let choice = Binding<StockChoice>(
            get: { StockChoice(kind: g.kind, size: g.size) },
            set: { choices[g.key] = $0 })
        return VStack(alignment: .leading, spacing: Space.sm) {
            Divider()
            HStack(spacing: Space.md) {
                Text("\(g.material.isEmpty ? "Unnamed material" : g.material) \(f(g.t))").font(.headline)
                Picker("Stock", selection: Binding(
                    get: { g.kind },
                    set: { kind in
                        let widest = g.rows.map(\.w).max() ?? 0
                        choice.wrappedValue = StockChoice(kind: kind, size: kind == .sheet ? StockSize(width: 48, length: 96)
                                                          : StockSize(width: boardWidth(for: widest), length: 96))
                    })) {
                    Text("Sheets").tag(StockGroup.Kind.sheet)
                    Text("Boards").tag(StockGroup.Kind.board)
                }
                .labelsHidden()
                .fixedSize()
                lengthField(g.kind == .sheet ? "Sheet" : "Board", Binding(get: { g.size.width }, set: { choice.wrappedValue.size.width = max(0.25, $0) }))
                lengthField("×", Binding(get: { g.size.length }, set: { choice.wrappedValue.size.length = max(0.25, $0) }))
                Spacer()
                Text("\(n) \(g.kind == .sheet ? (n == 1 ? "sheet" : "sheets") : (n == 1 ? "board" : "boards")), \(Int((avg * 100).rounded()))% used")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            ForEach(Array(lay.tooBig.enumerated()), id: \.offset) { _, b in
                Label("\(b.name) (\(f(b.length)) × \(f(b.width))) doesn't fit on this stock.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }
            ForEach(Array(lay.pieces.enumerated()), id: \.offset) { _, piece in
                StockDrawing(stock: lay.stock, piece: piece, format: f)
            }
        }
    }

    // MARK: export

    private func save(_ data: Data, name: String, type: UTType) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [type]
        panel.nameFieldStringValue = name
        let write = {
            guard let url = panel.url else { return }
            do { try data.write(to: url, options: .atomic) } catch { NSApp.presentError(error) }
        }
        if let w = NSApp.keyWindow { panel.beginSheetModal(for: w) { if $0 == .OK { write() } } } else if panel.runModal() == .OK { write() }
    }

    private func exportCSV(_ rows: [CutRow]) {
        save(Data(CutList.csv(rows, units: units).utf8), name: "\(editor.modelName) cut list.csv", type: .commaSeparatedText)
    }

    private func exportPDF(_ rows: [CutRow], _ groups: [StockGroup], _ layouts: [LayoutResult]) {
        let data = CuttingPlanPDF.make(title: editor.modelName, rows: rows, groups: groups, layouts: layouts,
                                       kerf: kerf, margin: margin, respectGrain: respectGrain, units: units)
        save(data, name: "\(editor.modelName) cutting plan.pdf", type: .pdf)
    }
}

/// One sheet or board, length left to right, with each part labelled.
struct StockDrawing: View {
    let stock: StockSize
    let piece: StockPiece
    let format: (Double) -> String

    var body: some View {
        // Boards are drawn at least 28 pt tall so labels fit (only across, never along).
        let aspect = stock.width / stock.length
        GeometryReader { geo in
            let w = geo.size.width
            let sx = w / stock.length
            let sy = max(sx, 28 / stock.width)
            Canvas { ctx, _ in
                ctx.stroke(Path(CGRect(x: 0.5, y: 0.5, width: w - 1, height: stock.width * sy - 1)),
                           with: .color(.secondary), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                for p in piece.placements {
                    let r = CGRect(x: p.y * sx, y: p.x * sy, width: p.length * sx, height: p.width * sy)
                    ctx.fill(Path(r), with: .color(Color(red: 0.918, green: 0.843, blue: 0.69)))
                    ctx.stroke(Path(r), with: .color(Color(red: 0.48, green: 0.35, blue: 0.18)), lineWidth: 1)
                    if r.width > 40, r.height > 14 {
                        let size = min(12, max(8, r.height / 3))
                        let two = r.height > 2.4 * size
                        ctx.draw(Text(p.name).font(.system(size: size, weight: .semibold)).foregroundStyle(Color(red: 0.23, green: 0.16, blue: 0.07)),
                                 at: CGPoint(x: r.midX, y: two ? r.midY - size * 0.55 : r.midY))
                        if two {
                            ctx.draw(Text("\(format(p.length)) × \(format(p.width))").font(.system(size: size * 0.85))
                                .foregroundStyle(Color(red: 0.42, green: 0.33, blue: 0.21)),
                                     at: CGPoint(x: r.midX, y: r.midY + size * 0.6))
                        }
                    }
                }
            }
        }
        .aspectRatio(1 / max(aspect, 28 / 700), contentMode: .fit)
        .frame(maxWidth: 800, maxHeight: 260, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel("Stock \(format(stock.length)) by \(format(stock.width)) with \(piece.placements.count) parts, \(Int((piece.used * 100).rounded())) percent used")
    }
}

/// A length typed in any unit (3/4", 19mm); applied on Return or when the field loses focus.
struct LengthField: View {
    let label: String
    @Binding var value: Double
    let units: UnitSettings
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent(label) {
            TextField(label, text: $text)
                .labelsHidden()
                .frame(width: 80)
                .monospacedDigit()
                .focused($focused)
                .onSubmit(commit)
                .onChange(of: focused) { _, f in if !f { commit() } }
        }
        .fixedSize()
        .onAppear { text = Units.format(value, units: units) }
        .onChange(of: value) { _, v in if !focused { text = Units.format(v, units: units) } }
    }

    private func commit() {
        if let v = Units.parse(text, units: units), v >= 0 { value = v }
        text = Units.format(value, units: units)
    }
}

extension Editor {
    /// The open model's name, for exports.
    var modelName: String {
        let n = fileURL?.deletingPathExtension().lastPathComponent ?? ""
        return n.isEmpty ? "Untitled" : n
    }
}

// MARK: - PDF

/// The printable cutting plan: page 1 the cut list and the stock to buy, then a scaled diagram of
/// every sheet and board. Letter landscape.
enum CuttingPlanPDF {
    static func make(title: String, rows: [CutRow], groups: [StockGroup], layouts: [LayoutResult],
                     kerf: Double, margin: Double, respectGrain: Bool, units: UnitSettings) -> Data {
        let f = { (x: Double) in Units.format(x, units: units) }
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 792, height: 612)
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let pdf = CGContext(consumer: consumer, mediaBox: &box, [kCGPDFContextTitle as String: "\(title) cutting plan"] as CFDictionary)
        else { return Data() }
        let M: CGFloat = 36, PW: CGFloat = 792, PH: CGFloat = 612
        var page = 0

        func begin() {
            pdf.beginPDFPage(nil)
            // draw top-down like a view
            pdf.translateBy(x: 0, y: PH)
            pdf.scaleBy(x: 1, y: -1)
            NSGraphicsContext.current = NSGraphicsContext(cgContext: pdf, flipped: true)
            page += 1
            text("\(title) · Workbench3D cutting plan · page \(page)", PW / 2, PH - 18, size: 8, color: .gray, align: .center)
        }
        func end() {
            NSGraphicsContext.current = nil
            pdf.endPDFPage()
        }
        func text(_ s: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat = 10, bold: Bool = false, color: NSColor = .black,
                  align: NSTextAlignment = .left, maxWidth: CGFloat? = nil) {
            let font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
            let para = NSMutableParagraphStyle()
            para.lineBreakMode = .byTruncatingTail
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: para]
            var w = (s as NSString).size(withAttributes: attrs).width
            if let maxWidth { w = min(w, maxWidth) }
            let dx: CGFloat = align == .center ? -w / 2 : align == .right ? -w : 0
            // y is the baseline
            (s as NSString).draw(in: CGRect(x: x + dx, y: y - font.ascender, width: w + 1, height: size * 1.4), withAttributes: attrs)
        }

        // Page 1: cut list and stock
        begin()
        text("Cut list: \(title)", M, M + 8, size: 16, bold: true)
        text("Kerf \(f(kerf))\(margin > 0 ? ", trim \(f(margin)) on every edge" : "")\(respectGrain ? ", grain along each part's length" : ", parts may turn")",
             M, M + 26, size: 9, color: .darkGray)
        let cols: [(String, CGFloat, NSTextAlignment)] = [("Qty", 34, .right), ("Part", 230, .left), ("Material", 150, .left),
                                                          ("T", 70, .right), ("W", 80, .right), ("L", 80, .right), ("Bd ft", 60, .right)]
        var y = M + 50
        func row(_ cells: [String], bold: Bool = false) {
            var x = M
            for (i, c) in cells.enumerated() {
                let (_, w, a) = cols[i]
                text(c, a == .right ? x + w - 6 : x, y, size: 9, bold: bold, align: a, maxWidth: w - 6)
                x += w
            }
            y += 14
        }
        row(cols.map(\.0), bold: true)
        pdf.setStrokeColor(NSColor.gray.cgColor)
        pdf.setLineWidth(0.5)
        pdf.strokeLineSegments(between: [CGPoint(x: M, y: y - 10), CGPoint(x: M + cols.reduce(0) { $0 + $1.1 }, y: y - 10)])
        for r in rows {
            if y > PH - 120 {
                end()
                begin()
                y = M + 10
            }
            row([String(r.qty), r.name, r.material, f(r.t), f(r.w), f(r.l), String(format: "%.2f", r.boardFeet)])
        }
        y += 10
        text("Stock to buy", M, y, size: 12, bold: true)
        y += 16
        for (i, g) in groups.enumerated() {
            let lay = layouts[i]
            let n = lay.pieces.count
            let avg = n == 0 ? 0 : lay.pieces.reduce(0) { $0 + $1.used } / Double(n)
            let what = g.kind == .sheet ? "\(n) sheet\(n == 1 ? "" : "s") \(f(g.size.width)) × \(f(g.size.length))"
                : "\(n) board\(n == 1 ? "" : "s") \(f(g.size.width)) wide × \(f(g.size.length))"
            text("\(g.material.isEmpty ? "Unnamed material" : g.material) \(f(g.t)): \(what)  (\(Int((avg * 100).rounded()))% used)", M, y)
            y += 14
            for b in lay.tooBig {
                text("  \(b.name) (\(f(b.length)) × \(f(b.width))) is bigger than the stock", M, y, size: 9, color: .systemRed)
                y += 13
            }
        }
        end()

        // Diagrams
        var yy = PH
        for (gi, g) in groups.enumerated() {
            let lay = layouts[gi]
            let L = lay.stock.length, W = lay.stock.width
            let scale = min((PW - 2 * M) / L, g.kind == .sheet ? (PH - 2 * M - 60) / W : .greatestFiniteMagnitude)
            let sy = max(scale, 26 / W)
            let h = W * sy
            for (pi, piece) in lay.pieces.enumerated() {
                if yy + h + 40 > PH - 30 {
                    if yy != PH { end() }
                    begin()
                    yy = M
                }
                text("\(g.material.isEmpty ? "Unnamed material" : g.material) \(f(g.t)): \(g.kind == .sheet ? "sheet" : "board") \(pi + 1) of \(lay.pieces.count)  (\(Int((piece.used * 100).rounded()))% used)",
                     M, yy + 10, size: 10, bold: true)
                let top = yy + 18
                pdf.setStrokeColor(NSColor.darkGray.cgColor)
                pdf.setLineWidth(0.75)
                pdf.stroke(CGRect(x: M, y: top, width: L * scale, height: h))
                for p in piece.placements {
                    let r = CGRect(x: M + p.y * scale, y: top + p.x * sy, width: p.length * scale, height: p.width * sy)
                    pdf.setFillColor(CGColor(red: 0.918, green: 0.843, blue: 0.69, alpha: 1))
                    pdf.fill(r)
                    pdf.setStrokeColor(CGColor(red: 0.48, green: 0.35, blue: 0.18, alpha: 1))
                    pdf.setLineWidth(0.6)
                    pdf.stroke(r)
                    let fs = max(5, min(9, r.height / 3))
                    if r.width > 30, r.height > 9 {
                        let two = r.height > 2.6 * fs
                        text(p.name, r.midX, r.midY + (two ? -fs * 0.15 : fs * 0.35), size: fs, bold: true, align: .center, maxWidth: r.width - 4)
                        if two { text("\(f(p.length)) × \(f(p.width))", r.midX, r.midY + fs, size: fs * 0.9, color: .darkGray, align: .center, maxWidth: r.width - 4) }
                    }
                }
                text(f(L), M + L * scale / 2, top + h + 12, size: 8, color: .gray, align: .center)
                text(f(W), M + L * scale + 6, top + h / 2 + 3, size: 8, color: .gray)
                yy = top + h + 26
            }
        }
        if yy != PH { end() }
        pdf.closePDF()
        return data as Data
    }
}
