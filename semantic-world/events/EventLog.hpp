#pragma once

#include "events/Event.hpp"

#include <filesystem>
#include <vector>

namespace sw {

// Phase 4: append-only log. Entries are never edited or reordered — a
// correction is a new event, not a rewrite.
class EventLog {
public:
    void append(const Event& event);

    const std::vector<Event>& events() const;
    std::vector<Event> eventsForTick(Tick tick) const;

    void save(const std::filesystem::path& path) const;
    static EventLog load(const std::filesystem::path& path);

private:
    std::vector<Event> m_events;
    Sequence m_nextSequence {1};
};

} // namespace sw
