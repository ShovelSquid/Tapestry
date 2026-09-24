#pragma once

#include "core/Page.hpp"
#include "core/Stroke.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace tapestry {

// The model: every page in the workspace, kept in draw order — index 0 is the
// furthest back, the last element draws on top and is hit-tested first.
//
// The world advances only through step(), in fixed ticks, and never reads
// wall-clock time. That is inherited from semantic-world and it is what makes
// a recorded session replayable: identical inputs at identical ticks produce
// an identical world.
class World {
public:
    // Appends on top of the draw order and assigns the next id. Returns the id
    // rather than a reference: the vector reallocates as pages are added, so a
    // reference would be an invitation to dangle.
    std::uint64_t addPage(PageKind kind, std::string title, std::string body,
                          Rect rect);

    // Topmost page containing the world point, or nullptr. Pointers are valid
    // only until the next addPage/bringToFront — hold ids across frames, not
    // pointers.
    Page* pageAt(Vec2 worldPoint);
    const Page* pageAt(Vec2 worldPoint) const;
    Page* pageById(std::uint64_t id);
    const Page* pageById(std::uint64_t id) const;

    void bringToFront(std::uint64_t id);

    std::uint64_t beginStroke(StrokePoint first);
    void appendStrokePoint(std::uint64_t id, StrokePoint point);
    Stroke* strokeById(std::uint64_t id);
    const Stroke* strokeById(std::uint64_t id) const;
    void adoptStroke(Stroke stroke);

    // Union of every page rect. Zero-size when there are no pages; check
    // empty() before framing.
    Rect contentBounds() const;

    // Advances one fixed tick. Pages are inert this milestone, so all it moves
    // is the tick counter — but the loop calls it unconditionally so that when
    // pages do gain behaviour, nothing about the loop's shape changes.
    void step(std::uint32_t dtMs);

    // Deserialization only: appends a page that keeps its saved id, and moves
    // the id counter past it. Everything else should go through addPage.
    void adopt(Page page);
    void setTicks(std::uint64_t ticks);

    const std::vector<Page>& pages() const { return m_pages; }
    const std::vector<Stroke>& strokes() const { return m_strokes; }
    std::uint64_t ticks() const { return m_ticks; }
    bool empty() const { return m_pages.empty() && m_strokes.empty(); }

private:
    std::vector<Page> m_pages;
    std::vector<Stroke> m_strokes;
    std::uint64_t m_nextId = 1;
    std::uint64_t m_nextStrokeId = 1;
    std::uint64_t m_ticks = 0;
};

} // namespace tapestry
