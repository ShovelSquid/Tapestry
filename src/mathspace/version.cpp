// mathspace/version.cpp — the one symbol that exists before the store does.
//
// The static library needs a translation unit from the first commit so the
// CMake target, the test link and the forbidden-token gate are all exercised
// before any real code lands. The version string is also what a fixture
// header will record once goldens exist.
#include "mathspace/version.hpp"

namespace mathspace {

const char* version() { return "mathspace 0.1.0"; }

} // namespace mathspace
