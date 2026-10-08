use std::collections::BTreeMap;
use std::fmt;

/// A point's stable, structural ID, such as `cellar/door` (log 0006).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Id(String);

impl Id {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for Id {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl From<String> for Id {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A property's value. Vectors and shapes arrive with physics.
#[derive(Clone, PartialEq, Debug)]
pub enum Value {
    Bool(bool),
    Number(f64),
    Text(String),
    Ref(Id),
}

impl Value {
    pub fn text(s: &str) -> Self {
        Self::Text(s.to_owned())
    }

    pub fn point(id: &str) -> Self {
        Self::Ref(id.into())
    }

    pub fn as_ref(&self) -> Option<&Id> {
        match self {
            Self::Ref(id) => Some(id),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(s) => Some(s),
            _ => None,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bool(b) => write!(f, "{b}"),
            Self::Number(n) => write!(f, "{n}"),
            Self::Text(s) => write!(f, "{s:?}"),
            Self::Ref(id) => write!(f, "{id}"),
        }
    }
}

/// Every point's properties at one moment. Anything not stored is unspecified.
///
/// A point exists once any key says something about it. Its parent is the
/// ordinary property `parent`, so moving it is a change like any other (§5.1).
#[derive(Clone, Default, Debug)]
pub struct World {
    points: BTreeMap<Id, BTreeMap<String, Value>>,
}

impl World {
    pub const PARENT: &'static str = "parent";

    pub fn get(&self, point: &Id, property: &str) -> Option<&Value> {
        self.points.get(point)?.get(property)
    }

    pub fn contains(&self, point: &Id) -> bool {
        self.points.contains_key(point)
    }

    pub fn properties(&self, point: &Id) -> impl Iterator<Item = (&str, &Value)> {
        self.points
            .get(point)
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.as_str(), v))
    }

    pub fn parent(&self, point: &Id) -> Option<&Id> {
        self.get(point, Self::PARENT)?.as_ref()
    }

    /// Points whose parent is `point`, in ID order.
    pub fn children<'a>(&'a self, point: &'a Id) -> impl Iterator<Item = &'a Id> {
        self.points
            .keys()
            .filter(move |c| self.parent(c) == Some(point))
    }

    pub fn is(&self, point: &Id, property: &str, value: bool) -> bool {
        self.get(point, property).and_then(Value::as_bool) == Some(value)
    }

    pub(crate) fn touch(&mut self, point: &Id) {
        self.points.entry(point.clone()).or_default();
    }

    pub(crate) fn set(&mut self, point: &Id, property: &str, value: Value) -> Option<Value> {
        self.points
            .entry(point.clone())
            .or_default()
            .insert(property.to_owned(), value)
    }
}
