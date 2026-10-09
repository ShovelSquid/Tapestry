//! A terminal as a card: a real shell on a pseudo-terminal, its screen kept
//! by a VT100 parser and drawn in the paper-and-ink palette.
//!
//! Run anything in it, `claude` included, beside the notes it's about.
//!
//! With tapestry-server running, the shell lives there instead (see
//! `server.rs`): the card shows it, and so can every other device.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use eframe::egui;
use egui::{Color32, FontId, Pos2, Rect, Stroke, pos2, vec2};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::server::{Link, Remote, Server};
use crate::{FAINT, INK};

const SCROLLBACK: usize = 5000;
/// Points of wheel travel per line scrolled.
const WHEEL_LINE: f32 = 8.0;

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
    backend: Backend,
    exited: Arc<AtomicBool>,
    size: (u16, u16),
    /// Where the grid was last drawn and its cell size, to find the cell
    /// under the pointer.
    grid: Option<(Pos2, f32, f32)>,
    /// Wheel travel not yet worth a whole line, so slow trackpad scrolling
    /// adds up instead of rounding away each frame.
    wheel_rest: f32,
    /// The files the program in it has read and changed.
    pub trail: Arc<Mutex<crate::trail::Trail>>,
    /// Unix time it was opened.
    pub started: f64,
    /// Text selected with the mouse: the (row, column) it started at and
    /// the one it reaches, as dragged.
    sel: Option<((u16, u16), (u16, u16))>,
    selecting: bool,
}

enum Backend {
    /// A shell of the app's own, which ends with it.
    Local {
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
    },
    /// A shell the server keeps.
    Remote { link: Link, server: Arc<Server> },
}

impl Terminal {
    /// Show a terminal the server keeps.
    pub fn attach(server: &Arc<Server>, remote: Remote, ctx: &egui::Context) -> Self {
        let (rows, cols) = (24, 80);
        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, SCROLLBACK)));
        let exited = Arc::new(AtomicBool::new(false));
        let link = server.connect(remote.id, parser.clone(), exited.clone(), ctx.clone());
        // Its processes are only ours to follow when it runs on this machine.
        let trail = match remote.pid {
            Some(pid) if server.local => crate::trail::watch(pid, exited.clone(), ctx.clone()),
            _ => Default::default(),
        };
        Self {
            id: remote.id,
            trail,
            started: crate::trail::now(),
            sel: None,
            selecting: false,
            cwd: remote.cwd,
            parser,
            backend: Backend::Remote {
                link,
                server: server.clone(),
            },
            exited,
            // Unknown until drawn, so the first draw sends the card's size.
            size: (0, 0),
            grid: None,
            wheel_rest: 0.0,
        }
    }

    /// End it: the app's own shell is killed; one on the server is closed
    /// there, for every device.
    pub fn close(&mut self) {
        match &mut self.backend {
            Backend::Local { child, .. } => {
                let _ = child.kill();
            }
            Backend::Remote { server, .. } => {
                let (server, id) = (server.clone(), self.id);
                std::thread::spawn(move || server.close(id));
            }
        }
    }

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
        let shell_pid = child.process_id();
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
        let trail = match shell_pid {
            Some(pid) => crate::trail::watch(pid, exited.clone(), ctx.clone()),
            None => Default::default(),
        };
        Ok(Self {
            id,
            trail,
            started: crate::trail::now(),
            sel: None,
            selecting: false,
            cwd: cwd.to_path_buf(),
            parser,
            backend: Backend::Local {
                writer,
                master: pair.master,
                child,
            },
            exited,
            size: (rows, cols),
            grid: None,
            wheel_rest: 0.0,
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
        match &mut self.backend {
            Backend::Local { master, .. } => {
                let _ = master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
            Backend::Remote { link, .. } => link.resize(rows, cols),
        }
        self.parser.lock().unwrap().screen_mut().set_size(rows, cols);
    }

    /// Whether `p` is over the screen (not the card's title).
    pub fn in_grid(&self, p: Pos2) -> bool {
        self.grid.is_some_and(|(o, cw, ch)| {
            let (rows, cols) = self.size;
            Rect::from_min_size(o, vec2(cols as f32 * cw, rows as f32 * ch)).contains(p)
        })
    }

    /// The 0-based (row, column) under `p`, clamped to the grid.
    fn cell(&self, p: Pos2) -> (u16, u16) {
        let (col, row) = self.cell_at(Some(p));
        (row - 1, col - 1)
    }

    fn select_from(&mut self, p: Pos2) {
        let c = self.cell(p);
        self.sel = Some((c, c));
    }

    fn select_to(&mut self, p: Pos2) {
        let c = self.cell(p);
        if let Some((_, end)) = &mut self.sel {
            *end = c;
        }
    }

    /// Dragging across the screen selects; a click clears. Returns whether
    /// the pointer is selecting, so the card doesn't move with it.
    pub fn select_with(&mut self, ui: &egui::Ui, resp: &egui::Response) -> bool {
        let origin = ui.input(|i| i.pointer.press_origin());
        if resp.drag_started() {
            self.selecting = origin.is_some_and(|p| self.in_grid(p));
            if self.selecting
                && let Some(p) = origin
            {
                self.select_from(p);
            }
        }
        if self.selecting {
            if let Some(p) = resp.interact_pointer_pos() {
                self.select_to(p);
            }
            if !resp.dragged() {
                self.selecting = false;
            }
            return true;
        }
        if resp.clicked() && origin.is_some_and(|p| self.in_grid(p)) {
            self.sel = None;
        }
        false
    }

    /// The selection, first cell first, end inclusive.
    fn sel_range(&self) -> Option<((u16, u16), (u16, u16))> {
        let (a, b) = self.sel?;
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        (a != b).then_some((a, b))
    }

    /// The selected text, and the screen point above where it starts.
    pub fn selection(&self) -> Option<(String, Pos2)> {
        let (a, b) = self.sel_range()?;
        let (origin, cw, ch) = self.grid?;
        let text = self
            .parser
            .lock()
            .unwrap()
            .screen()
            .contents_between(a.0, a.1, b.0, b.1 + 1);
        let at = origin + vec2(a.1 as f32 * cw, a.0 as f32 * ch);
        (!text.trim().is_empty()).then_some((text, at))
    }

    pub fn send(&mut self, bytes: &[u8]) {
        // Typing returns to the live screen, as any terminal does.
        self.parser.lock().unwrap().screen_mut().set_scrollback(0);
        self.sel = None;
        self.write_raw(bytes);
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
                // With text selected, Cmd+C copies it; otherwise it interrupts.
                egui::Event::Copy => match self.selection() {
                    Some((text, _)) => ui.ctx().copy_text(text),
                    None => self.send(b"\x03"),
                },
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

    /// Wheel travel in points (positive: up, further back), with the pointer.
    ///
    /// Where it goes depends on what's running, as in any terminal: a program
    /// that asked for the mouse gets wheel reports; a full-screen program on
    /// the alternate screen (which has no history) gets arrow keys; otherwise
    /// it scrolls back through history.
    pub fn wheel(&mut self, dy: f32, pointer: Option<Pos2>) {
        self.wheel_rest += dy / WHEEL_LINE;
        let lines = self.wheel_rest.trunc() as i32;
        if lines == 0 {
            return;
        }
        self.wheel_rest -= lines as f32;
        let (mode, encoding, alternate, app_cursor) = {
            let p = self.parser.lock().unwrap();
            let s = p.screen();
            (
                s.mouse_protocol_mode(),
                s.mouse_protocol_encoding(),
                s.alternate_screen(),
                s.application_cursor(),
            )
        };
        let up = lines > 0;
        let n = lines.unsigned_abs().min(50);
        if mode != vt100::MouseProtocolMode::None {
            let (col, row) = self.cell_at(pointer);
            let report = wheel_report(up, col, row, encoding);
            for _ in 0..n {
                self.write_raw(&report);
            }
        } else if alternate {
            let arrow: &[u8] = match (up, app_cursor) {
                (true, true) => b"\x1bOA",
                (true, false) => b"\x1b[A",
                (false, true) => b"\x1bOB",
                (false, false) => b"\x1b[B",
            };
            for _ in 0..n {
                self.write_raw(arrow);
            }
        } else {
            let mut p = self.parser.lock().unwrap();
            let s = p.screen_mut();
            let now = s.scrollback() as i32;
            s.set_scrollback((now + lines).max(0) as usize);
        }
    }

    /// Send without leaving history: for wheel reports, not typing.
    fn write_raw(&mut self, bytes: &[u8]) {
        match &mut self.backend {
            Backend::Local { writer, .. } => {
                let _ = writer.write_all(bytes);
                let _ = writer.flush();
            }
            Backend::Remote { link, .. } => link.send(bytes),
        }
    }

    /// The 1-based (column, row) under `pointer`, clamped to the grid.
    fn cell_at(&self, pointer: Option<Pos2>) -> (u16, u16) {
        let (rows, cols) = self.size;
        match (self.grid, pointer) {
            (Some((origin, cw, ch)), Some(p)) => (
                (((p.x - origin.x) / cw).floor().max(0.0) as u16 + 1).min(cols),
                (((p.y - origin.y) / ch).floor().max(0.0) as u16 + 1).min(rows),
            ),
            _ => (1, 1),
        }
    }

    /// Draw the screen into `rect`, fitting the terminal's size to it.
    pub fn draw(&mut self, ui: &egui::Ui, painter: &egui::Painter, rect: Rect, size: f32, active: bool) {
        let font = FontId::monospace(size);
        let cell = painter.layout_no_wrap("M".into(), font.clone(), INK).size();
        let (cw, ch) = (cell.x.max(1.0), cell.y.max(1.0));
        self.grid = Some((rect.min, cw, ch));
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
        if let Some((a, b)) = self.sel_range() {
            for row in a.0..=b.0.min(rows.saturating_sub(1)) {
                let from = if row == a.0 { a.1 } else { 0 };
                let to = if row == b.0 { b.1 + 1 } else { cols };
                painter.rect_filled(
                    Rect::from_min_max(
                        pos2(rect.left() + from as f32 * cw, rect.top() + row as f32 * ch),
                        pos2(rect.left() + to as f32 * cw, rect.top() + (row + 1) as f32 * ch),
                    ),
                    0.0,
                    Color32::from_rgba_unmultiplied(0x4a, 0x7f, 0xc1, 60),
                );
            }
        }
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
    /// The app's own shell ends with its card; one on the server outlives it.
    fn drop(&mut self) {
        if let Backend::Local { child, .. } = &mut self.backend {
            let _ = child.kill();
        }
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
    // Shift/Alt/Ctrl on an arrow, as xterm reports them (Shift+Up is ESC [1;2A).
    let modified = |c: u8| {
        let n = 1 + m.shift as u8 + 2 * m.alt as u8 + 4 * m.ctrl as u8;
        format!("\x1b[1;{n}{}", c as char).into_bytes()
    };
    // The editing keys a Mac terminal gives a shell: Option moves and deletes
    // by word (as Meta), Cmd by line.
    let bytes = match key {
        // A new line without sending: what Claude Code and zsh take as Meta+Enter.
        Enter if m.shift || m.alt => b"\x1b\r".to_vec(),
        Enter => b"\r".to_vec(),
        Backspace if m.mac_cmd => b"\x15".to_vec(),
        Backspace if m.alt => b"\x1b\x7f".to_vec(),
        Backspace if m.ctrl => b"\x17".to_vec(),
        Backspace => b"\x7f".to_vec(),
        Delete if m.mac_cmd => b"\x0b".to_vec(),
        Delete if m.alt || m.ctrl => b"\x1bd".to_vec(),
        Delete => b"\x1b[3~".to_vec(),
        Tab if m.shift => b"\x1b[Z".to_vec(),
        Tab => b"\t".to_vec(),
        Escape => b"\x1b".to_vec(),
        ArrowLeft if m.mac_cmd => b"\x01".to_vec(),
        ArrowRight if m.mac_cmd => b"\x05".to_vec(),
        ArrowLeft if m.alt && !m.shift => b"\x1bb".to_vec(),
        ArrowRight if m.alt && !m.shift => b"\x1bf".to_vec(),
        ArrowUp if m.shift || m.alt || m.ctrl => modified(b'A'),
        ArrowDown if m.shift || m.alt || m.ctrl => modified(b'B'),
        ArrowRight if m.shift || m.alt || m.ctrl => modified(b'C'),
        ArrowLeft if m.shift || m.alt || m.ctrl => modified(b'D'),
        ArrowUp => arrow(b'A'),
        ArrowDown => arrow(b'B'),
        ArrowRight => arrow(b'C'),
        ArrowLeft => arrow(b'D'),
        Home => b"\x1b[H".to_vec(),
        End => b"\x1b[F".to_vec(),
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
/// One wheel notch as an xterm mouse report (button 64 up, 65 down).
fn wheel_report(up: bool, col: u16, row: u16, encoding: vt100::MouseProtocolEncoding) -> Vec<u8> {
    let button: u32 = if up { 64 } else { 65 };
    match encoding {
        vt100::MouseProtocolEncoding::Sgr => format!("\x1b[<{button};{col};{row}M").into_bytes(),
        vt100::MouseProtocolEncoding::Utf8 => {
            let mut out = b"\x1b[M".to_vec();
            for v in [button + 32, col as u32 + 32, row as u32 + 32] {
                let c = char::from_u32(v).unwrap_or(' ');
                out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            }
            out
        }
        vt100::MouseProtocolEncoding::Default => {
            let byte = |v: u32| (v + 32).min(255) as u8;
            vec![0x1b, b'[', b'M', byte(button), byte(col as u32), byte(row as u32)]
        }
    }
}

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
