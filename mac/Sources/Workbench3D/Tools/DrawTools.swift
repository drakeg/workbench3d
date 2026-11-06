import AppKit
import Workbench3DKit

private func showInference(_ e: Editor, _ inf: Inference) {
    e.inference = inf.kind == .free ? nil : inf
    e.viewChanged()
}

private func lockHint(_ a: Axis?) -> String? {
    a.map { "Locked to the \($0.name.lowercased()) axis. Press the same arrow again to unlock." }
}

final class LineTool: Tool {
    let id = ToolID.line
    let name = "Line"
    let symbol = "line.diagonal"
    let shortcut: Character? = "L"
    let vcbLabel = "Length"
    let hint = "Click to start a line, click to add points. Close a loop to make a face. Type a length and press Return. Arrow keys lock an axis."
    private var points: [V3] = []
    private var current: V3?
    private var lock: Axis?

    func activate(_ e: Editor) { reset() }

    private func reset() {
        points = []
        current = nil
        lock = nil
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        let from = points.last
        var o = InferOptions()
        o.from = from
        o.lockAxis = from == nil ? nil : lock
        let inf = e.infer(ev.pt, o)
        showInference(e, inf)
        current = inf.point
        e.overlay = []
        if let from {
            e.addLines([from, inf.point], color: lineColor(from, inf.point), width: 2.4)
            e.setVCB(e.fmt(from.distance(to: inf.point)))
        }
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        var o = InferOptions()
        o.from = points.last
        o.lockAxis = points.isEmpty ? nil : lock
        add(e.infer(ev.pt, o).point, e)
    }

    private func add(_ p: V3, _ e: Editor) {
        guard let from = points.last else {
            points.append(p)
            return
        }
        if from.distance(to: p) < 1e-4 { return }
        let before = e.context.mesh.faces.count
        e.perform("Line") {
            let mesh = e.context.mesh
            let a = mesh.vertexAt(e.toLocal(from))
            let b = mesh.vertexAt(e.toLocal(p))
            mesh.addLine(a, b)
        }
        lock = nil
        if e.context.mesh.faces.count > before {
            reset()
            e.clearOverlay()
            e.setVCB("")
            return
        }
        points.append(p)
    }

    func doubleClick(_ ev: ToolEvent, _ e: Editor) { cancel(e) }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard let a = axisFromKey(key, current: lock) else { return false }
        lock = a
        e.hint = lockHint(a) ?? hint
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard let from = points.last, let len = Units.parse(text, units: e.doc.units), let cur = current else { return false }
        let dir = cur - from
        if dir.lengthSquared < 1e-12 { return false }
        add(from + dir.normalized * len, e)
        return true
    }

    func cancel(_ e: Editor) {
        if points.isEmpty { return e.escapeDefault() }
        reset()
        e.clearOverlay()
        e.setVCB("")
    }
}

final class RectangleTool: Tool {
    let id = ToolID.rect
    let name = "Rectangle"
    let symbol = "rectangle"
    let shortcut: Character? = "R"
    let vcbLabel = "Dimensions"
    let hint = "Click the first corner, then the opposite corner. Draws on the face under the cursor, or the ground. Type “width, depth” and press Return."
    private var p0: V3?
    private var n = V3.zAxis, u = V3.xAxis, v = V3.yAxis
    private var du = 0.0, dv = 0.0
    private var lock: Axis?

    func activate(_ e: Editor) { p0 = nil }

    private func corners(_ du: Double, _ dv: Double) -> [V3] {
        let p = p0!
        return [p, p + u * du, p + u * du + v * dv, p + v * dv]
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard let p0 else { return showInference(e, e.infer(ev.pt)) }
        var o = InferOptions()
        o.from = p0
        o.plane = (n, p0)
        let inf = e.infer(ev.pt, o)
        showInference(e, inf)
        let d = inf.point - p0
        du = d.dot(u)
        dv = d.dot(v)
        preview(e)
    }

    private func preview(_ e: Editor) {
        e.overlay = []
        let c = corners(du, dv)
        let square = abs(abs(du) - abs(dv)) < 1e-6 && abs(du) > 0
        e.addLines(c, color: square ? Palette3D.cyan : Palette3D.ink, width: 2.2, closed: true)
        e.overlayPolygons = [(c, Palette3D.selectionFill)]
        e.setVCB("\(e.fmt(abs(du))), \(e.fmt(abs(dv)))")
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        guard p0 != nil else {
            let inf = e.infer(ev.pt)
            p0 = inf.point
            n = planeFromInference(inf, lock: lock, editor: e)
            (u, v) = planeBasis(n)
            du = 0
            dv = 0
            return
        }
        commit(e)
    }

    private func commit(_ e: Editor) {
        guard p0 != nil, abs(du) > 1e-4, abs(dv) > 1e-4 else { return }
        let pts = corners(du, dv).map { e.toLocal($0) }
        e.perform("Rectangle") { _ = e.context.mesh.addPolygon(pts) }
        p0 = nil
        e.clearOverlay()
        e.setVCB("")
    }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard p0 == nil, let a = axisFromKey(key, current: lock) else { return false }
        lock = a
        e.hint = a.map { "Drawing perpendicular to the \($0.name.lowercased()) axis." } ?? hint
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard let vals = Units.parseList(text, units: e.doc.units), p0 != nil else { return false }
        let w = vals[0], h = vals.count > 1 ? vals[1] : vals[0]
        du = (du == 0 ? 1 : du.sign == .minus ? -1 : 1) * w
        dv = (dv == 0 ? 1 : dv.sign == .minus ? -1 : 1) * h
        commit(e)
        return true
    }

    func cancel(_ e: Editor) {
        if p0 == nil { return e.escapeDefault() }
        p0 = nil
        e.clearOverlay()
    }
}

final class CircleTool: Tool {
    let id = ToolID.circle
    let name = "Circle"
    let symbol = "circle"
    let shortcut: Character? = "C"
    let vcbLabel = "Radius"
    let hint = "Click the centre, then the radius. Type a radius and press Return, or “36s” for the number of sides."
    var segments = 24
    private var c: V3?
    private var n = V3.zAxis, u = V3.xAxis, v = V3.yAxis
    private var r = 0.0, angle = 0.0
    private var lock: Axis?

    private func points() -> [V3] {
        (0..<segments).map { i in
            let t = angle + Double(i) / Double(segments) * 2 * .pi
            return c! + u * (cos(t) * r) + v * (sin(t) * r)
        }
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard let c else {
            showInference(e, e.infer(ev.pt))
            e.setVCB("\(segments) sides", label: "Sides")
            return
        }
        var o = InferOptions()
        o.from = c
        o.plane = (n, c)
        let inf = e.infer(ev.pt, o)
        showInference(e, inf)
        let d = inf.point - c
        r = d.length
        angle = atan2(d.dot(v), d.dot(u))
        e.overlay = []
        if r > 1e-6 {
            let pts = points()
            e.addLines(pts, color: Palette3D.ink, width: 2.2, closed: true)
            e.addLines([c, pts[0]], color: Palette3D.muted, width: 1.4)
            e.setVCB(e.fmt(r), label: "Radius")
        }
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        guard c != nil else {
            let inf = e.infer(ev.pt)
            c = inf.point
            n = planeFromInference(inf, lock: lock, editor: e)
            (u, v) = planeBasis(n)
            r = 0
            return
        }
        commit(e)
    }

    private func commit(_ e: Editor) {
        guard c != nil, r > 1e-4 else { return }
        let pts = points().map { e.toLocal($0) }
        e.perform(name) { _ = e.context.mesh.addPolygon(pts) }
        c = nil
        e.clearOverlay()
        e.setVCB("")
    }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard c == nil, let a = axisFromKey(key, current: lock) else { return false }
        lock = a
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        if let m = text.wholeMatch(of: /(\d+)\s*[sS]/), let s = Int(m.1) {
            segments = max(3, min(360, s))
            e.setVCB("\(segments) sides", label: "Sides")
            return true
        }
        guard let r2 = Units.parse(text, units: e.doc.units), c != nil, r2 > 0 else { return false }
        r = r2
        commit(e)
        return true
    }

    func cancel(_ e: Editor) {
        if c == nil { return e.escapeDefault() }
        c = nil
        e.clearOverlay()
    }
}

final class ArcTool: Tool {
    let id = ToolID.arc
    let name = "Arc"
    let symbol = "point.topleft.down.to.point.bottomright.curvepath"
    let shortcut: Character? = "A"
    let vcbLabel = "Bulge"
    let hint = "Click the start, click the end, then move to set the bulge and click. Type the bulge, or “12s” for segments."
    var segments = 12
    private var a: V3?, b: V3?
    private var n = V3.zAxis
    private var bulge = 0.0
    private var lock: Axis?

    func activate(_ e: Editor) {
        a = nil
        b = nil
    }

    func points(_ a: V3, _ b: V3, _ s: Double) -> [V3] {
        let chord = b - a
        let c = chord.length
        if abs(s) < 1e-6 || c < 1e-6 { return [a, b] }
        let perp = n.cross(chord).normalized
        let mid = (a + b) / 2
        let R = c * c / 4 / (2 * abs(s)) + abs(s) / 2
        let center = mid + perp * ((s < 0 ? -1 : 1) * (abs(s) - R))
        let top = mid + perp * s
        let va = a - center
        let total = 4 * atan(2 * abs(s) / c)
        func rot(_ angle: Double) -> V3 { Mat4.rotation(axis: n, angle: angle).transformDirection(va) + center }
        let sign: Double = rot(total / 2).distance(to: top) < rot(-total / 2).distance(to: top) ? 1 : -1
        var out = (0...segments).map { rot(sign * total * Double($0) / Double(segments)) }
        out[0] = a
        out[out.count - 1] = b
        return out
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        guard let a else { return showInference(e, e.infer(ev.pt)) }
        guard let b else {
            var o = InferOptions()
            o.from = a
            o.lockAxis = lock
            o.plane = (n, a)
            let inf = e.infer(ev.pt, o)
            showInference(e, inf)
            e.overlay = []
            e.addLines([a, inf.point], color: lineColor(a, inf.point))
            e.setVCB(e.fmt(a.distance(to: inf.point)), label: "Length")
            return
        }
        var o = InferOptions()
        o.plane = (n, a)
        let inf = e.infer(ev.pt, o)
        showInference(e, inf)
        let chord = b - a
        let perp = n.cross(chord).normalized
        let mid = (a + b) / 2
        var s = (inf.point - mid).dot(perp)
        let half = chord.length / 2
        let semi = abs(abs(s) - half) < half * 0.04
        if semi { s = (s < 0 ? -1 : 1) * half }
        bulge = s
        e.overlay = []
        e.addLines(points(a, b, s), color: semi ? Palette3D.magenta : Palette3D.ink, width: 2.2)
        e.setVCB(e.fmt(abs(s)), label: "Bulge")
        e.hint = semi ? "Half circle" : hint
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        guard let a else {
            let inf = e.infer(ev.pt)
            self.a = inf.point
            n = planeFromInference(inf, lock: lock, editor: e)
            return
        }
        guard b != nil else {
            var o = InferOptions()
            o.from = a
            o.lockAxis = lock
            o.plane = (n, a)
            let p = e.infer(ev.pt, o).point
            if p.distance(to: a) > 1e-4 {
                b = p
                bulge = 0
            }
            return
        }
        commit(e)
    }

    private func commit(_ e: Editor) {
        guard let a, let b else { return }
        let pts = points(a, b, bulge)
        e.perform("Arc") {
            let mesh = e.context.mesh
            let ids = pts.map { mesh.vertexAt(e.toLocal($0)) }
            for i in 0..<(ids.count - 1) { mesh.addLine(ids[i], ids[i + 1]) }
        }
        self.a = nil
        self.b = nil
        e.clearOverlay()
        e.setVCB("")
    }

    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool {
        guard let a2 = axisFromKey(key, current: lock) else { return false }
        lock = a2
        return true
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        if let m = text.wholeMatch(of: /(\d+)\s*[sS]/), let s = Int(m.1) {
            segments = max(2, min(180, s))
            return true
        }
        guard b != nil, let v = Units.parse(text, units: e.doc.units) else { return false }
        bulge = (bulge < 0 ? -1 : 1) * v
        commit(e)
        return true
    }

    func cancel(_ e: Editor) {
        if a == nil { return e.escapeDefault() }
        a = nil
        b = nil
        e.clearOverlay()
    }
}
