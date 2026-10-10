//! Notes by meaning: an embedding model, so notes that say alike things in
//! different words still find each other ("car" and "automobile").
//!
//! The model is Model2Vec's potion-base-8M: a static embedding, a table of
//! token vectors distilled from a sentence transformer, so a note's vector
//! is a lookup and an average. About 30 MB, quick enough for a phone. It's
//! downloaded once from Hugging Face, at a pinned revision, into
//! `~/.cache/tapestry/models/potion-base-8M/`, and loaded off the UI thread.
//! Until it's ready, or if it can't be had, notes are read by their words
//! alone (`tapestry_canvas::note_vector`).
//!
//! The model's 256 numbers are turned into the swarm's [`N`] by a fixed
//! random projection, which keeps how alike two notes are, near enough.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use model2vec_rs::model::StaticModel;
use tapestry_canvas::{N, Vector};

const REPO: &str = "minishlab/potion-base-8M";
/// The revision downloaded: a model that changed under us would read notes
/// differently from one day to the next.
const REVISION: &str = "bf8b056651a2c21b8d2565580b8569da283cab23";
const FILES: [&str; 3] = ["config.json", "tokenizer.json", "model.safetensors"];

enum Status {
    Idle,
    Loading,
    Ready(Arc<StaticModel>),
    Failed(String),
}

pub struct Embedder {
    status: Arc<Mutex<Status>>,
}

impl Embedder {
    pub fn new() -> Self {
        Self { status: Arc::new(Mutex::new(Status::Idle)) }
    }

    /// Start getting the model ready, if nothing has yet.
    pub fn start(&self, ctx: &eframe::egui::Context) {
        let mut status = self.status.lock().unwrap();
        if !matches!(*status, Status::Idle) {
            return;
        }
        *status = Status::Loading;
        let (status, ctx) = (self.status.clone(), ctx.clone());
        std::thread::spawn(move || {
            let result = fetch().and_then(|dir| {
                let read = |f: &str| std::fs::read(dir.join(f)).map_err(|e| format!("{f}: {e}"));
                StaticModel::from_bytes(read("tokenizer.json")?, read("model.safetensors")?, read("config.json")?, None)
                    .map_err(|e| e.to_string())
            });
            *status.lock().unwrap() = match result {
                Ok(model) => Status::Ready(Arc::new(model)),
                Err(e) => {
                    eprintln!("no embedding model, reading notes by their words: {e}");
                    Status::Failed(e)
                }
            };
            ctx.request_repaint();
        });
    }

    /// Whether the model has been downloaded already, so loading it is quick.
    pub fn cached() -> bool {
        FILES.iter().all(|f| cache().join(f).is_file())
    }

    /// Wait up to `secs` for the model to be ready.
    pub fn wait(&self, secs: f32) -> bool {
        let until = std::time::Instant::now() + std::time::Duration::from_secs_f32(secs);
        while self.loading() && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        self.ready()
    }

    pub fn ready(&self) -> bool {
        matches!(*self.status.lock().unwrap(), Status::Ready(_))
    }

    /// Still getting ready: worth waiting for.
    pub fn loading(&self) -> bool {
        matches!(*self.status.lock().unwrap(), Status::Loading)
    }

    /// How notes are being read, in a few words.
    pub fn describe(&self) -> String {
        match &*self.status.lock().unwrap() {
            Status::Idle => "notes read by their words".into(),
            Status::Loading => "getting the meaning model…".into(),
            Status::Ready(_) => "notes read by meaning".into(),
            Status::Failed(why) => format!("notes read by their words (no meaning model: {})", short(why)),
        }
    }

    /// A note's vector by meaning, once the model is ready.
    pub fn vector(&self, text: &str) -> Option<Vector> {
        let model = match &*self.status.lock().unwrap() {
            Status::Ready(m) => m.clone(),
            _ => return None,
        };
        Some(project(&model.encode_single(text)))
    }
}

/// The model's numbers as the swarm's: each of ours a fixed ±1 mix of all
/// of theirs, scaled to length 1.
fn project(e: &[f32]) -> Vector {
    let mut v = [0.0; N];
    for (d, out) in v.iter_mut().enumerate() {
        for (k, x) in e.iter().enumerate() {
            let sign = if splitmix((d as u64) << 32 | k as u64) & 1 == 0 { 1.0 } else { -1.0 };
            *out += sign * x;
        }
    }
    let len = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if len > 1e-9 {
        for x in &mut v {
            *x /= len;
        }
    }
    v
}

fn short(s: &str) -> &str {
    s.char_indices().nth(60).map_or(s, |(i, _)| &s[..i])
}

fn splitmix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn cache() -> PathBuf {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("tapestry/models/potion-base-8M")
}

/// The model's files, downloaded if they aren't here yet.
fn fetch() -> Result<PathBuf, String> {
    let dir = cache();
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for file in FILES {
        let path = dir.join(file);
        if path.is_file() {
            continue;
        }
        let url = format!("https://huggingface.co/{REPO}/resolve/{REVISION}/{file}");
        let mut response = ureq::get(&url).call().map_err(|e| format!("{url}: {e}"))?;
        let bytes = response
            .body_mut()
            .with_config()
            .limit(200 << 20)
            .read_to_vec()
            .map_err(|e| format!("{url}: {e}"))?;
        // Written whole or not at all, so a cut-off download isn't mistaken
        // for the model next time.
        let part = path.with_extension("part");
        std::fs::write(&part, &bytes).map_err(|e| format!("{}: {e}", part.display()))?;
        std::fs::rename(&part, &path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// How well the model tells the demo's topics apart. Needs the model
    /// (downloads it the first time): `cargo test -p tapestry-canvas-app -- --ignored`.
    #[test]
    #[ignore]
    fn the_model_tells_topics_apart() {
        let dir = fetch().expect("model");
        let read = |f: &str| std::fs::read(dir.join(f)).unwrap();
        let model = StaticModel::from_bytes(read("tokenizer.json"), read("model.safetensors"), read("config.json"), None).unwrap();
        let notes = crate::swarm::DEMO_NOTES;
        let by_meaning: Vec<Vector> = notes.iter().map(|(_, t)| project(&model.encode_single(t))).collect();
        let by_words: Vec<Vector> = notes.iter().map(|(_, t)| tapestry_canvas::note_vector(t)).collect();
        for (name, v) in [("meaning", &by_meaning), ("words", &by_words)] {
            let (mut w, mut wn, mut a, mut an, mut amax, mut wmin) = (0.0, 0, 0.0, 0, -1f32, 1f32);
            for i in 0..v.len() {
                for j in i + 1..v.len() {
                    let c: f32 = v[i].iter().zip(&v[j]).map(|(x, y)| x * y).sum();
                    if i / 4 == j / 4 {
                        (w, wn, wmin) = (w + c, wn + 1, wmin.min(c));
                    } else {
                        (a, an, amax) = (a + c, an + 1, amax.max(c));
                    }
                }
            }
            eprintln!("{name}: within {:.2} (min {wmin:.2}), across {:.2} (max {amax:.2})", w / wn as f32, a / an as f32);
        }
        let car: Vec<Vector> = ["I bought a new car.", "The automobile needs servicing.", "My tomato plants are flowering."]
            .iter()
            .map(|t| project(&model.encode_single(t)))
            .collect();
        let c = |a: &Vector, b: &Vector| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
        eprintln!("car~automobile {:.2}, car~tomato {:.2}", c(&car[0], &car[1]), c(&car[0], &car[2]));
    }

    /// The demo's notes read by meaning, flat and in depth: how many of the
    /// swarm's proposals join notes on one topic. Needs the model.
    #[test]
    #[ignore]
    fn proposals_by_meaning() {
        use tapestry_canvas::{TICKS_PER_SECOND, Timeline};
        let dir = fetch().expect("model");
        let read = |f: &str| std::fs::read(dir.join(f)).unwrap();
        let model = StaticModel::from_bytes(read("tokenizer.json"), read("model.safetensors"), read("config.json"), None).unwrap();
        let notes = crate::swarm::DEMO_NOTES;
        for depth in [false, true] {
            let (mut all, mut right) = (0, 0);
            for shift in [1usize, 5, 7, 11] {
                let mut t = Timeline::default();
                t.set_depth(depth);
                for (k, (name, text)) in notes.iter().enumerate() {
                    let slot = (k * shift) % notes.len();
                    let pos = glam::Vec2::new(820.0 + (slot % 4) as f32 * 200.0, 170.0 + (slot / 4) as f32 * 160.0);
                    t.read_note(name, name, pos, project(&model.encode_single(text)));
                }
                t.seek(4 * 60 * TICKS_PER_SECOND);
                let topic = |n: &str| notes.iter().position(|(m, _)| *m == n).unwrap() / 4;
                let ps = t.state().swarm.proposals();
                all += ps.len();
                right += ps.iter().filter(|p| topic(&p.a.name) == topic(&p.b.name)).count();
            }
            eprintln!("by meaning, depth {depth}: {right} of {all} proposals on one topic");
        }
    }
}
