#pragma once

#include "core/Types.hpp"

#include <cstdint>
#include <string>

namespace tapestry {

// What a page is. Sets its accent colour today; later it sets behaviour —
// conversations gain a composer, files mirror something on disk. Settings is
// an ordinary page in every mechanical respect (drag it, minimize it, save
// it); only its body is special — the renderer draws controls there and the
// app routes clicks on them to the camera and preferences.
enum class PageKind : std::uint8_t {
    Note,
    Conversation,
    File,
    Settings,
};

// Page header layout, in world units. Lives here rather than in the renderer
// because hit-testing (core) and drawing (render) must agree on where the
// title bar and its minimize button are.
constexpr double kPageTitleBarHeight = 40.0;
constexpr double kMinimizeButtonSize = 20.0;
constexpr double kMinimizeButtonMargin = 10.0;

// A page in world space. The rectangle is in world units, and 1 world unit is
// 1 logical pixel at 100% zoom — that is what "real reading size" means: at
// 100% a page's body text is the same size as text in any other window.
//
// Pages are model state, owned by World. Nothing here knows about rendering;
// how much of the text is legible at a given zoom is the renderer's business.
struct Page {
    std::uint64_t id = 0;
    PageKind kind = PageKind::Note;
    std::string title;
    std::string body;
    Rect rect;
    bool minimized = false;

    // The rectangle the page currently occupies on the canvas: the full rect,
    // or just the title bar when minimized. Hit-testing and rendering both go
    // through this, so a minimized page's hidden body is not clickable.
    Rect displayRect() const {
        if (minimized) {
            return {rect.x, rect.y, rect.w, kPageTitleBarHeight};
        }
        return rect;
    }

    // The minimize/restore button at the top right of the title bar.
    Rect minimizeButtonRect() const {
        return {rect.x + rect.w - kMinimizeButtonMargin - kMinimizeButtonSize,
                rect.y + (kPageTitleBarHeight - kMinimizeButtonSize) * 0.5,
                kMinimizeButtonSize,
                kMinimizeButtonSize};
    }
};

} // namespace tapestry
