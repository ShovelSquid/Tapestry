#include "render/Strokes.hpp"

#include <nanovg.h>

#include <algorithm>

namespace tapestry {

void drawStrokes(NVGcontext* vg, const World& world, const Camera& camera) {
    const double zoom = camera.zoom();
    const auto widthFor = [zoom](double pressure) {
        return std::max(0.8f, static_cast<float>(
            (1.5 + std::clamp(pressure, 0.0, 1.0) * 10.5) * zoom));
    };

    for (const Stroke& stroke : world.strokes()) {
        if (stroke.points.empty()) continue;
        if (stroke.points.size() == 1) {
            const Vec2 at = camera.worldToScreen(stroke.points[0].position.x,
                                                  stroke.points[0].position.y);
            nvgBeginPath(vg);
            nvgCircle(vg, static_cast<float>(at.x), static_cast<float>(at.y),
                      widthFor(stroke.points[0].pressure) * 0.5f);
            nvgFillColor(vg, nvgRGBA(128, 157, 244, 220));
            nvgFill(vg);
            continue;
        }

        for (std::size_t i = 1; i < stroke.points.size(); ++i) {
            const StrokePoint& a = stroke.points[i - 1];
            const StrokePoint& b = stroke.points[i];
            const Vec2 from = camera.worldToScreen(a.position.x, a.position.y);
            const Vec2 to = camera.worldToScreen(b.position.x, b.position.y);
            const float width = widthFor((a.pressure + b.pressure) * 0.5);
            nvgBeginPath(vg);
            nvgMoveTo(vg, static_cast<float>(from.x), static_cast<float>(from.y));
            nvgLineTo(vg, static_cast<float>(to.x), static_cast<float>(to.y));
            nvgStrokeColor(vg, nvgRGBA(128, 157, 244, 220));
            nvgStrokeWidth(vg, width);
            nvgLineCap(vg, NVG_ROUND);
            nvgLineJoin(vg, NVG_ROUND);
            nvgStroke(vg);
        }
    }
}

} // namespace tapestry
