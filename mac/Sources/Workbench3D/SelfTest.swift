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

        // cut list: the sample's parts, stock and a PDF cutting plan
        let rows = CutList.rows(e.doc)
        let legRow = rows.first { $0.name == "Leg" }
        check("the cut list counts the four legs as one line", legRow?.qty == 4 && abs((legRow?.l ?? 0) - 30) < 1e-6, "\(rows.map { "\($0.qty)× \($0.name)" })")
        check("the cut list has the top and the stretcher", rows.contains { $0.name == "Top" && abs($0.l - 48) < 1e-6 && abs($0.w - 24) < 1e-6 } && rows.contains { $0.name == "Stretcher" })
        let groups = CutList.stockGroups(rows)
        let layouts = groups.map { CutList.layout($0, kerf: 0.125, margin: 0, respectGrain: true) }
        check("every part is laid out on stock", layouts.reduce(0) { $0 + $1.pieces.reduce(0) { $0 + $1.placements.count } } == rows.reduce(0) { $0 + $1.qty }
              && layouts.allSatisfy(\.tooBig.isEmpty))
        let pdf = CuttingPlanPDF.make(title: "Sample", rows: rows, groups: groups, layouts: layouts, kerf: 0.125, margin: 0, respectGrain: true, units: e.doc.units)
        let pages = CGPDFDocument(CGDataProvider(data: pdf as CFData)!)?.numberOfPages ?? 0
        check("the cutting plan is a PDF with the list and the diagrams", pdf.starts(with: Data("%PDF".utf8)) && pages >= 2, "\(pdf.count) bytes, \(pages) pages")
        if !pdf.isEmpty { try? pdf.write(to: URL(fileURLWithPath: "/tmp/Workbench3D-selftest-cutting-plan.pdf")) }
        // pages as pictures, for the CI log preview
        try? FileManager.default.createDirectory(atPath: "/tmp/Workbench3D-pdf", withIntermediateDirectories: true)
        if let doc = CGPDFDocument(CGDataProvider(data: pdf as CFData)!) {
            for n in 1...min(2, doc.numberOfPages) {
                guard let page = doc.page(at: n) else { continue }
                let r = page.getBoxRect(.mediaBox)
                guard let ctx = CGContext(data: nil, width: Int(r.width * 1.5), height: Int(r.height * 1.5), bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
                ctx.setFillColor(.white)
                ctx.fill(CGRect(x: 0, y: 0, width: r.width * 1.5, height: r.height * 1.5))
                ctx.scaleBy(x: 1.5, y: 1.5)
                ctx.drawPDFPage(page)
                if let img = ctx.makeImage() { Snapshot.writePNG(img, to: "/tmp/Workbench3D-pdf/pdf-page\(n).png") }
            }
        }

        // tags and scenes (no undo manager: these checks don't group undo steps)
        e.undoManager = nil
        check("the sample model has tags and scenes", e.doc.tags.count == 3 && e.doc.scenes.count == 2)
        e.doc.tags = []
        e.doc.scenes = []
        for g in e.doc.root.all { g.tag = "" }
        let tagName = e.addTag()
        let tagged = e.doc.root.children[0]
        e.select(Selection(groups: [tagged.id]))
        e.tagSelection(tagName)
        check("Tag Selection puts a group on a tag", tagged.tag == tagName && e.groupCount(tag: tagName) == 1)
        e.renameTag(tagName, to: "Cabinets")
        check("renaming a tag keeps its groups", tagged.tag == "Cabinets" && e.doc.tags.contains { $0.name == "Cabinets" })
        e.setView(.top)
        let topCamera = e.camera.position
        e.addScene()
        e.setTagVisible("Cabinets", false)
        check("hiding a tag hides its groups", e.doc.isHidden(tagged))
        e.setView(.front)
        e.addScene()
        check("scenes save which tags are hidden", e.doc.scenes.count == 2 && e.doc.scenes[1].hiddenTags == ["Cabinets"] && e.doc.scenes[0].hiddenTags.isEmpty)
        e.goToScene(0)
        check("going to a scene restores its camera and tags", (e.camera.position - topCamera).length < 1e-6 && !e.doc.isHidden(tagged))
        e.nextScene(1)
        check("Next Scene steps through the scenes", e.activeScene == 1 && e.doc.isHidden(tagged))
        if let data = try? e.doc.data(), let again = try? WBDocument(data: data) {
            check("tags and scenes survive save and reopen", again.tags.map(\.name) == ["Cabinets"] && again.scenes.count == 2
                && again.root.all.contains { $0.tag == "Cabinets" })
        }
        e.deleteTag("Cabinets")
        check("deleting a tag untags its groups", tagged.tag.isEmpty && !e.doc.isHidden(tagged) && e.doc.scenes.allSatisfy { $0.hiddenTags.isEmpty })

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

        // Polygon: typed sides, then radius
        let poly = Editor(document: ModelDocument(model: WBDocument()))
        poly.camera.size = CGSize(width: 1000, height: 700)
        poly.camera.look(from: V3(0, -0.01, 200), at: .zero)
        poly.setTool(.polygon)
        let pc = CGPoint(x: 500, y: 350)
        poly.tool.mouseMoved(ToolEvent(pt: pc, ray: poly.camera.ray(at: pc)), poly)
        poly.submitVCB("8s")
        poly.tool.mouseDown(ToolEvent(pt: pc, ray: poly.camera.ray(at: pc)), poly)
        let pc2 = CGPoint(x: 560, y: 350)
        poly.tool.mouseMoved(ToolEvent(pt: pc2, ray: poly.camera.ray(at: pc2)), poly)
        poly.submitVCB("6")
        if let f = poly.doc.root.mesh.faces.values.first {
            let expected = 4 * 36 * sin(Double.pi / 4) // n/2 · r² · sin(2π/n), n = 8
            check("Polygon with 8 sides and radius 6 makes an octagon", f.outer.count == 8 && abs(poly.doc.root.mesh.area(f) - expected) < 1e-6,
                  "\(f.outer.count) sides, area \(poly.doc.root.mesh.area(f))")
        } else {
            check("Polygon with 8 sides and radius 6 makes an octagon", false, "no face")
        }

        // Scale: drag the top corner grip of a 24 x 12 x 6 group, type 2
        let sc = Editor(document: ModelDocument(model: WBDocument()))
        let um3 = UndoManager()
        um3.groupsByEvent = false
        sc.undoManager = um3
        let boxGroup = sc.doc.newGroup("Box")
        let base = boxGroup.mesh.addPolygon([V3(0, 0, 0), V3(24, 0, 0), V3(24, 12, 0), V3(0, 12, 0)])!
        _ = boxGroup.mesh.pushPull(base, -6)
        sc.doc.root.add(boxGroup)
        sc.camera.size = CGSize(width: 1000, height: 700)
        sc.setView(.iso)
        sc.select(Selection(groups: [boxGroup.id]))
        sc.setTool(.scale)
        let corner = sc.camera.project(V3(24, 12, 6))
        let cp = CGPoint(x: corner.x, y: corner.y)
        um3.beginUndoGrouping()
        sc.tool.mouseMoved(ToolEvent(pt: cp, ray: sc.camera.ray(at: cp)), sc)
        sc.tool.mouseDown(ToolEvent(pt: cp, ray: sc.camera.ray(at: cp)), sc)
        sc.submitVCB("2")
        um3.endUndoGrouping()
        let sb = sc.doc.bounds
        check("Scale ×2 from a corner doubles every size and keeps the opposite corner",
              abs(sb.size.x - 48) < 1e-6 && abs(sb.size.y - 24) < 1e-6 && abs(sb.size.z - 12) < 1e-6 && sb.min.length < 1e-6,
              "size \(sb.size), min \(sb.min)")
        um3.undo()
        check("Undo Scale restores the size", abs(sc.doc.bounds.size.x - 24) < 1e-6)

        // Native linear dimensions are annotations (no mesh mutations), support undo,
        // and round-trip through the same .wb3d file as the browser editor.
        let de = Editor(document: ModelDocument(model: WBDocument()))
        let dimUndo = UndoManager()
        dimUndo.groupsByEvent = false
        de.undoManager = dimUndo
        de.camera.size = CGSize(width: 1000, height: 700)
        de.camera.look(from: V3(0, -0.01, 200), at: .zero)
        de.setTool(.dimension)
        dimUndo.beginUndoGrouping()
        func dimensionEvent(_ p: V3) -> ToolEvent {
            let screen = de.camera.project(p).point
            return ToolEvent(pt: screen, ray: de.camera.ray(at: screen))
        }
        for point in [V3(0, 0, 0), V3(24, 0, 0), V3(12, 5, 0)] {
            let event = dimensionEvent(point)
            de.tool.mouseMoved(event, de)
            de.tool.mouseDown(event, de)
        }
        dimUndo.endUndoGrouping()
        let dim = de.doc.dimensions.first
        let span = dim.map { V3($0.b[0] - $0.a[0], $0.b[1] - $0.a[1], $0.b[2] - $0.a[2]).length } ?? 0
        check("Dimension makes a saved 24-inch linear annotation",
              de.doc.dimensions.count == 1 && abs(span - 24) < 1e-4 && (dim?.offset.count == 3),
              "count \(de.doc.dimensions.count), span \(span)")
        if let saved = try? de.doc.data(), let reloaded = try? WBDocument(data: saved) {
            check("Dimension persists through save and reopen", reloaded.dimensions == de.doc.dimensions)
        } else {
            check("Dimension persists through save and reopen", false, "failed to serialize")
        }
        dimUndo.undo()
        check("Undo Dimension removes the annotation without altering model geometry",
              de.doc.dimensions.isEmpty && de.doc.root.mesh.faces.isEmpty)

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
