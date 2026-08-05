// Tapestry — application shell.
//
// Milestone 2+: pages carry real text, can minimize to their title bar, and
// the workspace is a document — titled, saved to a .tapestry file as an
// append-only series of snapshots, and reopened from the newest one. A
// settings page (an ordinary page whose body draws controls) exposes typed
// zoom past the interactive limits, centring on the origin, and scroll
// inversion.
//
// Two constraints that are load-bearing rather than incidental:
//
//   * The GL context is 3.3 core and must stay there. Apple froze OpenGL at
//     4.1, so anything above 3.3 core costs portability for no gain, and 4.3
//     (which chrono_magnetic_particles needs for compute shaders) fails at
//     window creation on this machine with no useful diagnostic.
//
//   * Wall-clock time paces the loop and never enters the simulation. The
//     accumulator below is the only place real time is read; World::step is
//     the only way the world advances.

#include "core/Camera.hpp"
#include "core/Document.hpp"
#include "core/World.hpp"
#include "render/Fonts.hpp"
#include "render/Grid.hpp"
#include "render/Pages.hpp"

// glad must precede nanovg_gl.h — see third_party/nanovg/nanovg_gl_impl.c.
#include <glad/gl.h>

#include <nanovg.h>
#include <nanovg_gl.h>

#include <stb_image_write.h>

#include <SDL.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

using tapestry::Camera;
using tapestry::DocumentState;
using tapestry::PageKind;
using tapestry::Rect;
using tapestry::Vec2;
using tapestry::World;

constexpr int kDefaultWidth = 1280;
constexpr int kDefaultHeight = 800;

// Fixed simulation timestep. Rendering may drop or repeat frames; the
// simulation may not.
constexpr Uint32 kTickIntervalMs = 16;

// Screen pixels per wheel notch when panning, and the exponent applied to
// wheel/pinch deltas when zooming. Tuned to feel like the browser prototype.
constexpr double kWheelPanPixels = 24.0;
constexpr double kWheelZoomRate = 0.12;
constexpr double kPinchZoomRate = 6.0;
constexpr double kKeyPanPixels = 90.0;
constexpr double kKeyZoomFactor = 1.2;

// A drag shorter than this is a click, not a pan. Matches the prototype's 3px
// dead zone.
constexpr double kDragDeadZonePx = 3.0;

// Screen margin used when framing all pages with F.
constexpr double kFrameMarginPx = 60.0;

// Default size of a freshly created note, in world units.
constexpr double kNewNoteWidth = 320.0;
constexpr double kNewNoteHeight = 220.0;

// The document title's clickable header region, top-left, in screen pixels.
constexpr Rect kTitleHeaderRect {12.0, 6.0, 380.0, 28.0};

// How long a status line ("saved …") stays on screen.
constexpr int kStatusFrames = 240;

constexpr const char* kDefaultDocumentPath = "workspace.tapestry";

// Frames rendered before --screenshot captures, when no explicit --frames is
// given. A couple of frames lets the window settle at its real drawable size on
// HiDPI displays before the readback.
constexpr long kScreenshotWarmupFrames = 8;

struct Options {
    long frameLimit = -1; // -1 runs until the user quits
    bool headless = false;
    int width = kDefaultWidth;
    int height = kDefaultHeight;
    const char* screenshotPath = nullptr;
    const char* documentPath = kDefaultDocumentPath;
    double initialZoom = 1.0;
    double initialPanX = 0.0;
    double initialPanY = 0.0;
};

[[noreturn]] void usage(int code) {
    std::fprintf(stderr,
        "usage: tapestry [--file PATH] [--frames N] [--headless] [--size WxH]\n"
        "                [--screenshot PATH]\n"
        "\n"
        "  --file PATH       .tapestry document to open and save (default\n"
        "                    workspace.tapestry; opened if it exists)\n"
        "  --frames N        quit after N rendered frames (smoke testing)\n"
        "  --headless        run the loop with no window or GL context;\n"
        "                    steps one simulation tick per frame, deterministically\n"
        "  --size WxH        initial window size in logical pixels\n"
        "  --zoom Z          initial zoom level\n"
        "  --pan X,Y         initial pan in screen pixels\n"
        "  --screenshot PATH write the final frame to PATH as PNG, then quit\n");
    std::exit(code);
}

Options parseOptions(int argc, char** argv) {
    Options options;

    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--frames") == 0 && i + 1 < argc) {
            options.frameLimit = std::strtol(argv[++i], nullptr, 10);
        } else if (std::strcmp(argv[i], "--headless") == 0) {
            options.headless = true;
        } else if (std::strcmp(argv[i], "--file") == 0 && i + 1 < argc) {
            options.documentPath = argv[++i];
        } else if (std::strcmp(argv[i], "--size") == 0 && i + 1 < argc) {
            int w = 0;
            int h = 0;
            if (std::sscanf(argv[++i], "%dx%d", &w, &h) != 2 || w <= 0 || h <= 0) {
                usage(2);
            }
            options.width = w;
            options.height = h;
        } else if (std::strcmp(argv[i], "--screenshot") == 0 && i + 1 < argc) {
            options.screenshotPath = argv[++i];
        } else if (std::strcmp(argv[i], "--zoom") == 0 && i + 1 < argc) {
            options.initialZoom = std::strtod(argv[++i], nullptr);
            if (!(options.initialZoom > 0.0)) {
                usage(2);
            }
        } else if (std::strcmp(argv[i], "--pan") == 0 && i + 1 < argc) {
            if (std::sscanf(argv[++i], "%lf,%lf",
                            &options.initialPanX, &options.initialPanY) != 2) {
                usage(2);
            }
        } else {
            usage(std::strcmp(argv[i], "--help") == 0 ? 0 : 2);
        }
    }

    if (options.screenshotPath != nullptr && options.frameLimit < 0) {
        options.frameLimit = kScreenshotWarmupFrames;
    }

    return options;
}

// Dumps the back buffer to PNG. Called after nvgEndFrame and before the swap,
// so GL_BACK still holds the frame that was just drawn.
bool writeScreenshot(SDL_Window* window, const char* path) {
    int fbW = 0;
    int fbH = 0;
    SDL_GL_GetDrawableSize(window, &fbW, &fbH);
    if (fbW <= 0 || fbH <= 0) {
        return false;
    }

    std::vector<unsigned char> pixels(
        static_cast<size_t>(fbW) * static_cast<size_t>(fbH) * 4u);

    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, fbW, fbH, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());

    // GL's origin is bottom-left, PNG's is top-left.
    stbi_flip_vertically_on_write(1);
    const int ok = stbi_write_png(path, fbW, fbH, 4, pixels.data(), fbW * 4);
    return ok != 0;
}

// The starter workspace: a few pages arranged around the origin so a first
// launch shows what the app is, at real reading size. Purely illustrative —
// they are ordinary pages and can be dragged anywhere.
void seedWorld(World& world) {
    world.addPage(PageKind::Conversation, "Kickoff",
        "You: What if plans were places?\n\n"
        "Tapestry: Then planning would be arranging. Put the decision next to "
        "the notes that justify it, keep the open questions in view at the "
        "edge, and let distance mean what it means on a desk: relevance.\n\n"
        "You: And the pages keep their positions?\n\n"
        "Tapestry: Positions are the document.",
        {-560.0, -180.0, 440.0, 330.0});

    world.addPage(PageKind::Note, "How this works",
        "Pages occupy world space at real reading size. At 100% zoom this "
        "text is as big as text in any other window.\n\n"
        "Zoom out and pages shrink to cards you arrange; zoom in and they "
        "become documents you read. The grid coordinates are real — a page's "
        "position is readable straight off the canvas.",
        {-40.0, -220.0, 360.0, 280.0});

    world.addPage(PageKind::Note, "Try it",
        "Drag a page to move it; the — button minimizes it.\n"
        "Drag empty space to pan.\n"
        "Double-click empty space for a new note (or press N).\n"
        "F frames every page; 0 resets the view.\n"
        "Click the title top-left to rename; Cmd/Ctrl+S saves.",
        {40.0, 120.0, 330.0, 210.0});

    world.addPage(PageKind::File, "README.md",
        "tapestry/README.md — file pages will mirror documents on disk. For "
        "now this card is a placeholder for that link.",
        {-440.0, 230.0, 330.0, 160.0});

    world.addPage(PageKind::Settings, "Settings", "",
        tapestry::settingsPageRect({420.0, -140.0}));
}

struct Graphics {
    SDL_Window* window = nullptr;
    SDL_GLContext gl = nullptr;
    NVGcontext* vg = nullptr;
    int glMajor = 0;
    int glMinor = 0;
};

bool createGraphics(Graphics& gfx, const Options& options) {
    // These must all be set before the window is created; SDL bakes them into
    // the pixel format it picks.
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    // macOS only exposes 3.2+ core through a forward-compatible context.
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG);
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 0);
    // NVG_STENCIL_STROKES needs a stencil buffer; without this, overlapping
    // strokes double-blend and the artifacts are subtle enough to chase for a
    // while before suspecting the pixel format.
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    gfx.window = SDL_CreateWindow(
        "Tapestry",
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        options.width,
        options.height,
        SDL_WINDOW_OPENGL | SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE
            | SDL_WINDOW_ALLOW_HIGHDPI);

    if (gfx.window == nullptr) {
        std::fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
        return false;
    }

    gfx.gl = SDL_GL_CreateContext(gfx.window);
    if (gfx.gl == nullptr) {
        std::fprintf(stderr, "SDL_GL_CreateContext failed: %s\n", SDL_GetError());
        return false;
    }

    const int version = gladLoadGL(
        reinterpret_cast<GLADloadfunc>(SDL_GL_GetProcAddress));
    if (version == 0) {
        std::fprintf(stderr, "glad: failed to load OpenGL entry points\n");
        return false;
    }
    gfx.glMajor = GLAD_VERSION_MAJOR(version);
    gfx.glMinor = GLAD_VERSION_MINOR(version);

    SDL_GL_SetSwapInterval(1); // vsync; failure here is cosmetic

    gfx.vg = nvgCreateGL3(NVG_ANTIALIAS | NVG_STENCIL_STROKES);
    if (gfx.vg == nullptr) {
        std::fprintf(stderr, "nvgCreateGL3 failed\n");
        return false;
    }

    return true;
}

void destroyGraphics(Graphics& gfx) {
    if (gfx.vg != nullptr) {
        nvgDeleteGL3(gfx.vg);
        gfx.vg = nullptr;
    }
    if (gfx.gl != nullptr) {
        SDL_GL_DeleteContext(gfx.gl);
        gfx.gl = nullptr;
    }
    if (gfx.window != nullptr) {
        SDL_DestroyWindow(gfx.window);
        gfx.window = nullptr;
    }
}

// What the left button is currently doing. A press on a page starts a page
// drag; a press on empty space starts a pan. Both share the click dead zone.
struct DragState {
    enum class Mode { None, Pan, Page };

    Mode mode = Mode::None;
    bool moved = false;
    double startX = 0.0;
    double startY = 0.0;
    double lastX = 0.0;
    double lastY = 0.0;

    // Page mode only. The id is held instead of a pointer because addPage and
    // bringToFront both invalidate pointers into the world.
    Uint64 pageId = 0;
    Vec2 grabOffsetWorld {0.0, 0.0}; // cursor-to-page-origin, in world units
};

// Which text field, if any, is capturing the keyboard.
struct EditState {
    enum class Target { None, Zoom, Title };

    Target target = Target::None;
    std::string draft;
};

// Interaction state that outlives a single event.
struct Session {
    World world;
    Uint64 selectedId = 0;

    std::string documentTitle = "Untitled tapestry";
    std::string documentPath = kDefaultDocumentPath;
    bool invertScroll = false;

    std::string status;
    int statusFramesLeft = 0;
};

void showStatus(Session& session, std::string message) {
    session.status = std::move(message);
    session.statusFramesLeft = kStatusFrames;
}

void beginEdit(EditState& edit, EditState::Target target, std::string draft) {
    edit.target = target;
    edit.draft = std::move(draft);
    SDL_StartTextInput();
}

void endEdit(EditState& edit) {
    edit.target = EditState::Target::None;
    edit.draft.clear();
    SDL_StopTextInput();
}

// Applies whatever is in the draft, then leaves edit mode. A zoom draft that
// does not parse to a positive number is discarded rather than clamped.
void commitEdit(EditState& edit, Session& session, Camera& camera,
                double viewW, double viewH) {
    if (edit.target == EditState::Target::Zoom) {
        char* parseEnd = nullptr;
        const double percent = std::strtod(edit.draft.c_str(), &parseEnd);
        if (parseEnd != edit.draft.c_str() && percent > 0.0) {
            camera.setZoom(percent / 100.0, viewW * 0.5, viewH * 0.5);
        }
    } else if (edit.target == EditState::Target::Title) {
        if (!edit.draft.empty()) {
            session.documentTitle = edit.draft;
        }
    }
    endEdit(edit);
}

void saveSession(Session& session, const Camera& camera) {
    DocumentState state;
    state.title = session.documentTitle;
    state.invertScroll = session.invertScroll;
    state.panX = camera.pan().x;
    state.panY = camera.pan().y;
    state.zoom = camera.zoom();

    char message[512];
    if (tapestry::saveDocument(session.documentPath, state, session.world)) {
        std::snprintf(message, sizeof(message), "saved %s (version %d)",
            session.documentPath.c_str(),
            tapestry::countSnapshots(session.documentPath));
    } else {
        std::snprintf(message, sizeof(message), "could not save %s",
            session.documentPath.c_str());
    }
    showStatus(session, message);
}

// Applies a loaded document. The camera is rebuilt from reset so the saved
// pan/zoom land exactly, regardless of the camera's current state.
void applyDocument(Session& session, Camera& camera, const DocumentState& state,
                   World world) {
    session.world = std::move(world);
    session.selectedId = 0;
    session.documentTitle = state.title;
    session.invertScroll = state.invertScroll;
    camera.reset();
    camera.setZoom(state.zoom, 0.0, 0.0);
    camera.panBy(state.panX, state.panY);
}

bool loadSession(Session& session, Camera& camera) {
    DocumentState state;
    World world;
    if (!tapestry::loadDocument(session.documentPath, state, world)) {
        return false;
    }
    applyDocument(session, camera, state, std::move(world));
    return true;
}

void createNoteAt(Session& session, const Camera& camera, double sx, double sy) {
    const Vec2 at = camera.screenToWorld(sx, sy);
    const Rect rect {at.x - kNewNoteWidth * 0.5, at.y - kNewNoteHeight * 0.5,
                     kNewNoteWidth, kNewNoteHeight};
    session.selectedId = session.world.addPage(
        PageKind::Note, "Untitled note", "", rect);
}

// A left press landed on `page` at `worldPoint`. Routes to the minimize
// button, then the settings controls, then a drag. Returns true when the
// press was consumed by a control (no drag should start).
bool routePagePress(tapestry::Page* page, Vec2 worldPoint, Session& session,
                    Camera& camera, EditState& edit,
                    double viewW, double viewH) {
    const double zoom = camera.zoom();

    // The minimize button, when it is drawn large enough to hit reliably —
    // the renderer skips it below 5px and so does hit-testing.
    if (tapestry::kMinimizeButtonSize * zoom >= 5.0
        && page->minimizeButtonRect().contains(worldPoint)) {
        page->minimized = !page->minimized;
        return true;
    }

    if (page->kind == PageKind::Settings && !page->minimized
        && tapestry::settingsControlsInteractive(zoom)
        && worldPoint.y > page->rect.y + tapestry::kPageTitleBarHeight) {
        const tapestry::SettingsLayout layout = tapestry::settingsLayout(*page);
        if (layout.zoomField.contains(worldPoint)) {
            beginEdit(edit, EditState::Target::Zoom, "");
            return true;
        }
        if (layout.centerButton.contains(worldPoint)) {
            camera.centerOn({0.0, 0.0}, viewW, viewH);
            return true;
        }
        if (layout.invertToggle.contains(worldPoint)) {
            session.invertScroll = !session.invertScroll;
            return true;
        }
    }

    return false;
}

void handleEvent(const SDL_Event& event,
                 Session& session,
                 Camera& camera,
                 DragState& drag,
                 EditState& edit,
                 double viewW,
                 double viewH,
                 bool& running) {
    const bool editing = edit.target != EditState::Target::None;

    switch (event.type) {
    case SDL_QUIT:
        running = false;
        break;

    case SDL_TEXTINPUT:
        if (editing) {
            // The zoom field only accepts number-shaped input; the title
            // takes anything.
            if (edit.target == EditState::Target::Zoom) {
                for (const char* c = event.text.text; *c != '\0'; ++c) {
                    if ((*c >= '0' && *c <= '9') || *c == '.' || *c == '%') {
                        edit.draft += *c;
                    }
                }
            } else {
                edit.draft += event.text.text;
            }
        }
        break;

    case SDL_KEYDOWN: {
        const SDL_Keymod mods = SDL_GetModState();
        const bool command = (mods & (KMOD_CTRL | KMOD_GUI)) != 0;

        // Save/open work whether or not a field is being edited.
        if (command && event.key.keysym.sym == SDLK_s) {
            if (editing) {
                commitEdit(edit, session, camera, viewW, viewH);
            }
            saveSession(session, camera);
            break;
        }
        if (command && event.key.keysym.sym == SDLK_o) {
            if (editing) {
                endEdit(edit);
            }
            if (loadSession(session, camera)) {
                showStatus(session, "opened " + session.documentPath);
            } else {
                showStatus(session, "could not open " + session.documentPath);
            }
            break;
        }

        if (editing) {
            switch (event.key.keysym.sym) {
            case SDLK_RETURN:
            case SDLK_KP_ENTER:
                commitEdit(edit, session, camera, viewW, viewH);
                break;
            case SDLK_ESCAPE:
                endEdit(edit); // discard the draft
                break;
            case SDLK_BACKSPACE:
                // Pop one UTF-8 code point, not one byte.
                while (!edit.draft.empty()) {
                    const auto byte =
                        static_cast<unsigned char>(edit.draft.back());
                    edit.draft.pop_back();
                    if ((byte & 0xC0) != 0x80) {
                        break;
                    }
                }
                break;
            default: break;
            }
            break; // every other key belongs to the field while editing
        }

        switch (event.key.keysym.sym) {
        case SDLK_ESCAPE:
            // First press releases the selection; a second quits.
            if (session.selectedId != 0) {
                session.selectedId = 0;
            } else {
                running = false;
            }
            break;
        case SDLK_LEFT:   camera.panBy(kKeyPanPixels, 0.0); break;
        case SDLK_RIGHT:  camera.panBy(-kKeyPanPixels, 0.0); break;
        case SDLK_UP:     camera.panBy(0.0, kKeyPanPixels); break;
        case SDLK_DOWN:   camera.panBy(0.0, -kKeyPanPixels); break;
        case SDLK_0:      camera.reset(); break;
        case SDLK_f:
            if (!session.world.empty()) {
                camera.frame(session.world.contentBounds(), viewW, viewH,
                             kFrameMarginPx);
            }
            break;
        case SDLK_n: {
            int mx = 0;
            int my = 0;
            SDL_GetMouseState(&mx, &my);
            createNoteAt(session, camera,
                         static_cast<double>(mx), static_cast<double>(my));
            break;
        }
        case SDLK_EQUALS:
        case SDLK_PLUS:
            camera.zoomAt(viewW * 0.5, viewH * 0.5, kKeyZoomFactor);
            break;
        case SDLK_MINUS:
            camera.zoomAt(viewW * 0.5, viewH * 0.5, 1.0 / kKeyZoomFactor);
            break;
        default: break;
        }
        break;
    }

    case SDL_MOUSEBUTTONDOWN:
        if (event.button.button == SDL_BUTTON_LEFT
            || event.button.button == SDL_BUTTON_MIDDLE) {
            const double x = static_cast<double>(event.button.x);
            const double y = static_cast<double>(event.button.y);

            // A click while editing commits the field first; the click then
            // proceeds normally.
            if (editing) {
                commitEdit(edit, session, camera, viewW, viewH);
            }

            // The document title header is screen-space and sits above the
            // world.
            if (event.button.button == SDL_BUTTON_LEFT
                && kTitleHeaderRect.contains({x, y})) {
                beginEdit(edit, EditState::Target::Title, session.documentTitle);
                break;
            }

            drag.moved = false;
            drag.startX = drag.lastX = x;
            drag.startY = drag.lastY = y;

            // Middle button always pans; the left button pans only when it
            // misses every page.
            const Vec2 worldPoint = camera.screenToWorld(x, y);
            tapestry::Page* hit = (event.button.button == SDL_BUTTON_LEFT)
                ? session.world.pageAt(worldPoint)
                : nullptr;

            if (hit != nullptr) {
                session.selectedId = hit->id;
                if (routePagePress(hit, worldPoint, session, camera, edit,
                                   viewW, viewH)) {
                    break; // a control consumed the press; no drag
                }
                drag.mode = DragState::Mode::Page;
                drag.pageId = hit->id;
                drag.grabOffsetWorld = {worldPoint.x - hit->rect.x,
                                        worldPoint.y - hit->rect.y};
                session.world.bringToFront(hit->id); // invalidates `hit`
            } else {
                drag.mode = DragState::Mode::Pan;
                if (event.button.button == SDL_BUTTON_LEFT) {
                    session.selectedId = 0;
                    if (event.button.clicks == 2) {
                        createNoteAt(session, camera, x, y);
                    }
                }
            }
        }
        break;

    case SDL_MOUSEBUTTONUP:
        drag.mode = DragState::Mode::None;
        drag.pageId = 0;
        break;

    case SDL_MOUSEMOTION: {
        if (drag.mode == DragState::Mode::None) {
            break;
        }
        const double x = static_cast<double>(event.motion.x);
        const double y = static_cast<double>(event.motion.y);
        if (!drag.moved
            && std::hypot(x - drag.startX, y - drag.startY) > kDragDeadZonePx) {
            drag.moved = true;
        }
        if (drag.moved) {
            if (drag.mode == DragState::Mode::Pan) {
                camera.panBy(x - drag.lastX, y - drag.lastY);
            } else {
                tapestry::Page* page = session.world.pageById(drag.pageId);
                if (page != nullptr) {
                    const Vec2 worldPoint = camera.screenToWorld(x, y);
                    page->rect.x = worldPoint.x - drag.grabOffsetWorld.x;
                    page->rect.y = worldPoint.y - drag.grabOffsetWorld.y;
                }
            }
        }
        drag.lastX = x;
        drag.lastY = y;
        break;
    }

    case SDL_MOUSEWHEEL: {
        // SDL 2.0.18+ reports fractional trackpad deltas; the integer fields
        // are the fallback for older SDL and for real mouse wheels.
#if SDL_VERSION_ATLEAST(2, 0, 18)
        double dx = static_cast<double>(event.wheel.preciseX);
        double dy = static_cast<double>(event.wheel.preciseY);
#else
        double dx = static_cast<double>(event.wheel.x);
        double dy = static_cast<double>(event.wheel.y);
#endif
        if (event.wheel.direction == SDL_MOUSEWHEEL_FLIPPED) {
            dx = -dx;
            dy = -dy;
        }

        int mx = 0;
        int my = 0;
        SDL_GetMouseState(&mx, &my);

        const SDL_Keymod mods = SDL_GetModState();
        if ((mods & (KMOD_CTRL | KMOD_GUI)) != 0) {
            camera.zoomAt(static_cast<double>(mx), static_cast<double>(my),
                          std::exp(dy * kWheelZoomRate));
        } else {
            // Two-finger scroll pans, which is what a trackpad user expects.
            // The settings toggle flips pan direction only; zoom direction is
            // untouched.
            const double sign = session.invertScroll ? -1.0 : 1.0;
            camera.panBy(dx * kWheelPanPixels * sign,
                         dy * kWheelPanPixels * sign);
        }
        break;
    }

    case SDL_MULTIGESTURE:
        // Trackpad pinch. Gesture coordinates are normalised to the window.
        if (std::fabs(static_cast<double>(event.mgesture.dDist)) > 0.0005) {
            camera.zoomAt(static_cast<double>(event.mgesture.x) * viewW,
                          static_cast<double>(event.mgesture.y) * viewH,
                          std::exp(static_cast<double>(event.mgesture.dDist)
                                   * kPinchZoomRate));
        }
        break;

    default:
        break;
    }
}

// The document header: title top-left, editable in place. Screen-space, like
// the readout — it belongs to the window, not the world.
void drawHeader(NVGcontext* vg, const tapestry::FontSet& fonts,
                const Session& session, const EditState& edit) {
    if (!fonts.ok()) {
        return;
    }

    const bool editing = edit.target == EditState::Target::Title;
    const std::string& text = editing ? edit.draft : session.documentTitle;

    nvgFontFaceId(vg, fonts.bold);
    nvgFontSize(vg, 15.0f);
    nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
    nvgFillColor(vg, editing ? nvgRGBA(222, 229, 244, 245)
                             : nvgRGBA(200, 210, 232, 190));

    const auto midY = static_cast<float>(
        kTitleHeaderRect.y + kTitleHeaderRect.h * 0.5);
    float caretX = static_cast<float>(kTitleHeaderRect.x + 4.0);
    if (!text.empty()) {
        caretX = nvgText(vg, caretX, midY, text.c_str(), nullptr);
    }
    if (editing) {
        nvgBeginPath(vg);
        nvgMoveTo(vg, caretX + 1.5f, midY - 8.0f);
        nvgLineTo(vg, caretX + 1.5f, midY + 8.0f);
        nvgStrokeColor(vg, nvgRGBA(168, 142, 235, 220));
        nvgStrokeWidth(vg, 1.5f);
        nvgStroke(vg);
    }
}

void drawStatus(NVGcontext* vg, const tapestry::FontSet& fonts,
                const Session& session, double viewH) {
    if (!fonts.ok() || session.statusFramesLeft <= 0 || session.status.empty()) {
        return;
    }

    // Fade out over the last second of the countdown.
    const int alpha = std::min(180, session.statusFramesLeft * 3);
    nvgFontFaceId(vg, fonts.regular);
    nvgFontSize(vg, 13.0f);
    nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_BOTTOM);
    nvgFillColor(vg, nvgRGBA(190, 205, 235, static_cast<unsigned char>(alpha)));
    nvgText(vg, 16.0f, static_cast<float>(viewH - 14.0), session.status.c_str(),
            nullptr);
}

void drawReadout(NVGcontext* vg,
                 const tapestry::FontSet& fonts,
                 const Camera& camera,
                 const World& world,
                 double viewW,
                 int fps,
                 int glMajor,
                 int glMinor) {
    if (!fonts.ok()) {
        return;
    }

    char line[160];
    std::snprintf(line, sizeof(line),
        "GL %d.%d core   %zu pages   %g%%   %d Hz",
        glMajor, glMinor, world.pages().size(), camera.zoom() * 100.0, fps);

    nvgFontFaceId(vg, fonts.regular);
    nvgFontSize(vg, 13.0f);
    nvgTextAlign(vg, NVG_ALIGN_RIGHT | NVG_ALIGN_TOP);
    nvgFillColor(vg, nvgRGBA(190, 205, 235, 150));
    nvgText(vg, static_cast<float>(viewW - 16.0), 14.0f, line, nullptr);
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
    SDL_StopTextInput(); // SDL starts with text input active on some platforms

    Graphics gfx;
    // Headless deliberately skips GL entirely: the dummy video driver has no GL
    // context to give us, and the point of the mode is to exercise the loop and
    // the simulation on a machine with no display at all.
    if (!options.headless && !createGraphics(gfx, options)) {
        destroyGraphics(gfx);
        SDL_Quit();
        return 1;
    }

    const tapestry::FontSet fonts = (gfx.vg != nullptr)
        ? tapestry::loadFonts(gfx.vg, TAPESTRY_ASSET_DIR)
        : tapestry::FontSet {};

    if (gfx.vg != nullptr) {
        std::printf("tapestry: OpenGL %d.%d core, video driver %s\n",
            gfx.glMajor, gfx.glMinor, SDL_GetCurrentVideoDriver());
    } else {
        std::printf("tapestry: headless (video driver %s)\n",
            SDL_GetCurrentVideoDriver());
    }

    Session session;
    session.documentPath = options.documentPath;

    Camera camera;
    if (loadSession(session, camera)) {
        std::printf("tapestry: opened %s (%d snapshot(s))\n",
            session.documentPath.c_str(),
            tapestry::countSnapshots(session.documentPath));
    } else {
        seedWorld(session.world);
    }

    // CLI view flags apply on top of whatever the document restored.
    camera.panBy(options.initialPanX, options.initialPanY);
    if (options.initialZoom != 1.0) {
        camera.setZoom(camera.zoom() * options.initialZoom,
                       static_cast<double>(options.width) * 0.5,
                       static_cast<double>(options.height) * 0.5);
    }
    DragState drag;
    EditState edit;

    bool running = true;
    long frames = 0;
    Uint32 accumulatorMs = 0;
    Uint32 previousMs = SDL_GetTicks();

    int fps = 0;
    int framesThisSecond = 0;
    Uint32 fpsWindowStartMs = previousMs;

    while (running) {
        int winW = options.width;
        int winH = options.height;
        if (gfx.window != nullptr) {
            SDL_GetWindowSize(gfx.window, &winW, &winH);
        }
        const double viewW = static_cast<double>(winW);
        const double viewH = static_cast<double>(winH);

        SDL_Event event;
        while (SDL_PollEvent(&event) != 0) {
            handleEvent(event, session, camera, drag, edit, viewW, viewH,
                        running);
        }

        const Uint32 nowMs = SDL_GetTicks();

        if (options.headless) {
            // Headless is the deterministic path: exactly one simulation tick
            // per iteration, with no wall-clock read feeding the simulation at
            // all. That is what makes `--headless --frames N` reproducible, and
            // it is the harness replay verification will be built on. Pacing a
            // headless run by wall clock would step zero ticks, because 60
            // frames with nothing to draw finish well inside one tick interval.
            session.world.step(kTickIntervalMs);
        } else {
            // Wall-clock time paces the loop only. It never enters the world.
            accumulatorMs += nowMs - previousMs;
            while (accumulatorMs >= kTickIntervalMs) {
                accumulatorMs -= kTickIntervalMs;
                session.world.step(kTickIntervalMs);
            }
        }
        previousMs = nowMs;

        if (gfx.vg != nullptr) {
            // The drawable can be larger than the window on HiDPI displays.
            // GL works in drawable pixels; nanovg, our camera, and SDL's mouse
            // coordinates all work in logical pixels, bridged by pxRatio.
            int fbW = winW;
            int fbH = winH;
            SDL_GL_GetDrawableSize(gfx.window, &fbW, &fbH);
            const float pxRatio = (winW > 0)
                ? static_cast<float>(fbW) / static_cast<float>(winW)
                : 1.0f;

            glViewport(0, 0, fbW, fbH);
            glClearColor(0.055f, 0.058f, 0.071f, 1.0f);
            glClear(GL_COLOR_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);

            nvgBeginFrame(gfx.vg, static_cast<float>(viewW),
                          static_cast<float>(viewH), pxRatio);
            tapestry::drawGrid(gfx.vg, camera, viewW, viewH, fonts.regular);

            tapestry::PageUiState ui;
            ui.selectedId = session.selectedId;
            ui.zoom = camera.zoom();
            ui.invertScroll = session.invertScroll;
            ui.editingZoom = edit.target == EditState::Target::Zoom;
            if (ui.editingZoom) {
                ui.zoomDraft = edit.draft;
            }
            tapestry::drawPages(gfx.vg, session.world, camera, viewW, viewH,
                                fonts, ui);

            drawHeader(gfx.vg, fonts, session, edit);
            drawStatus(gfx.vg, fonts, session, viewH);
            drawReadout(gfx.vg, fonts, camera, session.world, viewW, fps,
                        gfx.glMajor, gfx.glMinor);
            nvgEndFrame(gfx.vg);

            const bool lastFrame = options.frameLimit >= 0
                && frames + 1 >= options.frameLimit;
            if (options.screenshotPath != nullptr && lastFrame) {
                if (writeScreenshot(gfx.window, options.screenshotPath)) {
                    std::printf("tapestry: wrote %s (%dx%d)\n",
                        options.screenshotPath, fbW, fbH);
                } else {
                    std::fprintf(stderr, "tapestry: failed to write %s\n",
                        options.screenshotPath);
                }
            }

            SDL_GL_SwapWindow(gfx.window);
        }

        if (session.statusFramesLeft > 0) {
            --session.statusFramesLeft;
        }

        ++frames;
        ++framesThisSecond;
        const Uint32 fpsWindowMs = nowMs - fpsWindowStartMs;
        if (fpsWindowMs >= 500) {
            fps = static_cast<int>(static_cast<double>(framesThisSecond)
                * 1000.0 / static_cast<double>(fpsWindowMs));
            framesThisSecond = 0;
            fpsWindowStartMs = nowMs;
        }

        if (options.frameLimit >= 0 && frames >= options.frameLimit) {
            running = false;
        }
    }

    std::printf("tapestry: closed after %ld frames, %llu ticks\n",
        frames, static_cast<unsigned long long>(session.world.ticks()));

    destroyGraphics(gfx);
    SDL_Quit();
    return 0;
}
