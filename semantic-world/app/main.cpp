// Phase 0 application shell: opens a blank window and runs a fixed-timestep
// loop. It owns no world state yet — Phase 1 supplies the world, Phase 7 the
// renderer. The loop shape is here from the start so simulation stepping can
// never accidentally become frame-rate dependent.

#include <SDL.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {

constexpr int kWindowWidth = 960;
constexpr int kWindowHeight = 600;

// Fixed simulation timestep. Rendering may drop or repeat frames; the
// simulation may not.
constexpr Uint32 kTickIntervalMs = 16;

struct Options {
    long frameLimit = -1; // -1 means run until the user quits
    bool headless = false;
};

Options parseOptions(int argc, char** argv) {
    Options options;

    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--frames") == 0 && i + 1 < argc) {
            options.frameLimit = std::strtol(argv[++i], nullptr, 10);
        } else if (std::strcmp(argv[i], "--headless") == 0) {
            options.headless = true;
        } else {
            std::fprintf(stderr,
                "usage: semantic_world [--frames N] [--headless]\n");
            std::exit(2);
        }
    }

    return options;
}

} // namespace

int main(int argc, char** argv) {
    const Options options = parseOptions(argc, argv);

#ifdef SDL_HINT_VIDEODRIVER
    if (options.headless) {
        SDL_SetHint(SDL_HINT_VIDEODRIVER, "dummy");
    }
#endif

    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        std::fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
        return 1;
    }

    SDL_Window* window = SDL_CreateWindow(
        "Semantic World",
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        kWindowWidth,
        kWindowHeight,
        SDL_WINDOW_SHOWN | SDL_WINDOW_ALLOW_HIGHDPI);

    if (window == nullptr) {
        std::fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }

    SDL_Renderer* renderer = SDL_CreateRenderer(
        window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);

    if (renderer == nullptr) {
        // Headless drivers and some Raspberry Pi configurations have no
        // accelerated renderer. Software is fine: rendering is not
        // authoritative.
        renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
    }

    if (renderer == nullptr) {
        std::fprintf(stderr, "SDL_CreateRenderer failed: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    std::printf("semantic_world: window open (video driver: %s)\n",
        SDL_GetCurrentVideoDriver());

    bool running = true;
    long frames = 0;
    Uint64 simulatedTicks = 0;
    Uint32 accumulatorMs = 0;
    Uint32 previousMs = SDL_GetTicks();

    while (running) {
        SDL_Event event;
        while (SDL_PollEvent(&event) != 0) {
            if (event.type == SDL_QUIT) {
                running = false;
            } else if (event.type == SDL_KEYDOWN
                && event.key.keysym.sym == SDLK_ESCAPE) {
                running = false;
            }
        }

        // Wall-clock time paces the loop only. It never enters the world.
        const Uint32 nowMs = SDL_GetTicks();
        accumulatorMs += nowMs - previousMs;
        previousMs = nowMs;

        while (accumulatorMs >= kTickIntervalMs) {
            accumulatorMs -= kTickIntervalMs;
            ++simulatedTicks; // Phase 1: world.step()
        }

        SDL_SetRenderDrawColor(renderer, 18, 18, 22, 255);
        SDL_RenderClear(renderer);
        // Phase 7: renderer->draw(worldView);
        SDL_RenderPresent(renderer);

        ++frames;
        if (options.frameLimit >= 0 && frames >= options.frameLimit) {
            running = false;
        }
    }

    std::printf("semantic_world: closed after %ld frames, %llu ticks\n",
        frames, static_cast<unsigned long long>(simulatedTicks));

    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
