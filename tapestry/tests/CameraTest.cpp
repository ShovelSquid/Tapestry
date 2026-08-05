// Camera invariants.
//
// The camera is small enough to eyeball and subtle enough to get wrong, and its
// bugs are miserable to diagnose through a GUI: cursor-pinned zoom that drifts
// by a pixel per notch only becomes obvious after thirty notches, by which point
// it looks like a mouse-input problem rather than an arithmetic one.

#include "core/Camera.hpp"

#include <cmath>
#include <cstdio>
#include <initializer_list>

namespace {

using tapestry::Camera;
using tapestry::Rect;
using tapestry::Vec2;

int g_failures = 0;

void check(bool condition, const char* what) {
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s\n", what);
        ++g_failures;
    }
}

void checkNear(double actual, double expected, double tolerance, const char* what) {
    if (std::fabs(actual - expected) > tolerance) {
        std::fprintf(stderr, "FAIL: %s (got %.9f, want %.9f)\n",
            what, actual, expected);
        ++g_failures;
    }
}

// The defining property: the world point under the cursor stays under it.
void zoomKeepsCursorPinned() {
    for (const double factor : {1.1, 1.0 / 1.1, 2.0, 0.5}) {
        Camera camera;
        camera.panBy(37.0, -19.0);

        const double cursorX = 613.0;
        const double cursorY = 288.0;
        const Vec2 before = camera.screenToWorld(cursorX, cursorY);

        camera.zoomAt(cursorX, cursorY, factor);

        const Vec2 after = camera.screenToWorld(cursorX, cursorY);
        checkNear(after.x, before.x, 1e-9, "zoomAt pins the cursor's world x");
        checkNear(after.y, before.y, 1e-9, "zoomAt pins the cursor's world y");
    }
}

// Repeated zooming must not accumulate drift — this is what makes scroll-wheel
// zoom feel solid rather than slowly sliding the world sideways.
void repeatedZoomDoesNotDrift() {
    Camera camera;
    const double cursorX = 400.0;
    const double cursorY = 300.0;
    const Vec2 before = camera.screenToWorld(cursorX, cursorY);

    for (int i = 0; i < 200; ++i) {
        camera.zoomAt(cursorX, cursorY, 1.05);
        camera.zoomAt(cursorX, cursorY, 1.0 / 1.05);
    }

    const Vec2 after = camera.screenToWorld(cursorX, cursorY);
    checkNear(after.x, before.x, 1e-6, "round-trip zoom does not drift x");
    checkNear(after.y, before.y, 1e-6, "round-trip zoom does not drift y");
    checkNear(camera.zoom(), 1.0, 1e-9, "round-trip zoom returns to 1.0");
}

// Zooming past a limit must clamp *and* leave the pan alone. Applying the
// requested factor to the pan while clamping the zoom is the obvious
// implementation and it creeps the view sideways at the stops.
void clampingDoesNotMovePan() {
    for (const double factor : {10.0, 0.01}) {
        Camera camera;
        const double cursorX = 250.0;
        const double cursorY = 125.0;

        // Drive hard into the stop, then keep pushing.
        for (int i = 0; i < 40; ++i) {
            camera.zoomAt(cursorX, cursorY, factor);
        }
        const Vec2 panAtLimit = camera.pan();
        const double zoomAtLimit = camera.zoom();

        for (int i = 0; i < 40; ++i) {
            camera.zoomAt(cursorX, cursorY, factor);
        }

        checkNear(camera.pan().x, panAtLimit.x, 1e-9, "pan x is stable at the zoom limit");
        checkNear(camera.pan().y, panAtLimit.y, 1e-9, "pan y is stable at the zoom limit");
        checkNear(camera.zoom(), zoomAtLimit, 1e-12, "zoom is stable at the limit");
    }

    Camera high;
    for (int i = 0; i < 100; ++i) {
        high.zoomAt(0.0, 0.0, 2.0);
    }
    checkNear(high.zoom(), Camera::kMaxZoom, 1e-12, "zoom clamps to kMaxZoom");

    Camera low;
    for (int i = 0; i < 100; ++i) {
        low.zoomAt(0.0, 0.0, 0.5);
    }
    checkNear(low.zoom(), Camera::kMinZoom, 1e-12, "zoom clamps to kMinZoom");
}

// setZoom is the settings page's typed value: it may leave the interactive
// band entirely, and interactive zoom from out there must walk back gradually
// rather than snapping to the band edge on the first notch.
void setZoomEscapesTheInteractiveBand() {
    Camera camera;
    const double cx = 400.0;
    const double cy = 300.0;

    const Vec2 before = camera.screenToWorld(cx, cy);
    camera.setZoom(0.001, cx, cy);
    checkNear(camera.zoom(), 0.001, 1e-15, "setZoom goes below kMinZoom");
    const Vec2 after = camera.screenToWorld(cx, cy);
    checkNear(after.x, before.x, 1e-6, "setZoom pins the given screen point x");
    checkNear(after.y, before.y, 1e-6, "setZoom pins the given screen point y");

    // One interactive notch in: a small step from 0.001, not a jump to 0.05.
    camera.zoomAt(cx, cy, 1.1);
    checkNear(camera.zoom(), 0.0011, 1e-12,
        "interactive zoom steps gradually from below the band");

    // And one notch out: the current zoom is the floor, so nothing moves.
    camera.setZoom(0.001, cx, cy);
    camera.zoomAt(cx, cy, 0.9);
    checkNear(camera.zoom(), 0.001, 1e-15,
        "interactive zoom-out does not push further below the band");

    camera.setZoom(1e-12, cx, cy);
    checkNear(camera.zoom(), Camera::kAbsoluteMinZoom, 1e-18,
        "setZoom clamps at the hard floor");
    camera.setZoom(1e12, cx, cy);
    checkNear(camera.zoom(), Camera::kAbsoluteMaxZoom, 1e-3,
        "setZoom clamps at the hard ceiling");
}

void centerOnPutsTheWorldPointMidView() {
    Camera camera;
    camera.zoomAt(123.0, 456.0, 2.5);
    camera.centerOn({-340.0, 220.0}, 1280.0, 800.0);

    const Vec2 screen = camera.worldToScreen(-340.0, 220.0);
    checkNear(screen.x, 640.0, 1e-9, "centerOn puts the point at mid width");
    checkNear(screen.y, 400.0, 1e-9, "centerOn puts the point at mid height");
    checkNear(camera.zoom(), 2.5, 1e-12, "centerOn leaves zoom alone");
}

void transformsRoundTrip() {
    Camera camera;
    camera.panBy(-131.5, 88.25);
    camera.zoomAt(320.0, 240.0, 2.75);

    for (const Vec2 world : {Vec2 {0.0, 0.0}, Vec2 {1234.5, -987.25}, Vec2 {-4.0, 3.0}}) {
        const Vec2 screen = camera.worldToScreen(world.x, world.y);
        const Vec2 back = camera.screenToWorld(screen.x, screen.y);
        checkNear(back.x, world.x, 1e-9, "worldToScreen/screenToWorld round-trips x");
        checkNear(back.y, world.y, 1e-9, "worldToScreen/screenToWorld round-trips y");
    }
}

void panIsInScreenPixels() {
    Camera camera;
    camera.zoomAt(0.0, 0.0, 3.0);

    const Vec2 before = camera.worldToScreen(10.0, 10.0);
    camera.panBy(25.0, -40.0);
    const Vec2 after = camera.worldToScreen(10.0, 10.0);

    // A pan of N screen pixels moves the projection by exactly N, whatever the
    // zoom — otherwise dragging feels like it slips at high zoom.
    checkNear(after.x - before.x, 25.0, 1e-9, "panBy moves projection by screen dx");
    checkNear(after.y - before.y, -40.0, 1e-9, "panBy moves projection by screen dy");
}

void visibleRectMatchesCorners() {
    Camera camera;
    camera.panBy(64.0, -32.0);
    camera.zoomAt(100.0, 100.0, 1.7);

    const double viewW = 1280.0;
    const double viewH = 800.0;
    const Rect rect = camera.visibleWorldRect(viewW, viewH);

    const Vec2 topLeft = camera.screenToWorld(0.0, 0.0);
    const Vec2 bottomRight = camera.screenToWorld(viewW, viewH);

    checkNear(rect.x, topLeft.x, 1e-9, "visibleWorldRect starts at the top-left corner");
    checkNear(rect.y, topLeft.y, 1e-9, "visibleWorldRect starts at the top-left corner");
    checkNear(rect.right(), bottomRight.x, 1e-9, "visibleWorldRect ends at the bottom-right corner");
    checkNear(rect.bottom(), bottomRight.y, 1e-9, "visibleWorldRect ends at the bottom-right corner");
    check(rect.w > 0.0 && rect.h > 0.0, "visibleWorldRect has positive extent");
}

void frameCentresContent() {
    Camera camera;
    const Rect content {-500.0, -250.0, 1000.0, 500.0};
    const double viewW = 800.0;
    const double viewH = 600.0;

    camera.frame(content, viewW, viewH, 40.0);

    const Vec2 centre = camera.worldToScreen(
        content.x + content.w * 0.5, content.y + content.h * 0.5);
    checkNear(centre.x, viewW * 0.5, 1e-9, "frame centres content horizontally");
    checkNear(centre.y, viewH * 0.5, 1e-9, "frame centres content vertically");

    const Rect visible = camera.visibleWorldRect(viewW, viewH);
    check(visible.w >= content.w && visible.h >= content.h,
        "frame fits the whole content rect on screen");
}

} // namespace

int main() {
    zoomKeepsCursorPinned();
    repeatedZoomDoesNotDrift();
    clampingDoesNotMovePan();
    setZoomEscapesTheInteractiveBand();
    centerOnPutsTheWorldPointMidView();
    transformsRoundTrip();
    panIsInScreenPixels();
    visibleRectMatchesCorners();
    frameCentresContent();

    if (g_failures != 0) {
        std::fprintf(stderr, "%d camera check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("camera: all checks passed\n");
    return 0;
}
