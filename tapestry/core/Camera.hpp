#pragma once

#include "core/Types.hpp"

namespace tapestry {

// The window onto the world: screen = world * zoom + pan.
//
// Ported from the browser prototype (semantic-scroll/public/app.js:86-101),
// which had this right. The camera is view state only — it never enters the
// world hash and never affects replay, so it is free to be non-deterministic
// and double-precision.
class Camera {
public:
    // Matches the prototype's limits: 5% is roughly "whole workspace" and 600%
    // is past comfortable reading size. These bound *interactive* zoom only —
    // setZoom (the settings page's typed value) may leave the band, and
    // interactive zoom from outside it works its way back in gradually rather
    // than snapping.
    static constexpr double kMinZoom = 0.05;
    static constexpr double kMaxZoom = 6.0;

    // Hard limits for setZoom, guarding against 0, infinities, and doubles
    // small enough to break the projection arithmetic.
    static constexpr double kAbsoluteMinZoom = 1e-6;
    static constexpr double kAbsoluteMaxZoom = 1e6;

    Vec2 screenToWorld(double sx, double sy) const;
    Vec2 worldToScreen(double wx, double wy) const;

    // World-space rectangle currently visible in a viewport of this size.
    // Used for frustum culling before any per-page layout work happens.
    Rect visibleWorldRect(double viewW, double viewH) const;

    void panBy(double dxScreen, double dyScreen);

    // Zooms about a screen point, keeping the world point currently under it
    // pinned there. `factor` is relative (1.1 zooms in, 1/1.1 zooms out) and is
    // silently clamped at the zoom limits.
    void zoomAt(double sx, double sy, double factor);

    // Sets an absolute zoom about a screen point, clamped only to the hard
    // limits — this is how the settings page zooms past the interactive band.
    void setZoom(double zoom, double sx, double sy);

    // Pans so a world point sits at the viewport centre. Zoom is untouched.
    void centerOn(Vec2 world, double viewW, double viewH);

    // Frames a world rectangle inside the viewport with a margin in screen px.
    void frame(const Rect& worldRect, double viewW, double viewH, double marginPx);

    void reset();

    double zoom() const { return m_zoom; }
    Vec2 pan() const { return m_pan; }

private:
    Vec2 m_pan {0.0, 0.0};
    double m_zoom = 1.0;
};

} // namespace tapestry
