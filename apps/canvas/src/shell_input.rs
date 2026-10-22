//! The shell's one keyboard policy.
//!
//! Shell-global chords are taken out of the raw input before egui (and so
//! before any terminal drains `InputState.events`) sees them: Cmd-K opens the
//! palette, and Cmd-Shift-W leaves a hosted view, terminals included. Esc
//! then follows one precedence, and the simulation's own keys run only while
//! the Simulation destination is showing.

use eframe::egui;

use crate::shell::Destination;

/// Shell chords found in this frame's raw input, for `App::ui` to apply.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ShellChords {
    pub open_palette: bool,
    pub exit_view: bool,
}

/// Remove Cmd-K and Cmd-Shift-W, with the text each press would type, from
/// the raw events and report them.
pub fn filter_shell_chords(events: &mut Vec<egui::Event>) -> ShellChords {
    ShellChords {
        open_palette: filter_palette_shortcut(events),
        exit_view: false,
    }
}

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

/// Who has the keyboard this frame.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct KeyFocus {
    pub palette_open: bool,
    /// A text field, an editor, or a terminal has the keyboard.
    pub owner_claims_keyboard: bool,
    /// The hosted tool has its own use for Esc right now: an open file card,
    /// a rule being written, a picked keyframe.
    pub tool_claims_escape: bool,
}

/// What a press of Esc does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscapeRoute {
    ClosePalette,
    /// Leave it to the focused editor, terminal, or tool.
    Owner,
    ReturnToGraph,
    /// Canvas-local cancel on the graph workspace.
    GraphCancel,
}

/// Esc precedence: palette, then the focused owner or tool, then leaving the
/// hosted view, then the graph's own cancel.
pub fn route_escape(_destination: &Destination, _focus: KeyFocus) -> EscapeRoute {
    EscapeRoute::Owner
}

/// Where the exit chord takes the window: from any hosted view back to the
/// graph workspace.
pub fn route_exit_chord(_destination: &Destination) -> Option<Destination> {
    None
}

/// Space, digits, Delete, Cmd-Z, arrows and Home act on the simulation only
/// while it shows and nothing else has the keyboard.
pub fn simulation_keys_active(_destination: &Destination, _focus: KeyFocus) -> bool {
    true
}

/// While the palette is open it has the keyboard: take key, text, and
/// clipboard events away from the views drawn under it, to hand back to the
/// palette once they're drawn.
pub fn withhold_keyboard(_events: &mut Vec<egui::Event>) -> Vec<egui::Event> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(key: egui::Key, pressed: bool, modifiers: egui::Modifiers) -> egui::Event {
        egui::Event::Key {
            key,
            physical_key: Some(key),
            pressed,
            repeat: false,
            modifiers,
        }
    }

    fn cmd_shift() -> egui::Modifiers {
        egui::Modifiers::COMMAND | egui::Modifiers::SHIFT
    }

    #[test]
    fn cmd_k_opens_palette_and_removes_key_and_text_before_terminal_input() {
        let mut events = vec![
            key(egui::Key::K, true, egui::Modifiers::COMMAND),
            egui::Event::Text("k".into()),
            egui::Event::Text("x".into()),
        ];
        assert!(filter_palette_shortcut(&mut events));
        assert_eq!(events, vec![egui::Event::Text("x".into())]);
    }

    #[test]
    fn plain_k_remains_available_to_the_terminal() {
        let plain = key(egui::Key::K, true, egui::Modifiers::NONE);
        let mut events = vec![plain.clone(), egui::Event::Text("k".into())];
        assert!(!filter_palette_shortcut(&mut events));
        assert_eq!(events, vec![plain, egui::Event::Text("k".into())]);
    }

    #[test]
    fn input_router_cmd_k_with_terminal_focus_opens_palette_before_pty_input() {
        // What a focused terminal would drain this frame.
        let mut events = vec![
            egui::Event::Text("l".into()),
            key(egui::Key::K, true, egui::Modifiers::COMMAND),
            egui::Event::Text("k".into()),
            key(egui::Key::K, false, egui::Modifiers::COMMAND),
            egui::Event::Text("s".into()),
        ];
        let chords = filter_shell_chords(&mut events);
        assert_eq!(
            chords,
            ShellChords {
                open_palette: true,
                exit_view: false
            }
        );
        assert_eq!(
            events,
            vec![egui::Event::Text("l".into()), egui::Event::Text("s".into())]
        );
    }

    #[test]
    fn input_router_exit_chord_is_filtered_in_both_event_forms() {
        let mut events = vec![
            key(egui::Key::W, true, cmd_shift()),
            egui::Event::Text("W".into()),
            key(egui::Key::W, false, cmd_shift()),
            egui::Event::Text("a".into()),
        ];
        let chords = filter_shell_chords(&mut events);
        assert!(chords.exit_view);
        assert!(!chords.open_palette);
        assert_eq!(events, vec![egui::Event::Text("a".into())]);
        // Plain W and Cmd-W without Shift still reach the terminal.
        let plain = vec![
            key(egui::Key::W, true, egui::Modifiers::NONE),
            egui::Event::Text("w".into()),
            key(egui::Key::W, true, egui::Modifiers::COMMAND),
        ];
        let mut kept = plain.clone();
        assert_eq!(filter_shell_chords(&mut kept), ShellChords::default());
        assert_eq!(kept, plain);
        // The chord leaves any hosted view, and does nothing on the graph.
        for hosted in [
            Destination::Terminals,
            Destination::Simulation,
            Destination::Files,
            Destination::File("/vault/a.md".into()),
        ] {
            assert_eq!(route_exit_chord(&hosted), Some(Destination::Graph));
        }
        assert_eq!(route_exit_chord(&Destination::Graph), None);
    }

    #[test]
    fn input_router_escape_follows_the_locked_precedence() {
        let all = KeyFocus {
            palette_open: true,
            owner_claims_keyboard: true,
            tool_claims_escape: true,
        };
        let owner = KeyFocus {
            owner_claims_keyboard: true,
            ..KeyFocus::default()
        };
        let tool = KeyFocus {
            tool_claims_escape: true,
            ..KeyFocus::default()
        };
        let free = KeyFocus::default();
        let terminals = Destination::Terminals;
        assert_eq!(route_escape(&terminals, all), EscapeRoute::ClosePalette);
        assert_eq!(route_escape(&Destination::Graph, all), EscapeRoute::ClosePalette);
        assert_eq!(route_escape(&terminals, owner), EscapeRoute::Owner);
        assert_eq!(route_escape(&Destination::Files, tool), EscapeRoute::Owner);
        assert_eq!(route_escape(&terminals, free), EscapeRoute::ReturnToGraph);
        assert_eq!(route_escape(&Destination::Simulation, free), EscapeRoute::ReturnToGraph);
        assert_eq!(route_escape(&Destination::Graph, owner), EscapeRoute::Owner);
        assert_eq!(route_escape(&Destination::Graph, free), EscapeRoute::GraphCancel);
    }

    #[test]
    fn input_router_simulation_bindings_fire_only_while_simulation_is_hosted() {
        let free = KeyFocus::default();
        assert!(simulation_keys_active(&Destination::Simulation, free));
        for other in [
            Destination::Graph,
            Destination::Rules,
            Destination::Files,
            Destination::Terminals,
            Destination::Notes,
            Destination::File("/vault/a.md".into()),
        ] {
            assert!(!simulation_keys_active(&other, free), "{other:?}");
        }
        for claimed in [
            KeyFocus {
                owner_claims_keyboard: true,
                ..free
            },
            KeyFocus {
                palette_open: true,
                ..free
            },
        ] {
            assert!(!simulation_keys_active(&Destination::Simulation, claimed));
        }
        // A picked keyframe keeps Space, digits and Delete working.
        assert!(simulation_keys_active(
            &Destination::Simulation,
            KeyFocus {
                tool_claims_escape: true,
                ..free
            }
        ));
    }

    #[test]
    fn input_router_open_palette_withholds_keyboard_from_hosted_views() {
        let pointer = egui::Event::PointerMoved(egui::pos2(4.0, 4.0));
        let mut events = vec![
            egui::Event::Text("l".into()),
            pointer.clone(),
            key(egui::Key::Enter, true, egui::Modifiers::NONE),
            egui::Event::Paste("rm -rf".into()),
            egui::Event::Copy,
        ];
        let held = withhold_keyboard(&mut events);
        assert_eq!(events, vec![pointer]);
        assert_eq!(
            held,
            vec![
                egui::Event::Text("l".into()),
                key(egui::Key::Enter, true, egui::Modifiers::NONE),
                egui::Event::Paste("rm -rf".into()),
                egui::Event::Copy,
            ]
        );
    }
}
