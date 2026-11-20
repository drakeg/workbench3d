import Testing
import simd
@testable import Workbench3DKit

private let sheet = StockSize(width: 48, length: 96)

/// No overlaps with the kerf between parts, and every part on the stock inside the margin.
private func valid(_ r: LayoutResult, kerf: Double, margin: Double = 0) -> Bool {
    for piece in r.pieces {
        let ps = piece.placements
        for p in ps {
            if p.x < margin - 1e-9 || p.y < margin - 1e-9 { return false }
            if p.x + p.width > r.stock.width - margin + 1e-9 || p.y + p.length > r.stock.length - margin + 1e-9 { return false }
        }
        for i in ps.indices {
            for j in ps.indices where j > i {
                let a = ps[i], b = ps[j]
                let apart = a.x + a.width + kerf <= b.x + 1e-9 || b.x + b.width + kerf <= a.x + 1e-9
                    || a.y + a.length + kerf <= b.y + 1e-9 || b.y + b.length + kerf <= a.y + 1e-9
                if !apart { return false }
            }
        }
    }
    return true
}

@Suite struct CuttingLayout {
    @Test func twoHalfSheetsFitWhenTheKerfAllows() {
        let r = layoutParts([LayoutPart(name: "Side", width: 23.9, length: 96, qty: 2, canRotate: false)], stock: sheet, kerf: 0.125)
        #expect(r.pieces.count == 1)
        #expect(valid(r, kerf: 0.125))
    }

    @Test func theKerfCanForceASecondSheet() {
        let r = layoutParts([LayoutPart(name: "Side", width: 24, length: 96, qty: 2, canRotate: false)], stock: sheet, kerf: 0.125)
        #expect(r.pieces.count == 2)
    }

    @Test func aCabinetCarcassHasNoOverlaps() {
        let parts = [
            LayoutPart(name: "Side", width: 23.25, length: 34.5, qty: 2, canRotate: false),
            LayoutPart(name: "Bottom", width: 23.25, length: 34.5, qty: 1, canRotate: false),
            LayoutPart(name: "Shelf", width: 22, length: 33, qty: 2, canRotate: false),
            LayoutPart(name: "Stretcher", width: 4, length: 34.5, qty: 2, canRotate: false),
            LayoutPart(name: "Back", width: 34.5, length: 34.5, qty: 1, canRotate: false),
        ]
        let r = layoutParts(parts, stock: sheet, kerf: 0.125)
        #expect(valid(r, kerf: 0.125))
        #expect(r.pieces.reduce(0) { $0 + $1.placements.count } == 8)
        #expect(r.pieces.count <= 3)
        #expect(r.tooBig.isEmpty)
    }

    @Test func grainIsKept() {
        let r = layoutParts([LayoutPart(name: "Rail", width: 3, length: 40, qty: 6, canRotate: false)], stock: sheet, kerf: 0.125)
        for p in r.pieces.flatMap(\.placements) {
            #expect(!p.rotated)
            #expect(p.length == 40)
        }
    }

    @Test func grainlessPartsTurnWhenNeeded() {
        let fixed = layoutParts([LayoutPart(name: "Top", width: 60, length: 40, qty: 1, canRotate: false)], stock: sheet, kerf: 0.125)
        #expect(fixed.tooBig.count == 1)
        let free = layoutParts([LayoutPart(name: "Top", width: 60, length: 40, qty: 1, canRotate: true)], stock: sheet, kerf: 0.125)
        #expect(free.tooBig.isEmpty)
        #expect(free.pieces[0].placements[0].rotated)
    }

    @Test func theTrimMarginStaysClear() {
        let r = layoutParts([LayoutPart(name: "P", width: 10, length: 10, qty: 30, canRotate: false)], stock: sheet, kerf: 0.125, margin: 0.5)
        #expect(valid(r, kerf: 0.125, margin: 0.5))
    }

    @Test func boardsAreCutByLength() {
        let r = layoutParts([LayoutPart(name: "Leg", width: 3.5, length: 29, qty: 4, canRotate: false),
                             LayoutPart(name: "Rail", width: 3.5, length: 40, qty: 2, canRotate: false)],
                            stock: StockSize(width: 3.5, length: 96), kerf: 0.125)
        #expect(valid(r, kerf: 0.125))
        #expect(r.pieces.count == 3)
    }

    @Test func standardBoardWidths() {
        #expect(boardWidth(for: 3) == 3.5)
        #expect(boardWidth(for: 3.5) == 3.5)
        #expect(boardWidth(for: 6) == 7.25)
        #expect(boardWidth(for: 13) == 13)
    }
}

@Suite struct CutListRows {
    private func box(_ doc: WBDocument, _ name: String, _ w: Double, _ d: Double, _ h: Double, material: String) -> Group {
        let g = doc.newGroup(name)
        let f = g.mesh.addPolygon([V3(0, 0, 0), V3(w, 0, 0), V3(w, d, 0), V3(0, d, 0)])!
        _ = g.mesh.pushPull(f, -h)
        g.attributes["material"] = .string(material)
        doc.root.add(g)
        return g
    }

    @Test func identicalPartsAreCountedAndSorted() {
        let doc = WBDocument()
        _ = box(doc, "Side", 0.75, 23.25, 34.5, material: "Plywood")
        _ = box(doc, "Side", 23.25, 0.75, 34.5, material: "Plywood") // same part, turned
        _ = box(doc, "Leg", 3.5, 3.5, 30, material: "Pine")
        let hidden = box(doc, "Jig", 1, 1, 1, material: "Pine")
        hidden.hidden = true
        let rows = CutList.rows(doc)
        #expect(rows.count == 2)
        let side = rows.first { $0.name == "Side" }!
        #expect(side.qty == 2)
        #expect(abs(side.t - 0.75) < 1e-9 && abs(side.w - 23.25) < 1e-9 && abs(side.l - 34.5) < 1e-9)
        #expect(abs(side.boardFeet - 0.75 * 23.25 * 34.5 * 2 / 144) < 1e-9)
    }

    @Test func stockDefaults() {
        let doc = WBDocument()
        _ = box(doc, "Side", 0.75, 23.25, 34.5, material: "Plywood")
        _ = box(doc, "Leg", 1.5, 3.5, 96, material: "Pine")
        _ = box(doc, "Frame", 2, 2, 60, material: "Steel tube")
        let groups = CutList.stockGroups(CutList.rows(doc))
        let ply = groups.first { $0.material == "Plywood" }!
        #expect(ply.kind == .sheet && ply.size == StockSize(width: 48, length: 96))
        let pine = groups.first { $0.material == "Pine" }!
        #expect(pine.kind == .board && pine.size == StockSize(width: 3.5, length: 96))
        let steel = groups.first { $0.material == "Steel tube" }!
        #expect(steel.kind == .board && steel.size.length == 240)
        let chosen = CutList.stockGroups(CutList.rows(doc), choices: [ply.key: StockChoice(kind: .sheet, size: StockSize(width: 60, length: 60))])
        #expect(chosen.first { $0.material == "Plywood" }!.size == StockSize(width: 60, length: 60))
    }

    @Test func csvQuotesNames() {
        let rows = [CutRow(name: "Shelf \"A\"", material: "Plywood", stock: "", t: 0.75, w: 11, l: 30, qty: 2)]
        let csv = CutList.csv(rows, units: .default)
        #expect(csv.contains("2,\"Shelf \"\"A\"\"\",\"Plywood\""))
        #expect(csv.contains("0.7500,11.0000,30.0000"))
    }
}
