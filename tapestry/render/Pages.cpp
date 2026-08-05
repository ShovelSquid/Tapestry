#include "render/Pages.hpp"

#include <nanovg.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

namespace tapestry {
namespace {

// Page metrics, in world units. 1 world unit = 1 logical pixel at 100% zoom,
// so these read as CSS-like pixel values. Title-bar geometry lives in
// Page.hpp because hit-testing shares it.
constexpr double kCornerRadius = 6.0;
constexpr double kPadding = 16.0;
constexpr double kTitleSize = 15.0;
constexpr double kBodySize = 14.0;
constexpr double kBodyLineHeight = 1.45;

// Settings page rows, in world units.
constexpr double kRowHeight = 44.0;
constexpr double kControlHeight = 30.0;
constexpr double kZoomFieldWidth = 96.0;
constexpr double kCenterButtonWidth = 150.0;
constexpr double kToggleWidth = 46.0;
constexpr double kToggleHeight = 26.0;

// Projected-size thresholds where text stops being worth drawing. Below
// kMinBodyPx the body greeks; below kMinGreekPx even the bars are noise.
constexpr double kMinTitlePx = 5.0;
constexpr double kMinBodyPx = 5.5;
constexpr double kMinGreekPx = 1.6;

NVGcolor accentFor(PageKind kind) {
    switch (kind) {
    case PageKind::Conversation: return nvgRGBA(110, 150, 235, 255);
    case PageKind::File:         return nvgRGBA(126, 204, 158, 255);
    case PageKind::Settings:     return nvgRGBA(168, 142, 235, 255);
    case PageKind::Note:         break;
    }
    return nvgRGBA(232, 196, 120, 255);
}

NVGcolor withAlpha(NVGcolor c, unsigned char a) {
    c.a = static_cast<float>(a) / 255.0f;
    return c;
}

// A world rect projected to screen, as floats ready for nanovg.
struct ScreenRect {
    float x, y, w, h;
};

ScreenRect project(const Camera& camera, const Rect& world) {
    const Vec2 topLeft = camera.worldToScreen(world.x, world.y);
    const double zoom = camera.zoom();
    return {static_cast<float>(topLeft.x), static_cast<float>(topLeft.y),
            static_cast<float>(world.w * zoom), static_cast<float>(world.h * zoom)};
}

// Greeked body: translucent bars standing in for lines of text once the real
// glyphs would be subpixel smears. Bar widths vary deterministically per page
// and line so distant pages look like different documents, not copies.
void drawGreekedBody(NVGcontext* vg, std::uint64_t pageId, double x, double y,
                     double w, double h, double lineStepPx) {
    const double barHeight = std::max(1.0, lineStepPx * 0.5);

    nvgBeginPath(vg);
    int line = 0;
    for (double ly = y; ly + barHeight <= y + h; ly += lineStepPx, ++line) {
        // xorshift-style mix of (page, line); only the low bits matter.
        std::uint64_t v = pageId * 2654435761u + static_cast<std::uint64_t>(line);
        v ^= v >> 13;
        const double fraction = 0.55 + 0.4 * static_cast<double>(v % 97u) / 96.0;
        nvgRect(vg, static_cast<float>(x), static_cast<float>(ly),
                static_cast<float>(w * fraction), static_cast<float>(barHeight));
    }
    nvgFillColor(vg, nvgRGBA(196, 205, 224, 34));
    nvgFill(vg);
}

// The minimize/restore control: a minus when open, a plus when minimized.
// Drawn as strokes rather than glyphs so it survives any zoom the title bar
// itself survives.
void drawMinimizeButton(NVGcontext* vg, const Camera& camera, const Page& page) {
    const ScreenRect r = project(camera, page.minimizeButtonRect());
    if (r.w < 5.0f) {
        return; // too small to hit reliably; the dot and card carry the page
    }

    nvgBeginPath(vg);
    nvgRoundedRect(vg, r.x, r.y, r.w, r.h, r.w * 0.2f);
    nvgFillColor(vg, nvgRGBA(255, 255, 255, 14));
    nvgFill(vg);

    const float cx = r.x + r.w * 0.5f;
    const float cy = r.y + r.h * 0.5f;
    const float arm = r.w * 0.28f;
    nvgBeginPath(vg);
    nvgMoveTo(vg, cx - arm, cy);
    nvgLineTo(vg, cx + arm, cy);
    if (page.minimized) {
        nvgMoveTo(vg, cx, cy - arm);
        nvgLineTo(vg, cx, cy + arm);
    }
    nvgStrokeColor(vg, nvgRGBA(196, 205, 224, 180));
    nvgStrokeWidth(vg, std::max(1.0f, r.w * 0.09f));
    nvgStroke(vg);
}

void drawControlChrome(NVGcontext* vg, const ScreenRect& r, float radius,
                       bool active) {
    nvgBeginPath(vg);
    nvgRoundedRect(vg, r.x, r.y, r.w, r.h, radius);
    nvgFillColor(vg, active ? nvgRGBA(255, 255, 255, 26)
                            : nvgRGBA(255, 255, 255, 14));
    nvgFill(vg);
    nvgStrokeColor(vg, active ? nvgRGBA(168, 142, 235, 160)
                              : nvgRGBA(255, 255, 255, 34));
    nvgStrokeWidth(vg, 1.0f);
    nvgStroke(vg);
}

// The settings page body: three rows — zoom, center at origin, invert scroll.
// Labels on the left, controls on the right, all in world units so the page
// scales like any other.
void drawSettingsBody(NVGcontext* vg, const Page& page, const Camera& camera,
                      const FontSet& fonts, const PageUiState& ui) {
    const double zoom = camera.zoom();
    const double labelPx = 13.5 * zoom;
    if (!fonts.ok() || !settingsControlsInteractive(zoom)) {
        return; // controls are unreadable and unclickable this small
    }

    const SettingsLayout layout = settingsLayout(page);
    const auto radius = static_cast<float>(4.0 * zoom);

    nvgFontFaceId(vg, fonts.regular);
    nvgFontSize(vg, static_cast<float>(labelPx));
    nvgFillColor(vg, nvgRGBA(196, 205, 224, 200));

    // Row labels, vertically centred on their control.
    nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
    const auto labelX = static_cast<float>(
        camera.worldToScreen(page.rect.x + kPadding, 0.0).x);
    const char* const labels[] = {"Zoom", "View", "Invert scroll"};
    const Rect* const controls[] = {&layout.zoomField, &layout.centerButton,
                                    &layout.invertToggle};
    for (int i = 0; i < 3; ++i) {
        const ScreenRect r = project(camera, *controls[i]);
        nvgText(vg, labelX, r.y + r.h * 0.5f, labels[i], nullptr);
    }

    // Zoom field: the current zoom as an editable percentage. While editing it
    // shows the draft text with a caret; committing is the app's job.
    {
        const ScreenRect r = project(camera, layout.zoomField);
        drawControlChrome(vg, r, radius, ui.editingZoom);

        char text[48];
        if (ui.editingZoom) {
            std::snprintf(text, sizeof(text), "%s|", ui.zoomDraft.c_str());
        } else {
            std::snprintf(text, sizeof(text), "%g%%", ui.zoom * 100.0);
        }
        nvgTextAlign(vg, NVG_ALIGN_CENTER | NVG_ALIGN_MIDDLE);
        nvgFillColor(vg, nvgRGBA(222, 229, 244, 230));
        nvgText(vg, r.x + r.w * 0.5f, r.y + r.h * 0.5f, text, nullptr);
    }

    // Center-at-origin button.
    {
        const ScreenRect r = project(camera, layout.centerButton);
        drawControlChrome(vg, r, radius, false);
        nvgTextAlign(vg, NVG_ALIGN_CENTER | NVG_ALIGN_MIDDLE);
        nvgFillColor(vg, nvgRGBA(222, 229, 244, 230));
        nvgText(vg, r.x + r.w * 0.5f, r.y + r.h * 0.5f, "Center at origin",
                nullptr);
    }

    // Invert-scroll toggle: a pill whose knob sits right when on.
    {
        const ScreenRect r = project(camera, layout.invertToggle);
        const float pillRadius = r.h * 0.5f;
        nvgBeginPath(vg);
        nvgRoundedRect(vg, r.x, r.y, r.w, r.h, pillRadius);
        nvgFillColor(vg, ui.invertScroll ? nvgRGBA(168, 142, 235, 120)
                                         : nvgRGBA(255, 255, 255, 18));
        nvgFill(vg);
        nvgStrokeColor(vg, nvgRGBA(255, 255, 255, 34));
        nvgStrokeWidth(vg, 1.0f);
        nvgStroke(vg);

        const float knobR = pillRadius * 0.72f;
        const float knobX = ui.invertScroll ? r.x + r.w - pillRadius
                                            : r.x + pillRadius;
        nvgBeginPath(vg);
        nvgCircle(vg, knobX, r.y + pillRadius, knobR);
        nvgFillColor(vg, ui.invertScroll ? nvgRGBA(222, 229, 244, 235)
                                         : nvgRGBA(196, 205, 224, 160));
        nvgFill(vg);
    }
}

void strokeCaret(NVGcontext* vg, float x, float top, float height) {
    nvgBeginPath(vg);
    nvgMoveTo(vg, x, top);
    nvgLineTo(vg, x, top + height);
    nvgStrokeColor(vg, nvgRGBA(222, 229, 244, 245));
    nvgStrokeWidth(vg, 1.5f);
    nvgStroke(vg);
}

void drawPageCaret(NVGcontext* vg, const Page& page, const Camera& camera,
                   const FontSet& fonts, const PageUiState& ui,
                   PageTextRegion region) {
    if (ui.editingPageId != page.id || ui.editingRegion != region || !fonts.ok()) {
        return;
    }
    const double zoom = camera.zoom();
    const ScreenRect card = project(camera, page.rect);
    if (region == PageTextRegion::Title) {
        const float dotR = std::max(1.5f, static_cast<float>(4.0 * zoom));
        const float x = card.x + static_cast<float>(kPadding * zoom)
            + dotR * 3.0f;
        const float midY = card.y
            + static_cast<float>(kPageTitleBarHeight * zoom * 0.5);
        const std::size_t caret = std::min(ui.caret, page.title.size());
        nvgFontFaceId(vg, fonts.bold);
        nvgFontSize(vg, static_cast<float>(kTitleSize * zoom));
        nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
        const float advance = nvgTextBounds(vg, x, midY, page.title.c_str(),
                                             page.title.c_str() + caret, nullptr);
        const float height = std::max(8.0f, static_cast<float>(18.0 * zoom));
        strokeCaret(vg, x + advance, midY - height * 0.5f, height);
        return;
    }

    const float bodyX = card.x + static_cast<float>(kPadding * zoom);
    const float bodyY = card.y + static_cast<float>(
        (kPageTitleBarHeight + kPadding * 0.5) * zoom);
    const float bodyW = card.w - static_cast<float>(kPadding * 2.0 * zoom);
    const float fontSize = static_cast<float>(kBodySize * zoom);
    const float lineStep = fontSize * static_cast<float>(kBodyLineHeight);
    nvgFontFaceId(vg, fonts.regular);
    nvgFontSize(vg, fontSize);
    nvgTextLineHeight(vg, static_cast<float>(kBodyLineHeight));
    nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_TOP);

    const std::size_t caret = std::min(ui.caret, page.body.size());
    const char* base = page.body.c_str();
    const char* end = base + page.body.size();
    const char* cursor = base;
    int line = 0;
    while (cursor < end) {
        NVGtextRow rows[32];
        const int count = nvgTextBreakLines(vg, cursor, end, bodyW, rows, 32);
        if (count <= 0) break;
        for (int i = 0; i < count; ++i, ++line) {
            const std::size_t rowEnd = static_cast<std::size_t>(rows[i].next - base);
            if (caret <= rowEnd) {
                const char* caretPtr = base + std::min(
                    caret, static_cast<std::size_t>(rows[i].end - base));
                const float advance = nvgTextBounds(vg, bodyX, bodyY,
                    rows[i].start, caretPtr, nullptr);
                strokeCaret(vg, bodyX + advance,
                    bodyY + lineStep * static_cast<float>(line),
                    std::max(8.0f, fontSize * 1.25f));
                return;
            }
        }
        cursor = rows[count - 1].next;
    }
    strokeCaret(vg, bodyX, bodyY + lineStep * static_cast<float>(line),
                std::max(8.0f, fontSize * 1.25f));
}

void drawPage(NVGcontext* vg, const Page& page, const Camera& camera,
              const FontSet& fonts, const PageUiState& ui) {
    const bool selected = page.id == ui.selectedId;
    const double zoom = camera.zoom();
    const ScreenRect card = project(camera, page.displayRect());
    const auto radius = static_cast<float>(kCornerRadius * zoom);

    const NVGcolor accent = accentFor(page.kind);

    // Drop shadow, so pages read as sitting above the plane rather than being
    // regions painted onto it.
    const float shadowSpread = std::max(2.0f, static_cast<float>(10.0 * zoom));
    NVGpaint shadow = nvgBoxGradient(vg, card.x, card.y + shadowSpread * 0.35f,
        card.w, card.h, radius, shadowSpread,
        nvgRGBA(0, 0, 0, 90), nvgRGBA(0, 0, 0, 0));
    nvgBeginPath(vg);
    nvgRect(vg, card.x - shadowSpread, card.y - shadowSpread,
            card.w + shadowSpread * 2.0f, card.h + shadowSpread * 2.0f);
    nvgRoundedRect(vg, card.x, card.y, card.w, card.h, radius);
    nvgPathWinding(vg, NVG_HOLE);
    nvgFillPaint(vg, shadow);
    nvgFill(vg);

    // Card.
    nvgBeginPath(vg);
    nvgRoundedRect(vg, card.x, card.y, card.w, card.h, radius);
    nvgFillColor(vg, nvgRGBA(30, 33, 43, 240));
    nvgFill(vg);

    nvgStrokeColor(vg, selected ? withAlpha(accent, 200)
                                : nvgRGBA(255, 255, 255, 28));
    nvgStrokeWidth(vg, selected ? 2.0f : 1.0f);
    nvgStroke(vg);

    // Kind accent: a small dot in the title bar. Kept visible below text LOD —
    // at a distance the dot's colour is what distinguishes a conversation from
    // a note.
    const double titlePx = kTitleSize * zoom;
    const float dotR = std::max(1.5f, static_cast<float>(4.0 * zoom));
    const auto padPx = static_cast<float>(kPadding * zoom);
    const auto titleBarPx = static_cast<float>(kPageTitleBarHeight * zoom);
    nvgBeginPath(vg);
    nvgCircle(vg, card.x + padPx, card.y + titleBarPx * 0.5f, dotR);
    nvgFillColor(vg, withAlpha(accent, 210));
    nvgFill(vg);

    if (fonts.ok() && titlePx >= kMinTitlePx && !page.title.empty()) {
        nvgFontFaceId(vg, fonts.bold);
        nvgFontSize(vg, static_cast<float>(titlePx));
        nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
        nvgFillColor(vg, nvgRGBA(222, 229, 244, 235));
        // Clip the title to the card, short of the minimize button.
        const ScreenRect button = project(camera, page.minimizeButtonRect());
        nvgSave(vg);
        nvgIntersectScissor(vg, card.x + padPx + dotR * 3.0f, card.y,
                            std::max(0.0f, button.x - card.x - padPx - dotR * 3.0f),
                            titleBarPx);
        nvgText(vg, card.x + padPx + dotR * 3.0f, card.y + titleBarPx * 0.5f,
                page.title.c_str(), nullptr);
        nvgRestore(vg);
    }

    drawMinimizeButton(vg, camera, page);
    drawPageCaret(vg, page, camera, fonts, ui, PageTextRegion::Title);

    if (page.minimized) {
        return; // the title bar is the whole card
    }

    // Divider under the title bar.
    if (card.h > titleBarPx * 1.5f) {
        nvgBeginPath(vg);
        nvgMoveTo(vg, card.x + padPx * 0.75f, card.y + titleBarPx);
        nvgLineTo(vg, card.x + card.w - padPx * 0.75f, card.y + titleBarPx);
        nvgStrokeColor(vg, nvgRGBA(255, 255, 255, 18));
        nvgStrokeWidth(vg, 1.0f);
        nvgStroke(vg);
    }

    // Body, clipped to the content area below the title bar.
    const float bodyX = card.x + padPx;
    const float bodyY = card.y + titleBarPx + padPx * 0.5f;
    const float bodyW = card.w - padPx * 2.0f;
    const float bodyH = card.h - titleBarPx - padPx * 1.5f;
    if (bodyW <= 0.0f || bodyH <= 0.0f) {
        return;
    }

    nvgSave(vg);
    nvgIntersectScissor(vg, bodyX, bodyY, bodyW, bodyH);
    if (page.kind == PageKind::Settings) {
        drawSettingsBody(vg, page, camera, fonts, ui);
    } else if (!page.body.empty()) {
        const double bodyPx = kBodySize * zoom;
        const double lineStepPx = bodyPx * kBodyLineHeight;
        if (fonts.ok() && bodyPx >= kMinBodyPx) {
            nvgFontFaceId(vg, fonts.regular);
            nvgFontSize(vg, static_cast<float>(bodyPx));
            nvgTextLineHeight(vg, static_cast<float>(kBodyLineHeight));
            nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_TOP);
            nvgFillColor(vg, nvgRGBA(196, 205, 224, 200));
            nvgTextBox(vg, bodyX, bodyY, bodyW, page.body.c_str(), nullptr);
        } else if (bodyPx >= kMinGreekPx) {
            drawGreekedBody(vg, page.id, bodyX, bodyY, bodyW, bodyH, lineStepPx);
        }
    }
    nvgRestore(vg);
    drawPageCaret(vg, page, camera, fonts, ui, PageTextRegion::Body);
}

void drawResizeHandles(NVGcontext* vg, const Page& page, const Camera& camera) {
    if (page.minimized) {
        return;
    }
    const ScreenRect card = project(camera, page.rect);
    constexpr float size = 9.0f;
    const float half = size * 0.5f;
    const float points[4][2] = {
        {card.x, card.y}, {card.x + card.w, card.y},
        {card.x, card.y + card.h}, {card.x + card.w, card.y + card.h},
    };
    for (const auto& point : points) {
        nvgBeginPath(vg);
        nvgRoundedRect(vg, point[0] - half, point[1] - half, size, size, 2.0f);
        nvgFillColor(vg, nvgRGBA(222, 229, 244, 245));
        nvgFill(vg);
        nvgStrokeColor(vg, nvgRGBA(92, 112, 175, 240));
        nvgStrokeWidth(vg, 1.5f);
        nvgStroke(vg);
    }
}

} // namespace

PageTextRegion pageTextRegionAt(const Page& page, Vec2 worldPoint) {
    if (!page.displayRect().contains(worldPoint)) {
        return PageTextRegion::None;
    }
    if (worldPoint.y < page.rect.y + kPageTitleBarHeight
        && !page.minimizeButtonRect().contains(worldPoint)) {
        return PageTextRegion::Title;
    }
    if (!page.minimized && page.kind != PageKind::Settings
        && worldPoint.y >= page.rect.y + kPageTitleBarHeight) {
        return PageTextRegion::Body;
    }
    return PageTextRegion::None;
}

std::size_t pageTextIndexAt(NVGcontext* vg, const Page& page,
                            const Camera& camera, const FontSet& fonts,
                            PageTextRegion region, Vec2 screenPoint) {
    if (vg == nullptr || !fonts.ok() || region == PageTextRegion::None) {
        return 0;
    }
    const double zoom = camera.zoom();
    const ScreenRect card = project(camera, page.rect);
    const auto indexOnLine = [&](const char* start, const char* end,
                                 float x, float y) {
        if (start == end) {
            return static_cast<std::size_t>(start - (region == PageTextRegion::Title
                ? page.title.c_str() : page.body.c_str()));
        }
        std::vector<NVGglyphPosition> glyphs(
            static_cast<std::size_t>(end - start) + 1u);
        const int count = nvgTextGlyphPositions(vg, x, y, start, end,
                                                glyphs.data(),
                                                static_cast<int>(glyphs.size()));
        for (int i = 0; i < count; ++i) {
            const float midpoint = (glyphs[static_cast<std::size_t>(i)].x
                + glyphs[static_cast<std::size_t>(i)].maxx) * 0.5f;
            if (screenPoint.x < midpoint) {
                const char* base = region == PageTextRegion::Title
                    ? page.title.c_str() : page.body.c_str();
                return static_cast<std::size_t>(
                    glyphs[static_cast<std::size_t>(i)].str - base);
            }
        }
        const char* base = region == PageTextRegion::Title
            ? page.title.c_str() : page.body.c_str();
        return static_cast<std::size_t>(end - base);
    };

    if (region == PageTextRegion::Title) {
        const float dotR = std::max(1.5f, static_cast<float>(4.0 * zoom));
        const float x = card.x + static_cast<float>(kPadding * zoom)
            + dotR * 3.0f;
        const float y = card.y
            + static_cast<float>(kPageTitleBarHeight * zoom * 0.5);
        nvgFontFaceId(vg, fonts.bold);
        nvgFontSize(vg, static_cast<float>(kTitleSize * zoom));
        nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
        return indexOnLine(page.title.c_str(),
                           page.title.c_str() + page.title.size(), x, y);
    }

    const float bodyX = card.x + static_cast<float>(kPadding * zoom);
    const float bodyY = card.y + static_cast<float>(
        (kPageTitleBarHeight + kPadding * 0.5) * zoom);
    const float bodyW = card.w - static_cast<float>(kPadding * 2.0 * zoom);
    const float fontSize = static_cast<float>(kBodySize * zoom);
    const float lineStep = fontSize * static_cast<float>(kBodyLineHeight);
    const int targetLine = std::max(0, static_cast<int>(
        std::floor((screenPoint.y - bodyY) / std::max(lineStep, 1.0f))));
    nvgFontFaceId(vg, fonts.regular);
    nvgFontSize(vg, fontSize);
    nvgTextLineHeight(vg, static_cast<float>(kBodyLineHeight));
    nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_TOP);

    const char* cursor = page.body.c_str();
    const char* end = cursor + page.body.size();
    int line = 0;
    while (cursor < end) {
        NVGtextRow rows[32];
        const int count = nvgTextBreakLines(vg, cursor, end, bodyW, rows, 32);
        if (count <= 0) break;
        for (int i = 0; i < count; ++i, ++line) {
            if (line == targetLine) {
                return indexOnLine(rows[i].start, rows[i].end, bodyX,
                                   bodyY + lineStep * static_cast<float>(line));
            }
        }
        cursor = rows[count - 1].next;
    }
    return page.body.size();
}

SettingsLayout settingsLayout(const Page& page) {
    const double rowStartY = page.rect.y + kPageTitleBarHeight + 12.0;
    const double controlRight = page.rect.right() - kPadding;

    const auto rowControl = [&](int row, double width, double height) {
        const double rowY = rowStartY + kRowHeight * row;
        return Rect {controlRight - width,
                     rowY + (kRowHeight - height) * 0.5,
                     width, height};
    };

    SettingsLayout layout;
    layout.zoomField = rowControl(0, kZoomFieldWidth, kControlHeight);
    layout.centerButton = rowControl(1, kCenterButtonWidth, kControlHeight);
    layout.invertToggle = rowControl(2, kToggleWidth, kToggleHeight);
    return layout;
}

Rect settingsPageRect(Vec2 topLeft) {
    return {topLeft.x, topLeft.y, 320.0,
            kPageTitleBarHeight + 12.0 + kRowHeight * 3.0 + 16.0};
}

bool settingsControlsInteractive(double zoom) {
    return 13.5 * zoom >= kMinBodyPx;
}

void drawPages(NVGcontext* vg, const World& world, const Camera& camera,
               double viewW, double viewH, const FontSet& fonts,
               const PageUiState& ui) {
    // Cull against a slightly inflated view so shadows at the edge don't pop.
    Rect visible = camera.visibleWorldRect(viewW, viewH);
    const double slack = 24.0 / std::max(camera.zoom(), 1e-6);
    visible.x -= slack;
    visible.y -= slack;
    visible.w += slack * 2.0;
    visible.h += slack * 2.0;

    for (const Page& page : world.pages()) {
        if (page.displayRect().intersects(visible)) {
            drawPage(vg, page, camera, fonts, ui);
            if (page.id == ui.selectedId) {
                drawResizeHandles(vg, page, camera);
            }
        }
    }
}

} // namespace tapestry
