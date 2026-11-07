import Foundation
import simd

/// A point or direction in model space. One unit is one inch; Z is up (blue), X red, Y green.
public typealias V3 = SIMD3<Double>
public typealias V2 = SIMD2<Double>
/// Column-major 4x4 matrix, the same layout the web app stores in .wb3d files.
public typealias Mat4 = simd_double4x4

/// Distance tolerance in inches used for welding and coplanarity.
public let TOL: Double = 1e-3

public extension V3 {
    static let xAxis = V3(1, 0, 0)
    static let yAxis = V3(0, 1, 0)
    static let zAxis = V3(0, 0, 1)

    var length: Double { simd_length(self) }
    var lengthSquared: Double { simd_length_squared(self) }
    var normalized: V3 {
        let l = length
        return l < 1e-12 ? self : self / l
    }
    func dot(_ o: V3) -> Double { simd_dot(self, o) }
    func cross(_ o: V3) -> V3 { simd_cross(self, o) }
    func distance(to o: V3) -> Double { simd_distance(self, o) }
}

public extension Mat4 {
    static let identity = matrix_identity_double4x4

    static func translation(_ t: V3) -> Mat4 {
        var m = matrix_identity_double4x4
        m.columns.3 = SIMD4(t.x, t.y, t.z, 1)
        return m
    }

    static func scale(_ s: V3) -> Mat4 {
        Mat4(diagonal: SIMD4(s.x, s.y, s.z, 1))
    }

    /// Rotation by `angle` radians about a unit axis (right-handed).
    static func rotation(axis: V3, angle: Double) -> Mat4 {
        let q = simd_quatd(angle: angle, axis: axis.normalized)
        return Mat4(q)
    }

    /// From the 16 numbers stored in .wb3d (column-major, like three.js `Matrix4.toArray`).
    init(array a: [Double]) {
        precondition(a.count == 16)
        self.init(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                            SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
    }

    var array: [Double] {
        let c = columns
        return [c.0.x, c.0.y, c.0.z, c.0.w, c.1.x, c.1.y, c.1.z, c.1.w,
                c.2.x, c.2.y, c.2.z, c.2.w, c.3.x, c.3.y, c.3.z, c.3.w]
    }

    func transformPoint(_ p: V3) -> V3 {
        let r = self * SIMD4(p.x, p.y, p.z, 1)
        return V3(r.x, r.y, r.z) / (abs(r.w) < 1e-15 ? 1 : r.w)
    }

    /// Directions ignore translation.
    func transformDirection(_ d: V3) -> V3 {
        let r = self * SIMD4(d.x, d.y, d.z, 0)
        return V3(r.x, r.y, r.z)
    }

    /// For normals under non-uniform scale.
    var normalMatrix: simd_double3x3 {
        let m = simd_double3x3(V3(columns.0.x, columns.0.y, columns.0.z),
                               V3(columns.1.x, columns.1.y, columns.1.z),
                               V3(columns.2.x, columns.2.y, columns.2.z))
        return m.inverse.transpose
    }

    var translationPart: V3 { V3(columns.3.x, columns.3.y, columns.3.z) }

    /// Scale along each local axis (column lengths), sign from the determinant.
    var scalePart: V3 {
        let sx = V3(columns.0.x, columns.0.y, columns.0.z).length
        let sy = V3(columns.1.x, columns.1.y, columns.1.z).length
        let sz = V3(columns.2.x, columns.2.y, columns.2.z).length
        return V3(determinant < 0 ? -sx : sx, sy, sz)
    }

    /// The rotation part with scale removed (a rigid transform without translation).
    var rotationPart: Mat4 {
        let s = scalePart
        var m = Mat4.identity
        m.columns.0 = SIMD4(columns.0.x / s.x, columns.0.y / s.x, columns.0.z / s.x, 0)
        m.columns.1 = SIMD4(columns.1.x / s.y, columns.1.y / s.y, columns.1.z / s.y, 0)
        m.columns.2 = SIMD4(columns.2.x / s.z, columns.2.y / s.z, columns.2.z / s.z, 0)
        return m
    }

    func isClose(to o: Mat4, tol: Double = 1e-6) -> Bool {
        zip(array, o.array).allSatisfy { abs($0 - $1) < tol }
    }
}

// MARK: - Plane geometry

/// Newell's method: robust normal for a (possibly non-convex) planar polygon. Not normalized.
public func newellNormal(_ pts: [V3]) -> V3 {
    var n = V3.zero
    for i in pts.indices {
        let a = pts[i]
        let b = pts[(i + 1) % pts.count]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    }
    return n
}

public func polygonNormal(_ pts: [V3]) -> V3 {
    let n = newellNormal(pts)
    let l = n.length
    return l < 1e-12 ? .zAxis : n / l
}

public func polygonArea(_ pts: [V3]) -> Double { newellNormal(pts).length / 2 }

/// An orthonormal in-plane basis (u, v) for normal n, aligned with world axes where possible.
/// Vertical planes keep v pointing up. Matches the web app so faces triangulate the same way.
public func planeBasis(_ n: V3) -> (u: V3, v: V3) {
    let nn = n.normalized
    if abs(nn.z) < 0.9 {
        let v = (V3.zAxis - nn * nn.z).normalized
        let u = v.cross(nn).normalized
        return (u, v)
    }
    let ref = abs(nn.x) < 0.9 ? V3.xAxis : V3.yAxis
    let u = (ref - nn * ref.dot(nn)).normalized
    let v = nn.cross(u).normalized
    return (u, v)
}

public func to2D(_ pts: [V3], origin: V3, u: V3, v: V3) -> [V2] {
    pts.map { p in
        let d = p - origin
        return V2(d.dot(u), d.dot(v))
    }
}

public func pointInPolygon(_ p: V2, _ poly: [V2]) -> Bool {
    var inside = false
    var j = poly.count - 1
    for i in poly.indices {
        let a = poly[i], b = poly[j]
        if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x { inside.toggle() }
        j = i
    }
    return inside
}

public func distancePointSegment(_ p: V2, _ a: V2, _ b: V2) -> Double {
    let ab = b - a
    let t = max(0, min(1, simd_dot(p - a, ab) / max(simd_length_squared(ab), 1e-18)))
    return simd_distance(a + ab * t, p)
}

public func closestPointOnSegment(_ p: V3, _ a: V3, _ b: V3) -> (point: V3, t: Double) {
    let ab = b - a
    let t = max(0, min(1, (p - a).dot(ab) / max(ab.lengthSquared, 1e-18)))
    return (a + ab * t, t)
}

/// Parameter t on the line p + t·d closest to the line q + s·e.
public func closestParamOnLine(_ p: V3, _ d: V3, _ q: V3, _ e: V3) -> Double {
    let r = p - q
    let a = d.dot(d), b = d.dot(e), c = e.dot(e)
    let dd = d.dot(r), f = e.dot(r)
    let den = a * c - b * b
    if abs(den) < 1e-12 { return 0 }
    return (b * f - c * dd) / den
}

/// A ray from the eye into the scene.
public struct Ray: Sendable {
    public var origin: V3
    public var direction: V3
    public init(origin: V3, direction: V3) {
        self.origin = origin
        self.direction = direction.normalized
    }
    public func at(_ t: Double) -> V3 { origin + direction * t }

    public func intersectPlane(normal: V3, point: V3) -> V3? {
        let den = normal.dot(direction)
        if abs(den) < 1e-12 { return nil }
        let t = normal.dot(point - origin) / den
        return t < 0 ? nil : at(t)
    }

    /// Möller–Trumbore. Returns the distance along the ray, both faces count.
    public func intersectTriangle(_ a: V3, _ b: V3, _ c: V3) -> Double? {
        let e1 = b - a, e2 = c - a
        let p = direction.cross(e2)
        let det = e1.dot(p)
        if abs(det) < 1e-14 { return nil }
        let inv = 1 / det
        let s = origin - a
        let u = s.dot(p) * inv
        if u < 0 || u > 1 { return nil }
        let q = s.cross(e1)
        let v = direction.dot(q) * inv
        if v < 0 || u + v > 1 { return nil }
        let t = e2.dot(q) * inv
        return t > 1e-9 ? t : nil
    }
}

/// An axis-aligned box.
public struct Box3: Sendable, Equatable {
    public var min = V3(repeating: .infinity)
    public var max = V3(repeating: -.infinity)
    public init() {}
    public init(min: V3, max: V3) {
        self.min = min
        self.max = max
    }
    public var isEmpty: Bool { max.x < min.x || max.y < min.y || max.z < min.z }
    public var size: V3 { isEmpty ? .zero : max - min }
    public var center: V3 { (min + max) / 2 }
    public mutating func expand(_ p: V3) {
        min = simd_min(min, p)
        max = simd_max(max, p)
    }
    public mutating func union(_ o: Box3) {
        if o.isEmpty { return }
        expand(o.min)
        expand(o.max)
    }
}
