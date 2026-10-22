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

/// A shell chord on a key event, and the text its press would type.
fn chord(event: &egui::Event) -> Option<(Chord, bool)> {
    let egui::Event::Key {
        key,
        pressed,
        modifiers,
        ..
    } = event
    else {
        return None;
    };
    match key {
        // Check the more specific modifier combination first.
        egui::Key::W if modifiers.command && modifiers.shift => Some((Chord::ExitView, *pressed)),
        egui::Key::K if modifiers.command && !modifiers.shift => {
            Some((Chord::OpenPalette, *pressed))
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Chord {
    OpenPalette,
    ExitView,
}

impl Chord {
    fn letter(self) -> &'static str {
        match self {
            Self::OpenPalette => "k",
            Self::ExitView => "w",
        }
    }
}

/// Remove Cmd-K and Cmd-Shift-W, with the text each press would type, from
/// the raw events and report them.
pub fn filter_shell_chords(events: &mut Vec<egui::Event>) -> ShellChords {
    let mut found = ShellChords::default();
    let mut pending_text: Option<Chord> = None;
    events.retain(|event| {
        if let Some((chord, pressed)) = chord(event) {
            if pressed {
                match chord {
                    Chord::OpenPalette => found.open_palette = true,
                    Chord::ExitView => found.exit_view = true,
                }
                pending_text = Some(chord);
            } else {
                pending_text = None;
            }
            return false;
        }
        if let (Some(chord), egui::Event::Text(text)) = (pending_text, event) {
            pending_text = None;
            if text.eq_ignore_ascii_case(chord.letter()) {
                return false;
            }
            return true;
        }
        pending_text = None;
        true
    });
    found
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
pub fn route_escape(destination: &Destination, focus: KeyFocus) -> EscapeRoute {
    if focus.palette_open {
        EscapeRoute::ClosePalette
    } else if focus.owner_claims_keyboard || focus.tool_claims_escape {
        EscapeRoute::Owner
    } else if destination.is_hosted() {
        EscapeRoute::ReturnToGraph
    } else {
        EscapeRoute::GraphCancel
    }
}

/// What each hosted tool has open that reads Esc itself.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ToolEscape {
    /// A keyframe picked on the simulation's timeline.
    pub keyframe_picked: bool,
    /// A rule card open for writing.
    pub rule_editing: bool,
    /// A note card open for writing.
    pub note_editing: bool,
}

/// Whether the showing tool has its own use for Esc: Esc puts a picked
/// keyframe or an open rule or note card down before it leaves the view,
/// even when the card's text field doesn't have the keyboard.
pub fn tool_claims_escape(destination: &Destination, open: ToolEscape) -> bool {
    match destination {
        Destination::Simulation => open.keyframe_picked,
        Destination::Rules => open.rule_editing,
        Destination::Notes => open.note_editing,
        _ => false,
    }
}

/// An opened file or terminal card has the keyboard only in Files, the one
/// view that draws it and reads its Esc. Elsewhere, Terminals included, a
/// card left open must not swallow Esc and marks undo.
pub fn opened_card_claims_keyboard(destination: &Destination, card_open: bool) -> bool {
    card_open && *destination == Destination::Files
}

/// Where the exit chord takes the window: from any hosted view back to the
/// graph workspace.
pub fn route_exit_chord(destination: &Destination) -> Option<Destination> {
    destination.is_hosted().then_some(Destination::Graph)
}

/// Space, digits, Delete, Cmd-Z, arrows and Home act on the simulation only
/// while it shows and nothing else has the keyboard.
pub fn simulation_keys_active(destination: &Destination, focus: KeyFocus) -> bool {
    *destination == Destination::Simulation && !focus.palette_open && !focus.owner_claims_keyboard
}

/// While the palette is open it has the keyboard: take key, text, and
/// clipboard events away from the views drawn under it, to hand back to the
/// palette once they're drawn.
pub fn withhold_keyboard(events: &mut Vec<egui::Event>) -> Vec<egui::Event> {
    let mut held = Vec::new();
    events.retain(|event| {
        let keyboard = matches!(
            event,
            egui::Event::Key { .. }
                | egui::Event::Text(_)
                | egui::Event::Paste(_)
                | egui::Event::Copy
                | egui::Event::Cut
                | egui::Event::Ime(_)
        );
        if keyboard {
            held.push(event.clone());
        }
        !keyboard
    });
    held
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
        assert!(filter_shell_chords(&mut events).open_palette);
        assert_eq!(events, vec![egui::Event::Text("x".into())]);
    }

    #[test]
    fn plain_k_remains_available_to_the_terminal() {
        let plain = key(egui::Key::K, true, egui::Modifiers::NONE);
        let mut events = vec![plain.clone(), egui::Event::Text("k".into())];
        assert_eq!(filter_shell_chords(&mut events), ShellChords::default());
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
        assert_eq!(
            route_escape(&Destination::Graph, all),
            EscapeRoute::ClosePalette
        );
        assert_eq!(route_escape(&terminals, owner), EscapeRoute::Owner);
        assert_eq!(route_escape(&Destination::Files, tool), EscapeRoute::Owner);
        assert_eq!(route_escape(&terminals, free), EscapeRoute::ReturnToGraph);
        assert_eq!(
            route_escape(&Destination::Simulation, free),
            EscapeRoute::ReturnToGraph
        );
        assert_eq!(route_escape(&Destination::Graph, owner), EscapeRoute::Owner);
        assert_eq!(
            route_escape(&Destination::Graph, free),
            EscapeRoute::GraphCancel
        );
    }

    #[test]
    fn input_router_open_rule_and_note_cards_take_esc_before_leaving() {
        let rule = ToolEscape {
            rule_editing: true,
            ..ToolEscape::default()
        };
        let note = ToolEscape {
            note_editing: true,
            ..ToolEscape::default()
        };
        let keyframe = ToolEscape {
            keyframe_picked: true,
            ..ToolEscape::default()
        };
        assert!(tool_claims_escape(&Destination::Rules, rule));
        assert!(tool_claims_escape(&Destination::Notes, note));
        assert!(tool_claims_escape(&Destination::Simulation, keyframe));
        // Only the tool that shows: a card left open elsewhere claims nothing.
        assert!(!tool_claims_escape(&Destination::Notes, rule));
        assert!(!tool_claims_escape(&Destination::Rules, note));
        assert!(!tool_claims_escape(&Destination::Graph, rule));
        assert!(!tool_claims_escape(&Destination::Rules, ToolEscape::default()));
        let focus = KeyFocus {
            tool_claims_escape: tool_claims_escape(&Destination::Rules, rule),
            ..KeyFocus::default()
        };
        assert_eq!(route_escape(&Destination::Rules, focus), EscapeRoute::Owner);
    }

    #[test]
    fn input_router_opened_card_claims_esc_only_where_it_is_drawn() {
        assert!(opened_card_claims_keyboard(&Destination::Files, true));
        assert!(!opened_card_claims_keyboard(&Destination::Files, false));
        for other in [
            Destination::Terminals,
            Destination::Graph,
            Destination::Simulation,
            Destination::File("/vault/a.md".into()),
        ] {
            assert!(!opened_card_claims_keyboard(&other, true), "{other:?}");
        }
        // With a card left open, Esc in Terminals still returns to the graph.
        let focus = KeyFocus {
            owner_claims_keyboard: opened_card_claims_keyboard(&Destination::Terminals, true),
            ..KeyFocus::default()
        };
        assert_eq!(
            route_escape(&Destination::Terminals, focus),
            EscapeRoute::ReturnToGraph
        );
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
