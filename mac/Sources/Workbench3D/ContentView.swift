import SwiftUI
import simd
import Workbench3DKit

extension ModelDocument {
    /// The window's editor, made on first use so it lives as long as the document.
    @MainActor var sharedEditor: Editor {
        if let editor { return editor }
        let e = Editor(document: self)
        editor = e
        e.zoomExtents()
        return e
    }
}

extension FocusedValues {
    /// The editor of the frontmost model window, for menu commands.
    @Entry var editor: Editor?
}

/// One model window: the Outliner, the 3D view with its tool palette, and Entity Info.
struct ContentView: View {
    let document: ModelDocument
    @Environment(\.undoManager) private var undoManager
    @State private var showInspector = true
    @State private var columns = NavigationSplitViewVisibility.all

    var body: some View {
        let editor = document.sharedEditor
        NavigationSplitView(columnVisibility: $columns) {
            OutlinerView(editor: editor)
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } detail: {
            Viewport(editor: editor)
                .inspector(isPresented: $showInspector) {
                    EntityInfoView(editor: editor)
                        .inspectorColumnWidth(min: 220, ideal: 260, max: 340)
                }
        }
        .toolbar { WindowToolbar(editor: editor, showInspector: $showInspector) }
        .focusedSceneValue(\.editor, editor)
        .onAppear { editor.undoManager = undoManager }
        .onChange(of: undoManager) { _, um in editor.undoManager = um }
        .noInitialFocus()
        .frame(minWidth: 820, minHeight: 520)
    }
}

// MARK: viewport

struct Viewport: View {
    @Bindable var editor: Editor

    var body: some View {
        ZStack(alignment: .topLeading) {
            ViewportView(editor: editor)
                .ignoresSafeArea(.container, edges: .top)
                .accessibilityLabel("3D model view")
            SnapMarker(editor: editor)
                .allowsHitTesting(false)
            ToolPalette(editor: editor)
                .padding(Space.md)
        }
        .overlay(alignment: .bottom) { StatusBar(editor: editor) }
        .overlay(alignment: .top) {
            if let t = editor.toast {
                Text(t)
                    .font(.callout)
                    .padding(.horizontal, Space.lg)
                    .padding(.vertical, Space.sm)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.top, Space.md)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
        }
        .animation(.default, value: editor.toast)
    }
}

/// The snap marker and its label ("Endpoint", "On Red Axis"), drawn over the 3D view.
struct SnapMarker: View {
    var editor: Editor

    var body: some View {
        let _ = editor.viewVersion
        if let inf = editor.inference, inf.kind != .free {
            let p = editor.camera.project(inf.point)
            if !p.behind {
                ZStack(alignment: .topLeading) {
                    marker(inf)
                        .position(x: p.x, y: p.y)
                    if !inf.label.isEmpty {
                        Text(inf.label)
                            .font(.caption)
                            .padding(.horizontal, Space.sm)
                            .padding(.vertical, Space.xs)
                            .background(.regularMaterial, in: .capsule)
                            .fixedSize()
                            .position(x: p.x + 48, y: p.y + 24)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func marker(_ inf: Inference) -> some View {
        let c = inf.color
        switch inf.kind {
        case .endpoint: Circle().fill(c).stroke(.white, lineWidth: 1.5).frame(width: 12, height: 12)
        case .midpoint: Circle().fill(c).stroke(.white, lineWidth: 1.5).frame(width: 11, height: 11)
        case .onEdge: Rectangle().fill(c).stroke(.white, lineWidth: 1).frame(width: 9, height: 9)
        case .onFace: Rectangle().stroke(c, lineWidth: 2).frame(width: 12, height: 12)
        default: Circle().stroke(c, lineWidth: 2).frame(width: 10, height: 10)
        }
    }
}

/// The floating tool palette, grouped like the Tools menu.
struct ToolPalette: View {
    var editor: Editor

    var body: some View {
        GlassEffectContainer {
            VStack(spacing: Space.xs) {
                ForEach(Array(toolGroups.enumerated()), id: \.offset) { i, group in
                    if i > 0 { Divider().frame(width: 24) }
                    ForEach(group) { id in
                        if let t = editor.tools[id] { button(t) }
                    }
                }
            }
            .padding(Space.xs)
            .glassEffect(.regular, in: .rect(cornerRadius: 12))
        }
    }

    private func button(_ t: Tool) -> some View {
        let on = editor.toolId == t.id
        return Button { editor.setTool(t.id) } label: {
            Image(systemName: t.symbol)
                .font(.system(size: 14))
                .frame(width: 28, height: 28)
                .foregroundStyle(on ? Palette.onAccent : Color.primary)
                .background(on ? Palette.accent : Color.clear, in: .rect(cornerRadius: 8))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(t.shortcutLabel.map { "\(t.name) (\($0))" } ?? t.name)
        .accessibilityLabel(t.name)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The hint for the active tool, along the bottom of the 3D view.
struct StatusBar: View {
    var editor: Editor

    var body: some View {
        if !editor.hint.isEmpty {
            Text(editor.hint)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.horizontal, Space.md)
                .padding(.vertical, Space.xs)
                .glassEffect(.regular, in: .capsule)
                .padding(.bottom, Space.md)
                .allowsHitTesting(false)
        }
    }
}

// MARK: toolbar

struct WindowToolbar: ToolbarContent {
    @Bindable var editor: Editor
    @Binding var showInspector: Bool

    var body: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            if editor.isInsideGroup {
                Button { editor.exitGroup() } label: { Label("Close Group", systemImage: "chevron.backward") }
                    .help("Close Group (⌘↑)")
            }
        }
        ToolbarItem(placement: .principal) {
            MeasurementsField(editor: editor)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Menu {
                ForEach(Camera.StandardView.allCases) { v in
                    Button(v.title) { editor.setView(v) }
                }
                Divider()
                Button("Zoom Extents") { editor.zoomExtents() }
                Toggle("Perspective", isOn: Binding(get: { editor.camera.perspective }, set: { _ in editor.togglePerspective() }))
                Toggle("X-Ray", isOn: Binding(get: { editor.xray }, set: { _ in editor.toggleXray() }))
                Toggle("Grid", isOn: Binding(get: { editor.showGrid }, set: { _ in editor.toggleGrid() }))
            } label: {
                Label("View", systemImage: "cube")
            }
            .help("Standard views, Zoom Extents, X-Ray")
            Button { showInspector.toggle() } label: { Label("Entity Info", systemImage: "sidebar.trailing") }
                .help("Show or hide Entity Info (⌥⌘I)")
        }
    }
}

/// The Measurements box: shows what the tool is measuring, and takes typed values.
struct MeasurementsField: View {
    @Bindable var editor: Editor

    var body: some View {
        HStack(spacing: Space.sm) {
            Text(editor.vcbLabel)
                .foregroundStyle(.secondary)
                .fixedSize()
            TextField(editor.vcbLabel, text: $editor.vcbText, prompt: Text(editor.vcbValue))
                .textFieldStyle(.roundedBorder)
                .frame(width: 160)
                .monospacedDigit()
                .onSubmit { editor.submitVCB(editor.vcbText) }
                .accessibilityLabel(editor.vcbLabel)
        }
        .help("Type a length or value and press Return. You can type without clicking here.")
    }
}

// MARK: outliner

struct OutlineNode: Identifiable {
    let id: Int
    let name: String
    let symbol: String
    let hidden: Bool
    let children: [OutlineNode]?
}

struct OutlinerView: View {
    var editor: Editor

    private func node(_ g: Group) -> OutlineNode {
        let kids = g.children.map(node)
        let name = g.componentId.flatMap { editor.doc.component($0)?.name } ?? g.name
        return OutlineNode(id: g.id, name: name, symbol: g.componentId != nil ? "square.stack.3d.forward.dottedline" : "cube",
                           hidden: g.hidden, children: kids.isEmpty ? nil : kids)
    }

    var body: some View {
        let _ = editor.version
        let roots = editor.doc.root.children.map(node)
        let selection = Binding<Set<Int>>(
            get: { editor.selection.groups },
            set: { ids in
                guard let first = ids.first, let g = editor.doc.findGroup(first), let parent = g.parent else { return }
                if parent.id != editor.contextId { editor.enterGroup(parent.id) }
                editor.select(Selection(groups: Set(ids.filter { editor.doc.findGroup($0)?.parent === parent })))
            })
        List(selection: selection) {
            Section("Outliner") {
                OutlineGroup(roots, children: \.children) { n in
                    Label(n.name, systemImage: n.symbol)
                        .foregroundStyle(n.hidden ? .secondary : .primary)
                        .tag(n.id)
                        .contextMenu {
                            Button("Edit") { editor.enterGroup(n.id) }
                        }
                }
            }
        }
        .overlay {
            if roots.isEmpty {
                ContentUnavailableView("No Groups", systemImage: "cube",
                                       description: Text("Select geometry and press ⌘G to make a group."))
            }
        }
    }
}

// MARK: entity info

struct EntityInfoView: View {
    var editor: Editor

    var body: some View {
        let _ = editor.version
        Form {
            let s = editor.selection
            let ctx = editor.context
            if s.isEmpty {
                Section("Model") {
                    LabeledContent("Groups", value: "\(editor.doc.root.all.count - 1)")
                    let b = editor.doc.bounds
                    if !b.isEmpty {
                        let d = b.max - b.min
                        LabeledContent("Size", value: "\(editor.fmt(d.x)) × \(editor.fmt(d.y)) × \(editor.fmt(d.z))")
                    }
                    LabeledContent("Units", value: editor.doc.units.system == .metric ? "Millimetres" : "Inches")
                }
            } else if s.groups.count == 1, s.faces.isEmpty, s.edges.isEmpty, let g = editor.selectedGroups.first {
                GroupInfo(editor: editor, group: g)
            } else {
                Section("Selection") {
                    if !s.groups.isEmpty { LabeledContent("Groups", value: "\(s.groups.count)") }
                    if !s.faces.isEmpty {
                        LabeledContent("Faces", value: "\(s.faces.count)")
                        let area = s.faces.compactMap { ctx.mesh.faces[$0] }.reduce(0) { $0 + ctx.mesh.area($1) }
                        LabeledContent("Area", value: Units.formatArea(area, units: editor.doc.units))
                    }
                    if !s.edges.isEmpty {
                        LabeledContent("Edges", value: "\(s.edges.count)")
                        let len = s.edges.reduce(0.0) { $0 + ctx.mesh.v($1.a).distance(to: ctx.mesh.v($1.b)) }
                        LabeledContent("Length", value: editor.fmt(len))
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct GroupInfo: View {
    var editor: Editor
    let group: Group
    @State private var name = ""

    var body: some View {
        Section(group.componentId != nil ? "Component" : "Group") {
            TextField("Name", text: $name)
                .onSubmit {
                    let n = name.trimmingCharacters(in: .whitespaces)
                    guard !n.isEmpty, n != group.name else { return }
                    editor.perform("Rename") { group.name = n }
                }
            let b = group.localBounds
            if !b.isEmpty {
                let d = b.max - b.min
                LabeledContent("Size", value: "\(editor.fmt(d.x)) × \(editor.fmt(d.y)) × \(editor.fmt(d.z))")
            }
            LabeledContent("Faces", value: "\(group.mesh.faces.count)")
            if let id = group.componentId {
                LabeledContent("Copies", value: "\(editor.doc.instances(of: id).count)")
            }
        }
        .onAppear { name = group.name }
        .onChange(of: group.id) { name = group.name }
    }
}
