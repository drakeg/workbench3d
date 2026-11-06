import Foundation

/// An undirected edge between two vertex ids (smaller id first).
public struct EdgeKey: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let a: Int
    public let b: Int
    public init(_ x: Int, _ y: Int) {
        a = min(x, y)
        b = max(x, y)
    }
    public static func < (l: EdgeKey, r: EdgeKey) -> Bool { (l.a, l.b) < (r.a, r.b) }
    public var description: String { "\(a):\(b)" }
}

/// A planar face: one outer loop and zero or more hole loops, each a list of vertex ids.
/// The outer loop winds counter-clockwise around the face normal, holes the other way.
public struct Face: Equatable, Sendable {
    public var id: Int
    public var outer: [Int]
    public var holes: [[Int]]
    public var color: String?

    public var loops: [[Int]] { [outer] + holes }
    public var vertexIds: [Int] { outer + holes.flatMap { $0 } }
}

private func loopEdges(_ loop: [Int]) -> [(Int, Int)] {
    loop.indices.map { (loop[$0], loop[($0 + 1) % loop.count]) }
}

private func walk(_ loop: [Int], from: Int, to: Int) -> [Int] {
    var out: [Int] = []
    var i = from
    while true {
        out.append(loop[i])
        if i == to { break }
        i = (i + 1) % loop.count
    }
    return out
}

private func minDistToLoop(_ p: V2, _ loop: [V2]) -> Double {
    var d = Double.infinity
    for i in loop.indices { d = min(d, distancePointSegment(p, loop[i], loop[(i + 1) % loop.count])) }
    return d
}

/// The editable geometry of one context (the model root or the inside of a group).
/// Geometry is "sticky": faces sharing vertices and edges are connected, so moving an edge
/// stretches every face that uses it. Groups keep parts apart.
/// This is a line-for-line port of `src/core/mesh.ts`; keep the two in step.
public final class Mesh {
    public var verts: [Int: V3] = [:]
    public var faces: [Int: Face] = [:]
    /// Edges that are not (yet) part of any face.
    public var lines: Set<EdgeKey> = []
    public var nextId = 1

    public init() {}

    // MARK: queries

    public func v(_ id: Int) -> V3 { verts[id] ?? .zero }
    public func loopPoints(_ loop: [Int]) -> [V3] { loop.map { v($0) } }

    /// Faces in creation order (ids only ever grow), so results are deterministic.
    public var orderedFaces: [Face] { faces.values.sorted { $0.id < $1.id } }

    public func normal(_ f: Face) -> V3 { polygonNormal(loopPoints(f.outer)) }

    public func area(_ f: Face) -> Double {
        var a = polygonArea(loopPoints(f.outer))
        for h in f.holes { a -= polygonArea(loopPoints(h)) }
        return a
    }

    public func faceEdgeKeys(_ f: Face) -> [EdgeKey] {
        f.loops.flatMap { loopEdges($0).map { EdgeKey($0.0, $0.1) } }
    }

    /// Every edge (face edges and loose lines), in a stable order.
    public func allEdges() -> [EdgeKey] {
        var seen = Set<EdgeKey>()
        var out: [EdgeKey] = []
        for f in orderedFaces { for k in faceEdgeKeys(f) where seen.insert(k).inserted { out.append(k) } }
        for k in lines.sorted() where seen.insert(k).inserted { out.append(k) }
        return out
    }

    public func facesUsingEdge(_ key: EdgeKey) -> [Face] { orderedFaces.filter { faceEdgeKeys($0).contains(key) } }
    public func facesUsingVertex(_ id: Int) -> [Face] { orderedFaces.filter { $0.vertexIds.contains(id) } }

    public func edgeUsed(_ key: EdgeKey) -> Bool {
        lines.contains(key) || faces.values.contains { faceEdgeKeys($0).contains(key) }
    }

    public func frame(_ f: Face) -> (n: V3, u: V3, v: V3, origin: V3) {
        let n = normal(f)
        let b = planeBasis(n)
        return (n, b.u, b.v, v(f.outer[0]))
    }

    /// True if p (on the face plane) is strictly inside the face and outside its holes.
    public func pointInFace(_ f: Face, _ p: V3, margin: Double = TOL) -> Bool {
        let (n, u, vv, o) = frame(f)
        if abs((p - o).dot(n)) > TOL * 10 { return false }
        let p2 = to2D([p], origin: o, u: u, v: vv)[0]
        let outer2 = to2D(loopPoints(f.outer), origin: o, u: u, v: vv)
        if !pointInPolygon(p2, outer2) || minDistToLoop(p2, outer2) < margin { return false }
        for h in f.holes {
            let h2 = to2D(loopPoints(h), origin: o, u: u, v: vv)
            if pointInPolygon(p2, h2) || minDistToLoop(p2, h2) < margin { return false }
        }
        return true
    }

    public func isCoplanar(_ f: Face, _ pts: [V3]) -> Bool {
        let n = normal(f), o = v(f.outer[0])
        return pts.allSatisfy { abs(($0 - o).dot(n)) < TOL * 10 }
    }

    // MARK: creation

    @discardableResult
    public func newVertex(_ p: V3) -> Int {
        let id = nextId
        nextId += 1
        verts[id] = p
        return id
    }

    public func findVertex(_ p: V3, tol: Double = TOL) -> Int? {
        for (id, q) in verts.sorted(by: { $0.key < $1.key }) where q.distance(to: p) < tol { return id }
        return nil
    }

    /// Insert vertex `nv` into every loop and line that uses edge a-b.
    public func splitEdge(_ a: Int, _ b: Int, _ nv: Int) {
        for (fid, var f) in faces {
            var changed = false
            var loops = f.loops
            for li in loops.indices {
                let loop = loops[li]
                for i in loop.indices {
                    let x = loop[i], y = loop[(i + 1) % loop.count]
                    if (x == a && y == b) || (x == b && y == a) {
                        loops[li].insert(nv, at: i + 1)
                        changed = true
                        break
                    }
                }
            }
            if changed {
                f.outer = loops[0]
                f.holes = Array(loops.dropFirst())
                faces[fid] = f
            }
        }
        if lines.remove(EdgeKey(a, b)) != nil {
            lines.insert(EdgeKey(a, nv))
            lines.insert(EdgeKey(nv, b))
        }
    }

    /// A vertex at p: reuse one there, or split an edge passing through p, or make a new one.
    public func vertexAt(_ p: V3) -> Int {
        if let id = findVertex(p) { return id }
        for k in allEdges() {
            let (point, t) = closestPointOnSegment(p, v(k.a), v(k.b))
            if t > 0, t < 1, point.distance(to: p) < TOL {
                let id = newVertex(p)
                splitEdge(k.a, k.b, id)
                return id
            }
        }
        return newVertex(p)
    }

    /// Create a face from loops, normalizing hole winding. Loose lines on its edges are absorbed.
    @discardableResult
    public func addFace(_ outer: [Int], holes: [[Int]] = [], color: String? = nil) -> Int {
        let n = polygonNormal(loopPoints(outer))
        let fixed = holes.map { h in polygonNormal(loopPoints(h)).dot(n) > 0 ? Array(h.reversed()) : h }
        let id = nextId
        nextId += 1
        let f = Face(id: id, outer: outer, holes: fixed, color: color)
        faces[id] = f
        for k in faceEdgeKeys(f) { lines.remove(k) }
        return id
    }

    public func reverseFace(_ id: Int) {
        guard var f = faces[id] else { return }
        f.outer.reverse()
        f.holes = f.holes.map { $0.reversed() }
        faces[id] = f
    }

    /// Draw a closed polygon (rectangle, circle...). Strictly inside a coplanar face it becomes a
    /// hole in that face plus an inner face (ready to push/pull into a pocket or boss). Otherwise its
    /// edges are added as lines, which may split faces or close new ones. Returns the new face id.
    @discardableResult
    public func addPolygon(_ points: [V3]) -> Int? {
        if points.count < 3 || polygonArea(points) < TOL * TOL { return nil }
        if let host = findHostFace(points) {
            let hostN = normal(host)
            let ids = points.map { newVertex($0) }
            let loop = polygonNormal(points).dot(hostN) > 0 ? ids : Array(ids.reversed())
            var h = faces[host.id]!
            h.holes.append(Array(loop.reversed()))
            faces[host.id] = h
            return addFace(loop, color: host.color)
        }
        let ids = points.map { vertexAt($0) }
        let before = Set(faces.keys)
        for i in ids.indices { addLine(ids[i], ids[(i + 1) % ids.count]) }
        let idSet = Set(ids)
        for f in orderedFaces where !before.contains(f.id) && f.outer.count == ids.count && f.outer.allSatisfy({ idSet.contains($0) }) {
            return orientGround(f.id)
        }
        if loopEdges(ids).allSatisfy({ lines.contains(EdgeKey($0.0, $0.1)) }) { return orientGround(addFace(ids)) }
        return nil
    }

    /// Faces on the ground (z = 0) point down, so pulling them up builds outward faces.
    private func orientGround(_ id: Int) -> Int {
        guard let f = faces[id] else { return id }
        let onGround = loopPoints(f.outer).allSatisfy { abs($0.z) < TOL }
        if onGround, normal(f).z > 0.999 { reverseFace(id) }
        return id
    }

    public func findHostFace(_ points: [V3]) -> Face? {
        for f in orderedFaces where isCoplanar(f, points) && points.allSatisfy({ pointInFace(f, $0) }) {
            let midsInside = points.indices.allSatisfy { i in
                pointInFace(f, (points[i] + points[(i + 1) % points.count]) / 2)
            }
            if midsInside { return f }
        }
        return nil
    }

    /// Add an edge. A line cutting across a face splits it; a line closing a planar loop makes a face.
    public func addLine(_ a: Int, _ b: Int) {
        if a == b { return }
        let key = EdgeKey(a, b)
        if edgeUsed(key) { return }
        lines.insert(key)
        if trySplitWithChain(a, b) { return }
        _ = tryCloseLoop(a, b)
    }

    private func onFaceBoundary(_ id: Int) -> Bool { faces.values.contains { $0.vertexIds.contains(id) } }

    private func looseNeighbors(_ id: Int) -> [Int] {
        lines.sorted().compactMap { k in k.a == id ? k.b : k.b == id ? k.a : nil }
    }

    /// A chain of loose lines from one boundary vertex of a face to another splits the face.
    private func trySplitWithChain(_ a: Int, _ b: Int) -> Bool {
        var chain = [a, b]
        func extend(atEnd: Bool) {
            for _ in 0..<10000 {
                let end = atEnd ? chain[chain.count - 1] : chain[0]
                let prev = atEnd ? chain[chain.count - 2] : chain[1]
                if onFaceBoundary(end) { return }
                let nb = looseNeighbors(end).filter { $0 != prev }
                if nb.count != 1 || chain.contains(nb[0]) { return }
                if atEnd { chain.append(nb[0]) } else { chain.insert(nb[0], at: 0) }
            }
        }
        extend(atEnd: true)
        extend(atEnd: false)
        let s = chain[0], e = chain[chain.count - 1]
        if s == e { return false }
        let pts = loopPoints(chain)
        for f in orderedFaces {
            guard let i = f.outer.firstIndex(of: s), let j = f.outer.firstIndex(of: e) else { continue }
            if !isCoplanar(f, pts) { continue }
            var inside = true
            for k in 0..<(chain.count - 1) where inside {
                if !pointInFace(f, (pts[k] + pts[k + 1]) / 2) { inside = false }
            }
            if inside, chain.count > 2 {
                for k in 1..<(chain.count - 1) where !pointInFace(f, pts[k]) { inside = false }
            }
            if !inside { continue }
            let interior = Array(chain[1..<(chain.count - 1)])
            let loopA = walk(f.outer, from: i, to: j) + interior.reversed()
            let loopB = walk(f.outer, from: j, to: i) + interior
            faces[f.id] = nil
            let fa = addFace(loopA, color: f.color)
            let fb = addFace(loopB, color: f.color)
            for h in f.holes {
                let target = pointInFaceLoose(faces[fa]!, v(h[0])) ? fa : fb
                faces[target]!.holes.append(h)
            }
            for k in 0..<(chain.count - 1) { lines.remove(EdgeKey(chain[k], chain[k + 1])) }
            return true
        }
        return false
    }

    private func pointInFaceLoose(_ f: Face, _ p: V3) -> Bool {
        let (_, u, vv, o) = frame(f)
        return pointInPolygon(to2D([p], origin: o, u: u, v: vv)[0], to2D(loopPoints(f.outer), origin: o, u: u, v: vv))
    }

    /// After adding edge a-b, look for the shortest planar loop through it and make a face.
    private func tryCloseLoop(_ a: Int, _ b: Int) -> Int? {
        let skip = EdgeKey(a, b)
        var adj: [Int: [Int]] = [:]
        for k in allEdges() where k != skip {
            adj[k.a, default: []].append(k.b)
            adj[k.b, default: []].append(k.a)
        }
        var prev: [Int: Int] = [b: -1]
        var queue = [b]
        var head = 0
        while head < queue.count {
            let cur = queue[head]
            head += 1
            if cur == a { break }
            for nx in adj[cur] ?? [] where prev[nx] == nil {
                prev[nx] = cur
                queue.append(nx)
            }
        }
        guard prev[a] != nil else { return nil }
        var path: [Int] = []
        var c = a
        while c != -1 {
            path.append(c)
            c = prev[c]!
        }
        if path.count < 3 { return nil }
        let pts = loopPoints(path)
        if polygonArea(pts) < TOL * TOL { return nil }
        let n = polygonNormal(pts), o = pts[0]
        if !pts.allSatisfy({ abs(($0 - o).dot(n)) < TOL * 10 }) { return nil }
        let set = Set(path)
        if faces.values.contains(where: { $0.outer.count == path.count && $0.outer.allSatisfy { set.contains($0) } }) { return nil }
        let centroid = pts.reduce(V3.zero, +) / Double(pts.count)
        if faces.values.contains(where: { isCoplanar($0, [centroid]) && pointInFace($0, centroid, margin: 0) }) { return nil }
        return orientGround(addFace(path))
    }

    // MARK: deletion

    /// Remove a face. Its edges stay behind as lines unless dropEdges is set.
    public func removeFace(_ id: Int, dropEdges: Bool = false) {
        guard let f = faces.removeValue(forKey: id) else { return }
        if !dropEdges { for k in faceEdgeKeys(f) where !edgeUsed(k) { lines.insert(k) } }
    }

    /// Erase an edge; faces using it are removed too (their other edges remain).
    public func eraseEdge(_ key: EdgeKey) {
        for f in facesUsingEdge(key) { removeFace(f.id) }
        lines.remove(key)
    }

    /// Remove vertices nothing references.
    public func cleanup() {
        var used = Set<Int>()
        for f in faces.values { used.formUnion(f.vertexIds) }
        for k in lines {
            used.insert(k.a)
            used.insert(k.b)
        }
        for id in Array(verts.keys) where !used.contains(id) { verts[id] = nil }
    }

    // MARK: transforms

    public func verticesOf(faces faceIds: some Sequence<Int>, edges: some Sequence<EdgeKey>) -> Set<Int> {
        var s = Set<Int>()
        for id in faceIds { if let f = faces[id] { s.formUnion(f.vertexIds) } }
        for k in edges {
            s.insert(k.a)
            s.insert(k.b)
        }
        return s
    }

    public func apply(_ m: Mat4, to ids: some Sequence<Int>) {
        for id in ids { if let p = verts[id] { verts[id] = m.transformPoint(p) } }
    }

    public func translate(_ ids: some Sequence<Int>, by d: V3) {
        for id in ids { if let p = verts[id] { verts[id] = p + d } }
    }

    // MARK: push/pull

    /// Push/pull a face by d along its normal (see mesh.ts for the rules). Returns the face at the new position.
    @discardableResult
    public func pushPull(_ faceId: Int, _ d: Double) -> Int {
        guard let face = faces[faceId], abs(d) > 1e-9 else { return faceId }
        let n = normal(face)
        let offset = n * d
        let own = Set(faceEdgeKeys(face))
        let others = orderedFaces.filter { $0.id != faceId }
        let shared = others.contains { faceEdgeKeys($0).contains { own.contains($0) } }

        if shared {
            let ids = Set(face.vertexIds)
            let neighbours = others.filter { $0.vertexIds.contains { ids.contains($0) } }
            if neighbours.allSatisfy({ abs(normal($0).dot(n)) < 1e-6 }) {
                translate(ids, by: offset)
                return faceId
            }
        }

        var map: [Int: Int] = [:]
        for id in face.vertexIds { map[id] = newVertex(v(id) + offset) }
        let reverseSides = !shared && d < 0
        var touched: [Int] = []
        for loop in face.loops {
            for (a, b) in loopEdges(loop) {
                let key = EdgeKey(a, b)
                // a neighbour in the plane the new side would occupy is reshaped instead (rabbets)
                if let nb = others.first(where: { f in !touched.contains(f.id) && abs(normal(faces[f.id] ?? f).dot(n)) < 1e-6 && faceEdgeKeys(faces[f.id] ?? f).contains(key) }) {
                    spliceEdge(nb.id, a, b, map[a]!, map[b]!)
                    touched.append(nb.id)
                    continue
                }
                let quad = [a, b, map[b]!, map[a]!]
                addFace(reverseSides ? quad.reversed() : quad, color: face.color)
            }
        }
        for id in touched { removeSpikes(id) }
        let top = addFace(face.outer.map { map[$0]! }, holes: face.holes.map { $0.map { map[$0]! } }, color: face.color)
        if !shared && d < 0 { reverseFace(top) }
        if shared { faces[faceId] = nil } else if d > 0 { reverseFace(faceId) }
        for k in Array(lines) where !facesUsingEdge(k).isEmpty { lines.remove(k) }
        cleanup()
        return top
    }

    /// Replace edge a-b in a face's loop with the detour a -> a2 -> b2 -> b.
    private func spliceEdge(_ fid: Int, _ a: Int, _ b: Int, _ a2: Int, _ b2: Int) {
        guard var f = faces[fid] else { return }
        var loops = f.loops
        outer: for li in loops.indices {
            let loop = loops[li]
            for i in loop.indices {
                let x = loop[i], y = loop[(i + 1) % loop.count]
                if x == a && y == b {
                    loops[li].insert(contentsOf: [a2, b2], at: i + 1)
                    break outer
                }
                if x == b && y == a {
                    loops[li].insert(contentsOf: [b2, a2], at: i + 1)
                    break outer
                }
            }
        }
        f.outer = loops[0]
        f.holes = Array(loops.dropFirst())
        faces[fid] = f
    }

    /// Remove vertices where a loop doubles straight back on itself.
    private func removeSpikes(_ fid: Int) {
        guard var f = faces[fid] else { return }
        var loops = f.loops
        for li in loops.indices {
            var changed = true
            while changed && loops[li].count > 3 {
                changed = false
                let loop = loops[li]
                for i in loop.indices {
                    let p = v(loop[(i - 1 + loop.count) % loop.count]), c = v(loop[i]), q = v(loop[(i + 1) % loop.count])
                    let d1 = c - p, d2 = q - c
                    if d1.lengthSquared < TOL * TOL || (d1.cross(d2).length < TOL * d1.length && d1.dot(d2) < 0) {
                        loops[li].remove(at: i)
                        changed = true
                        break
                    }
                }
            }
        }
        f.outer = loops[0]
        f.holes = Array(loops.dropFirst())
        faces[fid] = f
    }

    // MARK: offset

    /// Offset a face's outline by d (positive = inward). Inward: hole + inner face. Outward: a ring.
    @discardableResult
    public func offsetFace(_ faceId: Int, _ d: Double) -> Int? {
        guard let face = faces[faceId], abs(d) > 1e-9 else { return nil }
        guard let pts = offsetLoop(loopPoints(face.outer), normal(face), d) else { return nil }
        if d > 0 { return addPolygon(pts) }
        let ids = pts.map { newVertex($0) }
        return addFace(ids, holes: [face.outer.reversed()], color: face.color)
    }

    // MARK: copy / split / merge

    /// Copy faces and lines into a new mesh (same coordinates).
    public func extract(faces faceIds: some Sequence<Int>, edges: some Sequence<EdgeKey>) -> Mesh {
        let out = Mesh()
        var map: [Int: Int] = [:]
        func mv(_ id: Int) -> Int {
            if let m = map[id] { return m }
            let m = out.newVertex(v(id))
            map[id] = m
            return m
        }
        for fid in faceIds.sorted() {
            guard let f = faces[fid] else { continue }
            out.addFace(f.outer.map(mv), holes: f.holes.map { $0.map(mv) }, color: f.color)
        }
        for k in edges.sorted() {
            let key = EdgeKey(mv(k.a), mv(k.b))
            if !out.edgeUsed(key) { out.lines.insert(key) }
        }
        return out
    }

    /// Remove faces and loose lines (used after extract when grouping).
    public func removeEntities(faces faceIds: some Sequence<Int>, edges: some Sequence<EdgeKey>) {
        for id in faceIds { faces[id] = nil }
        for k in edges where facesUsingEdge(k).isEmpty { lines.remove(k) }
        cleanup()
    }

    /// Erase a selection: faces go, selected edges take their faces with them.
    public func erase(faces faceIds: some Sequence<Int>, edges: some Sequence<EdgeKey>) {
        for id in faceIds { removeFace(id) }
        for k in edges { eraseEdge(k) }
        cleanup()
    }

    /// Merge another mesh into this one, transformed by m. Coincident vertices are welded.
    @discardableResult
    public func merge(_ other: Mesh, transform m: Mat4? = nil) -> (faces: [Int], lines: [EdgeKey]) {
        var map: [Int: Int] = [:]
        for (id, p) in other.verts.sorted(by: { $0.key < $1.key }) {
            let q = m?.transformPoint(p) ?? p
            map[id] = findVertex(q) ?? newVertex(q)
        }
        var newFaces: [Int] = []
        for f in other.orderedFaces {
            newFaces.append(addFace(f.outer.map { map[$0]! }, holes: f.holes.map { $0.map { map[$0]! } }, color: f.color))
        }
        var newLines: [EdgeKey] = []
        for k in other.lines.sorted() {
            let key = EdgeKey(map[k.a]!, map[k.b]!)
            if !edgeUsed(key) {
                lines.insert(key)
                newLines.append(key)
            }
        }
        if let m, m.determinant < 0 { for id in newFaces { reverseFace(id) } }
        return (newFaces, newLines)
    }

    /// Triangles for a face as vertex-id triples, wound to match the face normal.
    public func triangulate(_ f: Face) -> [(Int, Int, Int)] {
        let (n, u, vv, o) = frame(f)
        let ids = f.vertexIds
        let outer2 = to2D(loopPoints(f.outer), origin: o, u: u, v: vv)
        let holes2 = f.holes.map { to2D(loopPoints($0), origin: o, u: u, v: vv) }
        return Earcut.triangulate(outer: outer2, holes: holes2).map { t in
            let a = ids[t[0]], b = ids[t[1]], c = ids[t[2]]
            let tn = (v(b) - v(a)).cross(v(c) - v(a))
            return tn.dot(n) >= 0 ? (a, b, c) : (a, c, b)
        }
    }

    public func bounds(_ m: Mat4? = nil) -> Box3 {
        var b = Box3()
        for p in verts.values { b.expand(m?.transformPoint(p) ?? p) }
        return b
    }

    public var isEmpty: Bool { faces.isEmpty && lines.isEmpty }

    public func copy() -> Mesh { Mesh(json: json) }
}

/// Offset a planar loop (counter-clockwise around n) by d: positive moves every edge inward.
/// Returns nil if the result folds over itself.
public func offsetLoop(_ pts: [V3], _ n: V3, _ d: Double) -> [V3]? {
    let N = pts.count
    var clean: [V3] = []
    for i in 0..<N {
        let p = pts[(i - 1 + N) % N], c = pts[i], q = pts[(i + 1) % N]
        if (c - p).cross(q - c).length > 1e-9 * max(1, c.distance(to: p) * q.distance(to: c)) { clean.append(c) }
    }
    if clean.count < 3 { return nil }
    let M = clean.count
    let lines: [(p: V3, dir: V3)] = (0..<M).map { i in
        let a = clean[i], b = clean[(i + 1) % M]
        let dir = (b - a).normalized
        let inward = n.cross(dir).normalized
        return (a + inward * d, dir)
    }
    var out: [V3] = []
    for i in 0..<M {
        let l1 = lines[(i - 1 + M) % M], l2 = lines[i]
        let w = l2.p - l1.p
        let cross = l1.dir.cross(l2.dir)
        let den = cross.lengthSquared
        if den < 1e-12 {
            out.append(l2.p)
            continue
        }
        let t = w.cross(l2.dir).dot(cross) / den
        out.append(l1.p + l1.dir * t)
    }
    for i in 0..<M where (out[(i + 1) % M] - out[i]).dot(lines[i].dir) <= 1e-9 { return nil }
    return out
}
