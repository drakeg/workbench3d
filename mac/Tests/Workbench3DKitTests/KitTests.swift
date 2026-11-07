import Foundation
import Testing
import simd
@testable import Workbench3DKit

// Ports of the web app's tests (tests/*.test.ts), so both engines are held to the same results.

private func rect(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double, _ z: Double = 0) -> [V3] {
    [V3(x0, y0, z), V3(x1, y0, z), V3(x1, y1, z), V3(x0, y1, z)]
}

/// Closed, consistently oriented solids have signed volume equal to their volume.
private func signedVolume(_ m: Mesh, _ w: Mat4 = .identity) -> Double {
    var v = 0.0
    for f in m.orderedFaces {
        for (a, b, c) in m.triangulate(f) {
            v += w.transformPoint(m.v(a)).dot(w.transformPoint(m.v(b)).cross(w.transformPoint(m.v(c)))) / 6
        }
    }
    return v
}

private func totalArea(_ m: Mesh) -> Double { m.faces.values.reduce(0) { $0 + m.area($1) } }

private func near(_ a: Double, _ b: Double, _ tol: Double = 1e-6) -> Bool { abs(a - b) < tol }

@discardableResult
private func box(_ m: Mesh, _ w: Double = 10, _ d: Double = 20, _ h: Double = 5) -> (bottom: Int, top: Int) {
    let f = m.addPolygon(rect(0, 0, w, d))!
    let top = m.pushPull(f, -h)
    return (f, top)
}

@Suite struct UnitsTests {
    @Test(arguments: [
        ("12", 12.0), ("12\"", 12), ("3/4", 0.75), ("1 1/2", 1.5), ("1-1/2\"", 1.5), ("2'", 24), ("2' 6\"", 30),
        ("2'6-1/2\"", 30.5), ("25.4mm", 1), ("2.54cm", 1), ("-3", -3),
    ])
    func parses(_ text: String, _ expected: Double) {
        #expect(near(Units.parse(text)!, expected))
    }

    @Test func metricBareNumbers() {
        #expect(near(Units.parse("254", units: .init(system: .metric))!, 10))
    }

    @Test func rejectsJunk() {
        #expect(Units.parse("abc") == nil)
        #expect(Units.parse("") == nil)
    }

    @Test func formats() {
        #expect(Units.format(1.5) == "1 1/2\"")
        #expect(Units.format(0.75) == "3/4\"")
        #expect(Units.format(30.5) == "2' 6 1/2\"")
        #expect(Units.format(24) == "2' 0\"")
        #expect(Units.format(0.1) == "~ 1/8\"")
        #expect(Units.format(1, units: .init(system: .metric)) == "25 mm")
    }

    @Test func lists() {
        #expect(Units.parseList("24, 48") == [24, 48])
        #expect(Units.parseList("2'x4'") == [24, 48])
        #expect(Units.parseList("3/4;1 1/2") == [0.75, 1.5])
    }
}

@Suite struct MeshTests {
    @Test func rectangleOnGround() {
        let m = Mesh()
        let f = m.addPolygon(rect(0, 0, 4, 3))!
        #expect(m.faces.count == 1)
        #expect(near(m.area(m.faces[f]!), 12))
        #expect(m.lines.isEmpty)
        #expect(m.normal(m.faces[f]!).z < 0) // ground faces point down
    }

    @Test func pushPullMakesABox() {
        let m = Mesh()
        box(m)
        #expect(m.faces.count == 6)
        #expect(near(totalArea(m), 2 * (10 * 20 + 10 * 5 + 20 * 5)))
        #expect(near(signedVolume(m), 1000))
    }

    @Test func pullingTheTopAgainStretches() {
        let m = Mesh()
        let (_, top) = box(m)
        #expect(m.pushPull(top, 3) == top)
        #expect(m.faces.count == 6)
        #expect(near(signedVolume(m), 10 * 20 * 8))
    }

    @Test func pocketAndBoss() {
        let m = Mesh()
        let (_, top) = box(m)
        let inner = m.addPolygon(rect(2, 2, 6, 6, 5))!
        #expect(m.faces[top]!.holes.count == 1)
        #expect(near(m.area(m.faces[top]!), 200 - 16))
        m.pushPull(inner, -2)
        #expect(near(signedVolume(m), 1000 - 32))

        let m2 = Mesh()
        box(m2)
        let inner2 = m2.addPolygon(rect(2, 2, 6, 6, 5))!
        m2.pushPull(inner2, 3)
        #expect(near(signedVolume(m2), 1000 + 48))
    }

    @Test func lineAcrossFaceSplitsItAndMakesARabbet() {
        let m = Mesh()
        let (_, top) = box(m)
        let a = m.vertexAt(V3(5, 0, 5)), b = m.vertexAt(V3(5, 20, 5))
        m.addLine(a, b)
        #expect(m.faces[top] == nil)
        #expect(m.faces.count == 7)
        #expect(m.lines.isEmpty)
        let half = m.orderedFaces.first { m.normal($0).z > 0.99 && m.loopPoints($0.outer).allSatisfy { $0.x <= 5 + 1e-9 } }!
        #expect(near(m.area(half), 100))
        m.pushPull(half.id, -2)
        #expect(near(signedVolume(m), 1000 - 5 * 20 * 2))
        #expect(m.faces.count == 8)
        #expect(near(totalArea(m), 680))
    }

    @Test func closingLoopMakesFace() {
        let m = Mesh()
        let ids = rect(0, 0, 3, 3).map { m.vertexAt($0) }
        m.addLine(ids[0], ids[1])
        m.addLine(ids[1], ids[2])
        m.addLine(ids[2], ids[3])
        #expect(m.faces.isEmpty)
        m.addLine(ids[3], ids[0])
        #expect(m.faces.count == 1)
        #expect(m.lines.isEmpty)
    }

    @Test func erasingAnEdgeRemovesItsFaces() {
        let m = Mesh()
        box(m)
        let a = m.findVertex(V3(0, 0, 5))!, b = m.findVertex(V3(10, 0, 5))!
        m.erase(faces: [Int](), edges: [EdgeKey(a, b)])
        #expect(m.faces.count == 4)
    }

    @Test func offsetInsetsAndOutsets() {
        let out = offsetLoop(rect(0, 0, 10, 10), .zAxis, 1)!
        #expect(out.map { [$0.x, $0.y] } == [[1, 1], [9, 1], [9, 9], [1, 9]])
        #expect(offsetLoop(rect(0, 0, 10, 10), .zAxis, 6) == nil)
        let m = Mesh()
        let f = m.addPolygon(rect(0, 0, 10, 10))!
        let inner = m.offsetFace(f, 2)!
        #expect(near(m.area(m.faces[inner]!), 36))
        let L = [V3(0, 0, 0), V3(10, 0, 0), V3(10, 4, 0), V3(4, 4, 0), V3(4, 10, 0), V3(0, 10, 0)]
        let m2 = Mesh()
        let g = m2.addPolygon(L)!
        let i2 = m2.offsetFace(g, 1)!
        #expect(near(m2.area(m2.faces[i2]!), 8 * 2 + 2 * 6))
    }

    @Test func triangulatesFacesWithHoles() {
        let tris = Earcut.triangulate(outer: [V2(0, 0), V2(10, 0), V2(10, 10), V2(0, 10)],
                                      holes: [[V2(2, 2), V2(2, 8), V2(8, 8), V2(8, 2)]])
        #expect(tris.count == 8)
    }
}

@Suite struct DocumentTests {
    @Test func groupMoveRoundTripAndExport() throws {
        let doc = WBDocument()
        box(doc.root.mesh)
        let g = doc.makeGroup(in: doc.root, faces: Array(doc.root.mesh.faces.keys), edges: [], groups: [])
        #expect(doc.root.mesh.faces.isEmpty)
        #expect(g.mesh.faces.count == 6)
        g.matrix = .translation(V3(100, 0, 0))
        #expect(near(doc.bounds.min.x, 100))
        let size = g.localBounds.size
        #expect([size.x, size.y, size.z] == [10, 20, 5])
        let copy = try WBDocument(data: try doc.data())
        #expect(copy.root.children.count == 1)
        #expect(near(signedVolume(copy.root.children[0].mesh), 1000))
        #expect(Export.triangles(doc).count == 12)
        #expect(Export.stl(doc).count == 84 + 12 * 50)
    }

    @Test func explodeMovedGroup() {
        let doc = WBDocument()
        box(doc.root.mesh)
        let g = doc.makeGroup(in: doc.root, faces: Array(doc.root.mesh.faces.keys), edges: [], groups: [])
        g.matrix = .translation(V3(0, 0, 10))
        doc.explode(g)
        #expect(doc.root.children.isEmpty)
        #expect(near(doc.root.mesh.bounds().min.z, 10))
    }

    @Test func bakeScaleAndMirror() {
        let doc = WBDocument()
        box(doc.root.mesh)
        let g = doc.makeGroup(in: doc.root, faces: Array(doc.root.mesh.faces.keys), edges: [], groups: [])
        g.matrix = .translation(V3(50, 0, 0)) * .rotation(axis: .zAxis, angle: .pi / 2) * .scale(V3(2, 1, 1))
        doc.bakeScale(g)
        let s = g.localBounds.size
        #expect(near(s.x, 20) && near(s.y, 20) && near(s.z, 5))
        #expect(near(signedVolume(g.mesh), 2000))
        let sc = g.matrix.scalePart
        #expect(near(sc.x, 1) && near(sc.y, 1) && near(sc.z, 1))

        let d2 = WBDocument()
        box(d2.root.mesh, 10, 10, 10)
        let g2 = d2.makeGroup(in: d2.root, faces: Array(d2.root.mesh.faces.keys), edges: [], groups: [])
        g2.matrix = .scale(V3(-1, 1, 1))
        d2.bakeScale(g2)
        #expect(near(signedVolume(g2.mesh), 1000))
    }

    @Test func componentsShareEdits() {
        let doc = WBDocument()
        box(doc.root.mesh, 10, 10, 2)
        let a = doc.makeComponent(in: doc.root, faces: Array(doc.root.mesh.faces.keys), edges: [], groups: [], name: "Shelf")
        let b = doc.duplicate(a)
        b.matrix = .translation(V3(0, 0, 20))
        let top = a.mesh.orderedFaces.first { a.mesh.normal($0).z > 0.99 }!
        a.mesh.pushPull(top.id, 3)
        doc.syncComponent(from: a)
        #expect(near(signedVolume(b.mesh), 500))
        #expect(b.matrix.translationPart.z == 20)
        doc.makeUnique(b)
        #expect(doc.components.count == 2)
    }

    /// The file the web app wrote opens here with the same geometry.
    @Test func opensAFileFromTheWebApp() throws {
        let url = try #require(Bundle.module.url(forResource: "web-sample", withExtension: "wb3d", subdirectory: "Fixtures"))
        let doc = try WBDocument(data: try Data(contentsOf: url))
        #expect(doc.root.all.count - 1 == 8)
        #expect(doc.tags.first?.name == "Cabinets")
        #expect(doc.guides.count == 1)
        let tris = Export.triangles(doc)
        #expect(tris.count == 112)
        var vol = 0.0
        for t in tris { vol += t.a.dot(t.b.cross(t.c)) / 6 }
        #expect(abs(vol - 2649.125) < 1e-3)
        let s = doc.bounds.size
        #expect(near(s.x, 70, 1e-4) && near(s.y, 12, 1e-4) && near(s.z, 36, 1e-4))
        // and it round-trips
        let again = try WBDocument(data: try doc.data())
        #expect(Export.triangles(again).count == 112)
    }
}
