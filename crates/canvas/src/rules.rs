//! Rule notes: `.tree` files, written in the basic rules.
//!
//! A rule file is a note. Its first `#` line is the title, its prose says what
//! the rule means, and its rule lines say it in the basic rules:
//!
//! ```text
//! # Fire spreads to trees
//! A tree near fire heats up, and catches.
//!
//! change tree heat +1.5/s within 18 of fire or flame
//! convert tree to fire at heat 1 ±60%
//! ```
//!
//! A rule line starts with a basic rule's name in lower case; every other line
//! is prose. A note with no rule lines says nothing definite, so it does
//! nothing. A line that doesn't read is reported against its line number, and
//! the rest of the note still works.

use std::fmt;
use std::path::Path;

use crate::sim::Material;

/// A property the basic rules can change and test.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prop {
    Heat,
    Wet,
}

impl Prop {
    pub const ALL: [Prop; 2] = [Prop::Heat, Prop::Wet];

    fn from_name(s: &str) -> Option<Self> {
        match s {
            "heat" => Some(Prop::Heat),
            "wet" => Some(Prop::Wet),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Becomes {
    Material(Material),
    Gone,
}

/// The basic rules (log 0009). Only `change` and `convert` are built so far;
/// set, spawn, move and remove are recognised and reported as not yet built.
#[derive(Clone, Debug, PartialEq)]
pub enum Basic {
    /// While a `who` is within `radius` of any of `near`, its `prop` rises by
    /// `rate` per second.
    Change {
        who: Material,
        near: Vec<Material>,
        radius: f32,
        prop: Prop,
        rate: f32,
    },
    /// When a `who`'s `prop` reaches `at` it becomes `to`. Each point's own
    /// threshold is `at` give or take `vary` of it, from its ID, so a crowd
    /// doesn't turn all at once and a replay turns exactly the same way.
    Convert {
        who: Material,
        prop: Prop,
        at: f32,
        vary: f32,
        to: Becomes,
    },
}

const BUILT: [&str; 2] = ["change", "convert"];
const NOT_YET: [&str; 4] = ["set", "spawn", "move", "remove"];

/// The basic rules as they stand, in words: what an author (or an agent
/// translating prose) can write today. Built from the same lists the parser
/// reads, so it can't fall behind it.
pub fn grammar() -> String {
    let names = |v: Vec<&str>| v.join(", ");
    let materials = names(Material::ALL.iter().map(|m| m.name()).collect());
    let props = names(Prop::ALL.iter().map(|p| p.name()).collect());
    format!(
        "\
Rule lines (one per line; every other line of a note is prose):

  change <who> <prop> <±rate>/s within <distance> of <material> [or <material>...]
      While a <who> is within <distance> of any of the listed materials, its
      <prop> changes by <rate> each second. Rates may be negative.

  convert <who> to <material|nothing> at <prop> <threshold> [±<spread>%]
      When a <who>'s <prop> reaches <threshold> it becomes the material
      (or vanishes, for \"nothing\"). The spread varies each particle's
      threshold so a crowd doesn't turn all at once.

Materials: {materials}
Properties: {props}
Built: {built}
Recognised but not built yet: {not_yet}

Every property starts at 0 when a particle is made or converted, and only
change lines move it (except that wet ink dries a little each second by
itself). Distances are canvas units (about a pixel; the canvas
is {w} by {h}). Lines starting with // are comments.",
        built = names(BUILT.to_vec()),
        not_yet = names(NOT_YET.to_vec()),
        w = crate::sim::WIDTH,
        h = crate::sim::HEIGHT,
    )
}

/// A line of a note that didn't read.
#[derive(Clone, Debug, PartialEq)]
pub struct Problem {
    /// 1-based, as an editor shows it.
    pub line: usize,
    pub message: String,
}

/// One rule file, read.
#[derive(Clone, Debug, PartialEq)]
pub struct RuleNote {
    /// The file's name without `.tree`. Keyframes refer to the note by it.
    pub name: String,
    pub title: String,
    pub text: String,
    pub basics: Vec<Basic>,
    pub problems: Vec<Problem>,
    /// The file as written.
    pub source: String,
}

impl RuleNote {
    /// Read a note. Never fails: what doesn't read becomes a problem.
    pub fn parse(name: &str, source: &str) -> Self {
        let mut title = None;
        let mut text: Vec<&str> = Vec::new();
        let mut basics = Vec::new();
        let mut problems = Vec::new();
        for (n, raw) in source.lines().enumerate() {
            let line = raw.trim();
            let first = line.split_whitespace().next().unwrap_or("");
            if line.starts_with("//") {
                continue;
            }
            if let Some(t) = line.strip_prefix('#')
                && title.is_none()
            {
                title = Some(t.trim().to_owned());
            } else if BUILT.contains(&first) {
                match parse_basic(line) {
                    Ok(b) => basics.push(b),
                    Err(message) => problems.push(Problem {
                        line: n + 1,
                        message,
                    }),
                }
            } else if NOT_YET.contains(&first) {
                problems.push(Problem {
                    line: n + 1,
                    message: format!("“{first}” is a basic rule that isn't built yet"),
                });
            } else if !line.is_empty() || !text.is_empty() {
                text.push(line);
            }
        }
        while text.last().is_some_and(|l| l.is_empty()) {
            text.pop();
        }
        Self {
            name: name.to_owned(),
            title: title.unwrap_or_else(|| name.replace('-', " ")),
            text: text.join("\n"),
            basics,
            problems,
            source: source.to_owned(),
        }
    }

    /// A note with no working rule lines changes nothing.
    pub fn inert(&self) -> bool {
        self.basics.is_empty()
    }
}

/// Every rule note in a world, ordered by file name.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rulebook {
    pub notes: Vec<RuleNote>,
}

impl Rulebook {
    /// Read `(name, source)` pairs.
    pub fn from_sources<'a>(files: impl IntoIterator<Item = (&'a str, &'a str)>) -> Self {
        let mut notes: Vec<_> = files
            .into_iter()
            .map(|(name, src)| RuleNote::parse(name, src))
            .collect();
        notes.sort_by(|a, b| a.name.cmp(&b.name));
        Self { notes }
    }

    /// Read every `.tree` file in `dir`.
    pub fn load(dir: &Path) -> std::io::Result<Self> {
        let mut files = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "tree")
                && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
            {
                files.push((stem.to_owned(), std::fs::read_to_string(&path)?));
            }
        }
        Ok(Self::from_sources(
            files.iter().map(|(n, s)| (n.as_str(), s.as_str())),
        ))
    }

    pub fn index(&self, name: &str) -> Option<usize> {
        self.notes.iter().position(|n| n.name == name)
    }

    pub fn get(&self, name: &str) -> Option<&RuleNote> {
        self.notes.iter().find(|n| n.name == name)
    }

    pub fn len(&self) -> usize {
        self.notes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.notes.is_empty()
    }
}

/// Reads one rule line, or says what's wrong with it.
fn parse_basic(line: &str) -> Result<Basic, String> {
    let words: Vec<&str> = line
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|w| !w.is_empty())
        .collect();
    let mut w = Words {
        words: &words,
        at: 0,
    };
    match w.next("a basic rule")? {
        "change" => {
            let who = w.material()?;
            let prop = w.prop()?;
            let rate = w.next("a rate like +1.5/s")?;
            let rate = rate
                .strip_suffix("/s")
                .ok_or_else(|| format!("a rate is per second, like “{rate}/s”"))?;
            let rate = number(rate)?;
            w.expect("within")?;
            let radius = number(w.next("a distance")?)?;
            w.expect("of")?;
            let mut near = vec![w.material()?];
            while let Some(word) = w.peek() {
                if word == "or" {
                    w.at += 1;
                }
                near.push(w.material()?);
            }
            Ok(Basic::Change {
                who,
                near,
                radius,
                prop,
                rate,
            })
        }
        "convert" => {
            let who = w.material()?;
            w.expect("to")?;
            let to = match w.next("what it becomes")? {
                "nothing" => Becomes::Gone,
                m => Becomes::Material(material(m)?),
            };
            w.expect("at")?;
            let prop = w.prop()?;
            let at = number(w.next("a threshold")?)?;
            let vary = match w.peek() {
                None => 0.0,
                Some(v) => {
                    w.at += 1;
                    let v = v
                        .strip_prefix('±')
                        .or_else(|| v.strip_prefix("+-"))
                        .and_then(|v| v.strip_suffix('%'))
                        .ok_or_else(|| format!("“{v}” should be a spread like ±50%"))?;
                    number(v)? / 100.0
                }
            };
            w.end()?;
            Ok(Basic::Convert {
                who,
                prop,
                at,
                vary,
                to,
            })
        }
        other => Err(format!("“{other}” isn't a basic rule")),
    }
}

struct Words<'a> {
    words: &'a [&'a str],
    at: usize,
}

impl<'a> Words<'a> {
    fn peek(&self) -> Option<&'a str> {
        self.words.get(self.at).copied()
    }

    fn next(&mut self, wanted: &str) -> Result<&'a str, String> {
        let w = self
            .peek()
            .ok_or_else(|| format!("ends early: expected {wanted}"))?;
        self.at += 1;
        Ok(w)
    }

    fn expect(&mut self, word: &str) -> Result<(), String> {
        match self.next(&format!("“{word}”"))? {
            w if w == word => Ok(()),
            w => Err(format!("expected “{word}”, found “{w}”")),
        }
    }

    fn material(&mut self) -> Result<Material, String> {
        material(self.next("a material")?)
    }

    fn prop(&mut self) -> Result<Prop, String> {
        let w = self.next("a property (heat or wet)")?;
        Prop::from_name(w).ok_or_else(|| format!("“{w}” isn't a property (heat, wet)"))
    }

    fn end(&self) -> Result<(), String> {
        match self.peek() {
            None => Ok(()),
            Some(w) => Err(format!("didn't expect “{w}” here")),
        }
    }
}

fn material(w: &str) -> Result<Material, String> {
    Material::ALL
        .into_iter()
        .find(|m| m.name() == w)
        .ok_or_else(|| {
            let names: Vec<_> = Material::ALL.iter().map(|m| m.name()).collect();
            format!("“{w}” isn't a material ({})", names.join(", "))
        })
}

fn number(w: &str) -> Result<f32, String> {
    w.trim_start_matches('+')
        .parse()
        .map_err(|_| format!("“{w}” isn't a number"))
}

impl Prop {
    pub fn name(self) -> &'static str {
        match self {
            Prop::Heat => "heat",
            Prop::Wet => "wet",
        }
    }
}

impl fmt::Display for Prop {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// Written back in the same words a rule file uses.
impl fmt::Display for Basic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Basic::Change {
                who,
                near,
                radius,
                prop,
                rate,
            } => {
                let near: Vec<_> = near.iter().map(|m| m.name()).collect();
                write!(
                    f,
                    "change {} {prop} {rate:+}/s within {radius} of {}",
                    who.name(),
                    near.join(" or ")
                )
            }
            Basic::Convert {
                who,
                prop,
                at,
                vary,
                to,
            } => {
                let to = match to {
                    Becomes::Material(m) => m.name(),
                    Becomes::Gone => "nothing",
                };
                write!(f, "convert {} to {to} at {prop} {at}", who.name())?;
                if *vary > 0.0 {
                    write!(f, " ±{:.0}%", vary * 100.0)?;
                }
                Ok(())
            }
        }
    }
}
