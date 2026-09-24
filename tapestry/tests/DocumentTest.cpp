// Document format invariants.
//
// The .tapestry file is the only thing standing between an arranged workspace
// and losing it, so the property that matters is exact round-tripping: what
// loadDocument restores must be byte-for-byte the state saveDocument was
// given, including page bodies with newlines and backslashes, doubles at full
// precision, and minimized flags. The append-only history matters too — a
// save must never destroy the snapshots before it.

#include "core/Document.hpp"
#include "mathspace/action.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>

namespace {

using tapestry::DocumentState;
using tapestry::Page;
using tapestry::PageKind;
using tapestry::World;

int g_failures = 0;

void check(bool condition, const char* what) {
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s\n", what);
        ++g_failures;
    }
}

// A scratch path that will not collide between runs, cleaned up per test.
std::string scratchPath(const char* name) {
    const char* base = std::getenv("TMPDIR");
    std::string path = (base != nullptr) ? base : "/tmp";
    if (!path.empty() && path.back() != '/') {
        path += '/';
    }
    path += "tapestry-test-";
    path += name;
    path += ".tapestry";
    std::remove(path.c_str());
    return path;
}

DocumentState sampleState() {
    DocumentState state;
    state.title = "Plan: Q3 \\ north star";
    state.invertScroll = true;
    state.panX = -123.456789012345;
    state.panY = 987.654321;
    state.zoom = 0.000125; // beyond the interactive band on purpose
    return state;
}

World sampleWorld() {
    World world;
    world.addPage(PageKind::Conversation, "Kickoff",
        "line one\nline two\n\nwith a \\ backslash", {-560.0, -180.0, 440.0, 330.0});
    world.addPage(PageKind::Settings, "Settings", "", {420.0, -140.0, 320.0, 200.0});
    const auto minimizedId = world.addPage(PageKind::Note, "Folded", "hidden body",
        {10.5, -20.25, 300.0, 200.0});
    world.pageById(minimizedId)->minimized = true;
    const auto stroke = world.beginStroke({{-20.5, 30.25}, 0.125});
    world.appendStrokePoint(stroke, {{4.0, 80.0}, 0.875});
    for (int i = 0; i < 100; ++i) {
        world.step(16);
    }
    return world;
}

bool statesEqual(const DocumentState& a, const DocumentState& b) {
    return a.title == b.title && a.invertScroll == b.invertScroll
        && a.panX == b.panX && a.panY == b.panY && a.zoom == b.zoom;
}

bool worldsEqual(const World& a, const World& b) {
    if (a.ticks() != b.ticks() || a.pages().size() != b.pages().size()
        || a.strokes().size() != b.strokes().size()) {
        return false;
    }
    for (size_t i = 0; i < a.pages().size(); ++i) {
        const Page& p = a.pages()[i];
        const Page& q = b.pages()[i];
        if (p.id != q.id || p.kind != q.kind || p.minimized != q.minimized
            || p.title != q.title || p.body != q.body
            || p.rect.x != q.rect.x || p.rect.y != q.rect.y
            || p.rect.w != q.rect.w || p.rect.h != q.rect.h) {
            return false;
        }
    }
    for (size_t i = 0; i < a.strokes().size(); ++i) {
        const auto& p = a.strokes()[i];
        const auto& q = b.strokes()[i];
        if (p.id != q.id || p.points.size() != q.points.size()) return false;
        for (size_t j = 0; j < p.points.size(); ++j) {
            if (p.points[j].position.x != q.points[j].position.x
                || p.points[j].position.y != q.points[j].position.y
                || p.points[j].pressure != q.points[j].pressure) return false;
        }
    }
    return true;
}

void roundTripsExactly() {
    const std::string path = scratchPath("roundtrip");
    const DocumentState saved = sampleState();
    const World savedWorld = sampleWorld();

    check(tapestry::saveDocument(path, saved, savedWorld), "saveDocument succeeds");

    DocumentState loaded;
    World loadedWorld;
    check(tapestry::loadDocument(path, loaded, loadedWorld), "loadDocument succeeds");
    check(statesEqual(saved, loaded),
        "title, camera, and settings round-trip exactly");
    check(worldsEqual(savedWorld, loadedWorld),
        "pages, strokes, pressure, ticks, and minimized flags round-trip exactly");

    // Ids keep counting from where the loaded world left off.
    const auto nextId = loadedWorld.addPage(PageKind::Note, "new", "", {0, 0, 1, 1});
    check(nextId > savedWorld.pages().back().id,
        "loaded worlds hand out fresh ids above every restored one");

    std::remove(path.c_str());
}

long fileSize(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        return -1;
    }
    std::fseek(f, 0, SEEK_END);
    const long size = std::ftell(f);
    std::fclose(f);
    return size;
}

void savesAppendAndLoadsTakeNewest() {
    const std::string path = scratchPath("append");
    DocumentState state = sampleState();
    World world = sampleWorld();

    check(tapestry::saveDocument(path, state, world), "first save succeeds");
    check(tapestry::countSnapshots(path) == 1, "first save writes one version");

    // Mutate and save again — the file gains a version, keeps the old one.
    state.title = "Renamed";
    world.pageById(1)->rect.x = 999.0;
    const auto addedStroke = world.beginStroke({{500.0, -50.0}, 0.4});
    world.appendStrokePoint(addedStroke, {{510.0, -45.0}, 1.0});
    world.step(16);
    check(tapestry::saveDocument(path, state, world), "second save succeeds");
    check(tapestry::countSnapshots(path) == 2, "second save appends");

    DocumentState loaded;
    World loadedWorld;
    check(tapestry::loadDocument(path, loaded, loadedWorld), "load succeeds");
    check(loaded.title == "Renamed", "load restores the newest version's title");
    check(loadedWorld.pageById(1) != nullptr
              && loadedWorld.pageById(1)->rect.x == 999.0,
        "load restores the newest version's page positions");
    check(loadedWorld.pageById(2) != nullptr
              && loadedWorld.pageById(2)->title == "Settings",
        "pages untouched by the delta survive intact");
    check(loadedWorld.strokes().size() == 2
              && loadedWorld.strokes().back().points.back().pressure == 1.0,
        "stroke deltas restore vector points and pressure");

    std::remove(path.c_str());
}

// The point of deltas: repeated saves must cost the size of the edit, not the
// size of the workspace. A full-snapshot format would grow by the baseline
// every time and make long sessions expensive.
void deltasStaySmall() {
    const std::string path = scratchPath("delta-size");
    DocumentState state = sampleState();
    World world = sampleWorld();

    check(tapestry::saveDocument(path, state, world), "baseline save succeeds");
    const long baselineSize = fileSize(path);
    check(baselineSize > 0, "the baseline has content");

    // Twenty saves that each nudge one page: the file must not grow anywhere
    // near twenty baselines.
    for (int i = 0; i < 20; ++i) {
        world.pageById(1)->rect.x += 1.0;
        world.step(16);
        check(tapestry::saveDocument(path, state, world),
            "incremental save succeeds");
    }

    const long grown = fileSize(path);
    check(tapestry::countSnapshots(path) == 21, "every save appended a version");

    // The property that matters: a save costs the size of the edit, not the
    // size of the workspace. Compared against what full snapshots would have
    // written (21 baselines), and against a single baseline per save.
    const double perSave = static_cast<double>(grown - baselineSize) / 20.0;
    check(perSave < static_cast<double>(baselineSize) * 0.25,
        "one moved page costs a fraction of a full snapshot");
    check(grown < baselineSize * 21 / 3,
        "the delta chain is far smaller than the same saves as full snapshots");

    DocumentState loaded;
    World loadedWorld;
    check(tapestry::loadDocument(path, loaded, loadedWorld), "load succeeds");
    check(loadedWorld.pageById(1)->rect.x == -560.0 + 20.0,
        "replaying every delta lands on the final position");
    check(loadedWorld.pages().size() == world.pages().size(),
        "no pages were lost across the delta chain");

    std::remove(path.c_str());
}

// An unchanged workspace is not worth a version.
void unchangedSavesWriteNothing() {
    const std::string path = scratchPath("noop");
    const DocumentState state = sampleState();
    const World world = sampleWorld();

    check(tapestry::saveDocument(path, state, world), "baseline save succeeds");
    const long baselineSize = fileSize(path);

    check(tapestry::saveDocument(path, state, world), "no-op save succeeds");
    check(fileSize(path) == baselineSize, "a no-op save writes nothing");
    check(tapestry::countSnapshots(path) == 1, "a no-op save adds no version");

    std::remove(path.c_str());
}

// Structural edits — reordering, adding, removing — replay correctly.
void deltasCarryStructuralChanges() {
    const std::string path = scratchPath("structure");
    DocumentState state = sampleState();
    World world = sampleWorld();
    check(tapestry::saveDocument(path, state, world), "baseline save succeeds");

    const std::uint64_t raised = world.pages().front().id;
    world.bringToFront(raised);
    const auto added = world.addPage(PageKind::Note, "Fresh", "new page",
        {5.0, 6.0, 100.0, 80.0});
    world.step(16);
    check(tapestry::saveDocument(path, state, world), "structural save succeeds");

    DocumentState loaded;
    World loadedWorld;
    check(tapestry::loadDocument(path, loaded, loadedWorld), "load succeeds");
    check(loadedWorld.pages().size() == world.pages().size(),
        "the added page came through");
    check(loadedWorld.pageById(added) != nullptr
              && loadedWorld.pageById(added)->body == "new page",
        "the added page kept its content");

    // Draw order must survive, or raising a page would silently undo itself
    // on reload.
    bool orderMatches = true;
    for (size_t i = 0; i < world.pages().size(); ++i) {
        if (world.pages()[i].id != loadedWorld.pages()[i].id) {
            orderMatches = false;
        }
    }
    check(orderMatches, "a delta preserves the draw order");

    std::remove(path.c_str());
}

std::string spaceHash(const World& world, std::uint64_t pageId) {
    const tapestry::SpaceState* space = world.space(pageId);
    if (space == nullptr) {
        return "";
    }
    std::uint8_t digest[32];
    mathspace::hash(space->world, digest);
    static const char* hexDigits = "0123456789abcdef";
    std::string out;
    for (const std::uint8_t b : digest) {
        out.push_back(hexDigits[b >> 4]);
        out.push_back(hexDigits[b & 0x0f]);
    }
    return out;
}

mathspace::Field pos2(int x, int y) {
    mathspace::Field f;
    f.name = "pos";
    f.dim = 2;
    f.value[0] = mathspace::fx64::from_int(x);
    f.value[1] = mathspace::fx64::from_int(y);
    return f;
}

// A Space page's mathspace world survives save and load with the same hash,
// through a baseline and through deltas, and a page that is not a Space
// refuses actions.
void spaceActionsRoundTrip() {
    const std::string path = scratchPath("space");
    DocumentState state = sampleState();
    World world = sampleWorld();
    const std::uint64_t pageId = world.addPage(PageKind::Space, "Ideas",
        "first\nsecond", {0.0, 0.0, 400.0, 300.0});
    const std::uint64_t notePage = world.pages().front().id;

    check(world.space(pageId) == nullptr, "no space state before the first action");
    check(world.applySpaceAction(notePage, mathspace::encode_create_space(2))
              == mathspace::Error::NoSuchSpace,
        "a non-Space page refuses actions");

    mathspace::NoteId spaceId;
    check(world.applySpaceAction(pageId, mathspace::encode_create_space(2), &spaceId)
              == mathspace::Error::Ok, "CreateSpace applies");
    mathspace::NoteId a;
    check(world.applySpaceAction(pageId,
              mathspace::encode_create_note(mathspace::space_of(spaceId), mathspace::NoteKind::Note), &a)
              == mathspace::Error::Ok, "CreateNote applies");
    check(world.applySpaceAction(pageId, mathspace::encode_set_field(a, pos2(1, 2)))
              == mathspace::Error::Ok, "SetField applies");
    // A rejected action changes nothing, including the log.
    const std::string beforeReject = spaceHash(world, pageId);
    check(world.applySpaceAction(pageId, std::vector<std::uint8_t> {})
              == mathspace::Error::BadAction, "empty bytes are BadAction");
    check(spaceHash(world, pageId) == beforeReject && world.space(pageId)->log.size() == 3,
        "a rejected action leaves the world and log untouched");

    check(tapestry::saveDocument(path, state, world), "baseline save with a space succeeds");
    {
        DocumentState loaded;
        World loadedWorld;
        check(tapestry::loadDocument(path, loaded, loadedWorld), "load with a space succeeds");
        check(loadedWorld.space(pageId) != nullptr
                  && spaceHash(loadedWorld, pageId) == spaceHash(world, pageId),
            "the mathspace hash after reload equals the hash before save (baseline)");
        check(loadedWorld.space(pageId) != nullptr && loadedWorld.space(pageId)->log.size() == 3,
            "the full log came back");
    }

    // A delta carries only the appended actions.
    const long baselineSize = fileSize(path);
    check(world.applySpaceAction(pageId, mathspace::encode_set_field(a, pos2(5, 6)))
              == mathspace::Error::Ok, "second SetField applies");
    check(tapestry::saveDocument(path, state, world), "delta save with a space succeeds");
    check(tapestry::countSnapshots(path) == 2, "the space delta is one version");
    check(fileSize(path) - baselineSize < baselineSize / 2, "the space delta is small");
    {
        DocumentState loaded;
        World loadedWorld;
        check(tapestry::loadDocument(path, loaded, loadedWorld), "load after delta succeeds");
        check(spaceHash(loadedWorld, pageId) == spaceHash(world, pageId),
            "the mathspace hash after reload equals the hash before save (delta)");
        check(loadedWorld.space(pageId) != nullptr && loadedWorld.space(pageId)->log.size() == 4,
            "the delta appended one action");
        // The loaded page keeps accepting actions where the log left off.
        check(loadedWorld.applySpaceAction(pageId, mathspace::encode_delete_note(a))
                  == mathspace::Error::Ok, "the loaded space accepts a further action");
    }
    check(tapestry::saveDocument(path, state, world), "unchanged space save succeeds");
    check(tapestry::countSnapshots(path) == 2, "an unchanged space adds no version");

    std::remove(path.c_str());
}

void refusesForeignAndMissingFiles() {
    const std::string missing = scratchPath("missing");
    DocumentState state;
    World world;
    check(!tapestry::loadDocument(missing, state, world),
        "loading a missing file fails");
    check(tapestry::countSnapshots(missing) == 0,
        "a missing file has no snapshots");

    // A file that is not a tapestry document must be neither loaded nor
    // clobbered by a save.
    const std::string foreign = scratchPath("foreign");
    {
        std::FILE* f = std::fopen(foreign.c_str(), "wb");
        check(f != nullptr, "can create the foreign file");
        if (f != nullptr) {
            std::fputs("definitely not a tapestry file\n", f);
            std::fclose(f);
        }
    }
    check(!tapestry::loadDocument(foreign, state, world),
        "loading a foreign file fails");
    check(!tapestry::saveDocument(foreign, sampleState(), sampleWorld()),
        "saving refuses to overwrite a foreign file");
    {
        std::FILE* f = std::fopen(foreign.c_str(), "rb");
        char buffer[16] = {0};
        if (f != nullptr) {
            const size_t got = std::fread(buffer, 1, 10, f);
            check(got == 10 && std::string(buffer, 10) == "definitely",
                "the foreign file's content is untouched");
            std::fclose(f);
        }
    }
    std::remove(foreign.c_str());
}

} // namespace

int main() {
    roundTripsExactly();
    savesAppendAndLoadsTakeNewest();
    deltasStaySmall();
    unchangedSavesWriteNothing();
    deltasCarryStructuralChanges();
    spaceActionsRoundTrip();
    refusesForeignAndMissingFiles();

    if (g_failures != 0) {
        std::fprintf(stderr, "%d document check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("document: all checks passed\n");
    return 0;
}
