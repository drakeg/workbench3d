import AppKit
import MetalKit
import SwiftUI
import simd
import Workbench3DKit

/// The 3D view: an MTKView that draws on demand and turns mouse, trackpad and keyboard input into
/// tool events and camera moves.
///
/// - Left button: the active tool (or navigation for Orbit, Pan, Zoom).
/// - Right-drag pans (or orbits, in Settings). A right click without a drag opens the context menu.
/// - Middle-drag orbits; Shift + middle-drag pans.
/// - Trackpad: two-finger scroll pans (Settings can make it orbit or zoom); Option + scroll orbits;
///   pinch zooms; smart zoom (two-finger double tap) zooms to fit.
/// - Mouse wheel zooms toward the cursor.
/// - Typing goes to the Measurements box; Return enters it. Single letters pick tools.
final class ViewportNSView: MTKView {
    var editor: Editor? {
        didSet {
            renderer?.editor = editor
            editor?.requestRedraw = { [weak self] in self?.needsDisplay = true }
        }
    }
    private var renderer: Renderer?
    private var tracking: NSTrackingArea?

    private enum Drag { case tool, orbit, pan, zoom, rightPending }
    private var drag: Drag?
    private var last = CGPoint.zero
    private var downPoint = CGPoint.zero
    private var pivot = V3.zero
    private var optionDownAlone = false

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    init() {
        let dev = MTLCreateSystemDefaultDevice()
        super.init(frame: .zero, device: dev)
        colorPixelFormat = .bgra8Unorm
        depthStencilPixelFormat = .depth32Float
        sampleCount = Renderer.sampleCount
        isPaused = true
        enableSetNeedsDisplay = true
        if let dev, let r = Renderer(device: dev) {
            renderer = r
            delegate = r
        }
        setAccessibilityRole(.group)
        setAccessibilityLabel("3D model view")
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError() }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(t)
        tracking = t
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        editor?.camera.size = newSize
        needsDisplay = true
    }

    // MARK: helpers

    private func point(_ ev: NSEvent) -> CGPoint { convert(ev.locationInWindow, from: nil) }

    private func toolEvent(_ ev: NSEvent, _ e: Editor) -> ToolEvent {
        let p = point(ev)
        let f = ev.modifierFlags
        return ToolEvent(pt: p, ray: e.camera.ray(at: p), shift: f.contains(.shift), option: f.contains(.option),
                         command: f.contains(.command), clickCount: ev.type == .mouseMoved ? 1 : ev.clickCount)
    }

    /// The point under the cursor (on the model, else on the ground), for orbit pivots and zoom.
    private func anchor(_ p: CGPoint, _ e: Editor) -> V3 {
        let ray = e.camera.ray(at: p)
        if let hit = e.raycastFaces(ray) { return hit.point }
        if let g = ray.intersectPlane(normal: .zAxis, point: .zero), g.distance(to: ray.origin) < e.camera.distance * 20 { return g }
        return e.camera.target
    }

    private func navigate(_ mode: Drag, dx: Double, dy: Double, _ e: Editor) {
        switch mode {
        case .orbit: e.camera.orbit(dx: dx, dy: dy, pivot: pivot)
        case .pan: e.camera.pan(dx: dx, dy: dy, at: pivot)
        case .zoom: e.camera.zoom(factor: pow(1.006, dy), toward: pivot)
        default: return
        }
        e.viewChanged()
    }

    // MARK: left button

    override func mouseDown(with ev: NSEvent) {
        window?.makeFirstResponder(self)
        optionDownAlone = false
        guard let e = editor else { return }
        let p = point(ev)
        last = p
        downPoint = p
        if let nav = e.tool.navigation {
            pivot = anchor(p, e)
            drag = nav == .orbit ? .orbit : nav == .pan ? .pan : .zoom
            return
        }
        if ev.modifierFlags.contains(.option), e.tool.id == .select {
            pivot = anchor(p, e)
            drag = .orbit
            return
        }
        drag = .tool
        let te = toolEvent(ev, e)
        e.tool.mouseDown(te, e)
        if ev.clickCount == 2 { e.tool.doubleClick(te, e) }
    }

    override func mouseDragged(with ev: NSEvent) {
        guard let e = editor else { return }
        let p = point(ev)
        defer { last = p }
        switch drag {
        case .tool: e.tool.mouseMoved(toolEvent(ev, e), e)
        case .orbit, .pan, .zoom: navigate(drag!, dx: p.x - last.x, dy: p.y - last.y, e)
        default: break
        }
    }

    override func mouseUp(with ev: NSEvent) {
        guard let e = editor else { return }
        if drag == .tool { e.tool.mouseUp(toolEvent(ev, e), e) }
        drag = nil
    }

    override func mouseMoved(with ev: NSEvent) {
        guard let e = editor, drag == nil else { return }
        e.tool.mouseMoved(toolEvent(ev, e), e)
    }

    override func mouseExited(with event: NSEvent) {
        guard let e = editor else { return }
        e.inference = nil
        e.hoverFace = nil
        e.hoverGroup = nil
        e.viewChanged()
    }

    // MARK: right and middle buttons

    override func rightMouseDown(with ev: NSEvent) {
        guard let e = editor else { return }
        let p = point(ev)
        last = p
        downPoint = p
        pivot = anchor(p, e)
        drag = .rightPending
    }

    override func rightMouseDragged(with ev: NSEvent) {
        guard let e = editor else { return }
        let p = point(ev)
        if drag == .rightPending, hypot(p.x - downPoint.x, p.y - downPoint.y) > 3 {
            drag = AppSettings.rightDragOrbits ? .orbit : .pan
        }
        if let d = drag, d != .rightPending { navigate(d, dx: p.x - last.x, dy: p.y - last.y, e) }
        last = p
    }

    override func rightMouseUp(with ev: NSEvent) {
        defer { drag = nil }
        guard drag == .rightPending, let e = editor else { return }
        // A click without a drag: select what's under the cursor (unless already selected) and show the menu.
        if let picked = pickEntity(e, point(ev), allowExit: false) {
            let s = selection(of: picked)
            if !(s.faces.isSubset(of: e.selection.faces) && s.edges.isSubset(of: e.selection.edges) && s.groups.isSubset(of: e.selection.groups)) {
                e.select(s)
            }
        }
        NSMenu.popUpContextMenu(contextMenu(e), with: ev, for: self)
    }

    override func otherMouseDown(with ev: NSEvent) {
        guard let e = editor else { return }
        let p = point(ev)
        last = p
        pivot = anchor(p, e)
        drag = ev.modifierFlags.contains(.shift) ? .pan : .orbit
    }

    override func otherMouseDragged(with ev: NSEvent) {
        guard let e = editor, let d = drag else { return }
        let p = point(ev)
        navigate(d, dx: p.x - last.x, dy: p.y - last.y, e)
        last = p
    }

    override func otherMouseUp(with event: NSEvent) { drag = nil }

    // MARK: trackpad and wheel

    override func scrollWheel(with ev: NSEvent) {
        guard let e = editor else { return }
        let p = point(ev)
        if ev.phase == .began || ev.phase == [] && ev.momentumPhase == [] { pivot = anchor(p, e) }
        if ev.hasPreciseScrollingDeltas {
            var mode = AppSettings.scroll
            if ev.modifierFlags.contains(.option) { mode = .orbit }
            if ev.modifierFlags.contains(.shift) { mode = .pan }
            if ev.modifierFlags.contains(.command) { mode = .zoom }
            let dx = ev.scrollingDeltaX, dy = ev.scrollingDeltaY
            switch mode {
            case .pan: e.camera.pan(dx: dx, dy: dy, at: pivot)
            case .orbit: e.camera.orbit(dx: -dx, dy: -dy, pivot: pivot)
            case .zoom: e.camera.zoom(factor: pow(1.01, AppSettings.invertZoom ? dy : -dy), toward: anchor(p, e))
            }
        } else {
            let steps = ev.scrollingDeltaY
            guard steps != 0 else { return }
            let up = AppSettings.invertZoom ? steps < 0 : steps > 0
            e.camera.zoom(factor: pow(up ? 0.85 : 1 / 0.85, min(abs(steps), 4)), toward: anchor(p, e))
        }
        e.viewChanged()
    }

    override func magnify(with ev: NSEvent) {
        guard let e = editor else { return }
        if ev.phase == .began { pivot = anchor(point(ev), e) }
        e.camera.zoom(factor: 1 / max(0.2, 1 + ev.magnification), toward: pivot)
        e.viewChanged()
    }

    override func smartMagnify(with event: NSEvent) { editor?.zoomExtents() }

    override func rotate(with ev: NSEvent) {
        guard let e = editor else { return }
        if ev.phase == .began { pivot = anchor(point(ev), e) }
        e.camera.orbit(dx: Double(-ev.rotation) * 6, dy: 0, pivot: pivot)
        e.viewChanged()
    }

    // MARK: keyboard

    override func keyDown(with ev: NSEvent) {
        guard let e = editor else { return super.keyDown(with: ev) }
        optionDownAlone = false
        let f = ev.modifierFlags
        if f.contains(.command) || f.contains(.control) { return super.keyDown(with: ev) }
        let key = KeyInput(characters: ev.charactersIgnoringModifiers ?? "", keyCode: ev.keyCode, shift: f.contains(.shift), option: f.contains(.option))
        if e.tool.keyDown(key, e) { return }
        switch key.special {
        case .escape:
            if !e.vcbText.isEmpty { e.vcbText = "" } else { e.tool.cancel(e) }
            return
        case .enter:
            e.submitVCB(e.vcbText)
            return
        case .delete:
            if !e.vcbText.isEmpty { e.vcbText.removeLast() } else { e.deleteSelection() }
            return
        case .left, .right, .up, .down:
            return
        case .none: break
        }
        let chars = ev.characters ?? ""
        // Numbers and units go to the Measurements box.
        if let c = chars.first, !e.vcbText.isEmpty || "0123456789.,-/'\"<[".contains(c) {
            if c.isLetter || c.isNumber || c.isPunctuation || c.isSymbol || c == " " {
                e.vcbText.append(chars)
                return
            }
        }
        // Single-letter tool shortcuts.
        if key.characters.count == 1, let c = key.characters.uppercased().first {
            if c == "Z", key.shift { e.zoomExtents(); return }
            if c == "X", key.option { e.toggleXray(); return }
            if let t = allToolShortcuts[c] { e.setTool(t); return }
        }
        super.keyDown(with: ev)
    }

    private var allToolShortcuts: [Character: ToolID] {
        guard let e = editor else { return [:] }
        var m: [Character: ToolID] = [:]
        for t in ToolID.allCases { if let s = e.tools[t]?.shortcut { m[s] = t } }
        return m
    }

    override func flagsChanged(with ev: NSEvent) {
        guard let e = editor else { return }
        let f = ev.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if f.contains(.shift) { e.startShiftLock() } else { e.endShiftLock() }
        // Option pressed and released on its own: a tap (Move copy, Rotate copy...).
        if f == .option {
            optionDownAlone = true
        } else if f.isEmpty, optionDownAlone {
            optionDownAlone = false
            e.tool.optionTapped(e)
        } else {
            optionDownAlone = false
        }
    }

    // MARK: responder actions (Edit menu)

    @objc func delete(_ sender: Any?) { editor?.deleteSelection() }
    override func selectAll(_ sender: Any?) { editor?.selectAll() }

    // MARK: context menu

    private func contextMenu(_ e: Editor) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        func item(_ title: String, enabled: Bool = true, _ action: @escaping () -> Void) {
            let handler = MenuAction(action)
            let i = NSMenuItem(title: title, action: #selector(MenuAction.fire(_:)), keyEquivalent: "")
            i.target = handler
            i.representedObject = handler
            i.isEnabled = enabled
            menu.addItem(i)
        }
        if e.canEditGroup { item("Edit Group") { e.editSelectedGroup() } }
        if e.isInsideGroup { item("Close Group") { e.exitGroup() } }
        item("Make Group", enabled: e.canMakeGroup) { e.makeGroup() }
        item("Make Component…", enabled: e.canMakeGroup) { e.makeComponent() }
        if e.canExplode { item("Explode") { e.explodeSelection() } }
        menu.addItem(.separator())
        item("Hide", enabled: !e.selectedGroups.isEmpty) { e.hideSelection() }
        item("Delete", enabled: e.canDelete) { e.deleteSelection() }
        menu.addItem(.separator())
        item("Zoom Extents") { e.zoomExtents() }
        return menu
    }

    /// Offscreen render for snapshots.
    func image(size: CGSize) -> CGImage? {
        guard let e = editor else { return nil }
        return renderer?.image(editor: e, size: size)
    }
}

/// Runs a closure from a menu item (kept alive by the item's representedObject).
final class MenuAction: NSObject {
    private let run: () -> Void
    init(_ run: @escaping () -> Void) { self.run = run }
    @objc func fire(_ sender: Any?) { run() }
}

struct ViewportView: NSViewRepresentable {
    let editor: Editor

    func makeNSView(context: Context) -> ViewportNSView {
        let v = ViewportNSView()
        v.editor = editor
        return v
    }

    func updateNSView(_ v: ViewportNSView, context: Context) {
        if v.editor !== editor { v.editor = editor }
        v.needsDisplay = true
    }
}
