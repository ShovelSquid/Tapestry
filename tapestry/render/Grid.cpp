#include "render/Grid.hpp"

#include <nanovg.h>

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace tapestry {
namespace {

// World-space spacing of the finest grid at 100% zoom. 32 matches the
// prototype's CSS grid so the two look like the same workspace.
constexpr double kBaseSpacing = 32.0;

// Screen-space band the minor grid is kept inside. Below the floor the lattice
// turns into noise and costs thousands of line segments; above the ceiling it
// stops reading as a grid at all.
constexpr double kMinScreenSpacing = 14.0;
constexpr double kMaxScreenSpacing = 112.0;

// Steps by 4x so the major grid (every fourth minor line) survives a spacing
// change — the pattern stays put and only its density changes.
constexpr double kSpacingStep = 4.0;

void strokeLattice(NVGcontext* vg,
                   const Camera& camera,
                   double spacing,
                   const Rect& world,
                   double viewW,
                   double viewH,
                   NVGcolor color,
                   float width) {
    nvgBeginPath(vg);

    const double firstX = std::floor(world.x / spacing) * spacing;
    for (double wx = firstX; wx <= world.right(); wx += spacing) {
        // Snapping to a half-pixel keeps hairlines crisp instead of smearing
        // across two rows of pixels.
        const double sx = std::floor(camera.worldToScreen(wx, 0.0).x) + 0.5;
        nvgMoveTo(vg, static_cast<float>(sx), 0.0f);
        nvgLineTo(vg, static_cast<float>(sx), static_cast<float>(viewH));
    }

    const double firstY = std::floor(world.y / spacing) * spacing;
    for (double wy = firstY; wy <= world.bottom(); wy += spacing) {
        const double sy = std::floor(camera.worldToScreen(0.0, wy).y) + 0.5;
        nvgMoveTo(vg, 0.0f, static_cast<float>(sy));
        nvgLineTo(vg, static_cast<float>(viewW), static_cast<float>(sy));
    }

    nvgStrokeColor(vg, color);
    nvgStrokeWidth(vg, width);
    nvgStroke(vg);
}

// Formats a world coordinate for an axis label. Major-line coordinates are
// integers at every reachable zoom today (the spacing ladder bottoms out at 2),
// but %g keeps this honest if the ladder ever extends below 1.
void formatCoord(char* buffer, size_t size, double value) {
    if (std::fabs(value - std::round(value)) < 1e-9) {
        std::snprintf(buffer, size, "%.0f", value);
    } else {
        std::snprintf(buffer, size, "%g", value);
    }
}

// Axis coordinate labels on the major grid, Desmos-style: they sit beside the
// axes while an axis is on screen, and pin to the nearest viewport edge once it
// isn't, so there is never a view without readable coordinates.
void drawLabels(NVGcontext* vg,
                const Camera& camera,
                int labelFont,
                double majorSpacing,
                const Rect& world,
                double viewW,
                double viewH) {
    constexpr double kGapPx = 6.0;   // gap between an axis line and its labels
    constexpr double kEdgePadPx = 4.0;

    const Vec2 originScreen = camera.worldToScreen(0.0, 0.0);

    // Where each label row/column actually lives. Clamping is what keeps the
    // labels on screen when the axis itself is far outside the view.
    const bool xAxisOnScreen =
        originScreen.y >= 0.0 && originScreen.y <= viewH;
    const bool yAxisOnScreen =
        originScreen.x >= 0.0 && originScreen.x <= viewW;
    const double labelRowY = std::clamp(
        originScreen.y + kGapPx, kEdgePadPx, viewH - kEdgePadPx - 14.0);
    const double labelColX = std::clamp(
        originScreen.x + kGapPx, kEdgePadPx + 2.0, viewW - kEdgePadPx - 2.0);

    nvgFontFaceId(vg, labelFont);
    nvgFontSize(vg, 11.0f);
    // Pinned labels brighten slightly: with the axis gone they are the only
    // thing anchoring the numbers to the world.
    const NVGcolor onAxis = nvgRGBA(150, 168, 205, 120);
    const NVGcolor pinned = nvgRGBA(150, 168, 205, 160);

    char text[32];

    // X axis: labels below the horizontal axis line, one per major column.
    nvgTextAlign(vg, NVG_ALIGN_CENTER | NVG_ALIGN_TOP);
    nvgFillColor(vg, xAxisOnScreen ? onAxis : pinned);
    const double firstX = std::floor(world.x / majorSpacing) * majorSpacing;
    for (double wx = firstX; wx <= world.right(); wx += majorSpacing) {
        if (wx == 0.0) {
            continue; // the origin label is drawn once, below
        }
        const double sx = camera.worldToScreen(wx, 0.0).x;
        if (sx < 14.0 || sx > viewW - 14.0) {
            continue; // would collide with the pinned y-label column
        }
        formatCoord(text, sizeof(text), wx);
        nvgText(vg, static_cast<float>(sx), static_cast<float>(labelRowY),
                text, nullptr);
    }

    // Y axis: labels to the right of the vertical axis line, one per major row.
    nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
    nvgFillColor(vg, yAxisOnScreen ? onAxis : pinned);
    const double firstY = std::floor(world.y / majorSpacing) * majorSpacing;
    for (double wy = firstY; wy <= world.bottom(); wy += majorSpacing) {
        if (wy == 0.0) {
            continue;
        }
        const double sy = camera.worldToScreen(0.0, wy).y;
        if (sy < 12.0 || sy > viewH - 12.0) {
            continue;
        }
        formatCoord(text, sizeof(text), wy);
        nvgText(vg, static_cast<float>(labelColX), static_cast<float>(sy),
                text, nullptr);
    }

    // One "0" tucked into the axis corner, in place of the two colliding
    // zeros the per-axis loops would produce.
    if (xAxisOnScreen && yAxisOnScreen) {
        nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_TOP);
        nvgFillColor(vg, onAxis);
        nvgText(vg, static_cast<float>(originScreen.x + kGapPx),
                static_cast<float>(originScreen.y + kGapPx), "0", nullptr);
    }
}

void strokeOrigin(NVGcontext* vg, const Camera& camera, double viewW, double viewH) {
    const Vec2 origin = camera.worldToScreen(0.0, 0.0);

    const bool xVisible = origin.x >= 0.0 && origin.x <= viewW;
    const bool yVisible = origin.y >= 0.0 && origin.y <= viewH;
    if (!xVisible && !yVisible) {
        return;
    }

    nvgBeginPath(vg);
    if (xVisible) {
        const double sx = std::floor(origin.x) + 0.5;
        nvgMoveTo(vg, static_cast<float>(sx), 0.0f);
        nvgLineTo(vg, static_cast<float>(sx), static_cast<float>(viewH));
    }
    if (yVisible) {
        const double sy = std::floor(origin.y) + 0.5;
        nvgMoveTo(vg, 0.0f, static_cast<float>(sy));
        nvgLineTo(vg, static_cast<float>(viewW), static_cast<float>(sy));
    }
    nvgStrokeColor(vg, nvgRGBA(90, 130, 220, 70));
    nvgStrokeWidth(vg, 1.0f);
    nvgStroke(vg);

    // The origin itself: a small dot where the axes cross, so (0,0) reads as a
    // place rather than an intersection like any other.
    if (xVisible && yVisible) {
        nvgBeginPath(vg);
        nvgCircle(vg, static_cast<float>(origin.x),
                  static_cast<float>(origin.y), 3.0f);
        nvgFillColor(vg, nvgRGBA(110, 150, 235, 160));
        nvgFill(vg);
    }
}

} // namespace

void drawGrid(NVGcontext* vg, const Camera& camera, double viewW, double viewH,
              int labelFont) {
    const double zoom = camera.zoom();
    if (zoom <= 0.0) {
        return;
    }

    double spacing = kBaseSpacing;
    while (spacing * zoom < kMinScreenSpacing) {
        spacing *= kSpacingStep;
    }
    while (spacing * zoom > kMaxScreenSpacing) {
        spacing /= kSpacingStep;
    }

    const Rect world = camera.visibleWorldRect(viewW, viewH);

    // Fade the minor grid in as it approaches its comfortable spacing, so a
    // spacing change is a crossfade rather than a visible pop.
    const double screenSpacing = spacing * zoom;
    const double t = std::clamp(
        (screenSpacing - kMinScreenSpacing) / (kMaxScreenSpacing - kMinScreenSpacing),
        0.0, 1.0);
    const auto minorAlpha = static_cast<unsigned char>(10.0 + 26.0 * t);

    strokeLattice(vg, camera, spacing, world, viewW, viewH,
                  nvgRGBA(255, 255, 255, minorAlpha), 1.0f);
    strokeLattice(vg, camera, spacing * kSpacingStep, world, viewW, viewH,
                  nvgRGBA(255, 255, 255, 30), 1.0f);
    strokeOrigin(vg, camera, viewW, viewH);

    if (labelFont != -1) {
        drawLabels(vg, camera, labelFont, spacing * kSpacingStep, world,
                   viewW, viewH);
    }
}

} // namespace tapestry
