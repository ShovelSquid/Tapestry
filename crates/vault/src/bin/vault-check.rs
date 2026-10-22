//! Read-only Obsidian vault inspection.
//!
//! ```text
//! vault-check <vault-dir> [--strict]
//! vault-check --help
//! ```
//! Reports scan, links, frontmatter and layout without writing to the vault.

use std::path::PathBuf;
use std::process::ExitCode;
use tapestry_vault::index::{FmStatus, Resolution, VaultIndex};
use tapestry_vault::scan::{scan, stat_tree};

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("usage: vault-check <vault-dir> [--strict]");
        return ExitCode::SUCCESS;
    }
    let strict = args.iter().any(|a| a == "--strict");
    let Some(root) = args.iter().find(|a| !a.starts_with('-')).map(PathBuf::from) else {
        eprintln!("usage: vault-check <vault-dir> [--strict]");
        return ExitCode::FAILURE;
    };
    let before = match stat_tree(&root) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}: {e}", root.display());
            return ExitCode::FAILURE;
        }
    };
    let tapestry_before = root.join(".tapestry").exists();
    let vault = match scan(&root) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{}: {e}", root.display());
            return ExitCode::FAILURE;
        }
    };
    let index = VaultIndex::build(&vault);
    let mut resolved = 0;
    let mut ambiguous = 0;
    let mut unresolved = 0;
    for link in &index.links {
        match &link.target {
            Resolution::Resolved(_) => resolved += 1,
            Resolution::Ambiguous { candidates, .. } => {
                ambiguous += 1;
                println!(
                    "ambiguous: {}:{} {:?} candidates={:?}",
                    link.source,
                    link.source_line + 1,
                    link.path,
                    candidates
                );
            }
            Resolution::Unresolved => {
                unresolved += 1;
                println!(
                    "unresolved: {}:{} {:?}",
                    link.source,
                    link.source_line + 1,
                    link.path
                );
            }
        }
    }
    let invalid: Vec<_> = index
        .notes
        .values()
        .filter(|n| matches!(n.frontmatter, FmStatus::Invalid(_)))
        .collect();
    for note in &invalid {
        println!("invalid frontmatter: {}: {:?}", note.rel, note.frontmatter);
    }
    let conflicts: Vec<_> = index
        .notes
        .values()
        .filter(|n| !n.layout.conflicts.is_empty())
        .collect();
    for note in &conflicts {
        println!("layout conflict: {}: {:?}", note.rel, note.layout.conflicts);
    }
    let after = match stat_tree(&root) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}: {e}", root.display());
            return ExitCode::FAILURE;
        }
    };
    let modified = before
        .iter()
        .filter(|(k, v)| after.get(*k) != Some(*v))
        .count()
        + after.keys().filter(|k| !before.contains_key(*k)).count()
        + usize::from(!tapestry_before && root.join(".tapestry").exists());
    println!("vault: {}", vault.root.display());
    println!(
        "notes: {} (skipped: {}, truncated: {})",
        vault.notes.len(),
        vault.skipped.len(),
        vault.truncated
    );
    println!("folders: {}", vault.folders.len());
    println!(
        "links: {} resolved, {} ambiguous, {} unresolved",
        resolved, ambiguous, unresolved
    );
    println!(
        "computed placements: {}",
        index.notes.values().filter(|n| n.computed).count()
    );
    println!("modified: {modified}");
    if modified > 0 || (strict && (!invalid.is_empty() || unresolved > 0)) {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
