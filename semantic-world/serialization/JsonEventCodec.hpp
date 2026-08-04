#pragma once

#include "events/Event.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace sw {

// Readable JSON first; binary snapshots later. The codec is versioned by
// Event::schemaVersion so old logs stay replayable.
std::string encodeEvents(const std::vector<Event>& events);
std::vector<Event> decodeEvents(std::string_view json);

} // namespace sw
