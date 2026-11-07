import AppKit
import Observation
import SwiftUI
import simd
import Workbench3DKit

/// What is selected in the group being edited.
struct Selection: Equatable {
    var faces: Set<Int> = []
    var edges: Set<EdgeKey> = []
    var groups: Set<Int> = []
    var isEmpty: Bool { faces.isEmpty && edges.isEmpty && groups.isEmpty }
}

struct FaceRef: Equatable {
    var group: Int
    var face: Int
}

/// A line drawn over the model by a tool (rubber band, protractor...), in world space.
struct OverlayLine {
    var a: V3
    var b: V3
    var color: SIMD4<Float>
    var width: Float = 2
    var onTop = true
}

/// One window's editing state: selection, the group being edited, the active tool, the camera,
/// the Measurements box and tool previews. Every model change goes through `perform` (or a
/// live edit), which records Undo with the window's UndoManager. Port of src/app/app.ts.
@Observable
final class Editor {
    let document: ModelDocument
    var doc: WBDocument { document.model }
    @ObservationIgnored weak var undoManager: UndoManager?

    var camera = Camera()
    var contextId = 0
    var selection = Selection()
    var hoverFace: FaceRef?
    var hoverGroup: Int?
    private(set) var toolId: ToolID = .select
    @ObservationIgnored private(set) var tools: [ToolID: Tool] = [:]
    /// Text typed into the Measurements box (typing in the 3D view goes here too).
    var vcbText = ""
    /// What the active tool reports, e.g. the current length.
    var vcbValue = ""
    var vcbLabel = "Measurements"
    var hint = ""
    var inference: Inference?
    var overlay: [OverlayLine] = []
    var overlayPolygons: [(points: [V3], color: SIMD4<Float>)] = []
    var showGrid = true
    /// Paint tool color; Option-click a face to pick its color up.
    var paintColor = "#c8a26b"
    var xray = false
    var toast: String?
    /// Bumped on every change to geometry or selection: the renderer rebuilds its buffers.
    private(set) var version = 0
    /// Bumped when only the camera or tool previews change.
    private(set) var viewVersion = 0

    @ObservationIgnored var hints = InferenceHints()
    @ObservationIgnored var shiftLock: V3?
    @ObservationIgnored private var pick = PickCache()
    @ObservationIgnored var requestRedraw: () -> Void = {}

    init(document: ModelDocument) {
        self.document = document
        for t in allTools() { tools[t.id] = t }
        hint = tool.hint
    }

    var tool: Tool { tools[toolId]! }

    // MARK: context and selection

    var context: Group { doc.findGroup(contextId) ?? doc.root }

    func enterGroup(_ id: Int) {
        contextId = id
        selection = Selection()
        changed()
    }

    func exitGroup() {
        let ctx = context
        guard let parent = ctx.parent else { return }
        contextId = parent.id
        selection = Selection(groups: [ctx.id])
        changed()
    }

    func select(_ s: Selection) {
        selection = s
        changed(geometry: false)
    }

    var selectedGroups: [Group] { selection.groups.compactMap { doc.findGroup($0) } }

    enum Entity: Equatable {
        case raw
        case group(Int)
    }

    /// Which selectable thing in the current context a group's geometry belongs to.
    func entity(for groupId: Int) -> Entity? {
        let ctx = context
        if groupId == ctx.id { return .raw }
        var p = doc.findGroup(groupId)
        while let g = p {
            if g.parent === ctx { return .group(g.id) }
            p = g.parent
        }
        return nil
    }

    private func pruneSelection() {
        if doc.findGroup(contextId) == nil { contextId = 0 }
        let ctx = context
        let edges = Set(ctx.mesh.allEdges())
        selection.faces = selection.faces.filter { ctx.mesh.faces[$0] != nil }
        selection.edges = selection.edges.filter { edges.contains($0) }
        selection.groups = selection.groups.filter { id in ctx.children.contains { $0.id == id } }
    }

    // MARK: changes and undo

    func changed(geometry: Bool = true) {
        if geometry { pick.valid = false }
        pruneSelection()
        version += 1
        requestRedraw()
    }

    func viewChanged() {
        viewVersion += 1
        requestRedraw()
    }

    /// Run a change as one undo step named `name` ("Undo Push/Pull").
    @discardableResult
    func perform<T>(_ name: String, _ body: () throws -> T) rethrows -> T {
        let before = try? doc.data()
        let result = try body()
        syncComponents()
        changed()
        if let before, let after = try? doc.data() { registerUndo(name, before: before, after: after) }
        return result
    }

    private func registerUndo(_ name: String, before: Data, after: Data) {
        guard let um = undoManager else { return }
        um.registerUndo(withTarget: self) { ed in
            MainActor.assumeIsolated { ed.restore(before, redo: after, name: name) }
        }
        um.setActionName(name)
    }

    private func restore(_ data: Data, redo: Data, name: String) {
        try? doc.load(data)
        changed()
        registerUndo(name, before: redo, after: data)
    }

    /// A change previewed while the pointer moves: each `apply` starts again from the state at `beginLive`.
    final class LiveEdit {
        let name: String
        let before: Data
        var applied = false
        init(name: String, before: Data) {
            self.name = name
            self.before = before
        }
    }

    func beginLive(_ name: String) -> LiveEdit? {
        guard let data = try? doc.data() else { return nil }
        return LiveEdit(name: name, before: data)
    }

    func apply(_ live: LiveEdit, _ body: () -> Void) {
        try? doc.load(live.before)
        body()
        syncComponents()
        live.applied = true
        changed()
    }

    func commit(_ live: LiveEdit) {
        guard live.applied, let after = try? doc.data() else { return }
        registerUndo(live.name, before: live.before, after: after)
    }

    func cancel(_ live: LiveEdit) {
        try? doc.load(live.before)
        changed()
    }

    /// While editing inside a component, mirror edits into every other copy.
    private func syncComponents() {
        var g = doc.findGroup(contextId)
        while let x = g {
            if x.componentId != nil { doc.syncComponent(from: x) }
            g = x.parent
        }
    }

    // MARK: tools

    func setTool(_ id: ToolID) {
        guard let next = tools[id] else { return }
        tool.deactivate(self)
        overlay = []
        overlayPolygons = []
        inference = nil
        hoverFace = nil
        hoverGroup = nil
        vcbText = ""
        vcbValue = ""
        toolId = id
        vcbLabel = next.vcbLabel
        hint = next.hint
        next.activate(self)
        changed(geometry: false)
    }

    func setVCB(_ value: String, label: String? = nil) {
        vcbValue = value
        if let label { vcbLabel = label }
    }

    /// Enter in the Measurements box.
    func submitVCB(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespaces)
        vcbText = ""
        guard !t.isEmpty else { return }
        if !tool.vcb(t, self) { showToast("“\(t)” isn’t a value this tool can use") }
    }

    func showToast(_ text: String) {
        toast = text
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            if toast == text { toast = nil }
        }
    }

    func fmt(_ inches: Double) -> String { Units.format(inches, units: doc.units) }

    /// Escape with nothing in progress: clear the selection, then step out of the group.
    func escapeDefault() {
        if !selection.isEmpty { select(Selection()) } else if context !== doc.root { exitGroup() }
    }

    // MARK: overlay

    func clearOverlay() {
        overlay = []
        overlayPolygons = []
        viewChanged()
    }

    func addLines(_ pts: [V3], color: SIMD4<Float>, width: Float = 2, closed: Bool = false, onTop: Bool = true) {
        guard pts.count > 1 else { return }
        for i in 0..<(closed ? pts.count : pts.count - 1) {
            overlay.append(OverlayLine(a: pts[i], b: pts[(i + 1) % pts.count], color: color, width: width, onTop: onTop))
        }
        viewChanged()
    }

    // MARK: coordinates

    func toLocal(_ p: V3) -> V3 { context.worldMatrix.inverse.transformPoint(p) }
    func dirToLocal(_ d: V3) -> V3 { context.worldMatrix.inverse.transformDirection(d) }

    // MARK: picking

    struct FaceHit {
        var point: V3
        var group: Int
        var face: Int
        var normal: V3
        var distance: Double
    }

    func rebuildPickIfNeeded() {
        if pick.valid { return }
        pick = PickCache.build(doc)
    }

    var pickData: PickCache {
        rebuildPickIfNeeded()
        return pick
    }

    func raycastFaces(_ ray: Ray, where include: (Int) -> Bool = { _ in true }) -> FaceHit? {
        rebuildPickIfNeeded()
        var best: FaceHit?
        for t in pick.triangles where include(t.group) {
            if let d = ray.intersectTriangle(t.a, t.b, t.c), d < (best?.distance ?? .infinity) {
                best = FaceHit(point: ray.at(d), group: t.group, face: t.face, normal: t.normal, distance: d)
            }
        }
        return best
    }

    /// Nearest edge of the current context within a few points of the cursor.
    func pickEdge(_ pt: CGPoint, tolerance: Double = 6) -> EdgeKey? {
        rebuildPickIfNeeded()
        let ray = camera.ray(at: pt)
        let hit = raycastFaces(ray)
        let maxDepth = hit.map { $0.distance + camera.worldPerPoint(at: $0.point) * 4 } ?? .infinity
        var best: (d: Double, key: EdgeKey)?
        for e in pick.edges where e.group == contextId {
            let sa = camera.project(e.a), sb = camera.project(e.b)
            if sa.behind || sb.behind { continue }
            let (d, t) = screenDistance(pt, sa, sb)
            let mid = e.a + (e.b - e.a) * t
            if d < tolerance, d < (best?.d ?? .infinity), mid.distance(to: ray.origin) <= maxDepth { best = (d, e.key) }
        }
        return best?.key
    }

    // MARK: inference

    func infer(_ pt: CGPoint, _ opts: InferOptions = InferOptions()) -> Inference {
        var o = opts
        o.guides = doc.guides.map { g in (V3(g.point[0], g.point[1], g.point[2]), g.dir.map { V3($0[0], $0[1], $0[2]) }) }
        if let lock = shiftLock, o.from != nil, o.lockAxis == nil, o.lockDir == nil { o.lockDir = lock }
        let r = Inferencer.infer(pt, editor: self, o)
        lastInference = (r, o.from)
        return r
    }

    @ObservationIgnored var lastInference: (Inference, V3?)?

    func startShiftLock() {
        guard let (inf, from) = lastInference, let from else { return }
        var dir = inf.dir
        if dir == nil, [.endpoint, .midpoint, .onEdge].contains(inf.kind) { dir = inf.point - from }
        guard let d = dir, d.lengthSquared > 1e-10 else { return }
        shiftLock = d.normalized
        hint = "Direction locked while Shift is held."
    }

    func endShiftLock() {
        if shiftLock != nil {
            shiftLock = nil
            hint = tool.hint
        }
    }

    // MARK: model-wide

    var modelBounds: Box3 { doc.bounds }

    func zoomExtents() {
        camera.zoomExtents(modelBounds)
        viewChanged()
    }

    func setView(_ v: Camera.StandardView) {
        camera.setView(v, fit: modelBounds)
        viewChanged()
    }
}

func screenDistance(_ p: CGPoint, _ a: Camera.Projected, _ b: Camera.Projected) -> (Double, Double) {
    let ax = a.x, ay = a.y, bx = b.x - a.x, by = b.y - a.y
    let len2 = max(bx * bx + by * by, 1e-9)
    let t = max(0, min(1, ((p.x - ax) * bx + (p.y - ay) * by) / len2))
    let dx = ax + bx * t - p.x, dy = ay + by * t - p.y
    return ((dx * dx + dy * dy).squareRoot(), t)
}

/// World-space triangles, edges and vertices of everything visible, rebuilt when the model changes.
struct PickCache {
    struct Tri {
        var a, b, c: V3
        var normal: V3
        var group: Int
        var face: Int
    }
    struct Edge {
        var a, b: V3
        var key: EdgeKey
        var group: Int
    }
    struct Vert {
        var p: V3
        var id: Int
        var group: Int
    }
    var triangles: [Tri] = []
    var edges: [Edge] = []
    var verts: [Vert] = []
    var valid = false

    static func build(_ doc: WBDocument) -> PickCache {
        var c = PickCache()
        for g in doc.root.all where !doc.isHidden(g) {
            let m = g.worldMatrix
            let nm = m.normalMatrix
            var world: [Int: V3] = [:]
            for (id, p) in g.mesh.verts {
                let w = m.transformPoint(p)
                world[id] = w
                c.verts.append(Vert(p: w, id: id, group: g.id))
            }
            for f in g.mesh.faces.values {
                let n = (nm * g.mesh.normal(f)).normalized
                for (a, b, cc) in g.mesh.triangulate(f) {
                    c.triangles.append(Tri(a: world[a]!, b: world[b]!, c: world[cc]!, normal: n, group: g.id, face: f.id))
                }
            }
            for k in g.mesh.allEdges() { c.edges.append(Edge(a: world[k.a]!, b: world[k.b]!, key: k, group: g.id)) }
        }
        c.valid = true
        return c
    }
}
