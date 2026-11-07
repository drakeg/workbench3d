import AppKit
import Metal
import simd
import Workbench3DKit

/// Self-test for agents and CI: drives the app's real editor and tools on in-memory models,
/// prints PASS or FAIL per check, and quits with exit code 0 or 1.
///   Workbench3D --selftest     (tools/selftest.sh)
/// It never touches files outside /tmp. Add a check for every user story with logic.
enum SelfTest {
    static var requested: Bool { CommandLine.arguments.contains("--selftest") }
    /// Read by AppDelegate.applicationWillTerminate.
    nonisolated(unsafe) static var exitCode: Int32 = 0
    private static var failures = 0
    private static var count = 0

    static func runIfRequested() {
        guard requested else { return }
        setvbuf(stdout, nil, _IOLBF, 0)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.3))
            run()
            print(failures == 0 ? "SELFTEST PASS \(count) checks" : "SELFTEST FAIL \(failures) of \(count) checks")
            exitCode = failures == 0 ? 0 : 1
            NSApp.terminate(nil)
        }
    }

    private static func run() {
        // the sample model and the editor commands
        let doc = ModelDocument(model: SampleModel.make())
        let e = Editor(document: doc)
        let um = UndoManager()
        um.groupsByEvent = false
        e.undoManager = um
        func step(_ body: () -> Void) {
            um.beginUndoGrouping()
            body()
            um.endUndoGrouping()
        }
        check("the sample model has six groups at the top", e.doc.root.children.count == 6, "\(e.doc.root.children.count)")
        check("legs are copies of one component", e.doc.components.count == 1 && e.doc.instances(of: e.doc.components[0].id).count == 4)

        let top = e.doc.root.children[0]
        e.select(Selection(groups: [top.id]))
        step { e.deleteSelection() }
        check("Delete removes the selected group", e.doc.root.children.count == 5)
        um.undo()
        check("Undo brings it back", e.doc.root.children.count == 6)
        um.redo()
        check("Redo deletes it again", e.doc.root.children.count == 5)
        um.undo()

        let loose = e.doc.root.mesh
        let looseFaces = loose.faces.count
        e.selectAll()
        e.select(Selection(faces: Set(loose.faces.keys), edges: Set(loose.allEdges())))
        step { e.makeGroup() }
        check("Make Group moves loose geometry into a group", e.doc.root.mesh.faces.isEmpty && e.doc.root.children.count == 7)
        step { e.explodeSelection() }
        check("Explode puts it back", e.doc.root.mesh.faces.count == looseFaces && e.doc.root.children.count == 6)

        if let leg = e.doc.root.children.first(where: { $0.componentId != nil }) {
            e.enterGroup(leg.id)
            check("Edit Group enters it", e.context === leg && e.isInsideGroup)
            e.exitGroup()
            check("Close Group steps back out and selects it", e.context === e.doc.root && e.selection.groups == [leg.id])
        }

        if let data = try? e.doc.data(), let again = try? WBDocument(data: data) {
            check("a saved model opens with the same geometry",
                  Export.triangles(again).count == Export.triangles(e.doc).count && again.root.all.count == e.doc.root.all.count)
        } else {
            check("a saved model opens with the same geometry", false, "save or load threw")
        }

        // drawing with the real tools in an empty model
        let blank = Editor(document: ModelDocument(model: WBDocument()))
        let um2 = UndoManager()
        um2.groupsByEvent = false
        blank.undoManager = um2
        blank.camera.size = CGSize(width: 1000, height: 700)
        blank.camera.look(from: V3(0, -0.01, 200), at: .zero)
        func event(_ pt: CGPoint) -> ToolEvent { ToolEvent(pt: pt, ray: blank.camera.ray(at: pt)) }
        let mid = CGPoint(x: 500, y: 350)

        blank.setTool(.rect)
        um2.beginUndoGrouping()
        blank.tool.mouseMoved(event(mid), blank)
        blank.tool.mouseDown(event(mid), blank)
        blank.submitVCB("24, 12")
        um2.endUndoGrouping()
        let faces = blank.doc.root.mesh.faces.values
        check("Rectangle with typed 24, 12 makes one face", faces.count == 1, "\(faces.count) faces")
        if let f = faces.first {
            let area = blank.doc.root.mesh.area(f)
            check("…of 288 square inches", abs(area - 288) < 1e-6, "\(area)")
        }

        blank.setTool(.pushpull)
        let b = blank.doc.bounds
        let c = blank.camera.project((b.min + b.max) / 2).point
        um2.beginUndoGrouping()
        blank.tool.mouseMoved(event(c), blank)
        blank.tool.mouseDown(event(c), blank)
        blank.tool.mouseUp(event(c), blank)
        blank.submitVCB("6")
        um2.endUndoGrouping()
        let size = blank.doc.bounds.size
        check("Push/Pull with typed 6 makes a 6 in box", blank.doc.root.mesh.faces.count == 6 && abs(size.z - 6) < 1e-6,
              "\(blank.doc.root.mesh.faces.count) faces, height \(size.z)")
        um2.undo()
        check("Undo Push/Pull leaves the rectangle", blank.doc.root.mesh.faces.count == 1)

        blank.setTool(.select)
        blank.tool.mouseDown(event(c), blank)
        blank.tool.mouseUp(event(c), blank)
        check("Select picks the face under the cursor", blank.selection.faces.count == 1)

        check("the Measurements box parses feet and inches", Units.parse("2' 6\"") == 30)
        check("…and millimetres", abs((Units.parse("254mm") ?? 0) - 10) < 1e-9)

        // the renderer draws
        if let device = MTLCreateSystemDefaultDevice(), let r = Renderer(device: device) {
            e.zoomExtents()
            check("Metal draws the model offscreen", r.image(editor: e, size: CGSize(width: 320, height: 200)) != nil)
        } else {
            check("Metal draws the model offscreen", false, "no Metal device")
        }
    }

    private static func check(_ name: String, _ ok: Bool, _ detail: String = "") {
        count += 1
        if !ok { failures += 1 }
        print(ok ? "PASS \(name)" : "FAIL \(name)\(detail.isEmpty ? "" : ": \(detail)")")
    }
}
