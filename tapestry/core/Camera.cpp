#include "core/Camera.hpp"

#include <algorithm>

namespace tapestry {

Vec2 Camera::screenToWorld(double sx, double sy) const {
    return {(sx - m_pan.x) / m_zoom, (sy - m_pan.y) / m_zoom};
}

Vec2 Camera::worldToScreen(double wx, double wy) const {
    return {wx * m_zoom + m_pan.x, wy * m_zoom + m_pan.y};
}

Rect Camera::visibleWorldRect(double viewW, double viewH) const {
    const Vec2 topLeft = screenToWorld(0.0, 0.0);
    const Vec2 bottomRight = screenToWorld(viewW, viewH);
    return {topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y};
}

void Camera::panBy(double dxScreen, double dyScreen) {
    m_pan.x += dxScreen;
    m_pan.y += dyScreen;
}

void Camera::zoomAt(double sx, double sy, double factor) {
    // The band widens to include the current zoom, so if setZoom placed us
    // outside [kMinZoom, kMaxZoom] a scroll moves smoothly back toward the
    // band instead of snapping to its edge on the first notch.
    const double lo = std::min(kMinZoom, m_zoom);
    const double hi = std::max(kMaxZoom, m_zoom);
    const double target = std::clamp(m_zoom * factor, lo, hi);

    // Derive the factor actually applied after clamping. Using `factor`
    // directly would drift the pan at the zoom limits, so the view would creep
    // sideways when you kept scrolling against the stop.
    const double applied = target / m_zoom;

    m_pan.x = sx - (sx - m_pan.x) * applied;
    m_pan.y = sy - (sy - m_pan.y) * applied;
    m_zoom = target;
}

void Camera::setZoom(double zoom, double sx, double sy) {
    const double target = std::clamp(zoom, kAbsoluteMinZoom, kAbsoluteMaxZoom);
    const double applied = target / m_zoom;

    m_pan.x = sx - (sx - m_pan.x) * applied;
    m_pan.y = sy - (sy - m_pan.y) * applied;
    m_zoom = target;
}

void Camera::centerOn(Vec2 world, double viewW, double viewH) {
    m_pan.x = viewW * 0.5 - world.x * m_zoom;
    m_pan.y = viewH * 0.5 - world.y * m_zoom;
}

void Camera::frame(const Rect& worldRect, double viewW, double viewH, double marginPx) {
    const double availW = std::max(1.0, viewW - marginPx * 2.0);
    const double availH = std::max(1.0, viewH - marginPx * 2.0);

    const double zoomX = availW / std::max(1e-6, worldRect.w);
    const double zoomY = availH / std::max(1e-6, worldRect.h);
    m_zoom = std::clamp(std::min(zoomX, zoomY), kMinZoom, kMaxZoom);

    const double centreX = worldRect.x + worldRect.w * 0.5;
    const double centreY = worldRect.y + worldRect.h * 0.5;
    m_pan.x = viewW * 0.5 - centreX * m_zoom;
    m_pan.y = viewH * 0.5 - centreY * m_zoom;
}

void Camera::reset() {
    m_pan = {0.0, 0.0};
    m_zoom = 1.0;
}

} // namespace tapestry
