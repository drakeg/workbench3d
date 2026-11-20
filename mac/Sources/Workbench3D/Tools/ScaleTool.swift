import AppKit
import simd
import Workbench3DKit

/// Scale: drag a green grip on the selection's box. Corner grips scale evenly; edge and face grips
/// stretch. Tap Option to scale about the centre instead of the opposite grip. Type a factor
/// (2, 0.5, -1 mirrors) or a size with a unit (24"), or one value per stretched axis ("2, 1.5").
/// Port of the ScaleTool in src/tools/more.ts.
final class ScaleTool: Tool {
    let id = ToolID.scale
    let name = "Scale"
    let symbol = "arrow.up.left.and.arrow.down.right"
    let shortcut: Character? = "S"
    let vcbLabel = "Scale"
    let hint = "Select something, then drag a green grip. Corners scale evenly, edges and faces stretch. Tap Option to scale about the centre. Type a factor (2, 0.5, −1 to mirror) or a size like 24\"."

    private struct Box {
        var center: V3
        var half: V3
        /// Orientation of the box (a single group scales along its own axes).
        var basis: Mat4
    }

    private struct Grip: Equatable {
        var mask: V3
        var point: V3
        var isCorner: Bool { abs(mask.x) + abs(mask.y) + abs(mask.z) == 3 }
    }

    private struct Op {
        var grip: Grip
        var anchor: V3
        var live: Editor.LiveEdit
        var factor = V3(1, 1, 1)
        var down: CGPoint
    }

    private var box: Box?
    private var grips: [Grip] = []
    private var hover: Grip?
    private var op: Op?
    private var aboutCenter = false

    func activate(_ e: Editor) {
        computeBox(e)
        draw(e)
    }

    func deactivate(_ e: Editor) {
        if op != nil { cancel(e) }
        e.clearOverlay()
    }

    // MARK: box and grips

    private func computeBox(_ e: Editor) {
        box = nil
        grips = []
        let groups = e.selectedGroups
        let ctx = e.context
        let m = ctx.worldMatrix
        var basis = Mat4.identity
        var pts: [V3] = []
        if groups.count == 1, e.selection.faces.isEmpty, e.selection.edges.isEmpty {
            let g = groups[0]
            let wm = g.worldMatrix
            basis = wm.rotationPart
            let lb = g.localBounds
            if lb.isEmpty { return }
            for x in [lb.min.x, lb.max.x] { for y in [lb.min.y, lb.max.y] { for z in [lb.min.z, lb.max.z] { pts.append(wm.transformPoint(V3(x, y, z))) } } }
        } else {
            for v in ctx.mesh.verticesOf(faces: e.selection.faces, edges: e.selection.edges) { pts.append(m.transformPoint(ctx.mesh.v(v))) }
            for g in groups {
                let b = g.worldBounds
                if !b.isEmpty { pts += [b.min, b.max] }
            }
        }
        guard !pts.isEmpty else { return }
        let inv = basis.inverse
        var lb = Box3()
        for p in pts { lb.expand(inv.transformPoint(p)) }
        let center = basis.transformPoint((lb.min + lb.max) / 2)
        let half = (lb.max - lb.min) / 2
        box = Box(center: center, half: half, basis: basis)
        for x in [-1.0, 0, 1] {
            for y in [-1.0, 0, 1] {
                for z in [-1.0, 0, 1] {
                    if x == 0, y == 0, z == 0 { continue }
                    // no grips along a flat dimension (a face on the ground has no height)
                    if (half.x < 1e-6 && x != 0) || (half.y < 1e-6 && y != 0) || (half.z < 1e-6 && z != 0) { continue }
                    let mask = V3(x, y, z)
                    grips.append(Grip(mask: mask, point: gripPoint(mask)))
                }
            }
        }
    }

    private func gripPoint(_ mask: V3) -> V3 {
        let b = box!
        return b.basis.transformPoint(V3(mask.x * b.half.x, mask.y * b.half.y, mask.z * b.half.z)) + b.center
    }

    private func draw(_ e: Editor) {
        e.clearOverlay()
        guard box != nil else {
            e.hint = "Select a group, component or some geometry, then drag a grip. Or click something to select it."
            return
        }
        var c: [V3] = []
        for z in [-1.0, 1] { for (x, y) in [(-1.0, -1.0), (1, -1), (1, 1), (-1, 1)] { c.append(gripPoint(V3(x, y, z))) } }
        let orange = Palette3D.hover
        e.addLines(Array(c[0..<4]), color: orange, width: 1.2, closed: true)
        e.addLines(Array(c[4..<8]), color: orange, width: 1.2, closed: true)
        for i in 0..<4 { e.addLines([c[i], c[i + 4]], color: orange, width: 1.2) }
        for g in grips {
            let r = e.camera.worldPerPoint(at: g.point) * 4
            let hot = g == hover
            let color = hot ? Palette3D.axisRGBA(.x) : Palette3D.axisRGBA(.y)
            for ax in [V3(r, 0, 0), V3(0, r, 0), V3(0, 0, r)] {
                e.addLines([g.point - ax, g.point + ax], color: color, width: hot ? 6 : 4)
            }
        }
        e.viewChanged()
    }

    private func nearestGrip(_ e: Editor, _ pt: CGPoint) -> Grip? {
        var best: (d: Double, g: Grip)?
        for g in grips {
            let s = e.camera.project(g.point)
            let d = hypot(s.x - pt.x, s.y - pt.y)
            if !s.behind, d < 12, d < (best?.d ?? .infinity) { best = (d, g) }
        }
        return best?.g
    }

    // MARK: input

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard let op else {
            let g = nearestGrip(e, ev.pt)
            if g != hover {
                hover = g
                draw(e)
                e.hint = g.map { $0.isCorner ? "Uniform scale (corner)" : "Stretch" } ?? hint
            }
            return
        }
        let dir = op.grip.point - op.anchor
        let len = dir.length
        guard len > 1e-9 else { return }
        let t = closestParamOnLine(op.anchor, dir / len, ev.ray.origin, ev.ray.direction) / len
        apply(e, uniformOrMasked(t))
    }

    private func uniformOrMasked(_ t0: Double) -> V3 {
        let t = abs(t0) < 1e-4 ? 1e-4 * (t0 < 0 ? -1 : 1) : t0
        guard let op else { return V3(1, 1, 1) }
        if op.grip.isCorner { return V3(t, t, t) }
        let m = op.grip.mask
        return V3(m.x != 0 ? t : 1, m.y != 0 ? t : 1, m.z != 0 ? t : 1)
    }

    private func apply(_ e: Editor, _ f: V3) {
        guard var op, let b = box else { return }
        op.factor = f
        self.op = op
        let world = Mat4.translation(op.anchor) * b.basis * Mat4.scale(f) * b.basis.inverse * Mat4.translation(-op.anchor)
        let sel = e.selection
        e.apply(op.live) {
            let ctx = e.context
            let ctxW = ctx.worldMatrix
            let local = ctxW.inverse * world * ctxW
            for id in sel.groups {
                guard let g = e.doc.findGroup(id) else { continue }
                g.matrix = local * g.matrix
                e.doc.bakeScale(g)
            }
            let verts = ctx.mesh.verticesOf(faces: sel.faces, edges: sel.edges)
            ctx.mesh.apply(local, to: verts)
            if local.determinant < 0 {
                // mirrored: flip every face that moved as a whole, so it still faces out
                for (fid, _) in ctx.mesh.faces where ctx.mesh.verticesOf(faces: [fid], edges: [EdgeKey]()).isSubset(of: verts) {
                    ctx.mesh.reverseFace(fid)
                }
            }
        }
        let r = { (x: Double) in String((x * 1000).rounded() / 1000).replacingOccurrences(of: ".0", with: "", options: [.anchored, .backwards]) }
        e.setVCB(f.x == f.y && f.y == f.z ? r(f.x) : "\(r(f.x)), \(r(f.y)), \(r(f.z))", label: "Scale")
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        if op != nil { return finish(e) }
        guard let b = box else {
            // pick what's under the cursor, like Move does
            guard let p = pickEntity(e, ev.pt, allowExit: false) else { return }
            e.select(selection(of: p))
            computeBox(e)
            draw(e)
            return
        }
        guard let g = nearestGrip(e, ev.pt), let live = e.beginLive(name) else { return }
        let anchor = aboutCenter ? b.center : gripPoint(-g.mask)
        op = Op(grip: g, anchor: anchor, live: live, down: ev.pt)
    }

    func mouseUp(_ ev: ToolEvent, _ e: Editor) {
        if let op, hypot(ev.pt.x - op.down.x, ev.pt.y - op.down.y) > 6 { finish(e) }
    }

    private func finish(_ e: Editor) {
        guard let op else { return }
        self.op = nil
        let f = op.factor
        if abs(f.x - 1) < 1e-6, abs(f.y - 1) < 1e-6, abs(f.z - 1) < 1e-6 { e.cancel(op.live) } else { e.commit(op.live) }
        computeBox(e)
        draw(e)
    }

    func optionTapped(_ e: Editor) {
        aboutCenter.toggle()
        e.hint = aboutCenter ? "Scaling about the centre." : "Scaling about the opposite grip."
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard let op, let b = box else { return false }
        let parts = text.split(whereSeparator: { $0 == "," || $0 == ";" }).map { $0.trimmingCharacters(in: .whitespaces) }
        let dims = b.half * 2
        let mask = op.grip.mask
        let active = [mask.x, mask.y, mask.z].enumerated().filter { $0.element != 0 }.map(\.offset)
        // a value with a unit is a target size along that axis
        func factor(_ s: String, axis: Int) -> Double? {
            if let k = Double(s) { return k }
            guard let len = Units.parse(s, units: e.doc.units), dims[axis] > 1e-9 else { return nil }
            return len / dims[axis]
        }
        var f = V3(1, 1, 1)
        if parts.count == 1 {
            guard let first = active.first, let k = factor(parts[0], axis: first) else { return false }
            f = op.grip.isCorner ? V3(k, k, k) : uniformOrMasked(k)
        } else {
            for (i, s) in parts.enumerated() {
                let axis = i < active.count ? active[i] : i
                guard axis < 3, let k = factor(s, axis: axis) else { return false }
                f[axis] = k
            }
        }
        apply(e, f)
        finish(e)
        return true
    }

    func cancel(_ e: Editor) {
        guard let op else { return e.escapeDefault() }
        e.cancel(op.live)
        self.op = nil
        draw(e)
    }
}
