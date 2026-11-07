import AppKit
import Metal
import MetalKit
import simd
import Workbench3DKit

private struct Uniforms {
    var viewProj: simd_float4x4
    var viewport: SIMD4<Float>
    var light: SIMD4<Float>
    var back: SIMD4<Float>
    var params: SIMD4<Float>
}

private struct FaceVertex {
    var pos: SIMD4<Float>
    var normal: SIMD4<Float>
    var color: SIMD4<Float>
}

private struct LineSeg {
    var a: SIMD4<Float>
    var b: SIMD4<Float>
    var color: SIMD4<Float>
    var params: SIMD4<Float>
}

private func f4(_ v: V3, _ w: Float = 1) -> SIMD4<Float> { SIMD4(Float(v.x), Float(v.y), Float(v.z), w) }

/// Draws the model with Metal: faces (lit, back faces blue-grey), edges as screen-space lines,
/// grid and axes, selection and hover highlights, guides, and tool previews.
/// Geometry buffers are rebuilt only when the editor's version changes.
final class Renderer: NSObject, MTKViewDelegate {
    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let facePipeline: MTLRenderPipelineState
    private let blendFacePipeline: MTLRenderPipelineState
    private let flatPipeline: MTLRenderPipelineState
    private let linePipeline: MTLRenderPipelineState
    private let depthWrite: MTLDepthStencilState
    private let depthRead: MTLDepthStencilState
    private let depthOff: MTLDepthStencilState
    weak var editor: Editor?

    private var faceVerts: [FaceVertex] = []
    private var edgeSegs: [LineSeg] = []
    private var builtVersion = -1
    private var builtDark: Bool?
    static let sampleCount = 4

    init?(device: MTLDevice) {
        self.device = device
        guard let q = device.makeCommandQueue(),
              let lib = try? device.makeLibrary(source: shaderSource, options: nil) else { return nil }
        queue = q
        func pipeline(_ v: String, _ f: String, blend: Bool) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = lib.makeFunction(name: v)
            d.fragmentFunction = lib.makeFunction(name: f)
            d.colorAttachments[0].pixelFormat = .bgra8Unorm
            d.depthAttachmentPixelFormat = .depth32Float
            d.rasterSampleCount = Renderer.sampleCount
            if blend {
                let c = d.colorAttachments[0]!
                c.isBlendingEnabled = true
                c.sourceRGBBlendFactor = .sourceAlpha
                c.destinationRGBBlendFactor = .oneMinusSourceAlpha
                c.sourceAlphaBlendFactor = .one
                c.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            }
            return try? device.makeRenderPipelineState(descriptor: d)
        }
        guard let fp = pipeline("face_vertex", "face_fragment", blend: false),
              let bfp = pipeline("face_vertex", "face_fragment", blend: true),
              let flp = pipeline("face_vertex", "flat_fragment", blend: true),
              let lp = pipeline("line_vertex", "line_fragment", blend: true) else { return nil }
        facePipeline = fp
        blendFacePipeline = bfp
        flatPipeline = flp
        linePipeline = lp
        func depth(_ compare: MTLCompareFunction, write: Bool) -> MTLDepthStencilState {
            let d = MTLDepthStencilDescriptor()
            d.depthCompareFunction = compare
            d.isDepthWriteEnabled = write
            return device.makeDepthStencilState(descriptor: d)!
        }
        depthWrite = depth(.lessEqual, write: true)
        depthRead = depth(.lessEqual, write: false)
        depthOff = depth(.always, write: false)
        super.init()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        editor?.camera.size = view.bounds.size
    }

    func draw(in view: MTKView) {
        guard let editor, let pass = view.currentRenderPassDescriptor, let drawable = view.currentDrawable else { return }
        editor.camera.size = view.bounds.size
        let bg = Palette3D.background
        pass.colorAttachments[0].clearColor = MTLClearColor(red: Double(bg.x), green: Double(bg.y), blue: Double(bg.z), alpha: 1)
        guard let cmd = queue.makeCommandBuffer() else { return }
        encode(cmd, pass, editor: editor, drawableSize: view.drawableSize, scale: view.window?.backingScaleFactor ?? 2)
        cmd.present(drawable)
        cmd.commit()
    }

    /// Render into an offscreen texture and return a CGImage (snapshot mode, self-test).
    func image(editor: Editor, size: CGSize, scale: CGFloat = 2) -> CGImage? {
        let w = Int(size.width * scale), h = Int(size.height * scale)
        func tex(_ format: MTLPixelFormat, samples: Int, usage: MTLTextureUsage) -> MTLTexture? {
            let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
            d.textureType = samples > 1 ? .type2DMultisample : .type2D
            d.sampleCount = samples
            d.usage = usage
            d.storageMode = samples > 1 ? .private : .shared
            return device.makeTexture(descriptor: d)
        }
        guard let msaa = tex(.bgra8Unorm, samples: Renderer.sampleCount, usage: .renderTarget),
              let resolve = tex(.bgra8Unorm, samples: 1, usage: [.renderTarget, .shaderRead]),
              let depthTex = tex(.depth32Float, samples: Renderer.sampleCount, usage: .renderTarget),
              let cmd = queue.makeCommandBuffer() else { return nil }
        let pass = MTLRenderPassDescriptor()
        let bg = Palette3D.background
        pass.colorAttachments[0].texture = msaa
        pass.colorAttachments[0].resolveTexture = resolve
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .multisampleResolve
        pass.colorAttachments[0].clearColor = MTLClearColor(red: Double(bg.x), green: Double(bg.y), blue: Double(bg.z), alpha: 1)
        pass.depthAttachment.texture = depthTex
        pass.depthAttachment.clearDepth = 1
        pass.depthAttachment.storeAction = .dontCare
        let saved = editor.camera.size
        editor.camera.size = size
        encode(cmd, pass, editor: editor, drawableSize: CGSize(width: w, height: h), scale: scale)
        editor.camera.size = saved
        cmd.commit()
        cmd.waitUntilCompleted()
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        resolve.getBytes(&bytes, bytesPerRow: w * 4, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        guard let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        return ctx.makeImage()
    }

    // MARK: building geometry

    private func rebuild(_ e: Editor) {
        let doc = e.doc
        let ctx = e.context
        let inCtx = Set(ctx.all.map(\.id))
        let editingInside = ctx !== doc.root
        var faces: [FaceVertex] = []
        var edges: [LineSeg] = []
        let defaultFace = Palette3D.face
        let selColor = Palette3D.selection
        var selectedTrees = Set<Int>()
        for id in e.selection.groups { if let g = ctx.children.first(where: { $0.id == id }) { for d in g.all { selectedTrees.insert(d.id) } } }
        var hoverTree = Set<Int>()
        if let h = e.hoverGroup, let g = ctx.children.first(where: { $0.id == h }) { for d in g.all { hoverTree.insert(d.id) } }

        for g in doc.root.all where !doc.isHidden(g) {
            let m = g.worldMatrix
            let nm = m.normalMatrix
            let dim = editingInside && !inCtx.contains(g.id)
            var world: [Int: V3] = [:]
            for (id, p) in g.mesh.verts { world[id] = m.transformPoint(p) }
            for f in g.mesh.faces.values {
                var color = Palette3D.rgba(hex: f.color) ?? defaultFace
                color.w = dim ? 0.25 : 1
                let n = f4((nm * g.mesh.normal(f)).normalized, 0)
                for (a, b, c) in g.mesh.triangulate(f) {
                    for id in [a, b, c] { faces.append(FaceVertex(pos: f4(world[id]!), normal: n, color: color)) }
                }
            }
            let isCtx = g === ctx
            let highlight = selectedTrees.contains(g.id), hov = hoverTree.contains(g.id)
            for k in g.mesh.allEdges() {
                let selected = (isCtx && e.selection.edges.contains(k)) || highlight
                let color: SIMD4<Float>
                let width: Float
                if selected {
                    color = selColor
                    width = 2.4
                } else if hov {
                    color = Palette3D.hover
                    width = 2
                } else if dim {
                    color = Palette3D.edgeDim
                    width = 1
                } else if g.mesh.lines.contains(k) {
                    color = Palette3D.loose
                    width = 1.4
                } else {
                    color = Palette3D.edge
                    width = 1.4
                }
                edges.append(LineSeg(a: f4(world[k.a]!), b: f4(world[k.b]!), color: color, params: SIMD4(width, 2e-5, 0, 0)))
            }
            if isCtx {
                for fid in e.selection.faces {
                    guard let f = g.mesh.faces[fid] else { continue }
                    for k in g.mesh.faceEdgeKeys(f) {
                        edges.append(LineSeg(a: f4(world[k.a]!), b: f4(world[k.b]!), color: selColor, params: SIMD4(2.4, 3e-5, 0, 0)))
                    }
                }
            }
        }
        // boxes around selected groups and the group being edited
        for id in e.selection.groups { if let g = ctx.children.first(where: { $0.id == id }) { edges += boxLines(g, selColor, 1.2) } }
        if editingInside { edges += boxLines(ctx, Palette3D.muted, 1) }
        // guides
        for gd in doc.guides {
            let p = V3(gd.point[0], gd.point[1], gd.point[2])
            if let d = gd.dir {
                let dir = V3(d[0], d[1], d[2]).normalized * 3000
                edges.append(LineSeg(a: f4(p - dir), b: f4(p + dir), color: Palette3D.guide, params: SIMD4(1, 0, 0, 0)))
            } else {
                for ax in [V3.xAxis, .yAxis, .zAxis] {
                    edges.append(LineSeg(a: f4(p - ax * 0.6), b: f4(p + ax * 0.6), color: Palette3D.guide, params: SIMD4(1.4, 0, 0, 0)))
                }
            }
        }
        faceVerts = faces
        edgeSegs = edges
    }

    private func boxLines(_ g: Group, _ color: SIMD4<Float>, _ width: Float) -> [LineSeg] {
        var b = g.localBounds
        if b.isEmpty { return [] }
        b.min -= V3(repeating: 0.15)
        b.max += V3(repeating: 0.15)
        let m = g.worldMatrix
        let c = [V3(b.min.x, b.min.y, b.min.z), V3(b.max.x, b.min.y, b.min.z), V3(b.max.x, b.max.y, b.min.z), V3(b.min.x, b.max.y, b.min.z),
                 V3(b.min.x, b.min.y, b.max.z), V3(b.max.x, b.min.y, b.max.z), V3(b.max.x, b.max.y, b.max.z), V3(b.min.x, b.max.y, b.max.z)].map { m.transformPoint($0) }
        let idx = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]
        return stride(from: 0, to: idx.count, by: 2).map { LineSeg(a: f4(c[idx[$0]]), b: f4(c[idx[$0 + 1]]), color: color, params: SIMD4(width, 0, 0, 0)) }
    }

    private func gridLines(_ e: Editor) -> [LineSeg] {
        var out: [LineSeg] = []
        if e.showGrid {
            let step = 12.0, n = 40
            for i in -n...n where i != 0 {
                let color = i % 10 == 0 ? Palette3D.gridMajor : Palette3D.grid
                let x = Double(i) * step, L = Double(n) * step
                out.append(LineSeg(a: f4(V3(x, -L, -0.03)), b: f4(V3(x, L, -0.03)), color: color, params: SIMD4(1, -1e-5, 0, 0)))
                out.append(LineSeg(a: f4(V3(-L, x, -0.03)), b: f4(V3(L, x, -0.03)), color: color, params: SIMD4(1, -1e-5, 0, 0)))
            }
        }
        let L = 5000.0
        for ax in [Axis.x, .y, .z] {
            let c = Palette3D.axisRGBA(ax)
            out.append(LineSeg(a: f4(.zero), b: f4(ax.vector * L), color: c, params: SIMD4(1.6, 0, 0, 0)))
            var faded = c
            faded.w = 0.45
            out.append(LineSeg(a: f4(.zero), b: f4(ax.vector * -L), color: faded, params: SIMD4(1.2, 0, 0, 0)))
        }
        return out
    }

    // MARK: drawing

    private func encode(_ cmd: MTLCommandBuffer, _ pass: MTLRenderPassDescriptor, editor e: Editor, drawableSize: CGSize, scale: CGFloat) {
        let dark = Palette3D.isDark
        if builtVersion != e.version || builtDark != dark {
            rebuild(e)
            builtVersion = e.version
            builtDark = dark
        }
        guard let enc = cmd.makeRenderCommandEncoder(descriptor: pass) else { return }
        let s = Float(scale)
        var u = Uniforms(viewProj: e.camera.viewProjectionFloat,
                         viewport: SIMD4(Float(drawableSize.width), Float(drawableSize.height), s, 0),
                         light: SIMD4(-0.4, -0.7, 1, 0), back: Palette3D.back, params: SIMD4(1, 0, 0, 0))
        enc.setFrontFacing(.counterClockwise)
        enc.setCullMode(.none)

        func drawLines(_ segs: [LineSeg], depth: MTLDepthStencilState) {
            guard !segs.isEmpty else { return }
            // widths are in points; the shader works in pixels
            let scaled = segs.map { var l = $0; l.params.x *= s; return l }
            guard let buf = device.makeBuffer(bytes: scaled, length: MemoryLayout<LineSeg>.stride * scaled.count) else { return }
            enc.setRenderPipelineState(linePipeline)
            enc.setDepthStencilState(depth)
            enc.setVertexBuffer(buf, offset: 0, index: 0)
            enc.setVertexBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
            enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: scaled.count)
        }

        func drawFaces(_ verts: [FaceVertex], pipeline: MTLRenderPipelineState, depth: MTLDepthStencilState, bias: Float, alpha: Float = 1) {
            guard !verts.isEmpty, let buf = device.makeBuffer(bytes: verts, length: MemoryLayout<FaceVertex>.stride * verts.count) else { return }
            u.params.x = alpha
            enc.setRenderPipelineState(pipeline)
            enc.setDepthStencilState(depth)
            enc.setDepthBias(bias, slopeScale: bias * 2, clamp: 0)
            enc.setVertexBuffer(buf, offset: 0, index: 0)
            enc.setVertexBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
            enc.setFragmentBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
            enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: verts.count)
            enc.setDepthBias(0, slopeScale: 0, clamp: 0)
            u.params.x = 1
        }

        drawLines(gridLines(e), depth: depthRead)
        let anyDim = faceVerts.contains { $0.color.w < 1 }
        if e.xray || anyDim {
            let opaque = e.xray ? [] : faceVerts.filter { $0.color.w >= 1 }
            let translucent = e.xray ? faceVerts : faceVerts.filter { $0.color.w < 1 }
            drawFaces(opaque, pipeline: facePipeline, depth: depthWrite, bias: 1)
            drawFaces(translucent, pipeline: blendFacePipeline, depth: depthRead, bias: 1, alpha: e.xray ? 0.45 : 1)
        } else {
            drawFaces(faceVerts, pipeline: facePipeline, depth: depthWrite, bias: 1)
        }

        // selected and hovered faces
        var tint: [FaceVertex] = []
        let pick = e.pickData
        for t in pick.triangles {
            let selected = t.group == e.contextId && e.selection.faces.contains(t.face)
            let hovered = e.hoverFace == FaceRef(group: t.group, face: t.face)
            guard selected || hovered else { continue }
            let c = selected ? Palette3D.selectionFill : Palette3D.hoverFill
            for p in [t.a, t.b, t.c] { tint.append(FaceVertex(pos: f4(p), normal: f4(t.normal, 0), color: c)) }
        }
        drawFaces(tint, pipeline: flatPipeline, depth: depthRead, bias: -1)

        drawLines(edgeSegs, depth: depthWrite)

        // tool previews
        var polys: [FaceVertex] = []
        for (pts, color) in e.overlayPolygons where pts.count >= 3 {
            for i in 1..<(pts.count - 1) { for p in [pts[0], pts[i], pts[i + 1]] { polys.append(FaceVertex(pos: f4(p), normal: SIMD4(0, 0, 1, 0), color: color)) } }
        }
        drawFaces(polys, pipeline: flatPipeline, depth: depthOff, bias: 0)
        let onTop = e.overlay.filter(\.onTop).map { LineSeg(a: f4($0.a), b: f4($0.b), color: $0.color, params: SIMD4($0.width, 0, 0, 0)) }
        let inScene = e.overlay.filter { !$0.onTop }.map { LineSeg(a: f4($0.a), b: f4($0.b), color: $0.color, params: SIMD4($0.width, 1e-4, 0, 0)) }
        drawLines(inScene, depth: depthRead)
        drawLines(onTop, depth: depthOff)
        if let g = e.inference?.guide {
            drawLines([LineSeg(a: f4(g.0), b: f4(g.1), color: Palette3D.muted, params: SIMD4(1.2, 0, 0, 0))], depth: depthOff)
        }
        enc.endEncoding()
    }
}
