#pragma once

#include "rendering/Renderer.hpp"

struct SDL_Renderer;

namespace sw {

// Phase 7: draws cells as coloured rectangles (stone grey, sand yellow,
// water blue, entity white). It reads a WorldView and never writes to the
// world — disabling it must not change a single hash.
class SDLRenderer final : public Renderer {
public:
    explicit SDLRenderer(SDL_Renderer* renderer);

    void draw(const WorldView& view) override;

private:
    SDL_Renderer* m_renderer {};
    int m_cellSize {4};
};

} // namespace sw
