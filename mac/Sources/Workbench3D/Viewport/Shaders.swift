/// Metal shaders, compiled at launch (`device.makeLibrary(source:)`) so the Swift package needs no
/// metallib build step. Faces are lit with a key light and a sky/ground fill; back faces get the
/// classic blue-grey so inside-out faces are easy to spot. Lines are screen-space quads, so edges
/// keep the same width at any zoom.
let shaderSource = """
#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    float4x4 viewProj;
    float4 viewport;   // drawable width, height (pixels), backing scale, 0
    float4 light;      // key light direction
    float4 back;       // back-face color
    float4 params;     // x: face alpha
};

struct FaceIn { float4 pos; float4 normal; float4 color; };
struct FaceOut {
    float4 position [[position]];
    float3 normal;
    float4 color;
};

vertex FaceOut face_vertex(uint vid [[vertex_id]],
                           const device FaceIn* v [[buffer(0)]],
                           constant Uniforms& u [[buffer(1)]]) {
    FaceOut o;
    o.position = u.viewProj * float4(v[vid].pos.xyz, 1.0);
    o.normal = v[vid].normal.xyz;
    o.color = v[vid].color;
    return o;
}

fragment float4 face_fragment(FaceOut in [[stage_in]], bool front [[front_facing]],
                              constant Uniforms& u [[buffer(1)]]) {
    float3 n = normalize(in.normal);
    if (!front) n = -n;
    float3 key = normalize(u.light.xyz);
    float3 fill = normalize(float3(0.6, 0.5, 0.3));
    float diffuse = max(dot(n, key), 0.0) * 0.5 + max(dot(n, fill), 0.0) * 0.16;
    float sky = 0.40 + 0.20 * (0.5 + 0.5 * n.z);
    float3 base = front ? in.color.rgb : u.back.rgb;
    return float4(base * min(sky + diffuse, 1.08), in.color.a * u.params.x);
}

fragment float4 flat_fragment(FaceOut in [[stage_in]]) { return in.color; }

struct LineIn { float4 a; float4 b; float4 color; float4 params; }; // params.x width (pixels), y depth pull
struct LineOut {
    float4 position [[position]];
    float4 color;
};

vertex LineOut line_vertex(uint vid [[vertex_id]], uint iid [[instance_id]],
                           const device LineIn* lines [[buffer(0)]],
                           constant Uniforms& u [[buffer(1)]]) {
    LineIn s = lines[iid];
    float4 ca = u.viewProj * float4(s.a.xyz, 1.0);
    float4 cb = u.viewProj * float4(s.b.xyz, 1.0);
    // keep segments that cross the camera plane from flipping
    float nearW = 1e-3;
    if (ca.w < nearW && cb.w >= nearW) ca = mix(cb, ca, (cb.w - nearW) / (cb.w - ca.w));
    if (cb.w < nearW && ca.w >= nearW) cb = mix(ca, cb, (ca.w - nearW) / (ca.w - cb.w));
    float2 half_vp = u.viewport.xy * 0.5;
    float2 sa = ca.xy / max(ca.w, nearW) * half_vp;
    float2 sb = cb.xy / max(cb.w, nearW) * half_vp;
    float2 d = sb - sa;
    float len = length(d);
    float2 dir = len > 1e-5 ? d / len : float2(1.0, 0.0);
    float2 nrm = float2(-dir.y, dir.x);
    float hw = s.params.x * 0.5;
    const int corners[6] = {0, 1, 2, 2, 1, 3};
    int c = corners[vid];
    bool atB = c >= 2;
    float side = (c == 1 || c == 3) ? 1.0 : -1.0;
    float4 clip = atB ? cb : ca;
    float2 offPixels = nrm * side * hw + dir * (atB ? hw : -hw);
    clip.xy += offPixels / half_vp * clip.w;
    clip.z -= s.params.y * clip.w;
    LineOut o;
    o.position = clip;
    o.color = s.color;
    return o;
}

fragment float4 line_fragment(LineOut in [[stage_in]]) { return in.color; }
"""
