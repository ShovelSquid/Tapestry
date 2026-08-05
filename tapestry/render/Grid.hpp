#pragma once

#include "core/Camera.hpp"

struct NVGcontext;

namespace tapestry {

// Draws the world lattice: a minor grid plus a major grid every fourth line,
// with the world origin marked. Spacing adapts so lines stay in a comfortable
// screen-space band at any zoom, which is what makes the world read as infinite
// rather than as a texture that stretches.
//
// With a valid font handle, major lines are labelled with their world
// coordinates along the axes — and when an axis is off-screen the label row
// clamps to the nearest viewport edge, so the view reads as a region of the
// coordinate plane wherever you are. Pass -1 to skip labels.
//
// Coordinates are logical (window) pixels, matching SDL's mouse coordinates and
// nanovg's frame size. The caller has already applied the device pixel ratio.
void drawGrid(NVGcontext* vg, const Camera& camera, double viewW, double viewH,
              int labelFont = -1);

} // namespace tapestry
