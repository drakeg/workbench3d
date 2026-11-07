import AppKit
import simd
import Workbench3DKit

private func setHover(_ e: Editor, _ p: Picked?) {
    var hf: FaceRef?
    var hg: Int?
    if case .face(let f) = p { hf = FaceRef(group: e.contextId, face: f) }
    if case .group(let g) = p { hg = g }
    if hf != e.hoverFace || hg != e.hoverGroup {
        e.hoverFace = hf
        e.hoverGroup = hg
        e.changed(geometry: false)
    }
}

/// Faces and edges connected to a face or edge through shared edges.
func connected(_ e: Editor, from start: Picked) -> Selection {
    let mesh = e.context.mesh
    var faces = Set<Int>(), edges = Set<EdgeKey>()
    var queue: [EdgeKey] = []
    switch start {
    case .face(let id):
        if let f = mesh.faces[id] {
            faces.insert(id)
            queue += mesh.faceEdgeKeys(f)
        }
    case .edge(let k): queue.append(k)
    case .group: return Selection()
    }
    var byVertex: [Int: [EdgeKey]] = [:]
    for k in mesh.allEdges() {
        byVertex[k.a, default: []].append(k)
        byVertex[k.b, default: []].append(k)
    }
    while let k = queue.popLast() {
        if !edges.insert(k).inserted { continue }
        for f in mesh.facesUsingEdge(k) where faces.insert(f.id).inserted { queue += mesh.faceEdgeKeys(f) }
        for v in [k.a, k.b] { for k2 in byVertex[v] ?? [] where !edges.contains(k2) { queue.append(k2) } }
    }
    return Selection(faces: faces, edges: edges)
}

final class SelectTool: Tool {
    let id = ToolID.select
    let name = "Select"
    let symbol = "cursorarrow"
    let shortcut: Character? = " "
    let hint = "Click to select. Shift-click adds or removes. Drag right to window-select, left to cross-select. Double-click a group to edit it."
    private var down: CGPoint?
    private(set) var box: CGRect?
    private(set) var crossing = false

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        down = ev.pt
        box = nil
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        if let d = down {
            if box != nil || hypot(ev.pt.x - d.x, ev.pt.y - d.y) > 4 {
                box = CGRect(x: min(d.x, ev.pt.x), y: min(d.y, ev.pt.y), width: abs(ev.pt.x - d.x), height: abs(ev.pt.y - d.y))
                crossing = ev.pt.x < d.x
                e.viewChanged()
            }
            return
        }
        setHover(e, pickEntity(e, ev.pt, allowExit: false))
    }

    func mouseUp(_ ev: ToolEvent, _ e: Editor) {
        defer {
            down = nil
            box = nil
            e.viewChanged()
        }
        if let b = box {
            boxSelect(e, b, window: !crossing, add: ev.shift)
            return
        }
        guard down != nil else { return }
        let p = pickEntity(e, ev.pt)
        if ev.clickCount >= 3, let p, !p.isGroup {
            e.select(connected(e, from: p))
            return
        }
        if ev.clickCount == 2 { return } // doubleClick handles it
        guard let p else {
            if !ev.shift { e.select(Selection()) }
            return
        }
        if !ev.shift {
            e.select(selection(of: p))
            return
        }
        var s = e.selection
        switch p {
        case .face(let f): if s.faces.remove(f) == nil { s.faces.insert(f) }
        case .edge(let k): if s.edges.remove(k) == nil { s.edges.insert(k) }
        case .group(let g): if s.groups.remove(g) == nil { s.groups.insert(g) }
        }
        e.select(s)
    }

    func doubleClick(_ ev: ToolEvent, _ e: Editor) {
        guard let p = pickEntity(e, ev.pt, allowExit: false) else {
            if e.context.parent != nil { e.exitGroup() }
            return
        }
        let mesh = e.context.mesh
        switch p {
        case .group(let g): e.enterGroup(g)
        case .face(let id):
            if let f = mesh.faces[id] { e.select(Selection(faces: [id], edges: Set(mesh.faceEdgeKeys(f)))) }
        case .edge(let k): e.select(Selection(faces: Set(mesh.facesUsingEdge(k).map(\.id)), edges: [k]))
        }
    }

    private func boxSelect(_ e: Editor, _ r: CGRect, window: Bool, add: Bool) {
        let cam = e.camera
        func test(_ pts: [V3]) -> Bool {
            let ss = pts.map { cam.project($0).point }
            return window ? ss.allSatisfy { r.contains($0) } : ss.contains { r.contains($0) }
        }
        let ctx = e.context
        let m = ctx.worldMatrix
        func w(_ id: Int) -> V3 { m.transformPoint(ctx.mesh.v(id)) }
        var s = add ? e.selection : Selection()
        for f in ctx.mesh.faces.values where test(f.vertexIds.map(w)) { s.faces.insert(f.id) }
        for k in ctx.mesh.allEdges() where test([w(k.a), w(k.b)]) { s.edges.insert(k) }
        for g in ctx.children where !g.hidden {
            let b = g.localBounds
            if b.isEmpty { continue }
            let gm = g.worldMatrix
            var corners: [V3] = []
            for x in [b.min.x, b.max.x] { for y in [b.min.y, b.max.y] { for z in [b.min.z, b.max.z] { corners.append(gm.transformPoint(V3(x, y, z))) } } }
            if test(corners) { s.groups.insert(g.id) }
        }
        e.select(s)
    }

    func cancel(_ e: Editor) {
        down = nil
        box = nil
        e.escapeDefault()
    }
}

final class EraserTool: Tool {
    let id = ToolID.eraser
    let name = "Eraser"
    let symbol = "eraser"
    let shortcut: Character? = "E"
    let hint = "Click or drag over edges and groups to erase them. Erasing an edge removes the faces it bounds."
    private var active = false
    private var edges = Set<EdgeKey>()
    private var groups = Set<Int>()

    private func collect(_ ev: ToolEvent, _ e: Editor) {
        switch pickEntity(e, ev.pt, allowExit: false) {
        case .edge(let k): edges.insert(k)
        case .group(let g): groups.insert(g)
        default: break
        }
        e.select(Selection(edges: edges, groups: groups))
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        active = true
        edges = []
        groups = []
        collect(ev, e)
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        if active { collect(ev, e) } else { setHover(e, pickEntity(e, ev.pt, allowExit: false)) }
    }

    func mouseUp(_ ev: ToolEvent, _ e: Editor) {
        guard active else { return }
        active = false
        let ed = edges, gr = groups
        e.select(Selection())
        if ed.isEmpty && gr.isEmpty { return }
        e.perform("Erase") {
            let ctx = e.context
            ctx.mesh.erase(faces: [Int](), edges: ed)
            for id in gr { if let g = ctx.children.first(where: { $0.id == id }) { ctx.remove(g) } }
            e.doc.purgeComponents()
        }
    }
}

final class PaintTool: Tool {
    let id = ToolID.paint
    let name = "Paint"
    let symbol = "paintbrush.pointed"
    let shortcut: Character? = "B"
    let hint = "Click a face to paint it, or a group to paint all of it. Shift-click a face to pick up its colour. Pick colours in the inspector."

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) { setHover(e, pickEntity(e, ev.pt, allowExit: false)) }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        guard let p = pickEntity(e, ev.pt, allowExit: false) else { return }
        if ev.shift, case .face(let f) = p {
            if let c = e.context.mesh.faces[f]?.color { e.paintColor = c }
            return
        }
        let color = e.paintColor
        let sel = e.selection
        e.perform("Paint") {
            let ctx = e.context
            switch p {
            case .face(let f):
                for id in sel.faces.contains(f) ? Array(sel.faces) : [f] { ctx.mesh.faces[id]?.color = color }
            case .group(let g):
                for id in sel.groups.contains(g) ? Array(sel.groups) : [g] {
                    guard let grp = ctx.children.first(where: { $0.id == id }) else { continue }
                    for d in grp.all { for fid in Array(d.mesh.faces.keys) { d.mesh.faces[fid]?.color = color } }
                }
            case .edge: break
            }
        }
    }
}

/// Orbit, Pan and Zoom: left-drag navigates.
final class NavTool: Tool {
    let mode: NavMode
    init(_ mode: NavMode) { self.mode = mode }
    var id: ToolID { mode == .orbit ? .orbit : mode == .pan ? .pan : .zoom }
    var name: String { mode == .orbit ? "Orbit" : mode == .pan ? "Pan" : "Zoom" }
    var symbol: String { mode == .orbit ? "rotate.3d" : mode == .pan ? "hand.raised" : "plus.magnifyingglass" }
    var shortcut: Character? { mode == .orbit ? "O" : mode == .pan ? "H" : "Z" }
    var navigation: NavMode? { mode }
    var hint: String {
        switch mode {
        case .orbit: "Drag to orbit. Also: middle-drag, or Option-drag, or Option + two-finger scroll."
        case .pan: "Drag to pan. Also: right-drag, or two-finger scroll on a trackpad."
        case .zoom: "Drag up and down to zoom. Also: pinch, or scroll a mouse wheel. ⇧Z zooms to fit."
        }
    }
}
