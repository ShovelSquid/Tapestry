//! Splat renderer, level L0 for now: one ellipsoid per point (log 0004).
//!
//! Appearance only. It draws what it is given into its own offscreen texture
//! and knows nothing about where the world came from or what UI shows it.

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Quat, Vec3};
use tapestry_view::{Frame, resolve};

/// Format of the texture [`BlobRenderer::render`] draws into.
pub const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// One ellipsoid to draw, in world space.
#[derive(Clone, Copy, Debug)]
pub struct Instance {
    pub center: Vec3,
    pub rotation: Quat,
    pub radii: Vec3,
    /// Linear RGB plus opacity.
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Debug)]
pub struct Camera {
    pub eye: Vec3,
    pub target: Vec3,
    pub fov_y: f32,
}

impl Camera {
    pub fn view_proj(&self, aspect: f32) -> Mat4 {
        // wgpu's clip space has depth in [0, 1] and Y up, glam's "directx" convention.
        let proj = glam::camera::rh::proj::directx::perspective(self.fov_y, aspect, 0.02, 200.0);
        proj * glam::camera::rh::view::look_at_mat4(self.eye, self.target, Vec3::Y)
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    eye: [f32; 4],
    light_dir: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct InstanceRaw {
    center: [f32; 4],
    rotation: [f32; 4],
    radii: [f32; 4],
    color: [f32; 4],
}

/// One instance per point that has a blob, placed in world space.
pub fn instances(frame: &Frame) -> Vec<Instance> {
    let world = resolve(frame);
    frame
        .points
        .iter()
        .zip(&world)
        .filter_map(|(p, w)| {
            p.blob.map(|b| Instance { center: w.translation, rotation: w.rotation, radii: b.radii * w.scale, color: b.color })
        })
        .collect()
}

impl From<&Instance> for InstanceRaw {
    fn from(i: &Instance) -> Self {
        Self {
            center: i.center.extend(1.0).into(),
            rotation: i.rotation.normalize().into(),
            radii: i.radii.max(Vec3::splat(1e-5)).extend(0.0).into(),
            color: i.color,
        }
    }
}

struct Target {
    size: [u32; 2],
    texture: wgpu::Texture,
    color: wgpu::TextureView,
    depth: wgpu::TextureView,
}

pub struct BlobRenderer {
    pipeline: wgpu::RenderPipeline,
    globals: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    instances: wgpu::Buffer,
    capacity: usize,
    target: Option<Target>,
    pub clear: wgpu::Color,
}

impl BlobRenderer {
    pub fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(wgpu::include_wgsl!("blobs.wgsl"));

        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("blob globals"),
            size: size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("blob globals"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("blob globals"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: globals.as_entire_binding() }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("blobs"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("blobs"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: size_of::<InstanceRaw>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &wgpu::vertex_attr_array![
                        0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4
                    ],
                })],
            },
            primitive: wgpu::PrimitiveState {
                // Faces are drawn both ways; the ray cast decides what's visible.
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: COLOR_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });

        let capacity = 64;
        Self {
            pipeline,
            globals,
            bind_group,
            instances: Self::instance_buffer(device, capacity),
            capacity,
            target: None,
            clear: wgpu::Color { r: 0.035, g: 0.04, b: 0.05, a: 1.0 },
        }
    }

    fn instance_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("blob instances"),
            size: (capacity * size_of::<InstanceRaw>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    fn ensure_target(&mut self, device: &wgpu::Device, size: [u32; 2]) -> bool {
        if self.target.as_ref().is_some_and(|t| t.size == size) {
            return false;
        }
        let make = |label, format, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: size[0], height: size[1], depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
        };
        let usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
        let texture = make(
            "blob color",
            COLOR_FORMAT,
            usage | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
        );
        self.target = Some(Target {
            size,
            color: texture.create_view(&Default::default()),
            texture,
            depth: make("blob depth", DEPTH_FORMAT, usage).create_view(&Default::default()),
        });
        true
    }

    /// The texture the last [`render`](Self::render) drew into.
    pub fn target_view(&self) -> Option<&wgpu::TextureView> {
        self.target.as_ref().map(|t| &t.color)
    }

    /// Draws `instances` into the offscreen target and submits the work.
    /// Returns `true` when the target texture was recreated (its size changed).
    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        size: [u32; 2],
        camera: &Camera,
        instances: &[Instance],
    ) -> bool {
        let size = [size[0].max(1), size[1].max(1)];
        let recreated = self.ensure_target(device, size);

        let aspect = size[0] as f32 / size[1] as f32;
        let globals = Globals {
            view_proj: camera.view_proj(aspect).to_cols_array_2d(),
            eye: camera.eye.extend(1.0).into(),
            light_dir: Vec3::new(0.45, 0.85, 0.35).normalize().extend(0.0).into(),
        };
        queue.write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));

        if instances.len() > self.capacity {
            self.capacity = instances.len().next_power_of_two();
            self.instances = Self::instance_buffer(device, self.capacity);
        }
        let raw: Vec<InstanceRaw> = instances.iter().map(InstanceRaw::from).collect();
        queue.write_buffer(&self.instances, 0, bytemuck::cast_slice(&raw));

        let target = self.target.as_ref().expect("target was just ensured");
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("blobs") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("blobs"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target.color,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(self.clear), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &target.depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            if !raw.is_empty() {
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind_group, &[]);
                pass.set_vertex_buffer(0, self.instances.slice(..));
                pass.draw(0..36, 0..raw.len() as u32);
            }
        }
        queue.submit([encoder.finish()]);
        recreated
    }

    /// Reads the last rendered image back as tightly packed sRGB RGBA8 rows.
    /// Blocks until the GPU is done. Meant for snapshots and tests, not per frame.
    pub fn read_pixels(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> Option<([u32; 2], Vec<u8>)> {
        let target = self.target.as_ref()?;
        let [w, h] = target.size;
        let row = w * 4;
        let padded = row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("blob readback"),
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            target.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        queue.submit([encoder.finish()]);
        buffer.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("readback mapping failed"));
        device.poll(wgpu::PollType::wait_indefinitely()).ok()?;
        let data = buffer.slice(..).get_mapped_range().ok()?;
        let pixels = data.chunks(padded as usize).flat_map(|r| &r[..row as usize]).copied().collect();
        Some(([w, h], pixels))
    }
}
