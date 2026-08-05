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
#include "app/FileDialog.hpp"
#include "render/Fonts.hpp"
#include "render/Grid.hpp"
#include "render/Pages.hpp"
#include "render/Strokes.hpp"

// glad must precede nanovg_gl.h — see third_party/nanovg/nanovg_gl_impl.c.
#include <glad/gl.h>

#include <nanovg.h>
#include <nanovg_gl.h>

#include <stb_image_write.h>

#include <SDL.h>

#include <algorithm>
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
using tapestry::ResizeCorner;
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

constexpr double kHeaderHeight = 42.0;
constexpr Rect kFileMenuRect {12.0, 7.0, 46.0, 28.0};
constexpr Rect kEditMenuRect {60.0, 7.0, 46.0, 28.0};
constexpr Rect kViewMenuRect {108.0, 7.0, 52.0, 28.0};
constexpr Rect kTitleHeaderRect {176.0, 7.0, 390.0, 28.0};
constexpr double kMenuItemHeight = 30.0;
constexpr double kMenuWidth = 210.0;
constexpr double kToolButtonSize = 32.0;
constexpr double kToolButtonGap = 6.0;

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
    bool documentPathExplicit = false;
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
            options.documentPathExplicit = true;
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
    enum class Mode { None, Pan, Page, Resize, Zoom, Brush };

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
    ResizeCorner resizeCorner = ResizeCorner::None;
    Rect initialPageRect;
    Uint64 strokeId = 0;
};

// Which text field, if any, is capturing the keyboard.
struct EditState {
    enum class Target { None, Zoom, DocumentTitle, PageTitle, PageBody };

    Target target = Target::None;
    std::string draft;
    Uint64 pageId = 0;
    std::size_t caret = 0;
};

enum class OpenMenu { None, File, Edit, View };
enum class ActiveTool { Select, Hand, Zoom, Brush };

// Interaction state that outlives a single event.
struct Session {
    World world;
    Uint64 selectedId = 0;

    std::string documentTitle = "Untitled tapestry";
    std::string documentPath = kDefaultDocumentPath;
    bool hasDocumentPath = false;
    bool invertScroll = false;

    OpenMenu openMenu = OpenMenu::None;
    ActiveTool activeTool = ActiveTool::Select;

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
    edit.pageId = 0;
    edit.caret = 0;
    SDL_StopTextInput();
}

void beginPageEdit(EditState& edit, Uint64 pageId,
                   tapestry::PageTextRegion region, std::size_t caret) {
    edit.target = region == tapestry::PageTextRegion::Title
        ? EditState::Target::PageTitle : EditState::Target::PageBody;
    edit.pageId = pageId;
    edit.caret = caret;
    edit.draft.clear();
    SDL_StartTextInput();
}

std::string* editedPageText(EditState& edit, Session& session) {
    tapestry::Page* page = session.world.pageById(edit.pageId);
    if (page == nullptr) return nullptr;
    if (edit.target == EditState::Target::PageTitle) return &page->title;
    if (edit.target == EditState::Target::PageBody) return &page->body;
    return nullptr;
}

std::size_t previousUtf8(const std::string& text, std::size_t at) {
    if (at == 0) return 0;
    --at;
    while (at > 0
        && (static_cast<unsigned char>(text[at]) & 0xC0u) == 0x80u) {
        --at;
    }
    return at;
}

std::size_t nextUtf8(const std::string& text, std::size_t at) {
    if (at >= text.size()) return text.size();
    ++at;
    while (at < text.size()
        && (static_cast<unsigned char>(text[at]) & 0xC0u) == 0x80u) {
        ++at;
    }
    return at;
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
    } else if (edit.target == EditState::Target::DocumentTitle) {
        if (!edit.draft.empty()) {
            session.documentTitle = edit.draft;
        }
    }
    endEdit(edit);
}

bool saveSession(Session& session, const Camera& camera) {
    DocumentState state;
    state.title = session.documentTitle;
    state.invertScroll = session.invertScroll;
    state.panX = camera.pan().x;
    state.panY = camera.pan().y;
    state.zoom = camera.zoom();

    char message[512];
    const bool saved = tapestry::saveDocument(session.documentPath, state, session.world);
    if (saved) {
        std::snprintf(message, sizeof(message), "saved %s (version %d)",
            session.documentPath.c_str(),
            tapestry::countSnapshots(session.documentPath));
    } else {
        std::snprintf(message, sizeof(message), "could not save %s",
            session.documentPath.c_str());
    }
    showStatus(session, message);
    return saved;
}

void saveSessionAs(Session& session, const Camera& camera) {
    const auto path = tapestry::chooseDocumentToSave(session.documentPath);
    if (!path) {
        return;
    }
    const std::string previousPath = session.documentPath;
    const bool previouslyHadPath = session.hasDocumentPath;
    session.documentPath = *path;
    if (saveSession(session, camera)) {
        session.hasDocumentPath = true;
    } else {
        session.documentPath = previousPath;
        session.hasDocumentPath = previouslyHadPath;
    }
}

void saveSessionNormally(Session& session, const Camera& camera) {
    if (session.hasDocumentPath) {
        saveSession(session, camera);
    } else {
        saveSessionAs(session, camera);
    }
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

void openSessionFromDialog(Session& session, Camera& camera) {
    const auto path = tapestry::chooseDocumentToOpen();
    if (!path) {
        return;
    }
    DocumentState state;
    World world;
    if (!tapestry::loadDocument(*path, state, world)) {
        showStatus(session, "could not open " + *path);
        return;
    }
    session.documentPath = *path;
    session.hasDocumentPath = true;
    applyDocument(session, camera, state, std::move(world));
    showStatus(session, "opened " + session.documentPath);
}

Rect toolRect(double viewW, int slotFromRight) {
    return {viewW - 12.0 - kToolButtonSize
                - static_cast<double>(slotFromRight)
                    * (kToolButtonSize + kToolButtonGap),
            5.0, kToolButtonSize, kToolButtonSize};
}

Rect menuPanelRect(OpenMenu menu) {
    double x = kFileMenuRect.x;
    int items = 3;
    if (menu == OpenMenu::Edit) {
        x = kEditMenuRect.x;
        items = 2;
    } else if (menu == OpenMenu::View) {
        x = kViewMenuRect.x;
        items = 2;
    }
    return {x, kHeaderHeight, kMenuWidth,
            static_cast<double>(items) * kMenuItemHeight + 8.0};
}

int menuItemAt(OpenMenu menu, Vec2 point) {
    if (menu == OpenMenu::None) {
        return -1;
    }
    const Rect panel = menuPanelRect(menu);
    if (!panel.contains(point)) {
        return -1;
    }
    const int item = static_cast<int>((point.y - panel.y - 4.0) / kMenuItemHeight);
    const int count = menu == OpenMenu::File ? 3 : 2;
    return item >= 0 && item < count ? item : -1;
}

void revealSettings(Session& session) {
    for (const tapestry::Page& page : session.world.pages()) {
        if (page.kind == PageKind::Settings) {
            const Uint64 id = page.id;
            session.world.bringToFront(id);
            if (tapestry::Page* settings = session.world.pageById(id)) {
                settings->minimized = false;
            }
            session.selectedId = id;
            return;
        }
    }
}

bool hoveringEditableText(const Session& session, const Camera& camera,
                          double x, double y) {
    if (kTitleHeaderRect.contains({x, y})) {
        return true;
    }
    const Vec2 worldPoint = camera.screenToWorld(x, y);
    const tapestry::Page* page = session.world.pageAt(worldPoint);
    return page != nullptr
        && tapestry::pageTextRegionAt(*page, worldPoint)
            != tapestry::PageTextRegion::None;
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
                 NVGcontext* vg,
                 const tapestry::FontSet& fonts,
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
            if (std::string* text = editedPageText(edit, session)) {
                edit.caret = std::min(edit.caret, text->size());
                text->insert(edit.caret, event.text.text);
                edit.caret += std::strlen(event.text.text);
                break;
            }
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
            if ((mods & KMOD_SHIFT) != 0) {
                saveSessionAs(session, camera);
            } else {
                saveSessionNormally(session, camera);
            }
            break;
        }
        if (command && event.key.keysym.sym == SDLK_o) {
            if (editing) {
                endEdit(edit);
            }
            openSessionFromDialog(session, camera);
            break;
        }

        if (editing) {
            if (std::string* text = editedPageText(edit, session)) {
                edit.caret = std::min(edit.caret, text->size());
                switch (event.key.keysym.sym) {
                case SDLK_ESCAPE:
                    endEdit(edit);
                    break;
                case SDLK_RETURN:
                case SDLK_KP_ENTER:
                    if (edit.target == EditState::Target::PageBody) {
                        text->insert(edit.caret, "\n");
                        ++edit.caret;
                    } else {
                        endEdit(edit);
                    }
                    break;
                case SDLK_BACKSPACE:
                    if (edit.caret > 0) {
                        const std::size_t previous = previousUtf8(*text, edit.caret);
                        text->erase(previous, edit.caret - previous);
                        edit.caret = previous;
                    }
                    break;
                case SDLK_DELETE:
                    if (edit.caret < text->size()) {
                        text->erase(edit.caret, nextUtf8(*text, edit.caret) - edit.caret);
                    }
                    break;
                case SDLK_LEFT:
                    edit.caret = previousUtf8(*text, edit.caret);
                    break;
                case SDLK_RIGHT:
                    edit.caret = nextUtf8(*text, edit.caret);
                    break;
                case SDLK_HOME:
                    edit.caret = 0;
                    break;
                case SDLK_END:
                    edit.caret = text->size();
                    break;
                default: break;
                }
                break;
            }
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

            const Vec2 screenPoint {x, y};
            OpenMenu clickedMenu = OpenMenu::None;
            if (kFileMenuRect.contains(screenPoint)) clickedMenu = OpenMenu::File;
            else if (kEditMenuRect.contains(screenPoint)) clickedMenu = OpenMenu::Edit;
            else if (kViewMenuRect.contains(screenPoint)) clickedMenu = OpenMenu::View;
            if (event.button.button == SDL_BUTTON_LEFT
                && clickedMenu != OpenMenu::None) {
                session.openMenu = session.openMenu == clickedMenu
                    ? OpenMenu::None : clickedMenu;
                break;
            }

            if (event.button.button == SDL_BUTTON_LEFT
                && session.openMenu != OpenMenu::None) {
                const OpenMenu menu = session.openMenu;
                const int item = menuItemAt(menu, screenPoint);
                session.openMenu = OpenMenu::None;
                if (item >= 0) {
                    if (menu == OpenMenu::File) {
                        if (item == 0) openSessionFromDialog(session, camera);
                        else if (item == 1) saveSessionNormally(session, camera);
                        else saveSessionAs(session, camera);
                    } else if (menu == OpenMenu::View) {
                        if (item == 0) camera.reset();
                        else if (!session.world.empty()) {
                            camera.frame(session.world.contentBounds(), viewW,
                                         viewH, kFrameMarginPx);
                        }
                    }
                    break;
                }
            }

            if (event.button.button == SDL_BUTTON_LEFT) {
                if (toolRect(viewW, 0).contains(screenPoint)) {
                    revealSettings(session);
                    session.openMenu = OpenMenu::None;
                    break;
                }
                if (toolRect(viewW, 1).contains(screenPoint)) {
                    session.activeTool = ActiveTool::Brush;
                    session.openMenu = OpenMenu::None;
                    break;
                }
                if (toolRect(viewW, 2).contains(screenPoint)) {
                    session.activeTool = ActiveTool::Zoom;
                    session.openMenu = OpenMenu::None;
                    break;
                }
                if (toolRect(viewW, 3).contains(screenPoint)) {
                    session.activeTool = ActiveTool::Hand;
                    session.openMenu = OpenMenu::None;
                    break;
                }
                if (toolRect(viewW, 4).contains(screenPoint)) {
                    session.activeTool = ActiveTool::Select;
                    session.openMenu = OpenMenu::None;
                    break;
                }
            }

            // The document title header is screen-space and sits above the
            // world.
            if (event.button.button == SDL_BUTTON_LEFT
                && kTitleHeaderRect.contains({x, y})) {
                beginEdit(edit, EditState::Target::DocumentTitle,
                          session.documentTitle);
                break;
            }

            // The rest of the header is inert chrome. Never let a click fall
            // through to a page that happens to be underneath it.
            if (y < kHeaderHeight) {
                break;
            }

            drag.moved = false;
            drag.startX = drag.lastX = x;
            drag.startY = drag.lastY = y;

            if (event.button.button == SDL_BUTTON_LEFT
                && event.button.which != SDL_TOUCH_MOUSEID
                && session.activeTool == ActiveTool::Brush) {
                drag.mode = DragState::Mode::Brush;
                drag.strokeId = session.world.beginStroke(
                    {camera.screenToWorld(x, y), 0.55});
                break;
            }

            if (event.button.button == SDL_BUTTON_LEFT
                && session.activeTool == ActiveTool::Zoom) {
                drag.mode = DragState::Mode::Zoom;
                break;
            }

            if (event.button.button == SDL_BUTTON_LEFT
                && session.activeTool == ActiveTool::Hand) {
                drag.mode = DragState::Mode::Pan;
                break;
            }

            // Middle button always pans; the left button pans only when it
            // misses every page.
            const Vec2 worldPoint = camera.screenToWorld(x, y);

            // Resize handles extend slightly outside the page, so test the
            // selected page before ordinary pageAt hit-testing.
            if (event.button.button == SDL_BUTTON_LEFT
                && session.selectedId != 0) {
                tapestry::Page* selected =
                    session.world.pageById(session.selectedId);
                if (selected != nullptr) {
                    const ResizeCorner corner = selected->resizeCornerAt(
                        worldPoint, 10.0 / camera.zoom());
                    if (corner != ResizeCorner::None) {
                        drag.mode = DragState::Mode::Resize;
                        drag.pageId = selected->id;
                        drag.resizeCorner = corner;
                        drag.initialPageRect = selected->rect;
                        break;
                    }
                }
            }

            tapestry::Page* hit = (event.button.button == SDL_BUTTON_LEFT)
                ? session.world.pageAt(worldPoint)
                : nullptr;

            if (hit != nullptr) {
                session.selectedId = hit->id;
                if (routePagePress(hit, worldPoint, session, camera, edit,
                                   viewW, viewH)) {
                    break; // a control consumed the press; no drag
                }
                const tapestry::PageTextRegion textRegion =
                    tapestry::pageTextRegionAt(*hit, worldPoint);
                if (textRegion != tapestry::PageTextRegion::None
                    && vg != nullptr && fonts.ok()) {
                    const std::size_t caret = tapestry::pageTextIndexAt(
                        vg, *hit, camera, fonts, textRegion, {x, y});
                    const Uint64 id = hit->id;
                    beginPageEdit(edit, id, textRegion, caret);
                    session.world.bringToFront(id);
                    break;
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
        if (event.button.which == SDL_TOUCH_MOUSEID
            && drag.mode == DragState::Mode::Brush) {
            break;
        }
        if (drag.mode == DragState::Mode::Zoom && !drag.moved) {
            const SDL_Keymod mods = SDL_GetModState();
            const double factor = (mods & KMOD_ALT) != 0
                ? 1.0 / kKeyZoomFactor : kKeyZoomFactor;
            camera.zoomAt(static_cast<double>(event.button.x),
                          static_cast<double>(event.button.y), factor);
        }
        drag.mode = DragState::Mode::None;
        drag.pageId = 0;
        drag.resizeCorner = ResizeCorner::None;
        drag.strokeId = 0;
        break;

    case SDL_MOUSEMOTION: {
        if (event.motion.which == SDL_TOUCH_MOUSEID
            && drag.mode == DragState::Mode::Brush) {
            break;
        }
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
            } else if (drag.mode == DragState::Mode::Zoom) {
                camera.zoomAt(drag.startX, drag.startY,
                              std::exp((drag.lastY - y) * 0.012));
            } else if (drag.mode == DragState::Mode::Resize) {
                tapestry::Page* page = session.world.pageById(drag.pageId);
                if (page != nullptr) {
                    const Vec2 point = camera.screenToWorld(x, y);
                    const Rect before = drag.initialPageRect;
                    const bool left = drag.resizeCorner == ResizeCorner::TopLeft
                        || drag.resizeCorner == ResizeCorner::BottomLeft;
                    const bool top = drag.resizeCorner == ResizeCorner::TopLeft
                        || drag.resizeCorner == ResizeCorner::TopRight;

                    if (left) {
                        const double right = before.right();
                        page->rect.x = std::min(point.x,
                            right - tapestry::kMinimumPageWidth);
                        page->rect.w = right - page->rect.x;
                    } else {
                        page->rect.x = before.x;
                        page->rect.w = std::max(tapestry::kMinimumPageWidth,
                                               point.x - before.x);
                    }
                    if (top) {
                        const double bottom = before.bottom();
                        page->rect.y = std::min(point.y,
                            bottom - tapestry::kMinimumPageHeight);
                        page->rect.h = bottom - page->rect.y;
                    } else {
                        page->rect.y = before.y;
                        page->rect.h = std::max(tapestry::kMinimumPageHeight,
                                               point.y - before.y);
                    }
                }
            } else if (drag.mode == DragState::Mode::Brush) {
                tapestry::Stroke* stroke = session.world.strokeById(drag.strokeId);
                const Vec2 point = camera.screenToWorld(x, y);
                if (stroke != nullptr && (stroke->points.empty()
                    || std::hypot(point.x - stroke->points.back().position.x,
                                  point.y - stroke->points.back().position.y)
                        >= 0.75 / camera.zoom())) {
                    session.world.appendStrokePoint(drag.strokeId, {point, 0.55});
                }
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

    case SDL_FINGERDOWN:
        if (session.activeTool == ActiveTool::Brush) {
            const double x = static_cast<double>(event.tfinger.x) * viewW;
            const double y = static_cast<double>(event.tfinger.y) * viewH;
            if (y >= kHeaderHeight) {
                if (editing) endEdit(edit);
                drag.mode = DragState::Mode::Brush;
                drag.strokeId = session.world.beginStroke({
                    camera.screenToWorld(x, y),
                    std::clamp(static_cast<double>(event.tfinger.pressure),
                               0.0, 1.0)});
            }
        }
        break;

    case SDL_FINGERMOTION:
        if (drag.mode == DragState::Mode::Brush && drag.strokeId != 0) {
            const double x = static_cast<double>(event.tfinger.x) * viewW;
            const double y = static_cast<double>(event.tfinger.y) * viewH;
            const Vec2 point = camera.screenToWorld(x, y);
            tapestry::Stroke* stroke = session.world.strokeById(drag.strokeId);
            if (stroke != nullptr && (stroke->points.empty()
                || std::hypot(point.x - stroke->points.back().position.x,
                              point.y - stroke->points.back().position.y)
                    >= 0.75 / camera.zoom())) {
                session.world.appendStrokePoint(drag.strokeId, {
                    point, std::clamp(
                        static_cast<double>(event.tfinger.pressure), 0.0, 1.0)});
            }
        }
        break;

    case SDL_FINGERUP:
        if (drag.mode == DragState::Mode::Brush) {
            drag.mode = DragState::Mode::None;
            drag.strokeId = 0;
        }
        break;

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
                const Session& session, const EditState& edit, double viewW) {
    if (!fonts.ok()) {
        return;
    }

    nvgBeginPath(vg);
    nvgRect(vg, 0.0f, 0.0f, static_cast<float>(viewW),
            static_cast<float>(kHeaderHeight));
    nvgFillColor(vg, nvgRGBA(18, 20, 27, 238));
    nvgFill(vg);
    nvgBeginPath(vg);
    nvgMoveTo(vg, 0.0f, static_cast<float>(kHeaderHeight - 0.5));
    nvgLineTo(vg, static_cast<float>(viewW),
              static_cast<float>(kHeaderHeight - 0.5));
    nvgStrokeColor(vg, nvgRGBA(100, 115, 150, 70));
    nvgStrokeWidth(vg, 1.0f);
    nvgStroke(vg);

    const auto drawMenuLabel = [&](const Rect& rect, const char* label,
                                   OpenMenu menu) {
        if (session.openMenu == menu) {
            nvgBeginPath(vg);
            nvgRoundedRect(vg, static_cast<float>(rect.x), static_cast<float>(rect.y),
                           static_cast<float>(rect.w), static_cast<float>(rect.h), 5.0f);
            nvgFillColor(vg, nvgRGBA(75, 88, 120, 155));
            nvgFill(vg);
        }
        nvgFontFaceId(vg, fonts.regular);
        nvgFontSize(vg, 13.0f);
        nvgTextAlign(vg, NVG_ALIGN_CENTER | NVG_ALIGN_MIDDLE);
        nvgFillColor(vg, nvgRGBA(214, 221, 238, 225));
        nvgText(vg, static_cast<float>(rect.x + rect.w * 0.5),
                static_cast<float>(rect.y + rect.h * 0.5), label, nullptr);
    };
    drawMenuLabel(kFileMenuRect, "File", OpenMenu::File);
    drawMenuLabel(kEditMenuRect, "Edit", OpenMenu::Edit);
    drawMenuLabel(kViewMenuRect, "View", OpenMenu::View);

    const bool editing = edit.target == EditState::Target::DocumentTitle;
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

    const auto drawTool = [&](int slot, ActiveTool tool, const char* label) {
        const Rect rect = toolRect(viewW, slot);
        const bool active = session.activeTool == tool;
        nvgBeginPath(vg);
        nvgRoundedRect(vg, static_cast<float>(rect.x), static_cast<float>(rect.y),
                       static_cast<float>(rect.w), static_cast<float>(rect.h), 7.0f);
        nvgFillColor(vg, active ? nvgRGBA(92, 112, 175, 210)
                               : nvgRGBA(48, 54, 70, 175));
        nvgFill(vg);
        nvgFontFaceId(vg, fonts.bold);
        nvgFontSize(vg, 13.0f);
        nvgTextAlign(vg, NVG_ALIGN_CENTER | NVG_ALIGN_MIDDLE);
        nvgFillColor(vg, nvgRGBA(225, 231, 245, 235));
        nvgText(vg, static_cast<float>(rect.x + rect.w * 0.5),
                static_cast<float>(rect.y + rect.h * 0.5), label, nullptr);
    };
    drawTool(4, ActiveTool::Select, "A");
    drawTool(3, ActiveTool::Hand, "H");
    drawTool(2, ActiveTool::Zoom, "Z");
    drawTool(1, ActiveTool::Brush, "");
    const Rect brushRect = toolRect(viewW, 1);
    const float brushCx = static_cast<float>(brushRect.x + brushRect.w * 0.5);
    const float brushCy = static_cast<float>(brushRect.y + brushRect.h * 0.5);
    nvgBeginPath(vg);
    nvgMoveTo(vg, brushCx - 7.0f, brushCy + 7.0f);
    nvgBezierTo(vg, brushCx - 8.0f, brushCy + 2.0f,
                brushCx - 4.0f, brushCy + 1.0f,
                brushCx - 2.0f, brushCy + 3.0f);
    nvgLineTo(vg, brushCx + 8.0f, brushCy - 7.0f);
    nvgStrokeColor(vg, nvgRGBA(225, 231, 245, 235));
    nvgStrokeWidth(vg, 3.0f);
    nvgLineCap(vg, NVG_ROUND);
    nvgStroke(vg);
    const Rect settingsRect = toolRect(viewW, 0);
    nvgBeginPath(vg);
    nvgRoundedRect(vg, static_cast<float>(settingsRect.x),
                   static_cast<float>(settingsRect.y),
                   static_cast<float>(settingsRect.w),
                   static_cast<float>(settingsRect.h), 7.0f);
    nvgFillColor(vg, nvgRGBA(48, 54, 70, 175));
    nvgFill(vg);
    nvgFontFaceId(vg, fonts.bold);
    nvgFontSize(vg, 14.0f);
    nvgTextAlign(vg, NVG_ALIGN_CENTER | NVG_ALIGN_MIDDLE);
    nvgFillColor(vg, nvgRGBA(225, 231, 245, 235));
    nvgText(vg, static_cast<float>(settingsRect.x + settingsRect.w * 0.5),
            static_cast<float>(settingsRect.y + settingsRect.h * 0.5), "S", nullptr);

    if (session.openMenu != OpenMenu::None) {
        const Rect panel = menuPanelRect(session.openMenu);
        nvgBeginPath(vg);
        nvgRoundedRect(vg, static_cast<float>(panel.x), static_cast<float>(panel.y),
                       static_cast<float>(panel.w), static_cast<float>(panel.h), 7.0f);
        nvgFillColor(vg, nvgRGBA(27, 30, 39, 250));
        nvgFill(vg);
        nvgStrokeColor(vg, nvgRGBA(110, 126, 165, 100));
        nvgStrokeWidth(vg, 1.0f);
        nvgStroke(vg);

        const char* labels[3] = {nullptr, nullptr, nullptr};
        const char* shortcuts[3] = {nullptr, nullptr, nullptr};
        int count = 2;
        bool disabled = false;
        if (session.openMenu == OpenMenu::File) {
            labels[0] = "Open..."; labels[1] = "Save"; labels[2] = "Save As...";
            shortcuts[0] = "Cmd+O"; shortcuts[1] = "Cmd+S"; shortcuts[2] = "Cmd+Shift+S";
            count = 3;
        } else if (session.openMenu == OpenMenu::Edit) {
            labels[0] = "Undo"; labels[1] = "Redo";
            shortcuts[0] = "Cmd+Z"; shortcuts[1] = "Cmd+Shift+Z";
            disabled = true;
        } else {
            labels[0] = "Reset View"; labels[1] = "Frame All";
            shortcuts[0] = "0"; shortcuts[1] = "F";
        }
        nvgFontFaceId(vg, fonts.regular);
        nvgFontSize(vg, 13.0f);
        for (int i = 0; i < count; ++i) {
            const float y = static_cast<float>(panel.y + 4.0
                + (static_cast<double>(i) + 0.5) * kMenuItemHeight);
            nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_MIDDLE);
            nvgFillColor(vg, disabled ? nvgRGBA(145, 151, 168, 100)
                                     : nvgRGBA(225, 230, 241, 235));
            nvgText(vg, static_cast<float>(panel.x + 13.0), y, labels[i], nullptr);
            nvgTextAlign(vg, NVG_ALIGN_RIGHT | NVG_ALIGN_MIDDLE);
            nvgFillColor(vg, nvgRGBA(150, 160, 184, disabled ? 70 : 160));
            nvgText(vg, static_cast<float>(panel.x + panel.w - 12.0), y,
                    shortcuts[i], nullptr);
        }
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
    nvgText(vg, static_cast<float>(viewW - 16.0),
            static_cast<float>(kHeaderHeight + 10.0), line, nullptr);
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
    SDL_Cursor* arrowCursor = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_ARROW);
    SDL_Cursor* textCursor = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_IBEAM);
    SDL_Cursor* handCursor = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_HAND);
    SDL_Cursor* zoomCursor = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_CROSSHAIR);

    if (gfx.vg != nullptr) {
        std::printf("tapestry: OpenGL %d.%d core, video driver %s\n",
            gfx.glMajor, gfx.glMinor, SDL_GetCurrentVideoDriver());
    } else {
        std::printf("tapestry: headless (video driver %s)\n",
            SDL_GetCurrentVideoDriver());
    }

    Session session;
    session.documentPath = options.documentPath;
    session.hasDocumentPath = options.documentPathExplicit;

    Camera camera;
    if (loadSession(session, camera)) {
        session.hasDocumentPath = true;
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
            handleEvent(event, session, camera, drag, edit, gfx.vg, fonts,
                        viewW, viewH, running);
        }

        if (gfx.window != nullptr) {
            int mouseX = 0;
            int mouseY = 0;
            SDL_GetMouseState(&mouseX, &mouseY);
            SDL_Cursor* cursor = arrowCursor;
            if (session.activeTool == ActiveTool::Hand) {
                cursor = handCursor;
            } else if (session.activeTool == ActiveTool::Zoom
                       || session.activeTool == ActiveTool::Brush) {
                cursor = zoomCursor;
            } else if (hoveringEditableText(session, camera,
                       static_cast<double>(mouseX), static_cast<double>(mouseY))) {
                cursor = textCursor;
            }
            if (cursor != nullptr) {
                SDL_SetCursor(cursor);
            }
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
            tapestry::drawStrokes(gfx.vg, session.world, camera);

            tapestry::PageUiState ui;
            ui.selectedId = session.selectedId;
            ui.zoom = camera.zoom();
            ui.invertScroll = session.invertScroll;
            ui.editingZoom = edit.target == EditState::Target::Zoom;
            if (ui.editingZoom) {
                ui.zoomDraft = edit.draft;
            }
            if (edit.target == EditState::Target::PageTitle
                || edit.target == EditState::Target::PageBody) {
                ui.editingPageId = edit.pageId;
                ui.editingRegion = edit.target == EditState::Target::PageTitle
                    ? tapestry::PageTextRegion::Title
                    : tapestry::PageTextRegion::Body;
                ui.caret = edit.caret;
            }
            tapestry::drawPages(gfx.vg, session.world, camera, viewW, viewH,
                                fonts, ui);

            drawHeader(gfx.vg, fonts, session, edit, viewW);
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

    SDL_FreeCursor(zoomCursor);
    SDL_FreeCursor(handCursor);
    SDL_FreeCursor(textCursor);
    SDL_FreeCursor(arrowCursor);
    destroyGraphics(gfx);
    SDL_Quit();
    return 0;
}
