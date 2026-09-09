#include "kernel/Time.hpp"

namespace tapestry::kernel {

std::string RecordedAt::rfc3339Z() const { return {}; }
std::optional<RecordedAt> RecordedAt::parse(std::string_view) { return std::nullopt; }
bool isValidEventTime(std::string_view) { return false; }
RecordedAt SystemClock::now() { return {}; }

} // namespace tapestry::kernel
