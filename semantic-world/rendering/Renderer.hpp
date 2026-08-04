#pragma once

namespace sw {

// Read-only projection of the world handed to renderers. Phase 7 defines it
// properly; the important property is that it is not a mutable World.
class WorldView;

class Renderer {
public:
    virtual ~Renderer() = default;
    virtual void draw(const WorldView& view) = 0;
};

} // namespace sw
