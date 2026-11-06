// Polygon triangulation with holes: a Swift port of mapbox/earcut
// (https://github.com/mapbox/earcut, ISC License, Copyright (c) 2016 Mapbox).
// The web app triangulates with the same algorithm (three.js ShapeUtils uses earcut).

private final class Node {
    let i: Int
    let x: Double
    let y: Double
    var prev: Node!
    var next: Node!
    var steiner = false
    init(_ i: Int, _ x: Double, _ y: Double) {
        self.i = i
        self.x = x
        self.y = y
    }
}

public enum Earcut {
    /// Triangulate `outer` with `holes` (2D). Returns index triples into outer + holes flattened.
    public static func triangulate(outer: [V2], holes: [[V2]]) -> [[Int]] {
        let t = Triangulator()
        defer { t.releaseNodes() }
        return t.triangulate(outer: outer, holes: holes)
    }
}

/// One triangulation run. Keeps every node so the linked rings can be broken afterwards
/// (the prev/next references form cycles).
private final class Triangulator {
    private var nodes: [Node] = []

    func releaseNodes() {
        for n in nodes {
            n.prev = nil
            n.next = nil
        }
        nodes.removeAll()
    }

    func triangulate(outer: [V2], holes: [[V2]]) -> [[Int]] {
        var data: [Double] = []
        var holeIndices: [Int] = []
        for p in outer { data += [p.x, p.y] }
        for h in holes {
            holeIndices.append(data.count / 2)
            for p in h { data += [p.x, p.y] }
        }
        let flat = earcut(data, holeIndices)
        var out: [[Int]] = []
        var k = 0
        while k + 2 < flat.count {
            out.append([flat[k], flat[k + 1], flat[k + 2]])
            k += 3
        }
        return out
    }

    func earcut(_ data: [Double], _ holeIndices: [Int]) -> [Int] {
        let hasHoles = !holeIndices.isEmpty
        let outerLen = hasHoles ? holeIndices[0] * 2 : data.count
        guard var outerNode = linkedList(data, 0, outerLen, true) else { return [] }
        if outerNode.next === outerNode.prev { return [] }
        var triangles: [Int] = []
        if hasHoles { outerNode = eliminateHoles(data, holeIndices, outerNode) }
        earcutLinked(outerNode, &triangles, 0)
        return triangles
    }

    private func linkedList(_ data: [Double], _ start: Int, _ end: Int, _ clockwise: Bool) -> Node? {
        var last: Node?
        if clockwise == (signedArea(data, start, end) > 0) {
            var i = start
            while i < end {
                last = insertNode(i / 2, data[i], data[i + 1], last)
                i += 2
            }
        } else {
            var i = end - 2
            while i >= start {
                last = insertNode(i / 2, data[i], data[i + 1], last)
                i -= 2
            }
        }
        if let l = last, equals(l, l.next) {
            removeNode(l)
            last = l.next
        }
        return last
    }

    private func filterPoints(_ start: Node, _ endIn: Node? = nil) -> Node {
        var end: Node = endIn ?? start
        var p = start
        var again: Bool
        repeat {
            again = false
            if !p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) == 0) {
                removeNode(p)
                p = p.prev
                end = p.prev
                if p === p.next { break }
                again = true
            } else {
                p = p.next
            }
        } while again || p !== end
        return end
    }

    private func earcutLinked(_ earIn: Node?, _ triangles: inout [Int], _ pass: Int) {
        guard var ear = earIn else { return }
        var stop = ear
        while ear.prev !== ear.next {
            let prev = ear.prev!
            let next = ear.next!
            if isEar(ear) {
                triangles += [prev.i, ear.i, next.i]
                removeNode(ear)
                ear = next.next
                stop = next.next
                continue
            }
            ear = next
            if ear === stop {
                if pass == 0 {
                    earcutLinked(filterPoints(ear), &triangles, 1)
                } else if pass == 1 {
                    let cured = cureLocalIntersections(filterPoints(ear), &triangles)
                    earcutLinked(cured, &triangles, 2)
                } else if pass == 2 {
                    splitEarcut(ear, &triangles)
                }
                break
            }
        }
    }

    private func isEar(_ ear: Node) -> Bool {
        let a = ear.prev!, b = ear, c = ear.next!
        if area(a, b, c) >= 0 { return false }
        var p = c.next!
        while p !== a {
            if pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0 { return false }
            p = p.next
        }
        return true
    }

    private func cureLocalIntersections(_ startIn: Node, _ triangles: inout [Int]) -> Node {
        var start = startIn
        var p = start
        repeat {
            let a = p.prev!, b = p.next.next!
            if !equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a) {
                triangles += [a.i, p.i, b.i]
                removeNode(p)
                removeNode(p.next)
                p = b
                start = b
            }
            p = p.next
        } while p !== start
        return filterPoints(p)
    }

    private func splitEarcut(_ start: Node, _ triangles: inout [Int]) {
        var a = start
        repeat {
            var b = a.next.next!
            while b !== a.prev {
                if a.i != b.i && isValidDiagonal(a, b) {
                    var c = splitPolygon(a, b)
                    let fa = filterPoints(a, a.next)
                    c = filterPoints(c, c.next)
                    earcutLinked(fa, &triangles, 0)
                    earcutLinked(c, &triangles, 0)
                    return
                }
                b = b.next
            }
            a = a.next
        } while a !== start
    }

    private func eliminateHoles(_ data: [Double], _ holeIndices: [Int], _ outerIn: Node) -> Node {
        var queue: [Node] = []
        for (k, startIdx) in holeIndices.enumerated() {
            let start = startIdx * 2
            let end = k < holeIndices.count - 1 ? holeIndices[k + 1] * 2 : data.count
            if let list = linkedList(data, start, end, false) {
                if list === list.next { list.steiner = true }
                queue.append(getLeftmost(list))
            }
        }
        queue.sort { a, b in a.x != b.x ? a.x < b.x : a.y < b.y }
        var outer = outerIn
        for hole in queue { outer = eliminateHole(hole, outer) }
        return outer
    }

    private func eliminateHole(_ hole: Node, _ outer: Node) -> Node {
        guard let bridge = findHoleBridge(hole, outer) else { return outer }
        let bridgeReverse = splitPolygon(bridge, hole)
        _ = filterPoints(bridgeReverse, bridgeReverse.next)
        return filterPoints(bridge, bridge.next)
    }

    private func findHoleBridge(_ hole: Node, _ outer: Node) -> Node? {
        var p = outer
        let hx = hole.x, hy = hole.y
        var qx = -Double.infinity
        var m: Node?
        if equals(hole, p) { return p }
        repeat {
            if equals(hole, p.next) { return p.next }
            if hy <= p.y && hy >= p.next.y && p.next.y != p.y {
                let x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y)
                if x <= hx && x > qx {
                    qx = x
                    m = p.x < p.next.x ? p : p.next
                    if x == hx { return m }
                }
            }
            p = p.next
        } while p !== outer
        guard var mNode = m else { return nil }
        let stop = mNode
        let mx = mNode.x, my = mNode.y
        var tanMin = Double.infinity
        p = mNode
        repeat {
            if hx >= p.x && p.x >= mx && hx != p.x &&
                pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y) {
                let tan = abs(hy - p.y) / (hx - p.x)
                if locallyInside(p, hole) && (tan < tanMin || (tan == tanMin && (p.x > mNode.x || (p.x == mNode.x && sectorContainsSector(mNode, p))))) {
                    mNode = p
                    tanMin = tan
                }
            }
            p = p.next
        } while p !== stop
        return mNode
    }

    private func sectorContainsSector(_ m: Node, _ p: Node) -> Bool {
        area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0
    }

    private func getLeftmost(_ start: Node) -> Node {
        var p = start, leftmost = start
        repeat {
            if p.x < leftmost.x || (p.x == leftmost.x && p.y < leftmost.y) { leftmost = p }
            p = p.next
        } while p !== start
        return leftmost
    }

    private func pointInTriangle(_ ax: Double, _ ay: Double, _ bx: Double, _ by: Double, _ cx: Double, _ cy: Double, _ px: Double, _ py: Double) -> Bool {
        (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
            (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
            (bx - px) * (cy - py) >= (cx - px) * (by - py)
    }

    private func isValidDiagonal(_ a: Node, _ b: Node) -> Bool {
        a.next.i != b.i && a.prev.i != b.i && !intersectsPolygon(a, b) &&
            ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
                (area(a.prev, a, b.prev) != 0 || area(a, b.prev, b) != 0)) ||
                (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
    }

    private func area(_ p: Node, _ q: Node, _ r: Node) -> Double {
        (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
    }

    private func equals(_ p1: Node, _ p2: Node) -> Bool { p1.x == p2.x && p1.y == p2.y }

    private func intersects(_ p1: Node, _ q1: Node, _ p2: Node, _ q2: Node) -> Bool {
        let o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2))
        let o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1))
        if o1 != o2 && o3 != o4 { return true }
        if o1 == 0 && onSegment(p1, p2, q1) { return true }
        if o2 == 0 && onSegment(p1, q2, q1) { return true }
        if o3 == 0 && onSegment(p2, p1, q2) { return true }
        if o4 == 0 && onSegment(p2, q1, q2) { return true }
        return false
    }

    private func onSegment(_ p: Node, _ q: Node, _ r: Node) -> Bool {
        q.x <= max(p.x, r.x) && q.x >= min(p.x, r.x) && q.y <= max(p.y, r.y) && q.y >= min(p.y, r.y)
    }

    private func sign(_ v: Double) -> Int { v > 0 ? 1 : v < 0 ? -1 : 0 }

    private func intersectsPolygon(_ a: Node, _ b: Node) -> Bool {
        var p = a
        repeat {
            if p.i != a.i && p.next.i != a.i && p.i != b.i && p.next.i != b.i && intersects(p, p.next, a, b) { return true }
            p = p.next
        } while p !== a
        return false
    }

    private func locallyInside(_ a: Node, _ b: Node) -> Bool {
        area(a.prev, a, a.next) < 0
            ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
            : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0
    }

    private func middleInside(_ a: Node, _ b: Node) -> Bool {
        var p = a
        var inside = false
        let px = (a.x + b.x) / 2, py = (a.y + b.y) / 2
        repeat {
            if (p.y > py) != (p.next.y > py) && p.next.y != p.y && px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x {
                inside.toggle()
            }
            p = p.next
        } while p !== a
        return inside
    }

    private func splitPolygon(_ a: Node, _ b: Node) -> Node {
        let a2 = Node(a.i, a.x, a.y)
        let b2 = Node(b.i, b.x, b.y)
        nodes.append(a2)
        nodes.append(b2)
        let an = a.next!, bp = b.prev!
        a.next = b
        b.prev = a
        a2.next = an
        an.prev = a2
        b2.next = a2
        a2.prev = b2
        bp.next = b2
        b2.prev = bp
        return b2
    }

    private func insertNode(_ i: Int, _ x: Double, _ y: Double, _ last: Node?) -> Node {
        let p = Node(i, x, y)
        nodes.append(p)
        if let last {
            p.next = last.next
            p.prev = last
            last.next.prev = p
            last.next = p
        } else {
            p.prev = p
            p.next = p
        }
        return p
    }

    private func removeNode(_ p: Node) {
        p.next.prev = p.prev
        p.prev.next = p.next
    }

    private func signedArea(_ data: [Double], _ start: Int, _ end: Int) -> Double {
        var sum = 0.0
        var j = end - 2
        var i = start
        while i < end {
            sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1])
            j = i
            i += 2
        }
        return sum
    }
}
