import SwiftUI
import Workbench3DKit

enum Axis: String {
    case x, y, z
    var vector: V3 {
        switch self {
        case .x: .xAxis
        case .y: .yAxis
        case .z: .zAxis
        }
    }
    var name: String {
        switch self {
        case .x: "Red"
        case .y: "Green"
        case .z: "Blue"
        }
    }
}

/// What the cursor snapped to. Port of src/app/inference.ts.
struct Inference {
    enum Kind: String {
        case endpoint, midpoint, onEdge, onFace, axis, parallel, perpendicular, fromPoint, ground, plane, free
    }
    var point: V3
    var kind: Kind
    var label: String
    var group: Int?
    var face: Int?
    var vertex: Int?
    var edge: (key: EdgeKey, a: V3, b: V3)?
    var normal: V3?
    var axis: Axis?
    var dir: V3?
    var guide: (V3, V3)?

    /// Marker color, matching the web app.
    var color: Color {
        switch kind {
        case .endpoint: Color(red: 0.09, green: 0.64, blue: 0.29)
        case .midpoint: Color(red: 0.03, green: 0.57, blue: 0.70)
        case .onEdge: Color(red: 0.86, green: 0.15, blue: 0.15)
        case .onFace: Color(red: 0.15, green: 0.39, blue: 0.92)
        case .axis, .fromPoint: axis.map(Palette3D.axisColor) ?? Color(red: 0.75, green: 0.15, blue: 0.83)
        case .parallel, .perpendicular: Color(red: 0.75, green: 0.15, blue: 0.83)
        default: .gray
        }
    }
}

struct InferOptions {
    var from: V3?
    var lockAxis: Axis?
    var lockDir: V3?
    var plane: (normal: V3, point: V3)?
    var excludeGroups: Set<Int> = []
    /// "\(group):\(vertex)"
    var excludeVerts: Set<String> = []
    var noFaces = false
    var guides: [(V3, V3?)] = []
}

/// What the cursor touched recently: drives parallel and "from point" inference.
struct InferenceHints {
    var edge: (V3, V3)?
    var point: V3?
}

enum Inferencer {
    static let snapPoints = 11.0
    static let edgePoints = 7.0
    static let axisPoints = 10.0

    static func infer(_ pt: CGPoint, editor ed: Editor, _ o: InferOptions) -> Inference {
        let cam = ed.camera
        let ray = cam.ray(at: pt)
        let data = ed.pickData
        let hit = o.noFaces ? nil : ed.raycastFaces(ray) { !o.excludeGroups.contains($0) }
        let maxDepth = hit.map { $0.distance + cam.worldPerPoint(at: $0.point) * 4 } ?? .infinity

        var bestV: (d: Double, p: V3, g: Int, id: Int)?
        for v in data.verts where !o.excludeGroups.contains(v.group) && !o.excludeVerts.contains("\(v.group):\(v.id)") {
            let s = cam.project(v.p)
            if s.behind { continue }
            let d = hypot(s.x - pt.x, s.y - pt.y)
            if d < snapPoints, d < (bestV?.d ?? .infinity), v.p.distance(to: ray.origin) <= maxDepth { bestV = (d, v.p, v.group, v.id) }
        }
        var bestMid: (d: Double, p: V3, g: Int, e: PickCache.Edge)?
        var bestEdge: (d: Double, p: V3, g: Int, e: PickCache.Edge)?
        for e in data.edges where !o.excludeGroups.contains(e.group) {
            if o.excludeVerts.contains("\(e.group):\(e.key.a)") || o.excludeVerts.contains("\(e.group):\(e.key.b)") { continue }
            let sa = cam.project(e.a), sb = cam.project(e.b)
            if sa.behind || sb.behind { continue }
            let (d, _) = screenDistance(pt, sa, sb)
            if d > edgePoints { continue }
            let mid = (e.a + e.b) / 2
            let ms = cam.project(mid)
            let md = hypot(ms.x - pt.x, ms.y - pt.y)
            if md < snapPoints, md < (bestMid?.d ?? .infinity), mid.distance(to: ray.origin) <= maxDepth { bestMid = (md, mid, e.group, e) }
            let dir = e.b - e.a
            let s = max(0, min(1, closestParamOnLine(e.a, dir, ray.origin, ray.direction)))
            let p = e.a + dir * s
            if d < (bestEdge?.d ?? .infinity), p.distance(to: ray.origin) <= maxDepth { bestEdge = (d, p, e.group, e) }
        }

        // guides: points act like endpoints, lines like infinite edges
        var bestGuide: (d: Double, p: V3)?
        for (gp, gd) in o.guides {
            if let gd {
                let t = closestParamOnLine(gp, gd, ray.origin, ray.direction)
                let p = gp + gd * t
                let s = cam.project(p)
                let d = hypot(s.x - pt.x, s.y - pt.y)
                if !s.behind, d < edgePoints, d < (bestGuide?.d ?? .infinity) { bestGuide = (d, p) }
            } else {
                let s = cam.project(gp)
                let d = hypot(s.x - pt.x, s.y - pt.y)
                if !s.behind, d < snapPoints, d < (bestV?.d ?? .infinity) { bestV = (d, gp, -1, -1) }
            }
        }

        if let v = bestV, v.id != -1 { ed.hints.point = v.p }
        if let e = bestMid?.e ?? bestEdge?.e, e.a.distance(to: e.b) > 1e-6 { ed.hints.edge = (e.a, e.b) }

        func onPlane(_ r: Inference) -> Inference {
            guard let pl = o.plane else { return r }
            var r = r
            r.point = r.point - pl.normal * (r.point - pl.point).dot(pl.normal)
            return r
        }

        // locked direction (arrow keys or Shift)
        let lockDir = o.lockDir ?? o.lockAxis?.vector
        if let from = o.from, let lock = lockDir {
            let dir = lock.normalized
            let p: V3
            if let v = bestV { p = from + dir * (v.p - from).dot(dir) }
            else { p = from + dir * closestParamOnLine(from, dir, ray.origin, ray.direction) }
            let ax = alignedAxis(dir)
            return Inference(point: p, kind: .axis, label: (ax.map { "On \($0.name) Axis" } ?? "Along Direction") + " (locked)", axis: ax, dir: dir)
        }

        if let v = bestV {
            return onPlane(Inference(point: v.p, kind: .endpoint, label: v.id == -1 ? "Guide Point" : "Endpoint", group: v.g, vertex: v.id == -1 ? nil : v.id))
        }
        if let m = bestMid {
            return onPlane(Inference(point: m.p, kind: .midpoint, label: "Midpoint", group: m.g, edge: (m.e.key, m.e.a, m.e.b)))
        }

        if let from = o.from {
            struct Cand {
                var dir: V3
                var axis: Axis?
                var label: String
                var kind: Inference.Kind
            }
            var cands: [Cand] = [Axis.x, .y, .z].map { Cand(dir: $0.vector, axis: $0, label: "On \($0.name) Axis", kind: .axis) }
            if let (a, b) = ed.hints.edge {
                let ed2 = (b - a).normalized
                if alignedAxis(ed2) == nil {
                    cands.append(Cand(dir: ed2, label: "Parallel to Edge", kind: .parallel))
                    let up = abs(ed2.z) > 0.999 ? V3.xAxis : V3.zAxis
                    let perp = ed2.cross(up).normalized
                    if perp.lengthSquared > 0.5 { cands.append(Cand(dir: perp, label: "Perpendicular to Edge", kind: .perpendicular)) }
                }
            }
            var best: (d: Double, p: V3, c: Cand)?
            for c in cands {
                if let pl = o.plane, abs(pl.normal.dot(c.dir)) > 0.01 { continue }
                let t = closestParamOnLine(from, c.dir, ray.origin, ray.direction)
                let p = from + c.dir * t
                let s = cam.project(p)
                if s.behind { continue }
                let d = hypot(s.x - pt.x, s.y - pt.y)
                if d < axisPoints, d < (best?.d ?? .infinity), abs(t) > 1e-6 { best = (d, p, c) }
            }
            if let b = best {
                // "from point": slide along the axis until level with a point touched earlier
                if let hp = ed.hints.point, let ax = b.c.axis {
                    let q = from + b.c.dir * (hp - from).dot(b.c.dir)
                    let s = cam.project(q)
                    if !s.behind, hypot(s.x - pt.x, s.y - pt.y) < snapPoints, q.distance(to: hp) > 1e-4, q.distance(to: from) > 1e-4 {
                        return Inference(point: q, kind: .fromPoint, label: "From Point", axis: ax, dir: b.c.dir, guide: (hp, q))
                    }
                }
                return Inference(point: b.p, kind: b.c.kind, label: b.c.label, axis: b.c.axis, dir: b.c.dir)
            }
        }

        if let e = bestEdge {
            return onPlane(Inference(point: e.p, kind: .onEdge, label: "On Edge", group: e.g, edge: (e.e.key, e.e.a, e.e.b)))
        }
        if let g = bestGuide { return onPlane(Inference(point: g.p, kind: .onEdge, label: "On Guide")) }
        if let pl = o.plane, let p = ray.intersectPlane(normal: pl.normal, point: pl.point) {
            return Inference(point: p, kind: .plane, label: "", normal: pl.normal)
        }
        if let h = hit { return Inference(point: h.point, kind: .onFace, label: "On Face", group: h.group, face: h.face, normal: h.normal) }
        let gz = o.from?.z ?? 0
        if let gp = ray.intersectPlane(normal: .zAxis, point: V3(0, 0, gz)), gp.distance(to: ray.origin) < 1e5 {
            return Inference(point: gp, kind: .ground, label: "", normal: .zAxis)
        }
        return Inference(point: ray.at(100), kind: .free, label: "")
    }
}

func alignedAxis(_ d: V3) -> Axis? {
    let n = d.normalized
    if abs(n.x) > 0.9999 { return .x }
    if abs(n.y) > 0.9999 { return .y }
    if abs(n.z) > 0.9999 { return .z }
    return nil
}
