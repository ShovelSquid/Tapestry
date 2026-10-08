//! Renders the mock cup scene at a few moments to PNGs, with no window.
//!
//!     cargo run -p tapestry-render --example snapshot -- [out-dir] [time ...]

use glam::Vec3;
use tapestry_render::{BlobRenderer, Camera, instances};
use tapestry_view::WorldView;

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(args.next().unwrap_or_else(|| "snapshots".into()));
    let mut times: Vec<f64> = args
        .map(|a| a.parse().expect("times are numbers"))
        .collect();
    if times.is_empty() {
        times = vec![0.0, 30.0, 35.0, 35.5, 40.0];
    }
    std::fs::create_dir_all(&out).unwrap();

    let instance = wgpu::Instance::default();
    let adapter =
        pollster::block_on(instance.request_adapter(&Default::default())).expect("no GPU adapter");
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    eprintln!("adapter: {}", adapter.get_info().name);

    let world = tapestry_mock::CupScene;
    let camera = Camera {
        eye: Vec3::new(3.2, 2.6, 4.3),
        target: Vec3::new(0.6, 0.6, 0.0),
        fov_y: 45f32.to_radians(),
    };
    let mut renderer = BlobRenderer::new(&device);
    for t in times {
        let frame = world.frame_at(t);
        renderer.render(&device, &queue, [960, 600], &camera, &instances(&frame));
        let ([w, h], pixels) = renderer.read_pixels(&device, &queue).unwrap();

        let path = out.join(format!("cup-{t:05.1}.png"));
        let file = std::io::BufWriter::new(std::fs::File::create(&path).unwrap());
        let mut png = png::Encoder::new(file, w, h);
        png.set_color(png::ColorType::Rgba);
        png.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        png.write_header()
            .unwrap()
            .write_image_data(&pixels)
            .unwrap();
        println!("{}", path.display());
    }
}
