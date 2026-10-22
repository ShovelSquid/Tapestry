//! Raw-input filtering for shell-global shortcuts.

use eframe::egui;

/// Consume Cmd-K before terminal input is drained and report that the palette
/// should open during the current app frame.
pub fn filter_palette_shortcut(events: &mut Vec<egui::Event>) -> bool {
    let mut open_palette = false;
    let mut discard_associated_text = false;
    events.retain(|event| match event {
        egui::Event::Key {
            key: egui::Key::K,
            pressed,
            modifiers,
            ..
        } if modifiers.command => {
            open_palette |= *pressed;
            discard_associated_text = *pressed;
            false
        }
        egui::Event::Text(text)
            if discard_associated_text && matches!(text.as_str(), "k" | "K") =>
        {
            discard_associated_text = false;
            false
        }
        _ => {
            discard_associated_text = false;
            true
        }
    });
    open_palette
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_k_opens_palette_and_removes_key_and_text_before_terminal_input() {
        let mut events = vec![
            egui::Event::Key {
                key: egui::Key::K,
                physical_key: Some(egui::Key::K),
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::COMMAND,
            },
            egui::Event::Text("k".into()),
            egui::Event::Text("x".into()),
        ];
        assert!(filter_palette_shortcut(&mut events));
        assert_eq!(events, vec![egui::Event::Text("x".into())]);
    }

    #[test]
    fn plain_k_remains_available_to_the_terminal() {
        let key = egui::Event::Key {
            key: egui::Key::K,
            physical_key: Some(egui::Key::K),
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        };
        let mut events = vec![key.clone(), egui::Event::Text("k".into())];
        assert!(!filter_palette_shortcut(&mut events));
        assert_eq!(events, vec![key, egui::Event::Text("k".into())]);
    }
}
