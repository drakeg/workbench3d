import SwiftUI
import UniformTypeIdentifiers
import simd
import Workbench3DKit

nonisolated extension UTType {
    /// Workbench3D model files (.wb3d), JSON shared with the web and Windows versions.
    static let workbench3DModel = UTType(exportedAs: "io.github.drakeg.workbench3d.model", conformingTo: .json)
}

/// One open model. SwiftUI's DocumentGroup gives it New, Open, Open Recent, Save, Duplicate,
/// Rename, Revert, autosave and versions. Edits go through `Editor.perform`, which registers
/// Undo with the window's UndoManager; that is also how SwiftUI knows the document changed.
nonisolated final class ModelDocument: ReferenceFileDocument, @unchecked Sendable {
    static var readableContentTypes: [UTType] { [.workbench3DModel, .json] }
    static var writableContentTypes: [UTType] { [.workbench3DModel] }

    let model: WBDocument
    /// The window's editor (selection, camera, tools). Created by ContentView.
    var editor: Editor?

    init() {
        model = WBDocument()
        model.units = AppSettings.unitsForNewModels
    }

    /// A document around an existing model (snapshots, self-test).
    init(model: WBDocument) {
        self.model = model
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        model = try WBDocument(data: data)
    }

    func snapshot(contentType: UTType) throws -> Data {
        try model.data()
    }

    func fileWrapper(snapshot: Data, configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: snapshot)
    }
}
