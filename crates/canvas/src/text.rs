//! A note's text as a vector a mimic can carry.
//!
//! No model and nothing learned: every word (lowercased, three letters or
//! more, common words left out) is hashed to a fixed random direction, and
//! the note's vector is the sum of its words' directions, each counted with
//! diminishing returns, scaled to length 1. Notes sharing words point
//! alike; notes sharing none point every which way. It knows words, not
//! meanings: "car" and "automobile" are strangers to it.
//!
//! The app works this out when a note is read and stores the vector in the
//! keyframe, so the canvas never reads files itself and replays the same
//! even after the note changes.

use crate::mind::{N, Vector, normalize};
use crate::sim::{mix, unit};

const COMMON: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one",
    "our", "out", "has", "him", "his", "how", "its", "may", "new", "now", "see", "two", "who", "did",
    "get", "she", "too", "use", "that", "with", "have", "this", "will", "your", "from", "they", "been",
    "were", "what", "when", "them", "than", "then", "there", "their", "which", "would", "could",
    "should", "about", "into", "just", "like", "some", "more", "also", "very", "only", "over", "such",
    "each", "here", "where", "it's", "i'm", "don't",
];

/// The words that count, in order, repeats kept, each cut back to its
/// stem so "tomatoes" and "tomato" are one word.
pub fn words(text: &str) -> Vec<String> {
    spelled(text).into_iter().map(|(stem, _)| stem).collect()
}

/// Each word that counts: its stem, and how it was written.
fn spelled(text: &str) -> Vec<(String, String)> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .map(|w| w.trim_matches('\'').to_lowercase())
        .filter(|w| w.chars().count() >= 3 && !COMMON.contains(&w.as_str()))
        .map(|w| (stem(&w), w))
        .collect()
}

/// A rough English stem: a plural or -ing/-ed ending off, if enough is left.
fn stem(w: &str) -> String {
    let w = w.strip_suffix("'s").unwrap_or(w);
    for (end, with) in [("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", "")] {
        if let Some(rest) = w.strip_suffix(end)
            && rest.chars().count() >= 3
            && !(end == "s" && rest.ends_with('s'))
        {
            return format!("{rest}{with}");
        }
    }
    w.to_owned()
}

/// The note's vector.
pub fn vector(text: &str) -> Vector {
    let mut counts: Vec<(u64, f32)> = Vec::new();
    for w in words(text) {
        let h = fnv(&w);
        match counts.iter_mut().find(|(k, _)| *k == h) {
            Some((_, c)) => *c += 1.0,
            None => counts.push((h, 1.0)),
        }
    }
    let mut v = [0.0; N];
    for (h, c) in counts {
        // A word said twice counts a bit more than once, not twice as much.
        let weight = 1.0 + (c - 1.0).min(4.0) * 0.25;
        for (d, x) in v.iter_mut().enumerate() {
            *x += weight * (unit(h, d as u64) * 2.0 - 1.0);
        }
    }
    normalize(v)
}

/// The words two notes share, most repeated first, at most `limit`, as
/// the first note writes them.
pub fn shared(a: &str, b: &str, limit: usize) -> Vec<String> {
    let wb = words(b);
    let mut out: Vec<(usize, String, String)> = Vec::new();
    for (stem, written) in spelled(a) {
        if wb.contains(&stem) {
            match out.iter_mut().find(|(_, s, _)| *s == stem) {
                Some((n, _, _)) => *n += 1,
                None => out.push((1, stem, written)),
            }
        }
    }
    out.sort_by(|x, y| y.0.cmp(&x.0).then(x.1.cmp(&y.1)));
    out.into_iter().take(limit).map(|(_, _, w)| w).collect()
}

/// The id of the mimic that carries the note named `name`.
pub fn note_id(name: &str) -> u64 {
    mix(fnv(name), 0x6e6f7465)
}

/// FNV-1a: a plain, stable hash of the bytes.
fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}
