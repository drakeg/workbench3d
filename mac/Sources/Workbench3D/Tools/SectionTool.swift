import AppKit
import simd
import Workbench3DKit

/// Place a section cut on a picked face, then click or type the cut depth.
/// Only the displayed geometry is clipped; model geometry remains unchanged.
final class SectionTool: Tool {
    let id = ToolID.section
    let name = "Section Plane"
    let symbol = "square.split.2x2"
    let shortcut: Character? = nil
    let vcbLabel = "Depth"
    let hint = "Click a face to select its section plane, then move or type a depth and click to place. View → Section Cut toggles it."

    private var point: V3?
    private var normal: V3?
    private var depth = 0.0

    private func reset(_ e: Editor) {
        point = nil
        normal = nil
        depth = 0
        e.clearOverlay()
        e.hint = hint
    }

    func activate(_ e: Editor) { reset(e) }
    func deactivate(_ e: Editor) { reset(e) }

    private func outline(_ e: Editor) {
        guard let point, let normal else { return }
        let p = point - normal * depth
        let (u, v) = planeBasis(normal)
        let radius = max(12.0, min(100.0, e.doc.bounds.size.length * 0.7))
        let corners = [p - u * radius - v * radius,
                       p + u * radius - v * radius,
                       p + u * radius + v * radius,
                       p - u * radius + v * radius]
        e.overlay = []
        e.overlayPolygons = [(corners, Palette3D.magenta.withAlpha(0.12))]
        e.addLines(corners, color: Palette3D.magenta, width: 2, closed: true)
        e.addLines([p, p + normal * min(15, radius / 3)], color: Palette3D.magenta, width: 1.6)
        e.setVCB(e.fmt(depth), label: "Depth")
        e.viewChanged()
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        if let point, let normal {
            // Project cursor ray onto the normal line through the selected face.
            // The closest point gives a depth even when the cursor misses the model.
            let d = ev.ray.direction
            let w = point - ev.ray.origin
            let nDotD = normal.dot(d)
            let denom = 1 - nDotD * nDotD
            if denom > 1e-6 {
                let t = (w.dot(normal) - w.dot(d) * nDotD) / denom
                depth = max(0, -t)
            }
            outline(e)
        } else if let hit = e.raycastFaces(ev.ray) {
            point = hit.point
            normal = hit.normal.normalized
            outline(e)
            point = nil
            normal = nil
        } else {
            e.clearOverlay()
        }
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        if point == nil {
            guard let hit = e.raycastFaces(ev.ray), hit.normal.lengthSquared > 1e-10 else { return }
            point = hit.point
            normal = hit.normal.normalized
            depth = 0
            outline(e)
        } else {
            place(e)
        }
    }

    private func place(_ e: Editor) {
        guard let point, let normal,
              [point.x, point.y, point.z, normal.x, normal.y, normal.z, depth].allSatisfy(\.isFinite) else { return }
        let p = point - normal * depth
        e.perform("Section Plane") {
            for i in e.doc.sections.indices { e.doc.sections[i].active = false }
            e.doc.sections.append(SectionPlane(id: e.doc.nextItemId,
                                               point: [p.x, p.y, p.z],
                                               normal: [normal.x, normal.y, normal.z],
                                               active: true))
            e.doc.nextItemId += 1
        }
        reset(e)
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard point != nil, let length = Units.parse(text, units: e.doc.units),
              length.isFinite, length >= 0 else { return false }
        depth = length
        place(e)
        return true
    }

    func cancel(_ e: Editor) {
        if point == nil { e.escapeDefault() }
        else { reset(e) }
    }
}

private extension SIMD4 where Scalar == Float {
    func withAlpha(_ alpha: Float) -> SIMD4<Float> { SIMD4(x, y, z, alpha) }
}
