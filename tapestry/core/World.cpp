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

Page* World::pageById(std::uint64_t id) {
    for (Page& page : m_pages) {
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

Rect World::contentBounds() const {
    if (m_pages.empty()) {
        return {};
    }
    Rect bounds = m_pages.front().displayRect();
    for (const Page& page : m_pages) {
        bounds = bounds.unionWith(page.displayRect());
    }
    return bounds;
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
