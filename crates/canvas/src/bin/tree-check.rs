//! Check rule notes the way the canvas reads them.
//!
//! ```text
//! tree-check                 every note in world/rules
//! tree-check a.tree dir/     these notes, or every note in these folders
//! tree-check --grammar       the basic rules as they stand
//! ```
//!
//! For each note it prints the rule lines as the canvas understood them, and
//! every line that didn't read. It exits 1 if any line didn't, so an agent
//! writing rule lines can check its own work.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use tapestry_canvas::{RuleNote, grammar};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--grammar") {
        println!("{}", grammar());
        return ExitCode::SUCCESS;
    }
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("usage: tree-check [--grammar] [note.tree | folder]...");
        return ExitCode::SUCCESS;
    }
    let targets: Vec<PathBuf> = if args.is_empty() {
        vec![default_rules()]
    } else {
        args.iter().map(PathBuf::from).collect()
    };

    let mut files = Vec::new();
    for t in &targets {
        if t.is_dir() {
            match std::fs::read_dir(t) {
                Ok(entries) => {
                    let mut found: Vec<_> = entries
                        .filter_map(|e| e.ok().map(|e| e.path()))
                        .filter(|p| p.extension().is_some_and(|e| e == "tree"))
                        .collect();
                    found.sort();
                    files.extend(found);
                }
                Err(e) => {
                    eprintln!("{}: {e}", t.display());
                    return ExitCode::FAILURE;
                }
            }
        } else {
            files.push(t.clone());
        }
    }

    let mut bad = false;
    for path in &files {
        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{}: {e}", path.display());
                bad = true;
                continue;
            }
        };
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let note = RuleNote::parse(name, &source);
        println!("{} — {}", path.display(), note.title);
        for b in &note.basics {
            println!("  ok    {b}");
        }
        for p in &note.problems {
            println!("  line {}: {}", p.line, p.message);
        }
        if note.inert() && note.problems.is_empty() {
            println!("  (no rule lines: this note does nothing yet)");
        }
        bad |= !note.problems.is_empty();
    }
    if bad {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

/// `world/rules` in the nearest folder above here that has one.
fn default_rules() -> PathBuf {
    let here = std::env::current_dir().unwrap_or_default();
    let mut dir: Option<&Path> = Some(&here);
    while let Some(d) = dir {
        if d.file_name().is_some_and(|n| n == "rules")
            && d.parent().is_some_and(|p| p.ends_with("world"))
        {
            return d.to_path_buf();
        }
        let rules = d.join("world/rules");
        if rules.is_dir() {
            return rules;
        }
        dir = d.parent();
    }
    PathBuf::from("world/rules")
}
