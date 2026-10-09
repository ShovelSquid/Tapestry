//! A terminal as a card: a real shell on a pseudo-terminal, its screen kept
//! by a VT100 parser and drawn in the paper-and-ink palette.
//!
//! Run anything in it, `claude` included, beside the notes it's about.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use eframe::egui;
use egui::{Color32, FontId, Rect, Stroke, pos2, vec2};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::{FAINT, INK};

const SCROLLBACK: usize = 5000;

#[derive(Clone, Copy, PartialEq)]
struct Style {
    fg: Color32,
    italic: bool,
    underline: bool,
    bold: bool,
}

pub struct Terminal {
    pub id: u64,
    pub cwd: PathBuf,
    parser: Arc<Mutex<vt100::Parser>>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    exited: Arc<AtomicBool>,
    size: (u16, u16),
}

impl Terminal {
    /// Start the user's shell in `cwd`.
    pub fn spawn(id: u64, cwd: &Path, ctx: &egui::Context) -> Result<Self, String> {
        let (rows, cols) = (24, 80);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, SCROLLBACK)));
        let exited = Arc::new(AtomicBool::new(false));
        {
            let parser = parser.clone();
            let exited = exited.clone();
            let ctx = ctx.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 16 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            parser.lock().unwrap().process(&buf[..n]);
                            ctx.request_repaint();
                        }
                    }
                }
                exited.store(true, Ordering::Relaxed);
                ctx.request_repaint();
            });
        }
        Ok(Self {
            id,
            cwd: cwd.to_path_buf(),
            parser,
            writer,
            master: pair.master,
            child,
            exited,
            size: (rows, cols),
        })
    }

    pub fn exited(&self) -> bool {
        self.exited.load(Ordering::Relaxed)
    }

    pub fn title(&self) -> String {
        let place = self
            .cwd
            .file_name()
            .map_or("/".into(), |n| n.to_string_lossy().into_owned());
        if self.exited() {
            format!("terminal · {place} · ended")
        } else {
            format!("terminal · {place}")
        }
    }

    fn resize(&mut self, rows: u16, cols: u16) {
        if (rows, cols) == self.size || rows < 2 || cols < 4 {
            return;
        }
        self.size = (rows, cols);
        let _ = self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
        self.parser.lock().unwrap().screen_mut().set_size(rows, cols);
    }

    pub fn send(&mut self, bytes: &[u8]) {
        let _ = self.writer.write_all(bytes);
        let _ = self.writer.flush();
    }

    /// Take this frame's keyboard input (all of it: while a terminal has the
    /// keyboard, keys are the program's, not the app's).
    pub fn take_input(&mut self, ui: &egui::Ui) {
        let events = ui.input_mut(|i| std::mem::take(&mut i.events));
        let (app_cursor, bracketed) = {
            let p = self.parser.lock().unwrap();
            (
                p.screen().application_cursor(),
                p.screen().bracketed_paste(),
            )
        };
        for event in events {
            match event {
                egui::Event::Text(t) => self.send(t.as_bytes()),
                egui::Event::Copy => self.send(b"\x03"),
                egui::Event::Cut => self.send(b"\x18"),
                egui::Event::Paste(t) => {
                    if bracketed {
                        self.send(b"\x1b[200~");
                        self.send(t.as_bytes());
                        self.send(b"\x1b[201~");
                    } else {
                        self.send(t.as_bytes());
                    }
                }
                egui::Event::Key {
                    key,
                    pressed: true,
                    modifiers,
                    ..
                } => {
                    if let Some(bytes) = key_bytes(key, modifiers, app_cursor) {
                        self.send(&bytes);
                    }
                }
                _ => {}
            }
        }
    }

    /// Scroll back through history (positive: further back).
    pub fn scroll(&mut self, lines: i32) {
        let mut p = self.parser.lock().unwrap();
        let s = p.screen_mut();
        let now = s.scrollback() as i32;
        s.set_scrollback((now + lines).max(0) as usize);
    }

    /// Draw the screen into `rect`, fitting the terminal's size to it.
    pub fn draw(&mut self, ui: &egui::Ui, painter: &egui::Painter, rect: Rect, size: f32, active: bool) {
        let font = FontId::monospace(size);
        let cell = painter.layout_no_wrap("M".into(), font.clone(), INK).size();
        let (cw, ch) = (cell.x.max(1.0), cell.y.max(1.0));
        let rows = (rect.height() / ch).floor() as u16;
        let cols = (rect.width() / cw).floor() as u16;
        self.resize(rows, cols);

        let parser = self.parser.lock().unwrap();
        let screen = parser.screen();
        let (rows, cols) = screen.size();
        // Same-styled ASCII is laid out a run at a time; anything wider or
        // stranger goes cell by cell, so a fallback glyph can't push the
        // rest of the row out of its columns.
        let draw = |text: &str, col: u16, y: f32, st: Style| {
            let mut job = egui::text::LayoutJob::default();
            job.append(
                text,
                0.0,
                egui::TextFormat {
                    font_id: font.clone(),
                    color: st.fg,
                    italics: st.italic,
                    underline: if st.underline {
                        Stroke::new(1.0, st.fg)
                    } else {
                        Stroke::NONE
                    },
                    ..Default::default()
                },
            );
            let galley = ui.fonts_mut(|f| f.layout_job(job));
            let at = pos2(rect.left() + col as f32 * cw, y);
            if st.bold {
                // Overstrike for weight; the mono font has no bold face.
                painter.galley(at + vec2(0.6, 0.0), galley.clone(), st.fg);
            }
            painter.galley(at, galley, st.fg);
        };
        for row in 0..rows {
            let y = rect.top() + row as f32 * ch;
            let mut run = String::new();
            let mut run_at = 0;
            let mut run_style: Option<Style> = None;
            let mut col = 0;
            while col < cols {
                let Some(c) = screen.cell(row, col) else {
                    break;
                };
                let (mut fg, mut bg) = (
                    color(c.fgcolor(), INK),
                    color(c.bgcolor(), Color32::TRANSPARENT),
                );
                if c.inverse() {
                    std::mem::swap(&mut fg, &mut bg);
                    if fg == Color32::TRANSPARENT {
                        fg = crate::SHEET;
                    }
                    if bg == Color32::TRANSPARENT {
                        bg = INK;
                    }
                }
                if c.dim() {
                    fg = fg.gamma_multiply(0.6);
                }
                let width: u16 = if c.is_wide() { 2 } else { 1 };
                if bg != Color32::TRANSPARENT {
                    painter.rect_filled(
                        Rect::from_min_size(
                            pos2(rect.left() + col as f32 * cw, y),
                            vec2(cw * width as f32, ch),
                        ),
                        0.0,
                        bg,
                    );
                }
                let style = Style {
                    fg,
                    italic: c.italic(),
                    underline: c.underline(),
                    bold: c.bold(),
                };
                let text = match c.contents() {
                    "" => " ",
                    t => t,
                };
                let plain = width == 1 && text.len() == 1 && text.is_ascii();
                if plain && run_style == Some(style) {
                    run.push_str(text);
                } else {
                    if let Some(st) = run_style.take()
                        && !run.trim().is_empty()
                    {
                        draw(&run, run_at, y, st);
                    }
                    run.clear();
                    if plain {
                        run.push_str(text);
                        run_at = col;
                        run_style = Some(style);
                    } else {
                        draw(text, col, y, style);
                    }
                }
                col += width;
            }
            if let Some(st) = run_style
                && !run.trim().is_empty()
            {
                draw(&run, run_at, y, st);
            }
        }
        if !screen.hide_cursor() && screen.scrollback() == 0 {
            let (r, c) = screen.cursor_position();
            let at = Rect::from_min_size(
                pos2(rect.left() + c as f32 * cw, rect.top() + r as f32 * ch),
                vec2(cw, ch),
            );
            if active {
                painter.rect_filled(at, 1.0, INK.gamma_multiply(0.55));
            } else {
                painter.rect_stroke(at, 1.0, Stroke::new(1.0, FAINT), egui::StrokeKind::Inside);
            }
        }
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn key_bytes(key: egui::Key, m: egui::Modifiers, app_cursor: bool) -> Option<Vec<u8>> {
    use egui::Key::*;
    let arrow = |c: u8| {
        if app_cursor {
            vec![0x1b, b'O', c]
        } else {
            vec![0x1b, b'[', c]
        }
    };
    let bytes = match key {
        Enter => b"\r".to_vec(),
        Backspace => b"\x7f".to_vec(),
        Tab if m.shift => b"\x1b[Z".to_vec(),
        Tab => b"\t".to_vec(),
        Escape => b"\x1b".to_vec(),
        ArrowUp => arrow(b'A'),
        ArrowDown => arrow(b'B'),
        ArrowRight => arrow(b'C'),
        ArrowLeft => arrow(b'D'),
        Home => b"\x1b[H".to_vec(),
        End => b"\x1b[F".to_vec(),
        Delete => b"\x1b[3~".to_vec(),
        PageUp => b"\x1b[5~".to_vec(),
        PageDown => b"\x1b[6~".to_vec(),
        _ if m.ctrl => {
            // Ctrl+letter is the letter's control code (Ctrl+C is 3).
            let name = key.name();
            let letter = name.chars().next().filter(|_| name.len() == 1)?;
            if letter.is_ascii_alphabetic() {
                vec![(letter.to_ascii_uppercase() as u8) - b'A' + 1]
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(bytes)
}

/// Terminal colours, tuned to read on paper.
fn color(c: vt100::Color, default: Color32) -> Color32 {
    const BASE: [[u8; 3]; 16] = [
        [0x16, 0x19, 0x1b],
        [0xc8, 0x40, 0x1e],
        [0x4f, 0x7a, 0x3a],
        [0x9a, 0x74, 0x10],
        [0x3b, 0x6f, 0xb0],
        [0x8a, 0x4a, 0x9a],
        [0x2f, 0x86, 0x86],
        [0x9a, 0x97, 0x90],
        [0x68, 0x6a, 0x66],
        [0xe8, 0x49, 0x2a],
        [0x5f, 0x9a, 0x45],
        [0xb8, 0x90, 0x18],
        [0x4a, 0x7f, 0xc1],
        [0xa6, 0x5a, 0xb8],
        [0x3a, 0xa0, 0xa0],
        [0xd8, 0xd5, 0xcd],
    ];
    match c {
        vt100::Color::Default => default,
        vt100::Color::Idx(i) if i < 16 => {
            let [r, g, b] = BASE[i as usize];
            Color32::from_rgb(r, g, b)
        }
        vt100::Color::Idx(i) if i < 232 => {
            let i = i - 16;
            let level = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
            Color32::from_rgb(level(i / 36), level((i / 6) % 6), level(i % 6))
        }
        vt100::Color::Idx(i) => {
            let v = 8 + (i - 232) * 10;
            Color32::from_rgb(v, v, v)
        }
        vt100::Color::Rgb(r, g, b) => Color32::from_rgb(r, g, b),
    }
}
