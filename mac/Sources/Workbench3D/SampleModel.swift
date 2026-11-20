import simd
import Workbench3DKit

/// A small workbench, used by snapshot mode and the self-test: a top, four legs (one component),
/// a stretcher, and a loose box with a pocket pushed into it.
enum SampleModel {
    static func make() -> WBDocument {
        let doc = WBDocument()
        func block(_ name: String, _ w: Double, _ d: Double, _ h: Double, at p: V3) -> Group {
            let g = doc.newGroup(name)
            let f = g.mesh.addPolygon([V3(0, 0, 0), V3(w, 0, 0), V3(w, d, 0), V3(0, d, 0)])!
            _ = g.mesh.pushPull(f, -h)
            g.matrix = .translation(p)
            doc.root.add(g)
            return g
        }
        _ = block("Top", 48, 24, 1.5, at: V3(0, 0, 30))
        let leg = block("Leg", 3, 3, 30, at: V3(1, 1, 0))
        let def = doc.makeComponent(in: doc.root, faces: [], edges: [], groups: [leg], name: "Leg")
        for p in [V3(44, 1, 0), V3(1, 20, 0), V3(44, 20, 0)] {
            let c = doc.duplicate(def)
            c.matrix = .translation(p - V3(1, 1, 0)) * def.matrix
        }
        _ = block("Stretcher", 40, 1.5, 4, at: V3(4, 11.25, 6))

        // loose geometry: a box with a pocket
        let m = doc.root.mesh
        let base = m.addPolygon([V3(60, 0, 0), V3(78, 0, 0), V3(78, 12, 0), V3(60, 12, 0)])!
        let top = m.pushPull(base, -10)
        if let f = m.faces[top] {
            let c = f.vertexIds.map { m.v($0) }.reduce(V3.zero, +) / Double(f.vertexIds.count)
            if let pocket = m.addPolygon([c + V3(-5, -3, 0), c + V3(5, -3, 0), c + V3(5, 3, 0), c + V3(-5, 3, 0)]) {
                _ = m.pushPull(pocket, -3)
            }
        }
        // tags and a scene, so the sidebar panels have something to show
        doc.tags = [Tag(name: "Legs", color: "#d97706"), Tag(name: "Top", color: "#2563eb"), Tag(name: "Shop", visible: false, color: "#16a34a")]
        for g in doc.root.children where g.componentId != nil { g.tag = "Legs" }
        doc.root.children.first?.tag = "Top"
        doc.scenes = [
            Workbench3DKit.Scene(name: "Overview", camera: .init(position: [-60, -90, 70], target: [24, 12, 15], perspective: true)),
            Workbench3DKit.Scene(name: "Front", camera: .init(position: [24, -140, 18], target: [24, 12, 18], perspective: false), hiddenTags: ["Shop"]),
        ]
        doc.guides.append(Guide(id: doc.nextItemId, point: [0, -6, 0], dir: [1, 0, 0]))
        doc.nextItemId += 1
        return doc
    }
}
