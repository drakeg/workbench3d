import simd
import Workbench3DKit

/// A view-only section cut. The retained half-space has nonnegative signed distance.
/// Values remain in world-space inches, matching the existing .wb3d section records.
struct SectionClip {
    let point: V3
    let normal: V3
    private static let tolerance = 1e-8

    init?(point: [Double], normal: [Double]) {
        guard point.count == 3, normal.count == 3,
              (point + normal).allSatisfy(\.isFinite) else { return nil }
        let n = V3(normal[0], normal[1], normal[2])
        guard n.lengthSquared > 1e-12 else { return nil }
        self.point = V3(point[0], point[1], point[2])
        self.normal = n.normalized
    }

    static func active(in doc: WBDocument) -> SectionClip? {
        guard let plane = doc.sections.last(where: \.active) else { return nil }
        return SectionClip(point: plane.point, normal: plane.normal)
    }

    func signedDistance(_ p: V3) -> Double { (p - point).dot(normal) }
    func contains(_ p: V3) -> Bool { signedDistance(p) >= -Self.tolerance }

    func segment(_ a: V3, _ b: V3) -> (V3, V3)? {
        let da = signedDistance(a), db = signedDistance(b)
        if da < -Self.tolerance && db < -Self.tolerance { return nil }
        if da >= -Self.tolerance && db >= -Self.tolerance { return (a, b) }
        let t = min(1, max(0, da / (da - db)))
        let intersection = a + (b - a) * t
        return da >= -Self.tolerance ? (a, intersection) : (intersection, b)
    }

    /// Sutherland–Hodgman clipping in 3D, preserving the vertex winding.
    func polygon(_ points: [V3]) -> [V3] {
        guard !points.isEmpty else { return [] }
        var clipped: [V3] = []
        for i in points.indices {
            let a = points[i], b = points[(i + 1) % points.count]
            let da = signedDistance(a), db = signedDistance(b)
            let insideA = da >= -Self.tolerance, insideB = db >= -Self.tolerance
            if insideA && insideB { clipped.append(b) }
            else if insideA != insideB {
                let t = min(1, max(0, da / (da - db)))
                clipped.append(a + (b - a) * t)
                if insideB { clipped.append(b) }
            }
        }
        return clipped
    }
}
