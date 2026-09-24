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
