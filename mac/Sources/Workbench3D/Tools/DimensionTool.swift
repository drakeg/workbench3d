import AppKit
import simd
import Workbench3DKit

/// Persistent linear dimension, shared with the web editor's .wb3d format.
/// Click two endpoints and a third offset location. Length is the real 3D distance,
/// not the length projected onto the screen. The geometry is an annotation only.
final class DimensionTool: Tool {
    let id = ToolID.dimension
    let name = "Dimension"
    let symbol = "ruler"
    let shortcut: Character? = "D"
    let vcbLabel = "Offset"
    let hint = "Click the first point, the second point, and then the dimension-line offset. Type an offset to finish."

    private var a: V3?
    private var b: V3?
    private var offset = V3.zero
    private var inferredPoint: V3?
    
    func activate(_ e: Editor) { reset(e) }

    private func reset(_ e: Editor) {
        a = nil
        b = nil
        offset = .zero
        inferredPoint = nil
        e.clearOverlay()
        e.hint = hint
    }

    /// The annotation line must be normal to the measured segment, while the
    /// endpoints retain their full 3D positions. This preserves correct lengths.
    private func perpendicularOffset(_ point: V3, a: V3, b: V3) -> V3 {
        let direction = (b - a).normalized
        let fromMidpoint = point - (a + b) / 2
        return fromMidpoint - direction * fromMidpoint.dot(direction)
    }

    private func preview(_ e: Editor) {
        e.overlay = []
        guard let a else { return }
        if let b {
            let start = a + offset, end = b + offset
            e.addLines([a, start], color: Palette3D.muted, width: 1.2)
            e.addLines([b, end], color: Palette3D.muted, width: 1.2)
            e.addLines([start, end], color: Palette3D.selection, width: 2)
            e.setVCB(e.fmt(offset.length), label: "Offset")
            e.hint = "Length: \(e.fmt(a.distance(to: b))). Click to place, or enter an offset."
        } else if let point = inferredPoint {
            e.addLines([a, point], color: Palette3D.selection, width: 1.8)
            e.setVCB(e.fmt(a.distance(to: point)), label: "Length")
        }
        e.viewChanged()
    }

    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {
        let inf = e.infer(ev.pt)
        inferredPoint = inf.point
        e.inference = inf.kind == .free ? nil : inf
        if let a, let b { offset = perpendicularOffset(inf.point, a: a, b: b) }
        preview(e)
    }

    func mouseDown(_ ev: ToolEvent, _ e: Editor) {
        let p = e.infer(ev.pt).point
        if a == nil {
            a = p
            inferredPoint = p
        } else if b == nil {
            guard p.distance(to: a!) > 1e-5 else { return }
            b = p
            offset = .zero
        } else {
            offset = perpendicularOffset(p, a: a!, b: b!)
            commit(e)
            return
        }
        preview(e)
    }

    private func commit(_ e: Editor) {
        guard let a, let b, a.distance(to: b) > 1e-5 else { return }
        let vector = offset
        guard [a.x, a.y, a.z, b.x, b.y, b.z, vector.x, vector.y, vector.z].allSatisfy(\.isFinite) else { return }
        e.perform("Dimension") {
            e.doc.dimensions.append(Dimension(
                id: e.doc.nextItemId,
                a: [a.x, a.y, a.z],
                b: [b.x, b.y, b.z],
                offset: [vector.x, vector.y, vector.z]))
            e.doc.nextItemId += 1
        }
        reset(e)
    }

    func vcb(_ text: String, _ e: Editor) -> Bool {
        guard let a, let b, let length = Units.parse(text, units: e.doc.units),
              length.isFinite, length >= 0 else { return false }
        // Use the pointer's perpendicular offset direction when present; otherwise
        // select a stable direction normal to the measured line.
        let d = (b - a).normalized
        var direction = offset
        if direction.lengthSquared < 1e-10 {
            direction = d.cross(.zAxis)
            if direction.lengthSquared < 1e-10 { direction = d.cross(.xAxis) }
        }
        guard direction.lengthSquared > 1e-10 else { return false }
        offset = direction.normalized * length
        commit(e)
        return true
    }

    func cancel(_ e: Editor) {
        if a == nil { return e.escapeDefault() }
        reset(e)
    }

    func deactivate(_ e: Editor) { reset(e) }
}
