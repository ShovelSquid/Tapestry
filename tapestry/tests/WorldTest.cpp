// World invariants.
//
// The world is the model everything else will be built on — hit-testing feeds
// input handling, draw order feeds rendering, and step() is the seam replay
// verification will clamp onto. These are the properties that must hold before
// any of that lands on top.

#include "core/World.hpp"
#include "render/Pages.hpp"

#include <cstdio>

namespace {

using tapestry::Page;
using tapestry::PageKind;
using tapestry::Rect;
using tapestry::ResizeCorner;
using tapestry::Vec2;
using tapestry::World;

int g_failures = 0;

void check(bool condition, const char* what) {
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s\n", what);
        ++g_failures;
    }
}

void checkNear(double actual, double expected, double tolerance, const char* what) {
    const double diff = actual - expected;
    if (diff > tolerance || diff < -tolerance) {
        std::fprintf(stderr, "FAIL: %s (got %.9f, want %.9f)\n",
            what, actual, expected);
        ++g_failures;
    }
}

void idsAreUniqueAndOrdered() {
    World world;
    const auto a = world.addPage(PageKind::Note, "a", "", {0, 0, 10, 10});
    const auto b = world.addPage(PageKind::Note, "b", "", {0, 0, 10, 10});
    const auto c = world.addPage(PageKind::File, "c", "", {0, 0, 10, 10});

    check(a != b && b != c && a != c, "page ids are unique");
    check(a < b && b < c, "page ids increase in creation order");
    check(world.pages().size() == 3, "addPage grows the page list");
    check(world.pages().back().id == c, "new pages join the top of the draw order");
}

// The page drawn last is the page the cursor hits.
void hitTestFindsTopmost() {
    World world;
    const auto below = world.addPage(PageKind::Note, "below", "", {0, 0, 100, 100});
    const auto above = world.addPage(PageKind::Note, "above", "", {50, 50, 100, 100});

    Page* hit = world.pageAt({75.0, 75.0}); // inside both
    check(hit != nullptr && hit->id == above, "pageAt prefers the topmost page");

    hit = world.pageAt({10.0, 10.0}); // inside `below` only
    check(hit != nullptr && hit->id == below, "pageAt falls through to lower pages");

    check(world.pageAt({-5.0, -5.0}) == nullptr, "pageAt misses empty space");

    // Containment is half-open: the top-left edge belongs to a page, the
    // bottom-right edge belongs to whatever is under it.
    check(world.pageAt({0.0, 0.0}) != nullptr, "pageAt includes the top-left edge");
    check(world.pageAt({150.0, 150.0}) == nullptr, "pageAt excludes the bottom-right edge");
}

void bringToFrontPreservesRelativeOrder() {
    World world;
    const auto a = world.addPage(PageKind::Note, "a", "", {0, 0, 10, 10});
    const auto b = world.addPage(PageKind::Note, "b", "", {0, 0, 10, 10});
    const auto c = world.addPage(PageKind::Note, "c", "", {0, 0, 10, 10});

    world.bringToFront(a);

    const auto& pages = world.pages();
    check(pages.size() == 3, "bringToFront does not add or drop pages");
    check(pages[0].id == b && pages[1].id == c && pages[2].id == a,
        "bringToFront raises the page and keeps the rest in order");

    // Raising the already-top page is a no-op, not a shuffle.
    world.bringToFront(a);
    check(pages[0].id == b && pages[1].id == c && pages[2].id == a,
        "bringToFront on the top page changes nothing");

    // An unknown id is ignored — stale ids arrive naturally from input events.
    world.bringToFront(9999);
    check(pages.size() == 3 && pages[2].id == a,
        "bringToFront ignores unknown ids");
}

void pageByIdSurvivesReordering() {
    World world;
    const auto a = world.addPage(PageKind::Note, "a", "", {0, 0, 10, 10});
    const auto b = world.addPage(PageKind::Note, "b", "", {20, 0, 10, 10});
    world.bringToFront(a);

    Page* page = world.pageById(b);
    check(page != nullptr && page->rect.x == 20.0,
        "pageById finds pages after reordering");
    check(world.pageById(1234) == nullptr, "pageById misses unknown ids");
}

void contentBoundsUnionsAllPages() {
    World world;
    check(world.contentBounds().w == 0.0 && world.contentBounds().h == 0.0,
        "contentBounds of an empty world is zero-size");

    world.addPage(PageKind::Note, "a", "", {-100.0, -50.0, 60.0, 40.0});
    world.addPage(PageKind::Note, "b", "", {200.0, 100.0, 80.0, 30.0});

    const Rect bounds = world.contentBounds();
    checkNear(bounds.x, -100.0, 1e-12, "contentBounds left edge");
    checkNear(bounds.y, -50.0, 1e-12, "contentBounds top edge");
    checkNear(bounds.right(), 280.0, 1e-12, "contentBounds right edge");
    checkNear(bounds.bottom(), 130.0, 1e-12, "contentBounds bottom edge");
}

// Identical operations at identical ticks must produce identical worlds. Pages
// are inert this milestone, so the property is cheap — but locking it in now
// means any future rule that breaks it fails a test instead of a replay.
void steppingIsDeterministic() {
    World first;
    World second;

    for (World* world : {&first, &second}) {
        world->addPage(PageKind::Note, "a", "body", {0, 0, 100, 100});
        for (int i = 0; i < 480; ++i) {
            world->step(16);
        }
        world->addPage(PageKind::Conversation, "b", "", {50, 50, 100, 100});
        for (int i = 0; i < 480; ++i) {
            world->step(16);
        }
    }

    check(first.ticks() == second.ticks(), "tick counts match");
    check(first.ticks() == 960, "step advances exactly one tick per call");
    check(first.pages().size() == second.pages().size(), "page counts match");
    for (size_t i = 0; i < first.pages().size(); ++i) {
        const Page& p = first.pages()[i];
        const Page& q = second.pages()[i];
        check(p.id == q.id && p.rect.x == q.rect.x && p.rect.y == q.rect.y
                && p.rect.w == q.rect.w && p.rect.h == q.rect.h,
            "page state matches after identical histories");
    }
}

// Minimizing collapses a page to its title bar for both drawing and clicking.
void minimizedPagesHitOnlyTheTitleBar() {
    World world;
    const auto under = world.addPage(PageKind::Note, "under", "",
        {0.0, 0.0, 200.0, 300.0});
    const auto over = world.addPage(PageKind::Note, "over", "",
        {50.0, 50.0, 200.0, 300.0});

    Page* page = world.pageById(over);
    page->minimized = true;

    const Rect display = page->displayRect();
    checkNear(display.h, tapestry::kPageTitleBarHeight, 1e-12,
        "a minimized page's display rect is its title bar");
    checkNear(display.w, 200.0, 1e-12,
        "minimizing does not change a page's width");

    // Inside the title bar: still the minimized page.
    Page* hit = world.pageAt({60.0, 60.0});
    check(hit != nullptr && hit->id == over,
        "the title bar of a minimized page is clickable");

    // Below the title bar, where the body used to be: falls through to the
    // page underneath.
    hit = world.pageAt({60.0, 150.0});
    check(hit != nullptr && hit->id == under,
        "clicks fall through a minimized page's hidden body");

    // The button lives inside the title bar.
    const Rect button = page->minimizeButtonRect();
    check(display.contains({button.x, button.y})
              && display.contains({button.right() - 1e-9, button.bottom() - 1e-9}),
        "the minimize button sits inside the title bar");

    page->minimized = false;
    hit = world.pageAt({60.0, 150.0});
    check(hit != nullptr && hit->id == over,
        "restoring a page makes its body clickable again");
}

void resizeCornersHaveStableHitRegions() {
    Page page;
    page.rect = {100.0, 200.0, 300.0, 180.0};

    check(page.resizeCornerAt({96.0, 204.0}, 6.0) == ResizeCorner::TopLeft,
        "top-left resize handle includes its outside hit region");
    check(page.resizeCornerAt({404.0, 196.0}, 6.0) == ResizeCorner::TopRight,
        "top-right resize handle includes its outside hit region");
    check(page.resizeCornerAt({96.0, 384.0}, 6.0) == ResizeCorner::BottomLeft,
        "bottom-left resize handle includes its outside hit region");
    check(page.resizeCornerAt({404.0, 384.0}, 6.0) == ResizeCorner::BottomRight,
        "bottom-right resize handle includes its outside hit region");
    check(page.resizeCornerAt({250.0, 200.0}, 6.0) == ResizeCorner::None,
        "page edges away from corners are not resize handles");

    page.minimized = true;
    check(page.resizeCornerAt({100.0, 200.0}, 6.0) == ResizeCorner::None,
        "minimized pages do not expose resize handles");
}

void pageTextRegionsIncludeBlankDocumentSpace() {
    Page page;
    page.kind = PageKind::Note;
    page.rect = {100.0, 200.0, 300.0, 180.0};

    check(tapestry::pageTextRegionAt(page, {160.0, 220.0})
            == tapestry::PageTextRegion::Title,
        "page title bars expose editable title text");
    check(tapestry::pageTextRegionAt(page, {160.0, 300.0})
            == tapestry::PageTextRegion::Body,
        "blank page body space remains editable");
    const Rect minimize = page.minimizeButtonRect();
    check(tapestry::pageTextRegionAt(page, {minimize.x + 1.0, minimize.y + 1.0})
            == tapestry::PageTextRegion::None,
        "minimize control is not treated as editable title text");

    page.kind = PageKind::Settings;
    check(tapestry::pageTextRegionAt(page, {160.0, 300.0})
            == tapestry::PageTextRegion::None,
        "settings controls are not treated as document text");
    page.minimized = true;
    check(tapestry::pageTextRegionAt(page, {160.0, 300.0})
            == tapestry::PageTextRegion::None,
        "hidden bodies are not editable");
}

void stepDoesNotMovePages() {
    World world;
    const auto id = world.addPage(PageKind::Note, "a", "", {12.5, -7.25, 90.0, 60.0});
    for (int i = 0; i < 1000; ++i) {
        world.step(16);
    }
    const Page* page = world.pageById(id);
    check(page != nullptr, "page survives stepping");
    checkNear(page->rect.x, 12.5, 0.0, "step leaves page x untouched");
    checkNear(page->rect.y, -7.25, 0.0, "step leaves page y untouched");
}

void strokesKeepWorldCoordinatesAndPressure() {
    World world;
    const auto id = world.beginStroke({{10.0, -5.0}, 0.2});
    world.appendStrokePoint(id, {{30.0, 40.0}, 0.9});
    const auto* stroke = world.strokeById(id);
    check(stroke != nullptr && stroke->points.size() == 2,
        "stroke samples append to one persistent vector path");
    checkNear(stroke->points[0].pressure, 0.2, 0.0,
        "stroke preserves initial pressure");
    checkNear(stroke->points[1].position.y, 40.0, 0.0,
        "stroke preserves world-space coordinates");
}

} // namespace

int main() {
    idsAreUniqueAndOrdered();
    hitTestFindsTopmost();
    bringToFrontPreservesRelativeOrder();
    pageByIdSurvivesReordering();
    contentBoundsUnionsAllPages();
    minimizedPagesHitOnlyTheTitleBar();
    resizeCornersHaveStableHitRegions();
    pageTextRegionsIncludeBlankDocumentSpace();
    steppingIsDeterministic();
    stepDoesNotMovePages();
    strokesKeepWorldCoordinatesAndPressure();

    if (g_failures != 0) {
        std::fprintf(stderr, "%d world check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("world: all checks passed\n");
    return 0;
}
