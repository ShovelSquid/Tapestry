// L0 semantic rendering (log 0004): every point is one ellipsoid.
// Each instance rasterizes the back faces of its bounding box; the fragment
// shader intersects the camera ray with the true ellipsoid and writes its depth.

struct Globals {
    view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    light_dir: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: Globals;

struct Instance {
    @location(0) center: vec4<f32>,
    @location(1) rotation: vec4<f32>, // quaternion xyzw
    @location(2) radii: vec4<f32>,
    @location(3) color: vec4<f32>,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) @interpolate(flat) center: vec3<f32>,
    @location(2) @interpolate(flat) rotation: vec4<f32>,
    @location(3) @interpolate(flat) radii: vec3<f32>,
    @location(4) @interpolate(flat) color: vec4<f32>,
};

fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn unrotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    return rotate(vec4<f32>(-q.xyz, q.w), v);
}

// 36 corners of a cube, as 12 triangles.
fn cube_corner(i: u32) -> vec3<f32> {
    var idx = array<u32, 36>(
        0u, 2u, 1u, 1u, 2u, 3u, // -z
        4u, 5u, 6u, 5u, 7u, 6u, // +z
        0u, 1u, 4u, 1u, 5u, 4u, // -y
        2u, 6u, 3u, 3u, 6u, 7u, // +y
        0u, 4u, 2u, 2u, 4u, 6u, // -x
        1u, 3u, 5u, 3u, 7u, 5u, // +x
    );
    let c = idx[i];
    return vec3<f32>(
        select(-1.0, 1.0, (c & 1u) != 0u),
        select(-1.0, 1.0, (c & 2u) != 0u),
        select(-1.0, 1.0, (c & 4u) != 0u),
    );
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, inst: Instance) -> VsOut {
    let local = cube_corner(vi) * inst.radii.xyz;
    let world = inst.center.xyz + rotate(inst.rotation, local);
    var out: VsOut;
    out.clip = globals.view_proj * vec4<f32>(world, 1.0);
    out.world = world;
    out.center = inst.center.xyz;
    out.rotation = inst.rotation;
    out.radii = inst.radii.xyz;
    out.color = inst.color;
    return out;
}

struct FsOut {
    @location(0) color: vec4<f32>,
    @builtin(frag_depth) depth: f32,
};

@fragment
fn fs_main(in: VsOut) -> FsOut {
    let eye = globals.eye.xyz;
    let dir = normalize(in.world - eye);

    // Into the ellipsoid's unit-sphere space, where the ray is still linear in t.
    let o = unrotate(in.rotation, eye - in.center) / in.radii;
    let d = unrotate(in.rotation, dir) / in.radii;
    let a = dot(d, d);
    let b = dot(o, d);
    let c = dot(o, o) - 1.0;
    let disc = b * b - a * c;
    if disc < 0.0 {
        discard;
    }
    let s = sqrt(disc);
    var t = (-b - s) / a;
    if t < 0.0 {
        t = (-b + s) / a; // camera inside the blob
    }
    if t < 0.0 {
        discard;
    }

    let hit = eye + dir * t;
    let p = o + d * t;
    let n = normalize(rotate(in.rotation, p / in.radii));

    // Soft key light, sky/ground fill and a rim, enough to read form.
    let l = normalize(globals.light_dir.xyz);
    let key = max(dot(n, l), 0.0);
    let fill = mix(0.12, 0.3, n.y * 0.5 + 0.5);
    let rim = pow(1.0 - max(dot(n, -dir), 0.0), 3.0) * 0.08;
    let lit = in.color.rgb * (fill + key * 0.8) + vec3<f32>(rim);

    let clip = globals.view_proj * vec4<f32>(hit, 1.0);
    var out: FsOut;
    out.color = vec4<f32>(lit, in.color.a);
    out.depth = clip.z / clip.w;
    return out;
}
