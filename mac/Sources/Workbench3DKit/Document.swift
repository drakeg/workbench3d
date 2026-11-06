import Foundation

// MARK: - File format (.wb3d), shared with the web app. See docs/ARCHITECTURE.md.

/// Any JSON value, for add-on attributes.
public enum JSONValue: Codable, Equatable, Sendable, CustomStringConvertible {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }

    public var description: String {
        switch self {
        case .string(let s): s
        case .number(let n): n.rounded() == n ? String(Int(n)) : String(n)
        case .bool(let b): String(b)
        case .array(let a): a.map(\.description).joined(separator: ", ")
        case .object: "{…}"
        case .null: ""
        }
    }
}

struct MeshJSON: Codable {
    var nextId: Int
    var verts: [[Double]]
    var faces: [FaceJSON]
    var lines: [[Int]]
    struct FaceJSON: Codable {
        var id: Int
        var outer: [Int]
        var holes: [[Int]]
        var color: String?
    }
}

public struct GroupJSON: Codable {
    var id: Int
    var name: String
    var matrix: [Double]
    var mesh: MeshJSON
    var children: [GroupJSON]
    var hidden: Bool?
    var tag: String?
    var componentId: Int?
    var attributes: [String: JSONValue]?
}

public typealias V3Array = [Double]

public struct Guide: Codable, Equatable, Sendable {
    public var id: Int
    public var point: V3Array
    public var dir: V3Array?
}

public struct Dimension: Codable, Equatable, Sendable {
    public var id: Int
    public var a: V3Array
    public var b: V3Array
    public var offset: V3Array
}

public struct Tag: Codable, Equatable, Sendable {
    public var name: String
    public var visible: Bool
    public var color: String?
}

public struct Scene: Codable, Equatable, Sendable {
    public struct Camera: Codable, Equatable, Sendable {
        public var position: V3Array
        public var target: V3Array
        public var perspective: Bool
    }
    public var name: String
    public var camera: Camera
    public var hiddenTags: [String]
    public var activeSection: Int?
}

public struct SectionPlane: Codable, Equatable, Sendable {
    public var id: Int
    public var point: V3Array
    public var normal: V3Array
    public var active: Bool
}

public struct ComponentDef: Codable, Equatable, Sendable {
    public var id: Int
    public var name: String
    public var description: String?
}

struct DocumentJSON: Codable {
    var format: String
    var version: Int
    var units: UnitSettings
    var nextGroupId: Int
    var root: GroupJSON
    var guides: [Guide]?
    var dimensions: [Dimension]?
    var tags: [Tag]?
    var scenes: [Scene]?
    var sections: [SectionPlane]?
    var components: [ComponentDef]?
    var nextItemId: Int?
}

func round6(_ x: Double) -> Double { (x * 1e6).rounded() / 1e6 }

extension Mesh {
    var json: MeshJSON {
        MeshJSON(
            nextId: nextId,
            verts: verts.sorted { $0.key < $1.key }.map { [Double($0.key), round6($0.value.x), round6($0.value.y), round6($0.value.z)] },
            faces: orderedFaces.map { .init(id: $0.id, outer: $0.outer, holes: $0.holes, color: $0.color) },
            lines: lines.sorted().map { [$0.a, $0.b] })
    }

    convenience init(json j: MeshJSON) {
        self.init()
        nextId = j.nextId
        for v in j.verts where v.count >= 4 { verts[Int(v[0])] = V3(v[1], v[2], v[3]) }
        for f in j.faces { faces[f.id] = Face(id: f.id, outer: f.outer, holes: f.holes, color: f.color) }
        for l in j.lines where l.count == 2 { lines.insert(EdgeKey(l[0], l[1])) }
    }
}

// MARK: - Groups

/// A separate piece of geometry with its own transform; its edges never stick to anything outside it.
public final class Group: Identifiable {
    public var id: Int
    public var name: String
    public var matrix: Mat4 = .identity
    public var mesh = Mesh()
    public private(set) var children: [Group] = []
    public weak var parent: Group?
    public var hidden = false
    public var tag = ""
    public var componentId: Int?
    public var attributes: [String: JSONValue] = [:]

    public init(id: Int, name: String = "Group") {
        self.id = id
        self.name = name
    }

    /// Local space to world space.
    public var worldMatrix: Mat4 {
        var m = matrix
        var p = parent
        while let g = p {
            m = g.matrix * m
            p = g.parent
        }
        return m
    }

    public func add(_ child: Group) {
        child.parent?.remove(child)
        child.parent = self
        children.append(child)
    }

    public func remove(_ child: Group) {
        children.removeAll { $0 === child }
        if child.parent === self { child.parent = nil }
    }

    public var worldBounds: Box3 {
        var b = mesh.bounds(worldMatrix)
        for c in children { b.union(c.worldBounds) }
        return b
    }

    /// Bounds in the group's own axes (its "board size" however it is rotated).
    public var localBounds: Box3 {
        var b = mesh.bounds()
        for c in children { b.union(c.bounds(in: c.matrix)) }
        return b
    }

    private func bounds(in m: Mat4) -> Box3 {
        var b = mesh.bounds(m)
        for c in children { b.union(c.bounds(in: m * c.matrix)) }
        return b
    }

    /// This group and every descendant, parents first.
    public var all: [Group] { [self] + children.flatMap(\.all) }

    public func isAncestor(of g: Group) -> Bool {
        var p = g.parent
        while let x = p {
            if x === self { return true }
            p = x.parent
        }
        return false
    }

    var json: GroupJSON {
        GroupJSON(id: id, name: name, matrix: matrix.array, mesh: mesh.json, children: children.map(\.json),
                  hidden: hidden ? true : nil, tag: tag.isEmpty ? nil : tag, componentId: componentId,
                  attributes: attributes.isEmpty ? nil : attributes)
    }

    convenience init(json j: GroupJSON) {
        self.init(id: j.id, name: j.name)
        if j.matrix.count == 16 { matrix = Mat4(array: j.matrix) }
        mesh = Mesh(json: j.mesh)
        hidden = j.hidden ?? false
        tag = j.tag ?? ""
        componentId = j.componentId
        attributes = j.attributes ?? [:]
        for c in j.children { add(Group(json: c)) }
    }
}

// MARK: - Document

public enum DocumentError: LocalizedError {
    case notWorkbench3D
    public var errorDescription: String? { "This file isn't a Workbench3D model." }
}

/// The whole model: the root group, units, and model-level data (guides, tags, scenes...).
/// Undo lives in the app (UndoManager); this type is plain data with operations.
public final class WBDocument {
    public var root = Group(id: 0, name: "Model")
    public var units = UnitSettings.default
    public var nextGroupId = 1
    public var guides: [Guide] = []
    public var dimensions: [Dimension] = []
    public var tags: [Tag] = []
    public var scenes: [Scene] = []
    public var sections: [SectionPlane] = []
    public var components: [ComponentDef] = []
    public var nextItemId = 1

    public init() {}

    public func findGroup(_ id: Int) -> Group? { root.all.first { $0.id == id } }

    public func newGroup(_ name: String = "Group") -> Group {
        let g = Group(id: nextGroupId, name: name)
        nextGroupId += 1
        return g
    }

    // MARK: serialization

    public func data(pretty: Bool = false) throws -> Data {
        let j = DocumentJSON(format: "workbench3d", version: 1, units: units, nextGroupId: nextGroupId, root: root.json,
                             guides: guides, dimensions: dimensions, tags: tags, scenes: scenes, sections: sections,
                             components: components, nextItemId: nextItemId)
        let enc = JSONEncoder()
        if pretty { enc.outputFormatting = [.prettyPrinted, .sortedKeys] }
        return try enc.encode(j)
    }

    public convenience init(data: Data) throws {
        self.init()
        try load(data)
    }

    public func load(_ data: Data) throws {
        let j = try JSONDecoder().decode(DocumentJSON.self, from: data)
        guard j.format == "workbench3d" else { throw DocumentError.notWorkbench3D }
        root = Group(json: j.root)
        units = j.units
        nextGroupId = j.nextGroupId
        guides = j.guides ?? []
        dimensions = j.dimensions ?? []
        tags = j.tags ?? []
        scenes = j.scenes ?? []
        sections = j.sections ?? []
        components = j.components ?? []
        nextItemId = j.nextItemId ?? 1
    }

    // MARK: groups

    /// Move selected faces/lines of a context into a new child group.
    @discardableResult
    public func makeGroup(in context: Group, faces: [Int], edges: [EdgeKey], groups: [Group], name: String = "Group") -> Group {
        let g = newGroup(name)
        g.mesh = context.mesh.extract(faces: faces, edges: edges)
        context.mesh.removeEntities(faces: faces, edges: edges)
        for child in groups { g.add(child) }
        context.add(g)
        return g
    }

    /// Dissolve a group into its parent's geometry.
    @discardableResult
    public func explode(_ group: Group) -> (faces: [Int], lines: [EdgeKey], groups: [Group]) {
        guard let parent = group.parent else { return ([], [], []) }
        let r = parent.mesh.merge(group.mesh, transform: group.matrix)
        parent.remove(group)
        var moved: [Group] = []
        for c in group.children {
            c.matrix = group.matrix * c.matrix
            parent.add(c)
            moved.append(c)
        }
        return (r.faces, r.lines, moved)
    }

    /// Deep copy with new ids, added to the same parent.
    @discardableResult
    public func duplicate(_ group: Group) -> Group {
        var j = group.json
        func reId(_ x: inout GroupJSON) {
            x.id = nextGroupId
            nextGroupId += 1
            for i in x.children.indices { reId(&x.children[i]) }
        }
        reId(&j)
        let copy = Group(json: j)
        (group.parent ?? root).add(copy)
        return copy
    }

    /// Keep group transforms rigid: push any scale into the geometry so sizes stay true.
    public func bakeScale(_ g: Group) {
        let s = g.matrix.scalePart
        if abs(s.x - 1) < 1e-9, abs(s.y - 1) < 1e-9, abs(s.z - 1) < 1e-9 { return }
        var rigid = g.matrix.rotationPart
        rigid.columns.3 = g.matrix.columns.3
        var linear = rigid.inverse * g.matrix
        var keep = rigid
        if !(rigid * .scale(s)).isClose(to: g.matrix) {
            keep = .translation(g.matrix.translationPart)
            linear = keep.inverse * g.matrix
        }
        g.mesh.apply(linear, to: Array(g.mesh.verts.keys))
        if linear.determinant < 0 { for id in Array(g.mesh.faces.keys) { g.mesh.reverseFace(id) } }
        for c in g.children {
            c.matrix = linear * c.matrix
            bakeScale(c)
        }
        g.matrix = keep
    }

    // MARK: components

    public func component(_ id: Int?) -> ComponentDef? { id.flatMap { i in components.first { $0.id == i } } }
    public func instances(of componentId: Int) -> [Group] { root.all.filter { $0.componentId == componentId } }

    @discardableResult
    public func makeComponent(in context: Group, faces: [Int], edges: [EdgeKey], groups: [Group], name: String) -> Group {
        let g = makeGroup(in: context, faces: faces, edges: edges, groups: groups, name: name)
        let def = ComponentDef(id: nextItemId, name: name)
        nextItemId += 1
        components.append(def)
        g.componentId = def.id
        return g
    }

    /// Mirror an edited instance into every other instance of the same component.
    public func syncComponent(from source: Group) {
        guard let cid = source.componentId else { return }
        let meshJSON = source.mesh.json
        let kids = source.children.map(\.json)
        for other in instances(of: cid) where other !== source && !other.isAncestor(of: source) && !source.isAncestor(of: other) {
            other.mesh = Mesh(json: meshJSON)
            for c in other.children { other.remove(c) }
            for k in kids {
                var copy = k
                func reId(_ x: inout GroupJSON) {
                    x.id = nextGroupId
                    nextGroupId += 1
                    for i in x.children.indices { reId(&x.children[i]) }
                }
                reId(&copy)
                other.add(Group(json: copy))
            }
        }
    }

    public func makeUnique(_ g: Group) {
        guard let old = component(g.componentId) else { return }
        let def = ComponentDef(id: nextItemId, name: "\(old.name) #\(instances(of: old.id).count)")
        nextItemId += 1
        components.append(def)
        g.componentId = def.id
    }

    public func purgeComponents() {
        let used = Set(root.all.compactMap(\.componentId))
        components.removeAll { !used.contains($0.id) }
    }

    public func isTagVisible(_ tag: String) -> Bool { tag.isEmpty || (tags.first { $0.name == tag }?.visible ?? true) }

    /// Hidden itself, under a hidden parent, or on a hidden tag.
    public func isHidden(_ g: Group) -> Bool {
        var p: Group? = g
        while let x = p {
            if x.hidden || !isTagVisible(x.tag) { return true }
            p = x.parent
        }
        return false
    }

    public var bounds: Box3 {
        var b = Box3()
        for g in root.all where !isHidden(g) { b.union(g.mesh.bounds(g.worldMatrix)) }
        return b
    }
}

// MARK: - Export

public enum Export {
    public struct Triangle {
        public var a, b, c: V3
        public var group: String
    }

    public static func triangles(_ doc: WBDocument) -> [Triangle] {
        var out: [Triangle] = []
        for g in doc.root.all where !doc.isHidden(g) {
            let m = g.worldMatrix
            for f in g.mesh.orderedFaces {
                for (a, b, c) in g.mesh.triangulate(f) {
                    out.append(Triangle(a: m.transformPoint(g.mesh.v(a)), b: m.transformPoint(g.mesh.v(b)), c: m.transformPoint(g.mesh.v(c)), group: g.name))
                }
            }
        }
        return out
    }

    /// Binary STL. Slicers expect millimetres, so that's the default.
    public static func stl(_ doc: WBDocument, millimetres: Bool = true) -> Data {
        let s = millimetres ? mmPerInch : 1
        let tris = triangles(doc)
        var data = Data(count: 80)
        let header = Array("Workbench3D STL export".utf8)
        data.replaceSubrange(0..<header.count, with: header)
        func append<T>(_ v: T) {
            withUnsafeBytes(of: v) { data.append(contentsOf: $0) }
        }
        append(UInt32(tris.count).littleEndian)
        for t in tris {
            let n = (t.b - t.a).cross(t.c - t.a).normalized
            for p in [n, t.a * s, t.b * s, t.c * s] {
                append(Float(p.x).bitPattern.littleEndian)
                append(Float(p.y).bitPattern.littleEndian)
                append(Float(p.z).bitPattern.littleEndian)
            }
            append(UInt16(0))
        }
        return data
    }

    public static func obj(_ doc: WBDocument, millimetres: Bool = false) -> String {
        let s = millimetres ? mmPerInch : 1
        var lines = ["# Workbench3D OBJ export (units: \(millimetres ? "mm" : "in"))"]
        var base = 1
        for g in doc.root.all where !doc.isHidden(g) && !g.mesh.faces.isEmpty {
            let m = g.worldMatrix
            lines.append("o \(g.name.replacingOccurrences(of: " ", with: "_"))_\(g.id)")
            var index: [Int: Int] = [:]
            for (id, p) in g.mesh.verts.sorted(by: { $0.key < $1.key }) {
                let q = m.transformPoint(p) * s
                index[id] = base
                base += 1
                lines.append(String(format: "v %.5f %.5f %.5f", q.x, q.y, q.z))
            }
            for f in g.mesh.orderedFaces {
                for (a, b, c) in g.mesh.triangulate(f) { lines.append("f \(index[a]!) \(index[b]!) \(index[c]!)") }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }
}
