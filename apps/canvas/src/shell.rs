//! The Phase 2 read-only graph workspace.

use eframe::egui;

use crate::vault_host::{VaultStatus, VaultView};

const PAPER: egui::Color32 = egui::Color32::from_rgb(0xfa, 0xf9, 0xf5);
const FAINT: egui::Color32 = egui::Color32::from_rgb(0x68, 0x6a, 0x66);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerRow {
    Folder { key: String, label: String },
    Note { key: String, label: String },
}

pub fn explorer_rows(_view: &VaultView) -> Vec<ExplorerRow> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_host::VaultSnapshot;
    use tapestry_vault::index::VaultIndex;
    use tapestry_vault::scan::Scan;

    #[test]
    fn explorer_rows_lists_indexed_folders_before_notes() {
        let index = VaultIndex::build(&Scan {
            root: "/vault".into(),
            folders: vec!["".into(), "z-folder".into(), "a-folder".into()],
            notes: Vec::new(),
            skipped: Vec::new(),
            truncated: false,
        });
        let view = VaultView {
            status: VaultStatus::Ready,
            snapshot: Some(VaultSnapshot {
                root: "/vault".into(),
                index: std::sync::Arc::new(index),
            }),
        };
        assert_eq!(
            explorer_rows(&view),
            vec![
                ExplorerRow::Folder { key: "a-folder".into(), label: "a-folder".into() },
                ExplorerRow::Folder { key: "z-folder".into(), label: "z-folder".into() },
            ]
        );
    }
}

pub fn workspace(ui: &mut egui::Ui, view: &VaultView) {
    egui::CentralPanel::default()
        .frame(egui::Frame::NONE.fill(PAPER))
        .show(ui, |ui| {
            let canvas = ui.max_rect();
            ui.painter().rect_filled(canvas, 0, PAPER);
            match &view.status {
                VaultStatus::Loading if view.snapshot.is_none() => {
                    ui.painter().text(
                        canvas.center(),
                        egui::Align2::CENTER_CENTER,
                        "Loading vault…",
                        egui::FontId::proportional(14.0),
                        FAINT,
                    );
                }
                VaultStatus::Error(_) if view.snapshot.is_none() => {
                    ui.painter().text(
                        canvas.center(),
                        egui::Align2::CENTER_CENTER,
                        "Couldn’t open this folder. Check that it exists and is readable, then choose another folder.",
                        egui::FontId::proportional(14.0),
                        FAINT,
                    );
                }
                VaultStatus::Error(_) => {
                    ui.painter().text(
                        canvas.left_top() + egui::vec2(16.0, 16.0),
                        egui::Align2::LEFT_TOP,
                        "Couldn’t open this folder. Check that it exists and is readable, then choose another folder.",
                        egui::FontId::proportional(12.0),
                        FAINT,
                    );
                }
                VaultStatus::Loading | VaultStatus::Ready => {}
            }
        });
}
