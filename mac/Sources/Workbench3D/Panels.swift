import SwiftUI
import simd
import Workbench3DKit

// Tags and Scenes: the sidebar panels next to the Outliner, and the editor commands behind them.
// Tags show or hide groups together (Cabinets, Plumbing, Walls). Scenes save a camera and which
// tags are hidden, so you can step through views of a project.

extension Editor {
    // MARK: tags

    func addTag() -> String {
        var n = 1
        while doc.tags.contains(where: { $0.name == "Tag \(n)" }) { n += 1 }
        let name = "Tag \(n)"
        let palette = ["#d97706", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"]
        perform("Add Tag") { doc.tags.append(Tag(name: name, color: palette[doc.tags.count % palette.count])) }
        return name
    }

    func renameTag(_ old: String, to new: String) {
        let name = new.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, name != old, !doc.tags.contains(where: { $0.name == name }),
              let i = doc.tags.firstIndex(where: { $0.name == old }) else { return }
        perform("Rename Tag") {
            doc.tags[i].name = name
            for g in doc.root.all where g.tag == old { g.tag = name }
            for s in doc.scenes.indices { doc.scenes[s].hiddenTags = doc.scenes[s].hiddenTags.map { $0 == old ? name : $0 } }
        }
    }

    func setTagVisible(_ name: String, _ visible: Bool) {
        guard let i = doc.tags.firstIndex(where: { $0.name == name }), doc.tags[i].visible != visible else { return }
        perform(visible ? "Show Tag" : "Hide Tag") { doc.tags[i].visible = visible }
    }

    /// Delete a tag; its groups become untagged (they stay in the model).
    func deleteTag(_ name: String) {
        perform("Delete Tag") {
            doc.tags.removeAll { $0.name == name }
            for g in doc.root.all where g.tag == name { g.tag = "" }
            for s in doc.scenes.indices { doc.scenes[s].hiddenTags.removeAll { $0 == name } }
        }
    }

    /// Put the selected groups on a tag ("" = untagged).
    func tagSelection(_ name: String) {
        let gs = selectedGroups
        guard !gs.isEmpty else { return }
        perform(name.isEmpty ? "Untag" : "Tag \(name)") { for g in gs { g.tag = name } }
    }

    func groupCount(tag: String) -> Int { doc.root.all.filter { $0.tag == tag }.count }

    // MARK: scenes

    private func currentScene(named name: String) -> Workbench3DKit.Scene {
        let c = camera
        return Workbench3DKit.Scene(name: name,
                                    camera: .init(position: [c.position.x, c.position.y, c.position.z],
                                                  target: [c.target.x, c.target.y, c.target.z], perspective: c.perspective),
                                    hiddenTags: doc.tags.filter { !$0.visible }.map(\.name))
    }

    /// Save the current view as a new scene.
    func addScene() {
        var n = doc.scenes.count + 1
        while doc.scenes.contains(where: { $0.name == "Scene \(n)" }) { n += 1 }
        let scene = currentScene(named: "Scene \(n)")
        perform("Add Scene") { doc.scenes.append(scene) }
        activeScene = doc.scenes.count - 1
        showToast("Saved \(scene.name)")
    }

    /// Replace a scene's view with the current one.
    func updateScene(_ i: Int) {
        guard doc.scenes.indices.contains(i) else { return }
        let scene = currentScene(named: doc.scenes[i].name)
        perform("Update Scene") { doc.scenes[i] = scene }
        showToast("Updated \(scene.name)")
    }

    func renameScene(_ i: Int, to new: String) {
        let name = new.trimmingCharacters(in: .whitespaces)
        guard doc.scenes.indices.contains(i), !name.isEmpty, name != doc.scenes[i].name else { return }
        perform("Rename Scene") { doc.scenes[i].name = name }
    }

    func deleteScene(_ i: Int) {
        guard doc.scenes.indices.contains(i) else { return }
        perform("Delete Scene") { doc.scenes.remove(at: i) }
        if let a = activeScene { activeScene = a == i ? nil : a > i ? a - 1 : a }
    }

    func moveScenes(from: IndexSet, to: Int) {
        perform("Reorder Scenes") { doc.scenes.move(fromOffsets: from, toOffset: to) }
    }

    /// Go to a scene: its camera, and its tags shown or hidden. (Showing and hiding tags this way
    /// isn't an undo step, like moving the camera.)
    func goToScene(_ i: Int) {
        guard doc.scenes.indices.contains(i) else { return }
        let s = doc.scenes[i]
        let p = s.camera.position, t = s.camera.target
        if p.count == 3, t.count == 3 {
            camera.position = V3(p[0], p[1], p[2])
            camera.target = V3(t[0], t[1], t[2])
            camera.perspective = s.camera.perspective
        }
        var tagsChanged = false
        for j in doc.tags.indices {
            let visible = !s.hiddenTags.contains(doc.tags[j].name)
            if doc.tags[j].visible != visible {
                doc.tags[j].visible = visible
                tagsChanged = true
            }
        }
        activeScene = i
        if tagsChanged { changed() }
        viewChanged()
    }

    func nextScene(_ step: Int) {
        guard !doc.scenes.isEmpty else { return }
        let n = doc.scenes.count
        let i = ((activeScene ?? (step > 0 ? -1 : 0)) + step + n) % n
        goToScene(i)
    }
}

// MARK: sidebar

enum SidebarPanel: String, CaseIterable, Identifiable {
    case outliner, tags, scenes
    var id: String { rawValue }
    var title: String {
        switch self {
        case .outliner: "Outliner"
        case .tags: "Tags"
        case .scenes: "Scenes"
        }
    }
}

struct SidebarView: View {
    var editor: Editor
    @AppStorage("sidebar.panel") private var panel = SidebarPanel.outliner

    var body: some View {
        VStack(spacing: 0) {
            Picker("Panel", selection: $panel) {
                ForEach(SidebarPanel.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm)
            switch panel {
            case .outliner: OutlinerView(editor: editor)
            case .tags: TagsView(editor: editor)
            case .scenes: ScenesView(editor: editor)
            }
        }
    }
}

struct TagsView: View {
    var editor: Editor
    @State private var renaming: String?
    @State private var draft = ""

    var body: some View {
        let _ = editor.version
        let tags = editor.doc.tags
        List {
            Section {
                ForEach(tags, id: \.name) { tag in
                    HStack(spacing: Space.sm) {
                        Button {
                            editor.setTagVisible(tag.name, !tag.visible)
                        } label: {
                            Image(systemName: tag.visible ? "eye" : "eye.slash")
                                .foregroundStyle(tag.visible ? .primary : .secondary)
                                .frame(width: 20)
                        }
                        .buttonStyle(.plain)
                        .help(tag.visible ? "Hide \(tag.name)" : "Show \(tag.name)")
                        .accessibilityLabel(tag.visible ? "Hide \(tag.name)" : "Show \(tag.name)")
                        Circle()
                            .fill(Color(hex: tag.color) ?? .secondary)
                            .frame(width: 10, height: 10)
                            .accessibilityHidden(true)
                        if renaming == tag.name {
                            TextField("Name", text: $draft)
                                .onSubmit {
                                    editor.renameTag(tag.name, to: draft)
                                    renaming = nil
                                }
                                .onExitCommand { renaming = nil }
                        } else {
                            Text(tag.name)
                                .foregroundStyle(tag.visible ? .primary : .secondary)
                                .onTapGesture(count: 2) { startRename(tag.name) }
                        }
                        Spacer()
                        Text("\(editor.groupCount(tag: tag.name))")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                            .accessibilityLabel("\(editor.groupCount(tag: tag.name)) groups")
                    }
                    .contextMenu {
                        Button("Tag Selection") { editor.tagSelection(tag.name) }
                            .disabled(editor.selectedGroups.isEmpty)
                        Button("Rename") { startRename(tag.name) }
                        Divider()
                        Button("Delete Tag", role: .destructive) { editor.deleteTag(tag.name) }
                    }
                }
            } header: {
                HStack {
                    Text("Tags")
                    Spacer()
                    Button {
                        startRename(editor.addTag())
                    } label: { Label("Add Tag", systemImage: "plus") }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .help("Add Tag")
                }
            }
        }
        .overlay {
            if tags.isEmpty {
                ContentUnavailableView {
                    Label("No Tags", systemImage: "tag")
                } description: {
                    Text("Tags show and hide groups together, like Cabinets or Plumbing.")
                } actions: {
                    Button("Add Tag") { startRename(editor.addTag()) }
                }
            }
        }
    }

    private func startRename(_ name: String) {
        draft = name
        renaming = name
    }
}

struct ScenesView: View {
    var editor: Editor
    @State private var renaming: Int?
    @State private var draft = ""

    var body: some View {
        let _ = editor.version
        let scenes = editor.doc.scenes
        List {
            Section {
                ForEach(Array(scenes.enumerated()), id: \.offset) { i, scene in
                    HStack {
                        Image(systemName: editor.activeScene == i ? "camera.fill" : "camera")
                            .foregroundStyle(editor.activeScene == i ? Palette.accent : .secondary)
                            .frame(width: 20)
                            .accessibilityHidden(true)
                        if renaming == i {
                            TextField("Name", text: $draft)
                                .onSubmit {
                                    editor.renameScene(i, to: draft)
                                    renaming = nil
                                }
                                .onExitCommand { renaming = nil }
                        } else {
                            Text(scene.name)
                        }
                        Spacer()
                        if !scene.hiddenTags.isEmpty {
                            Image(systemName: "eye.slash")
                                .foregroundStyle(.secondary)
                                .help("Hides \(scene.hiddenTags.joined(separator: ", "))")
                        }
                    }
                    .contentShape(.rect)
                    .onTapGesture { editor.goToScene(i) }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { editor.goToScene(i) }
                    .contextMenu {
                        Button("Go to Scene") { editor.goToScene(i) }
                        Button("Update to Current View") { editor.updateScene(i) }
                        Button("Rename") {
                            draft = scene.name
                            renaming = i
                        }
                        Divider()
                        Button("Delete Scene", role: .destructive) { editor.deleteScene(i) }
                    }
                }
                .onMove { editor.moveScenes(from: $0, to: $1) }
            } header: {
                HStack {
                    Text("Scenes")
                    Spacer()
                    Button { editor.addScene() } label: { Label("Add Scene", systemImage: "plus") }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .help("Save the current view as a scene (⌃⌘N)")
                }
            }
        }
        .overlay {
            if scenes.isEmpty {
                ContentUnavailableView {
                    Label("No Scenes", systemImage: "camera")
                } description: {
                    Text("A scene saves the camera and which tags are hidden.")
                } actions: {
                    Button("Add Scene") { editor.addScene() }
                }
            }
        }
    }
}

extension Color {
    /// "#c8a26b" -> Color.
    init?(hex: String?) {
        guard let v = Palette3D.rgba(hex: hex) else { return nil }
        self.init(red: Double(v.x), green: Double(v.y), blue: Double(v.z))
    }
}
