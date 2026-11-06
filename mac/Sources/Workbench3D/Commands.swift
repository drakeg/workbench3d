import AppKit
import UniformTypeIdentifiers
import Workbench3DKit

/// Menu commands that act on the selection. Each is one undo step.
extension Editor {
    var canDelete: Bool { !selection.isEmpty }
    var canMakeGroup: Bool { !selection.isEmpty }
    var canExplode: Bool { !selectedGroups.isEmpty }
    var canEditGroup: Bool { selectedGroups.count == 1 }
    var isInsideGroup: Bool { context !== doc.root }

    func deleteSelection() {
        guard canDelete else { return }
        let s = selection
        perform("Delete") {
            let ctx = context
            ctx.mesh.erase(faces: s.faces, edges: s.edges)
            for g in selectedGroups { ctx.remove(g) }
        }
        select(Selection())
    }

    func selectAll() {
        let ctx = context
        select(Selection(faces: Set(ctx.mesh.faces.keys), edges: Set(ctx.mesh.allEdges()), groups: Set(ctx.children.map(\.id))))
    }

    func selectNone() { select(Selection()) }

    func makeGroup() {
        guard canMakeGroup else { return }
        let s = selection
        let g = perform("Make Group") {
            doc.makeGroup(in: context, faces: Array(s.faces), edges: Array(s.edges), groups: selectedGroups)
        }
        select(Selection(groups: [g.id]))
    }

    func makeComponent() {
        guard canMakeGroup else { return }
        let s = selection
        let name = "Component \(doc.components.count + 1)"
        let g = perform("Make Component") {
            doc.makeComponent(in: context, faces: Array(s.faces), edges: Array(s.edges), groups: selectedGroups, name: name)
        }
        select(Selection(groups: [g.id]))
    }

    func explodeSelection() {
        guard canExplode else { return }
        var next = Selection()
        perform("Explode") {
            for g in selectedGroups {
                let r = doc.explode(g)
                next.faces.formUnion(r.faces)
                next.edges.formUnion(r.lines)
                next.groups.formUnion(r.groups.map(\.id))
            }
        }
        select(next)
    }

    func editSelectedGroup() {
        if let g = selectedGroups.first { enterGroup(g.id) }
    }

    func hideSelection() {
        guard !selectedGroups.isEmpty else { return }
        perform("Hide") { for g in selectedGroups { g.hidden = true } }
        select(Selection())
    }

    func unhideAll() {
        perform("Unhide All") { for g in doc.root.all { g.hidden = false } }
    }

    func duplicateSelection() {
        guard !selectedGroups.isEmpty else { return }
        var ids: Set<Int> = []
        perform("Duplicate") {
            for g in selectedGroups {
                let c = doc.duplicate(g)
                c.matrix = .translation(V3(12, 12, 0)) * c.matrix
                ids.insert(c.id)
            }
        }
        select(Selection(groups: ids))
    }

    func toggleXray() {
        xray.toggle()
        changed(geometry: false)
    }

    func toggleGrid() {
        showGrid.toggle()
        changed(geometry: false)
    }

    func togglePerspective() {
        camera.perspective.toggle()
        viewChanged()
    }

    // MARK: export

    func export(_ kind: ExportKind, window: NSWindow?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [kind.type]
        panel.nameFieldStringValue = "\(document.displayName).\(kind.ext)"
        let doc = self.doc
        let write = {
            guard let url = panel.url else { return }
            let mm = doc.units.system == .metric
            let data = kind == .stl ? Export.stl(doc) : Data(Export.obj(doc, millimetres: mm).utf8)
            do { try data.write(to: url, options: .atomic) } catch { NSApp.presentError(error) }
        }
        if let window { panel.beginSheetModal(for: window) { if $0 == .OK { write() } } } else if panel.runModal() == .OK { write() }
    }

    enum ExportKind {
        case stl, obj
        var ext: String { self == .stl ? "stl" : "obj" }
        var type: UTType { UTType(filenameExtension: ext) ?? .data }
    }
}

extension ModelDocument {
    var displayName: String { "Model" }
}
