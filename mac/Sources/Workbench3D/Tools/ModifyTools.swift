import AppKit
import simd
import Workbench3DKit

private func show(_ e: Editor, _ inf: Inference?) {
    e.inference = inf.flatMap { $0.kind == .free ? nil : $0 }
    e.viewChanged()
}

/// If nothing is selected, pick what's under the cursor (Move, Rotate).
private func ensureSelection(_ e: Editor, _ pt: CGPoint) -> Bool {
    if !e.selection.isEmpty { return true }
    guard let p = pickEntity(e, pt, allowExit: false) else { return false }
    e.select(selection(of: p))
    return true
}

private func movingExclusions(_ e: Editor) -> (groups: Set<Int>, verts: Set<String>) {
    var groups = Set<Int>()
    for g in e.selectedGroups { for d in g.all { groups.insert(d.id) } }
    let ctx = e.context
    let verts = Set(ctx.mesh.verticesOf(faces: e.selection.faces, edges: e.selection.edges).map { "\(ctx.id):\($0)" })
    return (groups, verts)
}

/// Apply a context-local transform to the selection, optionally as copies. Returns the copies' selection.
@discardableResult
private func transformSelection(_ e: Editor, _ sel: Selection, copy: Bool, copies: Int = 1, step: (Int) -> Mat4) -> Selection? {
    let ctx = e.context
    let groups = sel.groups.compactMap { id in ctx.children.first { $0.id == id } }
    if !copy {
        let m = step(1)
        for g in groups { g.matrix = m * g.matrix }
        ctx.mesh.apply(m, to: ctx.mesh.verticesOf(faces: sel.faces, edges: sel.edges))
        return nil
    }
    var out = Selection()
    let piece = ctx.mesh.extract(faces: sel.faces, edges: sel.edges)
    for k in 1...max(1, copies) {
        let mk = step(k)
        for g in groups {
            let d = e.doc.duplicate(g)
            d.matrix = mk * d.matrix
            out.groups.insert(d.id)
        }
        if !piece.isEmpty {
            let r = ctx.mesh.merge(piece, transform: mk)
            out.faces.formUnion(r.faces)
            out.edges.formUnion(r.lines)
        }
    }
    return out
}

// MARK: - Push/Pull

final class PushPullTool: Tool {
    let id = ToolID.pushpull
    let name = "Push/Pull"
    let symbol = "square.stack.3d.up"
    let shortcut: Character? = "P"
    let vcbLabel = "Distance"
    let hint = "Click a face and move to push or pull it, then click again (or drag and release). Type a distance and press Return. Double-click a face to repeat the last distance."
    private struct Op {
        var face: Int
        var n: V3
        var start: V3
        var live: Editor.LiveEdit
        var d = 0.0
        var down: CGPoint
        var verts: Set<String>
    }
    private var op: Op?
    private var lastD = 0.0
    private var lastFace: Int?

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard var op else {
            let hit = e.raycastFaces(ev.ray)
            let own = hit.flatMap { $0.group == e.contextId ? FaceRef(group: $0.group, face: $0.face) : nil }
            if own != e.hoverFace {
                e.hoverFace = own
                e.changed(geometry: false)
            }
            return
        }
        var o = InferOptions()
        o.excludeVerts = op.verts
        o.noFaces = true
        let inf = e.infer(ev.pt, o)
        let d: Double
        if [.endpoint, .midpoint, .onEdge].contains(inf.kind) {
            d = (inf.point - op.start).dot(op.n)
            show(e, inf)
        } else {
            d = closestParamOnLine(op.start, op.n, ev.ray.origin, ev.ray.direction)
            show(e, nil)
        }
        apply(&op, d, e)
        self.op = op
    }

    private func apply(_ op: inout Op, _ d: Double, _ e: Editor) {
        op.d = d
        let face = op.face
        e.apply(op.live) { e.context.mesh.pushPull(face, d) }
        e.overlay = []
        e.addLines([op.start, op.start + op.n * d], color: Palette3D.muted, width: 1.4)
        e.setVCB(e.fmt(abs(d)))
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        if op != nil { return finish(e) }
        guard let hit = e.raycastFaces(ev.ray) else { return }
        guard hit.group == e.contextId else {
            e.showToast("That face is inside a group. Double-click the group with the Select tool to edit it.")
            return
        }
        guard let face = e.context.mesh.faces[hit.face], let live = e.beginLive("Push/Pull") else { return }
        let verts = Set(face.vertexIds.map { "\(e.contextId):\($0)" })
        op = Op(face: hit.face, n: hit.normal.normalized, start: hit.point, live: live, down: ev.pt, verts: verts)
        e.hoverFace = nil
    }

    func mouseUp(_ ev: ToolEvent, _ e: Editor) {
        if let op, hypot(ev.pt.x - op.down.x, ev.pt.y - op.down.y) > 6 { finish(e) }
    }

    private func finish(_ e: Editor) {
        guard let o = op else { return }
        op = nil
        e.clearOverlay()
        show(e, nil)
        if abs(o.d) < 1e-4 { return e.cancel(o.live) }
        e.commit(o.live)
        lastD = o.d
        lastFace = o.face
    }

    func doubleClick(_ ev: ToolEvent, _ e: Editor) {
        guard op == nil, lastD != 0, let hit = e.raycastFaces(ev.ray), hit.group == e.contextId else { return }
        let d = lastD
        e.perform("Push/Pull") { e.context.mesh.pushPull(hit.face, d) }
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard let v = Units.parse(text, units: e.doc.units) else { return false }
        if var o = op {
            // ground faces point down: a typed distance pulls them up
            let sign: Double = abs(o.d) > 1e-6 ? (o.d < 0 ? -1 : 1) : (o.n.z < -0.99 ? -1 : 1)
            apply(&o, sign * v, e)
            op = o
            finish(e)
            return true
        }
        return false
    }

    func cancel(_ e: Editor) {
        guard let o = op else { return e.escapeDefault() }
        e.cancel(o.live)
        op = nil
        e.clearOverlay()
    }

    func deactivate(_ e: Editor) { if op != nil { cancel(e) } }
}

// MARK: - Offset

final class OffsetTool: Tool {
    let id = ToolID.offset
    let name = "Offset"
    let symbol = "square.on.square.dashed"
    let shortcut: Character? = "F"
    let vcbLabel = "Distance"
    let hint = "Click a face, then move inward or outward and click to offset its outline. Type a distance (negative = outward)."
    private struct Op {
        var face: Int
        var normal: V3
        var point: V3
        var start: Double
        var d = 0.0
        var live: Editor.LiveEdit
    }
    private var op: Op?

    /// Signed distance of p from the face outline (+ inside).
    private func inside(_ e: Editor, _ faceId: Int, _ p: V3) -> Double {
        let mesh = e.context.mesh
        guard let face = mesh.faces[faceId] else { return 0 }
        let m = e.context.worldMatrix
        let pts = mesh.loopPoints(face.outer).map { m.transformPoint($0) }
        var d = Double.infinity
        for i in pts.indices { d = min(d, closestPointOnSegment(p, pts[i], pts[(i + 1) % pts.count]).point.distance(to: p)) }
        var outerOnly = face
        outerOnly.holes = []
        return mesh.pointInFace(outerOnly, e.toLocal(p), margin: 0) ? d : -d
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard var o = op else {
            let hit = e.raycastFaces(ev.ray) { $0 == e.contextId }
            let hf = hit.map { FaceRef(group: $0.group, face: $0.face) }
            if hf != e.hoverFace {
                e.hoverFace = hf
                e.changed(geometry: false)
            }
            return
        }
        guard let p = ev.ray.intersectPlane(normal: o.normal, point: o.point) else { return }
        o.d = inside(e, o.face, p) - o.start
        let face = o.face, d = o.d
        e.apply(o.live) { _ = e.context.mesh.offsetFace(face, d) }
        e.setVCB(e.fmt(d))
        op = o
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        if op != nil { return finish(e) }
        guard let hit = e.raycastFaces(ev.ray, where: { $0 == e.contextId }), let live = e.beginLive("Offset") else { return }
        op = Op(face: hit.face, normal: hit.normal, point: hit.point, start: inside(e, hit.face, hit.point), live: live)
        e.hoverFace = nil
    }

    private func finish(_ e: Editor) {
        guard let o = op else { return }
        op = nil
        if abs(o.d) < 1e-4 { e.cancel(o.live) } else { e.commit(o.live) }
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard var o = op, let v = Units.parse(text, units: e.doc.units) else { return false }
        o.d = v
        let face = o.face
        e.apply(o.live) { _ = e.context.mesh.offsetFace(face, v) }
        op = o
        finish(e)
        return true
    }

    func cancel(_ e: Editor) {
        guard let o = op else { return e.escapeDefault() }
        e.cancel(o.live)
        op = nil
    }

    func deactivate(_ e: Editor) { if op != nil { cancel(e) } }
}

// MARK: - Move

final class MoveTool: Tool {
    let id = ToolID.move
    let name = "Move"
    let symbol = "arrow.up.and.down.and.arrow.left.and.right"
    let shortcut: Character? = "M"
    let vcbLabel = "Distance"
    let hint = "Click a point on the selection (or anything under the cursor), then click where it goes. Tap Option to toggle Copy. After a copy, type “x5” for 5 copies or “/5” to divide."
    private struct Op {
        var start: V3
        var live: Editor.LiveEdit
        var delta = V3.zero
        var down: CGPoint
        var excl: (groups: Set<Int>, verts: Set<String>)
        var sel: Selection
        var copies: Selection?
    }
    private var op: Op?
    private var lock: Axis?
    private var copy = false
    private var lastCopy: (delta: V3, orig: Selection)?

    func activate(_ e: Editor) {
        copy = false
        lastCopy = nil
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard let o = op else { return show(e, e.infer(ev.pt)) }
        var opts = InferOptions()
        opts.from = o.start
        opts.lockAxis = lock
        opts.excludeGroups = o.excl.groups
        opts.excludeVerts = o.excl.verts
        let inf = e.infer(ev.pt, opts)
        show(e, inf)
        apply(inf.point - o.start, e)
    }

    private func apply(_ delta: V3, _ e: Editor, copies: Int = 1, divide: Bool = false) {
        guard var o = op else { return }
        o.delta = delta
        let sel = o.sel
        var made: Selection?
        e.apply(o.live) {
            let local = e.dirToLocal(delta)
            made = transformSelection(e, sel, copy: copy, copies: copies) { k in
                let f = divide ? Double(k) / Double(copies) : Double(k)
                return .translation(local * f)
            }
        }
        e.selection = sel
        o.copies = made
        op = o
        e.overlay = []
        e.addLines([o.start, o.start + delta], color: lineColor(o.start, o.start + delta), width: 1.6)
        e.setVCB(e.fmt(delta.length))
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        if op != nil { return finish(e) }
        guard ensureSelection(e, ev.pt), let live = e.beginLive(copy ? "Copy" : "Move") else { return }
        op = Op(start: e.infer(ev.pt).point, live: live, down: ev.pt, excl: movingExclusions(e), sel: e.selection)
    }

    func mouseUp(_ ev: ToolEvent, _ e: Editor) {
        if let o = op, hypot(ev.pt.x - o.down.x, ev.pt.y - o.down.y) > 6 { finish(e) }
    }

    private func finish(_ e: Editor) {
        guard let o = op else { return }
        op = nil
        lock = nil
        e.clearOverlay()
        show(e, nil)
        if o.delta.length < 1e-5 { return e.cancel(o.live) }
        e.commit(o.live)
        if copy, let c = o.copies {
            lastCopy = (o.delta, o.sel)
            e.select(c)
        } else {
            lastCopy = nil
        }
    }

    func optionTapped(_ e: Editor) {
        copy.toggle()
        e.hint = copy ? "Copy mode (+): the original stays put. Tap Option again to move instead." : hint
    }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard op != nil, let a = axisFromKey(key, current: lock) else { return false }
        lock = a
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        if op == nil, let lc = lastCopy, let m = text.wholeMatch(of: /(?:[xX*](\d+)|(\d+)[xX*]|\/(\d+))/) {
            let n = Int(m.1 ?? m.2 ?? m.3 ?? "") ?? 0
            guard n >= 1 else { return false }
            let divide = m.3 != nil
            e.undoManager?.undo()
            e.select(lc.orig)
            copy = true
            guard let live = e.beginLive("Copy") else { return false }
            op = Op(start: .zero, live: live, down: .zero, excl: ([], []), sel: lc.orig)
            apply(lc.delta, e, copies: n, divide: divide)
            finish(e)
            return true
        }
        guard let o = op, let v = Units.parse(text, units: e.doc.units) else { return false }
        let dir = o.delta.lengthSquared > 1e-12 ? o.delta.normalized : lock?.vector
        guard let dir else { return false }
        apply(dir * v, e)
        finish(e)
        return true
    }

    func cancel(_ e: Editor) {
        guard let o = op else { return e.escapeDefault() }
        e.cancel(o.live)
        op = nil
        lock = nil
        e.clearOverlay()
    }

    func deactivate(_ e: Editor) { if op != nil { cancel(e) } }
}

// MARK: - Rotate

final class RotateTool: Tool {
    let id = ToolID.rotate
    let name = "Rotate"
    let symbol = "arrow.trianglehead.clockwise.rotate.90"
    let shortcut: Character? = "Q"
    let vcbLabel = "Angle"
    let hint = "Click the centre (on a face to rotate in its plane), click a reference point, then click to set the angle. Type degrees. Arrow keys pick the axis. Tap Option to copy."
    private var stage = 0
    private var center = V3.zero
    private var n = V3.zAxis
    private var ref = V3.xAxis
    private var angle = 0.0
    private var live: Editor.LiveEdit?
    private var sel = Selection()
    private var lock: Axis?
    private var copy = false

    func activate(_ e: Editor) {
        stage = 0
        copy = false
    }

    private func protractor(_ e: Editor, _ cur: V3? = nil) {
        e.overlay = []
        let r = e.camera.worldPerPoint(at: center) * 46
        let (u, v) = planeBasis(n)
        let pts = (0..<48).map { i -> V3 in
            let a = Double(i) / 48 * 2 * .pi
            return center + u * (cos(a) * r) + v * (sin(a) * r)
        }
        let ax = [Axis.x, .y, .z].first { abs($0.vector.dot(n)) > 0.999 }
        e.addLines(pts, color: ax.map(Palette3D.axisRGBA) ?? Palette3D.selection, width: 1.8, closed: true)
        if stage >= 1 { e.addLines([center, center + ref * r * 1.6], color: Palette3D.muted, width: 1.4) }
        if let cur { e.addLines([center, cur], color: Palette3D.ink, width: 1.4) }
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        if stage == 0 {
            let inf = e.infer(ev.pt)
            show(e, inf)
            center = inf.point
            n = planeFromInference(inf, lock: lock, editor: e)
            protractor(e)
            return
        }
        var o = InferOptions()
        o.from = center
        o.plane = (n, center)
        if stage == 2 {
            let ex = movingExclusions(e)
            o.excludeGroups = ex.groups
            o.excludeVerts = ex.verts
        }
        let inf = e.infer(ev.pt, o)
        show(e, inf)
        var dir = inf.point - center
        dir -= n * dir.dot(n)
        if dir.lengthSquared < 1e-12 { return }
        dir = dir.normalized
        if stage == 1 {
            ref = dir
            protractor(e, inf.point)
            return
        }
        var a = atan2(n.dot(ref.cross(dir)), ref.dot(dir))
        let deg = a * 180 / .pi
        let snap = (deg / 15).rounded() * 15
        if abs(deg - snap) < 2.5 { a = snap * .pi / 180 }
        apply(a, e)
        protractor(e, inf.point)
    }

    private func apply(_ a: Double, _ e: Editor) {
        guard let live else { return }
        angle = a
        let s = sel, c = center, axis = n, cp = copy
        e.apply(live) {
            let ctxW = e.context.worldMatrix
            func local(_ k: Int) -> Mat4 {
                let world = Mat4.translation(c) * .rotation(axis: axis, angle: a * Double(k)) * .translation(-c)
                return ctxW.inverse * world * ctxW
            }
            transformSelection(e, s, copy: cp, step: local)
        }
        e.selection = s
        e.setVCB(String(format: "%.1f°", a * 180 / .pi))
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        switch stage {
        case 0:
            if ensureSelection(e, ev.pt) {
                sel = e.selection
                stage = 1
            }
        case 1:
            stage = 2
            live = e.beginLive(copy ? "Rotate Copy" : "Rotate")
        default:
            finish(e)
        }
    }

    private func finish(_ e: Editor) {
        if let live { abs(angle) < 1e-6 ? e.cancel(live) : e.commit(live) }
        live = nil
        stage = 0
        angle = 0
        lock = nil
        e.clearOverlay()
    }

    func optionTapped(_ e: Editor) {
        copy.toggle()
        e.hint = copy ? "Rotate copy (+): the original stays put." : hint
    }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard stage == 0, let a = axisFromKey(key, current: lock) else { return false }
        lock = a
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard stage == 2, let m = text.wholeMatch(of: /(-?[\d.]+)\s*°?/), let deg = Double(m.1) else { return false }
        apply(deg * .pi / 180 * (angle < 0 ? -1 : 1), e)
        finish(e)
        return true
    }

    func cancel(_ e: Editor) {
        if stage == 0 { return e.escapeDefault() }
        if let live { e.cancel(live) }
        live = nil
        stage = 0
        e.clearOverlay()
    }

    func deactivate(_ e: Editor) { if stage != 0 { cancel(e) } }
}

// MARK: - Tape measure

final class TapeTool: Tool {
    let id = ToolID.tape
    let name = "Tape Measure"
    let symbol = "ruler"
    let shortcut: Character? = "T"
    let vcbLabel = "Length"
    let hint = "Click two points to measure. Start on an edge for a parallel guide line, on a point for a guide point. Tap Option to measure without guides."
    private var a: V3?
    private var edgeDir: V3?
    private var last: V3?
    private var lock: Axis?
    private var guides = true

    private func reset(_ e: Editor) {
        a = nil
        edgeDir = nil
        last = nil
        lock = nil
        e.clearOverlay()
    }

    private func parallel(_ p: V3) -> (p: V3, dist: Double, perp: V3) {
        let rel = p - a!
        let perp = rel - edgeDir! * rel.dot(edgeDir!)
        return (a! + perp, perp.length, perp)
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        var o = InferOptions()
        o.from = a
        o.lockAxis = a == nil ? nil : lock
        let inf = e.infer(ev.pt, o)
        show(e, inf)
        guard let a else { return }
        last = inf.point
        e.overlay = []
        if let d = edgeDir, guides {
            let (p, dist, _) = parallel(inf.point)
            e.addLines([p - d * 2000, p + d * 2000], color: Palette3D.guide, width: 1.2, onTop: false)
            e.addLines([a, p], color: Palette3D.ink, width: 1.6)
            e.setVCB(e.fmt(dist))
            return
        }
        e.addLines([a, inf.point], color: lineColor(a, inf.point), width: 2)
        let d = inf.point - a
        e.setVCB(e.fmt(d.length))
        e.hint = "Δ red \(e.fmt(abs(d.x)))   Δ green \(e.fmt(abs(d.y)))   Δ blue \(e.fmt(abs(d.z)))\(guides ? "" : "   (guides off)")"
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        var o = InferOptions()
        o.from = a
        o.lockAxis = a == nil ? nil : lock
        let inf = e.infer(ev.pt, o)
        guard a != nil else {
            a = inf.point
            if [.onEdge, .midpoint].contains(inf.kind), let ed = inf.edge { edgeDir = (ed.b - ed.a).normalized }
            return
        }
        place(inf.point, e)
    }

    private func place(_ b: V3, _ e: Editor) {
        guard let a else { return }
        if guides {
            if let d = edgeDir {
                let (p, dist, _) = parallel(b)
                if dist > 1e-4 {
                    e.perform("Guide") {
                        e.doc.guides.append(Guide(id: e.doc.nextItemId, point: [p.x, p.y, p.z], dir: [d.x, d.y, d.z]))
                        e.doc.nextItemId += 1
                    }
                }
            } else if b.distance(to: a) > 1e-4 {
                e.perform("Guide Point") {
                    e.doc.guides.append(Guide(id: e.doc.nextItemId, point: [b.x, b.y, b.z], dir: nil))
                    e.doc.nextItemId += 1
                }
            }
        }
        e.setVCB(e.fmt(edgeDir != nil ? parallel(b).dist : a.distance(to: b)))
        reset(e)
    }

    func optionTapped(_ e: Editor) {
        guides.toggle()
        e.hint = guides ? hint : "Measuring only: no guides will be created."
    }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard let a2 = axisFromKey(key, current: lock) else { return false }
        lock = a2
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard let v = Units.parse(text, units: e.doc.units), let a, let last else { return false }
        if edgeDir != nil {
            let perp = parallel(last).perp
            if perp.lengthSquared < 1e-12 { return false }
            place(a + perp.normalized * v, e)
            return true
        }
        let dir = last - a
        if dir.lengthSquared < 1e-12 { return false }
        place(a + dir.normalized * v, e)
        return true
    }

    func cancel(_ e: Editor) {
        if a == nil { return e.escapeDefault() }
        reset(e)
        e.hint = hint
    }
}
