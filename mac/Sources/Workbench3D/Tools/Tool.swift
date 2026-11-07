import AppKit
import simd
import Workbench3DKit

enum ToolID: String, CaseIterable, Identifiable {
    case select, eraser, paint, line, arc, rect, circle, pushpull, offset, move, rotate, tape, orbit, pan, zoom
    var id: String { rawValue }
}

enum NavMode { case orbit, pan, zoom }

/// A pointer event in the 3D view. Points are in view coordinates, origin at the top left.
struct ToolEvent {
    var pt: CGPoint
    var ray: Ray
    var shift = false
    var option = false
    var command = false
    var clickCount = 1
}

/// A key press the view passes to the tool before handling it itself.
struct KeyInput {
    var characters: String
    var keyCode: UInt16
    var shift = false
    var option = false

    enum Special { case left, right, up, down, escape, enter, delete, none }
    var special: Special {
        switch keyCode {
        case 123: .left
        case 124: .right
        case 125: .down
        case 126: .up
        case 53: .escape
        case 36, 76: .enter
        case 51, 117: .delete
        default: .none
        }
    }
}

/// A tool reacts to pointer and keyboard input in the 3D view. Port of src/tools/tool.ts.
protocol Tool: AnyObject {
    var id: ToolID { get }
    var name: String { get }
    /// SF Symbol for the tool palette.
    var symbol: String { get }
    /// Single key, shown in tooltips and Settings > Shortcuts.
    var shortcut: Character? { get }
    var hint: String { get }
    var vcbLabel: String { get }
    /// Left-drag navigates instead of editing (Orbit, Pan, Zoom).
    var navigation: NavMode? { get }

    func activate(_ e: Editor)
    func deactivate(_ e: Editor)
    func mouseDown(_ ev: ToolEvent, _ e: Editor)
    func mouseMoved(_ ev: ToolEvent, _ e: Editor)
    func mouseUp(_ ev: ToolEvent, _ e: Editor)
    func doubleClick(_ ev: ToolEvent, _ e: Editor)
    /// Return true if the key was used.
    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool
    /// Option tapped (copy toggles, scale about centre...).
    func optionTapped(_ e: Editor)
    /// Text typed into the Measurements box. Return true if accepted.
    func vcb(_ text: String, _ e: Editor) -> Bool
    /// Escape.
    func cancel(_ e: Editor)
}

extension Tool {
    var vcbLabel: String { "Measurements" }
    var navigation: NavMode? { nil }
    var shortcut: Character? { nil }
    var shortcutLabel: String? { shortcut.map { $0 == " " ? "Space" : String($0) } }
    func activate(_ e: Editor) {}
    func deactivate(_ e: Editor) {}
    func mouseDown(_ ev: ToolEvent, _ e: Editor) {}
    func mouseMoved(_ ev: ToolEvent, _ e: Editor) {}
    func mouseUp(_ ev: ToolEvent, _ e: Editor) {}
    func doubleClick(_ ev: ToolEvent, _ e: Editor) {}
    func keyDown(_ key: KeyInput, _ e: Editor) -> Bool { false }
    func optionTapped(_ e: Editor) {}
    func vcb(_ text: String, _ e: Editor) -> Bool { false }
    func cancel(_ e: Editor) { e.escapeDefault() }
}

func allTools() -> [Tool] {
    [SelectTool(), EraserTool(), PaintTool(), LineTool(), ArcTool(), RectangleTool(), CircleTool(), PushPullTool(), OffsetTool(),
     MoveTool(), RotateTool(), TapeTool(), NavTool(.orbit), NavTool(.pan), NavTool(.zoom)]
}

/// Toolbar groups, in order.
let toolGroups: [[ToolID]] = [[.select, .eraser, .paint], [.line, .arc, .rect, .circle], [.pushpull, .offset, .move, .rotate], [.tape], [.orbit, .pan, .zoom]]

/// Arrow keys lock an axis: right = red, left = green, up = blue, down = unlock.
/// Returns nil when the key isn't an arrow; .some(nil) unlocks.
func axisFromKey(_ k: KeyInput, current: Axis?) -> Axis?? {
    let a: Axis
    switch k.special {
    case .right: a = .x
    case .left: a = .y
    case .up: a = .z
    case .down: return .some(nil)
    default: return nil
    }
    return .some(current == a ? nil : a)
}

/// Drawing plane from what's under the cursor: the face, or the ground.
func planeFromInference(_ inf: Inference, lock: Axis?, editor: Editor) -> V3 {
    if let lock { return lock.vector }
    if inf.kind == .onFace, let n = inf.normal { return n.normalized }
    if let gid = inf.group, let vid = inf.vertex, let g = editor.doc.findGroup(gid) {
        let faces = g.mesh.facesUsingVertex(vid)
        if faces.count == 1 { return (g.worldMatrix.normalMatrix * g.mesh.normal(faces[0])).normalized }
    }
    return .zAxis
}

/// Rubber-band color: the axis color when aligned, otherwise ink.
func lineColor(_ a: V3, _ b: V3) -> SIMD4<Float> {
    alignedAxis(b - a).map(Palette3D.axisRGBA) ?? Palette3D.ink
}

/// Pick what's under the cursor in the current context. Clicking outside the context steps out of it.
enum Picked: Equatable {
    case face(Int)
    case edge(EdgeKey)
    case group(Int)

    var isGroup: Bool { if case .group = self { true } else { false } }
}

func pickEntity(_ e: Editor, _ pt: CGPoint, allowExit: Bool = true) -> Picked? {
    let edge = e.pickEdge(pt)
    let hit = e.raycastFaces(e.camera.ray(at: pt))
    if let edge, hit.flatMap({ e.entity(for: $0.group) }).map({ if case .group = $0 { false } else { true } }) ?? true {
        return .edge(edge)
    }
    guard let hit else { return nil }
    var ent = e.entity(for: hit.group)
    while ent == nil, allowExit, e.context.parent != nil {
        e.exitGroup()
        ent = e.entity(for: hit.group)
    }
    switch ent {
    case .raw: return .face(hit.face)
    case .group(let id): return .group(id)
    case nil: return nil
    }
}

func selection(of p: Picked) -> Selection {
    switch p {
    case .face(let f): Selection(faces: [f])
    case .edge(let k): Selection(edges: [k])
    case .group(let g): Selection(groups: [g])
    }
}
