#pragma once

#include "core/Camera.hpp"
#include "core/World.hpp"
#include "render/Fonts.hpp"

#include <cstddef>

struct NVGcontext;

namespace tapestry {

enum class PageTextRegion { None, Title, Body };

// Editable text geometry shared by input and rendering. The coarse region hit
// includes blank body space; textIndexAt refines a click to a UTF-8 byte caret.
PageTextRegion pageTextRegionAt(const Page& page, Vec2 worldPoint);
std::size_t pageTextIndexAt(NVGcontext* vg, const Page& page,
                            const Camera& camera, const FontSet& fonts,
                            PageTextRegion region, Vec2 screenPoint);

// Where the settings page's controls sit, in world space. Computed from the
// page's rect so the controls travel with the page; the renderer draws these
// rects and the app hit-tests clicks against the same ones, which is what
// keeps them from drifting apart.
struct SettingsLayout {
    Rect zoomField;
    Rect centerButton;
    Rect invertToggle;
};

SettingsLayout settingsLayout(const Page& page);

// The default size a settings page needs to show all of its rows.
Rect settingsPageRect(Vec2 topLeft);

// Whether the settings controls are drawn (and therefore clickable) at this
// zoom. Below the threshold their labels would be illegible, so the renderer
// leaves them out and input treats a press as an ordinary page drag.
bool settingsControlsInteractive(double zoom);

// Space page geometry shared by input and rendering. A note's `pos` is in
// page-local world units with the body's top-left as origin, so the app can
// turn a click into a pos and the renderer can turn a pos into a dot using
// the same two functions.
constexpr double kSpaceDotRadius = 4.0; // world units

// World-space point of page-local (0, 0): the body's top-left.
Vec2 spaceBodyOrigin(const Page& page);

// The note whose dot is under `worldPoint` (topmost = highest id wins),
// or an unassigned id. `slackWorld` widens the hit circle so small dots at
// low zoom stay grabbable.
mathspace::NoteId spaceNoteAt(const Page& page, const SpaceState* space,
                              Vec2 worldPoint, double slackWorld);

// View-state the page renderer needs beyond the world itself: what is
// selected, and what the settings page should display.
struct PageUiState {
    std::uint64_t selectedId = 0;
    // A note being dragged on a Space page: drawn displaced by
    // dragNoteOffset (world units) until release applies the SetField.
    std::uint64_t dragNotePage = 0;
    mathspace::NoteId dragNote;
    Vec2 dragNoteOffset {0.0, 0.0};
    double zoom = 1.0;         // current camera zoom, shown in the zoom field
    bool invertScroll = false;
    bool editingZoom = false;
    std::string zoomDraft;     // text in the zoom field while editing
    std::uint64_t editingPageId = 0;
    PageTextRegion editingRegion = PageTextRegion::None;
    std::size_t caret = 0;      // UTF-8 byte offset
};

// Draws every page that intersects the view, back to front, matching World's
// draw order.
//
// Typography is specified in world units (a page's body is 14-unit text), so
// text is laid out at world scale and only then projected: at 100% zoom a page
// reads like any other window, and zooming is the only thing that changes
// apparent size. When projected text drops below legibility the body degrades
// to greeked lines, then to a bare card — the card silhouette, not the text,
// is what carries at a distance. Minimized pages draw as their title bar only.
//
// Coordinates are logical pixels, same contract as drawGrid.
void drawPages(NVGcontext* vg, const World& world, const Camera& camera,
               double viewW, double viewH, const FontSet& fonts,
               const PageUiState& ui);

} // namespace tapestry
