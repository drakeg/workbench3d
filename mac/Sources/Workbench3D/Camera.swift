import Foundation
import simd
import Workbench3DKit

/// The view camera: Z up, orbiting a target. Perspective or parallel (orthographic).
/// Math in Double for picking; `viewProjection` gives the Float matrix for Metal.
struct Camera: Equatable {
    var position = V3(-120, -180, 110)
    var target = V3(0, 0, 0)
    var fovDegrees = 35.0
    var perspective = true
    /// Viewport size in points.
    var size = CGSize(width: 800, height: 600)

    var forward: V3 { (target - position).normalized }
    var right: V3 {
        let r = forward.cross(.zAxis)
        return r.lengthSquared < 1e-12 ? .xAxis : r.normalized
    }
    var up: V3 { right.cross(forward).normalized }
    var distance: Double { position.distance(to: target) }
    var aspect: Double { max(size.width, 1) / max(size.height, 1) }
    private var tanHalf: Double { tan(fovDegrees * .pi / 360) }

    // MARK: matrices (Metal clip space: z in 0...1)

    var view: Mat4 {
        let f = forward, r = right, u = up
        var m = Mat4.identity
        m.columns.0 = SIMD4(r.x, u.x, -f.x, 0)
        m.columns.1 = SIMD4(r.y, u.y, -f.y, 0)
        m.columns.2 = SIMD4(r.z, u.z, -f.z, 0)
        m.columns.3 = SIMD4(-r.dot(position), -u.dot(position), f.dot(position), 1)
        return m
    }

    var near: Double { perspective ? max(0.05, distance * 0.002) : -100_000 }
    var far: Double { perspective ? max(10_000, distance * 50) : 100_000 }

    var projection: Mat4 {
        let n = near, fa = far
        if perspective {
            let y = 1 / tanHalf, x = y / aspect
            var m = Mat4(0)
            m.columns.0 = SIMD4(x, 0, 0, 0)
            m.columns.1 = SIMD4(0, y, 0, 0)
            m.columns.2 = SIMD4(0, 0, fa / (n - fa), -1)
            m.columns.3 = SIMD4(0, 0, n * fa / (n - fa), 0)
            return m
        }
        // parallel projection sized to match the perspective view at the target
        let h = distance * tanHalf, w = h * aspect
        var m = Mat4.identity
        m.columns.0 = SIMD4(1 / w, 0, 0, 0)
        m.columns.1 = SIMD4(0, 1 / h, 0, 0)
        m.columns.2 = SIMD4(0, 0, 1 / (n - fa), 0)
        m.columns.3 = SIMD4(0, 0, n / (n - fa), 1)
        return m
    }

    var viewProjection: Mat4 { projection * view }

    var viewProjectionFloat: simd_float4x4 {
        let m = viewProjection
        return simd_float4x4(SIMD4<Float>(m.columns.0), SIMD4<Float>(m.columns.1), SIMD4<Float>(m.columns.2), SIMD4<Float>(m.columns.3))
    }

    // MARK: screen <-> world (points, origin top-left)

    struct Projected {
        var x: Double
        var y: Double
        var behind: Bool
        var point: CGPoint { CGPoint(x: x, y: y) }
    }

    func project(_ p: V3) -> Projected {
        let c = viewProjection * SIMD4(p.x, p.y, p.z, 1)
        let w = abs(c.w) < 1e-12 ? 1e-12 : c.w
        let ndc = V3(c.x / w, c.y / w, c.z / w)
        return Projected(x: (ndc.x + 1) / 2 * size.width, y: (1 - ndc.y) / 2 * size.height,
                         behind: perspective ? c.w <= 0 : false)
    }

    func ray(at pt: CGPoint) -> Ray {
        let nx = pt.x / max(size.width, 1) * 2 - 1
        let ny = 1 - pt.y / max(size.height, 1) * 2
        if perspective {
            let dir = forward + right * (nx * tanHalf * aspect) + up * (ny * tanHalf)
            return Ray(origin: position, direction: dir)
        }
        let h = distance * tanHalf, w = h * aspect
        let origin = position + right * (nx * w) + up * (ny * h) - forward * 50_000
        return Ray(origin: origin, direction: forward)
    }

    /// World size of one screen point at p (for screen-size tolerances and pan).
    func worldPerPoint(at p: V3) -> Double {
        let depth = perspective ? max(0.01, (p - position).dot(forward)) : distance
        return depth * 2 * tanHalf / max(size.height, 1)
    }

    // MARK: navigation

    mutating func orbit(dx: Double, dy: Double, pivot: V3) {
        let yaw = simd_quatd(angle: -dx * 0.006, axis: .zAxis)
        let pitch = simd_quatd(angle: -dy * 0.006, axis: right)
        var q = yaw * pitch
        let newF = q.act(forward)
        if abs(newF.z) > 0.995 { q = yaw }
        position = q.act(position - pivot) + pivot
        target = q.act(target - pivot) + pivot
    }

    mutating func pan(dx: Double, dy: Double, at p: V3) {
        let wpp = worldPerPoint(at: p)
        let delta = right * (-dx * wpp) + up * (dy * wpp)
        position += delta
        target += delta
    }

    /// factor < 1 zooms in, toward `p`.
    mutating func zoom(factor: Double, toward p: V3) {
        var f = factor
        let d = position.distance(to: p)
        if f < 1, d * f < 0.5 { f = 0.5 / max(d, 0.5) }
        if f > 1, distance > 50_000 { return }
        position = p + (position - p) * f
        target = p + (target - p) * f
    }

    mutating func look(from pos: V3, at tgt: V3) {
        position = pos
        target = tgt
    }

    mutating func zoomExtents(_ box: Box3) {
        let b = box.isEmpty ? Box3(min: V3(-60, -60, 0), max: V3(60, 60, 40)) : box
        let center = b.center
        let radius = max(b.size.length / 2, 6)
        let dir = (position - target).normalized
        let fov = fovDegrees * .pi / 180
        let fit = min(fov, 2 * atan(tan(fov / 2) * aspect))
        let dist = radius / sin(fit / 2) * 1.05
        look(from: center + dir * dist, at: center)
    }

    enum StandardView: String, CaseIterable, Identifiable {
        case iso, top, front, right, back, left, bottom
        var id: String { rawValue }
        var title: String {
            switch self {
            case .iso: "Iso"
            case .top: "Top"
            case .front: "Front"
            case .right: "Right"
            case .back: "Back"
            case .left: "Left"
            case .bottom: "Bottom"
            }
        }
        var direction: V3 {
            switch self {
            case .iso: V3(-1, -1.4, 0.95).normalized
            case .top: V3(0, -0.0001, 1).normalized
            case .bottom: V3(0, 0.0001, -1).normalized
            case .front: V3(0, -1, 0)
            case .back: V3(0, 1, 0)
            case .left: V3(-1, 0, 0)
            case .right: V3(1, 0, 0)
            }
        }
    }

    mutating func setView(_ v: StandardView, fit box: Box3) {
        look(from: target + v.direction * 100, at: target)
        zoomExtents(box)
    }
}
