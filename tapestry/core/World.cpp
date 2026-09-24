#include "core/World.hpp"

#include <algorithm>
#include <utility>

namespace tapestry {

std::uint64_t World::addPage(PageKind kind, std::string title, std::string body,
                             Rect rect) {
    Page page;
    page.id = m_nextId++;
    page.kind = kind;
    page.title = std::move(title);
    page.body = std::move(body);
    page.rect = rect;
    m_pages.push_back(std::move(page));
    return m_pages.back().id;
}

Page* World::pageAt(Vec2 worldPoint) {
    // Back to front: the last-drawn page is the one under the cursor. Testing
    // the display rect means a minimized page's hidden body lets clicks fall
    // through to whatever is underneath it.
    for (auto it = m_pages.rbegin(); it != m_pages.rend(); ++it) {
        if (it->displayRect().contains(worldPoint)) {
            return &*it;
        }
    }
    return nullptr;
}

const Page* World::pageAt(Vec2 worldPoint) const {
    for (auto it = m_pages.rbegin(); it != m_pages.rend(); ++it) {
        if (it->displayRect().contains(worldPoint)) {
            return &*it;
        }
    }
    return nullptr;
}

Page* World::pageById(std::uint64_t id) {
    for (Page& page : m_pages) {
        if (page.id == id) {
            return &page;
        }
    }
    return nullptr;
}

const Page* World::pageById(std::uint64_t id) const {
    for (const Page& page : m_pages) {
        if (page.id == id) {
            return &page;
        }
    }
    return nullptr;
}

void World::bringToFront(std::uint64_t id) {
    const auto it = std::find_if(m_pages.begin(), m_pages.end(),
        [id](const Page& page) { return page.id == id; });
    if (it != m_pages.end()) {
        // Rotate rather than swap so the relative order of everything else is
        // preserved — raising one page must not shuffle the rest of the stack.
        std::rotate(it, it + 1, m_pages.end());
    }
}

std::uint64_t World::beginStroke(StrokePoint first) {
    Stroke stroke;
    stroke.id = m_nextStrokeId++;
    stroke.points.push_back(first);
    m_strokes.push_back(std::move(stroke));
    return m_strokes.back().id;
}

void World::appendStrokePoint(std::uint64_t id, StrokePoint point) {
    Stroke* stroke = strokeById(id);
    if (stroke != nullptr) {
        stroke->points.push_back(point);
    }
}

Stroke* World::strokeById(std::uint64_t id) {
    for (Stroke& stroke : m_strokes) {
        if (stroke.id == id) return &stroke;
    }
    return nullptr;
}

const Stroke* World::strokeById(std::uint64_t id) const {
    for (const Stroke& stroke : m_strokes) {
        if (stroke.id == id) return &stroke;
    }
    return nullptr;
}

void World::adoptStroke(Stroke stroke) {
    m_nextStrokeId = std::max(m_nextStrokeId, stroke.id + 1);
    m_strokes.push_back(std::move(stroke));
}

Rect World::contentBounds() const {
    Rect bounds;
    bool found = false;
    for (const Page& page : m_pages) {
        bounds = found ? bounds.unionWith(page.displayRect()) : page.displayRect();
        found = true;
    }
    for (const Stroke& stroke : m_strokes) {
        for (const StrokePoint& point : stroke.points) {
            const Rect mark {point.position.x, point.position.y, 0.001, 0.001};
            bounds = found ? bounds.unionWith(mark) : mark;
            found = true;
        }
    }
    return found ? bounds : Rect {};
}

namespace {

std::vector<SpaceState>::iterator spaceLowerBound(std::vector<SpaceState>& spaces,
                                                  std::uint64_t pageId) {
    return std::lower_bound(spaces.begin(), spaces.end(), pageId,
        [](const SpaceState& s, std::uint64_t id) { return s.pageId < id; });
}

} // namespace

mathspace::Error World::applySpaceAction(std::uint64_t pageId,
                                         const std::vector<std::uint8_t>& action,
                                         mathspace::NoteId* created) {
    const Page* page = pageById(pageId);
    if (page == nullptr || page->kind != PageKind::Space) {
        return mathspace::Error::NoSuchSpace;
    }
    auto it = spaceLowerBound(m_spaces, pageId);
    if (it == m_spaces.end() || it->pageId != pageId) {
        SpaceState fresh;
        fresh.pageId = pageId;
        fresh.world = mathspace::World(pageId);
        it = m_spaces.insert(it, std::move(fresh));
    }
    const mathspace::Error result = it->world.apply(action, created);
    if (result == mathspace::Error::Ok) {
        it->log.push_back(action);
    }
    return result;
}

const SpaceState* World::space(std::uint64_t pageId) const {
    for (const SpaceState& s : m_spaces) {
        if (s.pageId == pageId) return &s;
    }
    return nullptr;
}

void World::adoptSpace(SpaceState state) {
    auto it = spaceLowerBound(m_spaces, state.pageId);
    if (it != m_spaces.end() && it->pageId == state.pageId) {
        *it = std::move(state);
    } else {
        m_spaces.insert(it, std::move(state));
    }
}

void World::adopt(Page page) {
    // Deserialization path: the page keeps the id it was saved with, and the
    // id counter moves past it so later addPage calls never collide.
    if (page.id >= m_nextId) {
        m_nextId = page.id + 1;
    }
    m_pages.push_back(std::move(page));
}

void World::setTicks(std::uint64_t ticks) {
    m_ticks = ticks;
}

void World::step(std::uint32_t dtMs) {
    (void)dtMs;
    ++m_ticks;
}

} // namespace tapestry
