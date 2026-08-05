#pragma once

#include "core/Camera.hpp"
#include "core/World.hpp"

struct NVGcontext;

namespace tapestry {

void drawStrokes(NVGcontext* vg, const World& world, const Camera& camera);

} // namespace tapestry
