#pragma once

struct NVGcontext;

namespace tapestry {

// The UI font family. Handles are nanovg font ids; -1 means the face could not
// be loaded. Rendering code checks regular — when it is -1 there is no text at
// all and every drawing routine degrades to shapes.
struct FontSet {
    int regular = -1;
    int bold = -1;

    bool ok() const { return regular != -1; }
};

// Loads the family, preferring bundled faces under {assetDir}/fonts —
// ui.ttf and ui-bold.ttf — and falling back to platform fonts. If no bold face
// is found anywhere, bold aliases regular so callers never branch on it.
//
// Missing fonts degrade to no on-screen text rather than to an error: the app
// is still navigable, and headless machines have no fonts to find.
FontSet loadFonts(NVGcontext* vg, const char* assetDir);

} // namespace tapestry
