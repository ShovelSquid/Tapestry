#pragma once

#include "core/World.hpp"

#include <string>

namespace tapestry {

// Everything a saved workspace carries besides the pages themselves. Camera
// and preferences are view state — they never enter the world or its ticks —
// but a document that reopens somewhere else than where you left it would not
// feel like the same document, so they are saved with it.
struct DocumentState {
    std::string title = "Untitled tapestry";
    bool invertScroll = false;
    double panX = 0.0;
    double panY = 0.0;
    double zoom = 1.0;
};

// The .tapestry file format, version 1. One file is one document, and it is
// its own history: a full baseline followed by deltas.
//
//   tapestry 1
//   snapshot <tick>     full state — written once, when the file is created
//   ...
//   end
//   delta <tick>        only what changed since the previous version
//   ...
//   end
//
// The first save writes the baseline. Every save after it diffs against the
// state the file already describes and appends only the differences, so
// saving an unchanged page costs nothing and a long editing session grows the
// file by the size of the edits rather than by the size of the workspace.
// That keeps a scrubbable timelapse without the file ballooning.
//
// Block body lines:
//
//   title <text>                                  (when changed)
//   camera <panX> <panY> <zoom>                   (when changed)
//   settings invert <0|1>                         (when changed)
//   page <id> <kind> <minimized> <x> <y> <w> <h>  (changed/new pages only)
//   ptitle <text>
//   pbody <text, newlines escaped as \n>
//   drop <id>                                     (page removed)
//   order <id> <id> …                             (draw order changed)
//
// Strings are single-line with backslash escapes; doubles round-trip at full
// precision.

// Appends this state to the document: a baseline if the file is new,
// otherwise a delta against what the file already holds. Saving a state
// identical to the newest version writes nothing and succeeds. Returns false
// on I/O failure, or if the path exists and is not a tapestry document.
bool saveDocument(const std::string& path, const DocumentState& state,
                  const World& world);

// Restores the newest version — the baseline with every delta applied in
// order — into `state` and `world`. Returns false if the file cannot be read
// or holds no valid baseline; on failure the outputs are untouched.
bool loadDocument(const std::string& path, DocumentState& state, World& world);

// How many versions the file holds: the baseline plus each appended delta.
// 0 for a missing or foreign file. Exposed for tests and, later, a scrubber.
int countSnapshots(const std::string& path);

} // namespace tapestry
