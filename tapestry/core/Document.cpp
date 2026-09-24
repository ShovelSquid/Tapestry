#include "core/Document.hpp"

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <utility>
#include <vector>

namespace tapestry {
namespace {

constexpr const char* kMagic = "tapestry 1";

// Field values are single lines; real newlines and backslashes are escaped so
// a page body survives the line-based format.
std::string escapeText(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (const char c : text) {
        if (c == '\\') {
            out += "\\\\";
        } else if (c == '\n') {
            out += "\\n";
        } else {
            out += c;
        }
    }
    return out;
}

std::string unescapeText(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '\\' && i + 1 < text.size()) {
            ++i;
            out += (text[i] == 'n') ? '\n' : text[i];
        } else {
            out += text[i];
        }
    }
    return out;
}

const char* kindName(PageKind kind) {
    switch (kind) {
    case PageKind::Conversation: return "conversation";
    case PageKind::File:         return "file";
    case PageKind::Settings:     return "settings";
    case PageKind::Space:        return "space";
    case PageKind::Note:         break;
    }
    return "note";
}

bool kindFromName(const std::string& name, PageKind& kind) {
    if (name == "note")         { kind = PageKind::Note; return true; }
    if (name == "conversation") { kind = PageKind::Conversation; return true; }
    if (name == "file")         { kind = PageKind::File; return true; }
    if (name == "settings")     { kind = PageKind::Settings; return true; }
    if (name == "space")        { kind = PageKind::Space; return true; }
    return false;
}

// The value part of a "key value" line, or false if the key does not match.
bool valueAfter(const std::string& line, const char* key, std::string& value) {
    const size_t keyLen = std::char_traits<char>::length(key);
    if (line.compare(0, keyLen, key) != 0 || line.size() < keyLen + 1
        || line[keyLen] != ' ') {
        return false;
    }
    value = line.substr(keyLen + 1);
    return true;
}

// The accumulated document as the file describes it: a baseline with every
// delta applied. Both saving (to diff against) and loading build one.
struct Accumulated {
    DocumentState state;
    std::vector<Page> pages;
    std::vector<Stroke> strokes;
    std::vector<SpaceState> spaces; // sorted by page id
    std::uint64_t ticks = 0;
    bool hasBaseline = false;
};

bool sameStrokes(const std::vector<Stroke>& a, const std::vector<Stroke>& b) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (a[i].id != b[i].id || a[i].points.size() != b[i].points.size()) {
            return false;
        }
        for (std::size_t j = 0; j < a[i].points.size(); ++j) {
            const StrokePoint& p = a[i].points[j];
            const StrokePoint& q = b[i].points[j];
            if (p.position.x != q.position.x || p.position.y != q.position.y
                || p.pressure != q.pressure) return false;
        }
    }
    return true;
}

void writeStrokes(std::ostream& out, const std::vector<Stroke>& strokes) {
    out << "strokes " << strokes.size() << '\n';
    char buffer[192];
    for (const Stroke& stroke : strokes) {
        out << "stroke " << stroke.id << ' ' << stroke.points.size() << '\n';
        for (const StrokePoint& point : stroke.points) {
            std::snprintf(buffer, sizeof(buffer), "spoint %.17g %.17g %.17g",
                          point.position.x, point.position.y, point.pressure);
            out << buffer << '\n';
        }
    }
}

bool sameCamera(const DocumentState& a, const DocumentState& b) {
    return a.panX == b.panX && a.panY == b.panY && a.zoom == b.zoom;
}

const Page* findPage(const std::vector<Page>& pages, std::uint64_t id) {
    for (const Page& page : pages) {
        if (page.id == id) {
            return &page;
        }
    }
    return nullptr;
}

Page* mutablePage(std::vector<Page>& pages, std::uint64_t id) {
    for (Page& page : pages) {
        if (page.id == id) {
            return &page;
        }
    }
    return nullptr;
}

const SpaceState* findSpace(const std::vector<SpaceState>& spaces, std::uint64_t pageId) {
    for (const SpaceState& s : spaces) {
        if (s.pageId == pageId) return &s;
    }
    return nullptr;
}

// The SpaceState for `pageId`, created fresh (seeded with the page id, empty
// log) and inserted in id order when absent.
SpaceState& spaceFor(std::vector<SpaceState>& spaces, std::uint64_t pageId) {
    auto it = std::lower_bound(spaces.begin(), spaces.end(), pageId,
        [](const SpaceState& s, std::uint64_t id) { return s.pageId < id; });
    if (it == spaces.end() || it->pageId != pageId) {
        SpaceState fresh;
        fresh.pageId = pageId;
        fresh.world = mathspace::World(pageId);
        it = spaces.insert(it, std::move(fresh));
    }
    return *it;
}

// Action bytes travel as standard base64 (padded) so one action is one line
// of printable text, like every other field of the format.
std::string base64Encode(const std::vector<std::uint8_t>& bytes) {
    static const char* alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    std::size_t i = 0;
    for (; i + 3 <= bytes.size(); i += 3) {
        const unsigned v = (unsigned {bytes[i]} << 16) | (unsigned {bytes[i + 1]} << 8) | bytes[i + 2];
        out.push_back(alphabet[(v >> 18) & 63]);
        out.push_back(alphabet[(v >> 12) & 63]);
        out.push_back(alphabet[(v >> 6) & 63]);
        out.push_back(alphabet[v & 63]);
    }
    const std::size_t rest = bytes.size() - i;
    if (rest == 1) {
        const unsigned v = unsigned {bytes[i]} << 16;
        out.push_back(alphabet[(v >> 18) & 63]);
        out.push_back(alphabet[(v >> 12) & 63]);
        out += "==";
    } else if (rest == 2) {
        const unsigned v = (unsigned {bytes[i]} << 16) | (unsigned {bytes[i + 1]} << 8);
        out.push_back(alphabet[(v >> 18) & 63]);
        out.push_back(alphabet[(v >> 12) & 63]);
        out.push_back(alphabet[(v >> 6) & 63]);
        out.push_back('=');
    }
    return out;
}

int base64Value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

// Strict: length a multiple of four, padding only as the last one or two
// characters. Anything else is corruption, not a variant.
bool base64Decode(const std::string& text, std::vector<std::uint8_t>& out) {
    if (text.size() % 4 != 0) {
        return false;
    }
    out.clear();
    out.reserve(text.size() / 4 * 3);
    for (std::size_t i = 0; i < text.size(); i += 4) {
        const bool last = i + 4 == text.size();
        int pad = 0;
        if (last && text[i + 3] == '=') pad = (text[i + 2] == '=') ? 2 : 1;
        unsigned v = 0;
        for (std::size_t k = 0; k < 4; ++k) {
            const char c = text[i + k];
            if (k >= 4 - static_cast<std::size_t>(pad)) {
                v <<= 6;
                continue;
            }
            const int d = base64Value(c);
            if (d < 0) {
                return false;
            }
            v = (v << 6) | static_cast<unsigned>(d);
        }
        out.push_back(static_cast<std::uint8_t>((v >> 16) & 0xff));
        if (pad < 2) out.push_back(static_cast<std::uint8_t>((v >> 8) & 0xff));
        if (pad < 1) out.push_back(static_cast<std::uint8_t>(v & 0xff));
    }
    return true;
}

// One line per action from `from` onward, in log order.
void writeSpaceActions(std::ostream& out, const SpaceState& space, std::size_t from) {
    for (std::size_t i = from; i < space.log.size(); ++i) {
        out << "mspace " << space.pageId << ' ' << base64Encode(space.log[i]) << '\n';
    }
}

void writePage(std::ostream& out, const Page& page) {
    char buffer[256];
    std::snprintf(buffer, sizeof(buffer),
                  "page %llu %s %d %.17g %.17g %.17g %.17g",
                  static_cast<unsigned long long>(page.id),
                  kindName(page.kind), page.minimized ? 1 : 0,
                  page.rect.x, page.rect.y, page.rect.w, page.rect.h);
    out << buffer << '\n';
    out << "ptitle " << escapeText(page.title) << '\n';
    out << "pbody " << escapeText(page.body) << '\n';
}

void writeCamera(std::ostream& out, const DocumentState& state) {
    char buffer[128];
    std::snprintf(buffer, sizeof(buffer), "camera %.17g %.17g %.17g",
                  state.panX, state.panY, state.zoom);
    out << buffer << '\n';
}

void writeBaseline(std::ostream& out, const DocumentState& state,
                   const World& world) {
    out << "snapshot " << world.ticks() << '\n';
    out << "title " << escapeText(state.title) << '\n';
    writeCamera(out, state);
    out << "settings invert " << (state.invertScroll ? 1 : 0) << '\n';
    for (const Page& page : world.pages()) {
        writePage(out, page);
    }
    for (const SpaceState& space : world.spaces()) {
        writeSpaceActions(out, space, 0);
    }
    writeStrokes(out, world.strokes());
    out << "end\n";
}

// Writes only what differs from `previous`. Returns false when nothing
// differs, in which case nothing was written.
bool writeDelta(std::ostream& out, const Accumulated& previous,
                const DocumentState& state, const World& world) {
    std::ostringstream body;

    if (state.title != previous.state.title) {
        body << "title " << escapeText(state.title) << '\n';
    }
    if (!sameCamera(state, previous.state)) {
        writeCamera(body, state);
    }
    if (state.invertScroll != previous.state.invertScroll) {
        body << "settings invert " << (state.invertScroll ? 1 : 0) << '\n';
    }

    // Per-field diffing, not per-page: dragging a page with a long body must
    // cost one short line, not a rewrite of its text. That is the difference
    // between a session that grows the file by its edits and one that grows it
    // by the whole workspace every save.
    char buffer[256];
    for (const Page& page : world.pages()) {
        const Page* before = findPage(previous.pages, page.id);
        if (before == nullptr || before->kind != page.kind) {
            writePage(body, page); // new page, or a kind change: write it whole
            continue;
        }
        if (before->rect.x != page.rect.x || before->rect.y != page.rect.y
            || before->rect.w != page.rect.w || before->rect.h != page.rect.h) {
            std::snprintf(buffer, sizeof(buffer),
                          "pmove %llu %.17g %.17g %.17g %.17g",
                          static_cast<unsigned long long>(page.id),
                          page.rect.x, page.rect.y, page.rect.w, page.rect.h);
            body << buffer << '\n';
        }
        if (before->minimized != page.minimized) {
            body << "pfold " << page.id << ' ' << (page.minimized ? 1 : 0) << '\n';
        }
        if (before->title != page.title) {
            body << "pname " << page.id << ' ' << escapeText(page.title) << '\n';
        }
        if (before->body != page.body) {
            body << "ptext " << page.id << ' ' << escapeText(page.body) << '\n';
        }
    }

    // A space page's log is append-only, so the file's copy is normally a
    // prefix of the live one and the delta is just the tail. If it is not
    // (the file was edited by hand), the page is reset and rewritten whole
    // rather than left describing a different world.
    for (const SpaceState& space : world.spaces()) {
        if (findPage(world.pages(), space.pageId) == nullptr) {
            continue; // the page's drop line removes its space too
        }
        const SpaceState* before = findSpace(previous.spaces, space.pageId);
        std::size_t from = 0;
        if (before != nullptr) {
            const bool prefix = before->log.size() <= space.log.size()
                && std::equal(before->log.begin(), before->log.end(), space.log.begin());
            if (prefix) {
                from = before->log.size();
            } else {
                body << "mreset " << space.pageId << '\n';
            }
        }
        writeSpaceActions(body, space, from);
    }

    for (const Page& before : previous.pages) {
        if (findPage(world.pages(), before.id) == nullptr) {
            body << "drop " << before.id << '\n';
        }
    }

    // Draw order is implied by the order pages were written, so a reorder with
    // no content change still has to be recorded — cheaply, as a list of ids.
    const bool orderChanged =
        previous.pages.size() != world.pages().size()
        || !std::equal(previous.pages.begin(), previous.pages.end(),
                       world.pages().begin(),
                       [](const Page& a, const Page& b) { return a.id == b.id; });
    if (orderChanged) {
        body << "order";
        for (const Page& page : world.pages()) {
            body << ' ' << page.id;
        }
        body << '\n';
    }

    if (!sameStrokes(previous.strokes, world.strokes())) {
        writeStrokes(body, world.strokes());
    }

    const std::string text = body.str();
    if (text.empty() && world.ticks() == previous.ticks) {
        return false; // nothing to record
    }

    out << "delta " << world.ticks() << '\n' << text << "end\n";
    return true;
}

// Applies one block's body onto `acc`, up to its "end" line. A baseline block
// replaces the page list; a delta merges into it.
bool applyBlock(std::istream& in, std::uint64_t tick, bool baseline,
                Accumulated& acc) {
    if (baseline) {
        acc.pages.clear();
        acc.strokes.clear();
        acc.spaces.clear();
        acc.state = DocumentState {};
    }
    acc.ticks = tick;

    std::string line;
    while (std::getline(in, line)) {
        if (line == "end") {
            return true;
        }

        std::string value;
        if (valueAfter(line, "title", value)) {
            acc.state.title = unescapeText(value);
        } else if (valueAfter(line, "camera", value)) {
            if (std::sscanf(value.c_str(), "%lf %lf %lf", &acc.state.panX,
                            &acc.state.panY, &acc.state.zoom) != 3) {
                return false;
            }
        } else if (valueAfter(line, "settings", value)) {
            int invert = 0;
            if (std::sscanf(value.c_str(), "invert %d", &invert) != 1) {
                return false;
            }
            acc.state.invertScroll = invert != 0;
        } else if (valueAfter(line, "page", value)) {
            unsigned long long id = 0;
            char kindBuffer[32] = {0};
            int minimized = 0;
            Page page;
            if (std::sscanf(value.c_str(), "%llu %31s %d %lf %lf %lf %lf",
                            &id, kindBuffer, &minimized, &page.rect.x,
                            &page.rect.y, &page.rect.w, &page.rect.h) != 7
                || !kindFromName(kindBuffer, page.kind)) {
                return false;
            }
            page.id = id;
            page.minimized = minimized != 0;

            std::string field;
            if (!std::getline(in, field) || !valueAfter(field, "ptitle", value)) {
                return false;
            }
            page.title = unescapeText(value);
            if (!std::getline(in, field) || !valueAfter(field, "pbody", value)) {
                return false;
            }
            page.body = unescapeText(value);

            // A delta's page line either updates an existing page in place —
            // keeping its position in the draw order — or appends a new one.
            const auto it = std::find_if(acc.pages.begin(), acc.pages.end(),
                [id](const Page& p) { return p.id == id; });
            if (it != acc.pages.end()) {
                *it = std::move(page);
            } else {
                acc.pages.push_back(std::move(page));
            }
        } else if (valueAfter(line, "pmove", value)) {
            unsigned long long id = 0;
            Rect rect;
            if (std::sscanf(value.c_str(), "%llu %lf %lf %lf %lf", &id,
                            &rect.x, &rect.y, &rect.w, &rect.h) != 5) {
                return false;
            }
            Page* page = mutablePage(acc.pages, id);
            if (page == nullptr) {
                return false;
            }
            page->rect = rect;
        } else if (valueAfter(line, "pfold", value)) {
            unsigned long long id = 0;
            int minimized = 0;
            if (std::sscanf(value.c_str(), "%llu %d", &id, &minimized) != 2) {
                return false;
            }
            Page* page = mutablePage(acc.pages, id);
            if (page == nullptr) {
                return false;
            }
            page->minimized = minimized != 0;
        } else if (valueAfter(line, "pname", value)) {
            unsigned long long id = 0;
            int consumed = 0;
            if (std::sscanf(value.c_str(), "%llu %n", &id, &consumed) != 1) {
                return false;
            }
            Page* page = mutablePage(acc.pages, id);
            if (page == nullptr) {
                return false;
            }
            page->title = unescapeText(value.substr(
                static_cast<size_t>(consumed)));
        } else if (valueAfter(line, "ptext", value)) {
            unsigned long long id = 0;
            int consumed = 0;
            if (std::sscanf(value.c_str(), "%llu %n", &id, &consumed) != 1) {
                return false;
            }
            Page* page = mutablePage(acc.pages, id);
            if (page == nullptr) {
                return false;
            }
            page->body = unescapeText(value.substr(
                static_cast<size_t>(consumed)));
        } else if (valueAfter(line, "drop", value)) {
            unsigned long long id = 0;
            if (std::sscanf(value.c_str(), "%llu", &id) != 1) {
                return false;
            }
            acc.pages.erase(
                std::remove_if(acc.pages.begin(), acc.pages.end(),
                    [id](const Page& p) { return p.id == id; }),
                acc.pages.end());
            acc.spaces.erase(
                std::remove_if(acc.spaces.begin(), acc.spaces.end(),
                    [id](const SpaceState& s) { return s.pageId == id; }),
                acc.spaces.end());
        } else if (valueAfter(line, "mspace", value)) {
            // An action is applied as it is read, so a line the store rejects
            // is a corrupt block like any other malformed line.
            std::istringstream fields(value);
            unsigned long long id = 0;
            std::string encoded;
            std::string extra;
            std::vector<std::uint8_t> action;
            if (!(fields >> id >> encoded) || (fields >> extra)
                || !base64Decode(encoded, action)) {
                return false;
            }
            const Page* page = findPage(acc.pages, id);
            if (page == nullptr || page->kind != PageKind::Space) {
                return false;
            }
            SpaceState& space = spaceFor(acc.spaces, id);
            if (space.world.apply(action) != mathspace::Error::Ok) {
                return false;
            }
            space.log.push_back(std::move(action));
        } else if (valueAfter(line, "mreset", value)) {
            unsigned long long id = 0;
            if (std::sscanf(value.c_str(), "%llu", &id) != 1
                || findPage(acc.pages, id) == nullptr) {
                return false;
            }
            SpaceState& space = spaceFor(acc.spaces, id);
            space.world = mathspace::World(id);
            space.log.clear();
        } else if (valueAfter(line, "order", value)) {
            std::vector<Page> reordered;
            reordered.reserve(acc.pages.size());
            std::istringstream ids(value);
            unsigned long long id = 0;
            while (ids >> id) {
                const Page* page = findPage(acc.pages, id);
                if (page == nullptr) {
                    return false;
                }
                reordered.push_back(*page);
            }
            if (reordered.size() != acc.pages.size()) {
                return false;
            }
            acc.pages = std::move(reordered);
        } else if (valueAfter(line, "strokes", value)) {
            unsigned long long strokeCount = 0;
            if (std::sscanf(value.c_str(), "%llu", &strokeCount) != 1) {
                return false;
            }
            std::vector<Stroke> strokes;
            strokes.reserve(static_cast<std::size_t>(strokeCount));
            for (unsigned long long s = 0; s < strokeCount; ++s) {
                std::string strokeLine;
                unsigned long long id = 0;
                unsigned long long pointCount = 0;
                if (!std::getline(in, strokeLine)
                    || std::sscanf(strokeLine.c_str(), "stroke %llu %llu",
                                   &id, &pointCount) != 2) {
                    return false;
                }
                Stroke stroke;
                stroke.id = id;
                stroke.points.reserve(static_cast<std::size_t>(pointCount));
                for (unsigned long long p = 0; p < pointCount; ++p) {
                    std::string pointLine;
                    StrokePoint point;
                    if (!std::getline(in, pointLine)
                        || std::sscanf(pointLine.c_str(), "spoint %lf %lf %lf",
                            &point.position.x, &point.position.y,
                            &point.pressure) != 3) {
                        return false;
                    }
                    point.pressure = std::clamp(point.pressure, 0.0, 1.0);
                    stroke.points.push_back(point);
                }
                strokes.push_back(std::move(stroke));
            }
            acc.strokes = std::move(strokes);
        } else {
            return false; // unknown key — refuse rather than silently drop
        }
    }
    return false; // hit EOF before "end"
}

// Reads the whole file and replays it into an accumulated state.
bool readAccumulated(const std::string& path, Accumulated& acc) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return false;
    }
    std::string line;
    if (!std::getline(in, line) || line != kMagic) {
        return false;
    }

    while (std::getline(in, line)) {
        unsigned long long tick = 0;
        const bool baseline = std::sscanf(line.c_str(), "snapshot %llu", &tick) == 1;
        const bool delta = !baseline
            && std::sscanf(line.c_str(), "delta %llu", &tick) == 1;
        if (!baseline && !delta) {
            continue;
        }
        // A delta before any baseline has nothing to merge into.
        if (delta && !acc.hasBaseline) {
            return false;
        }
        if (!applyBlock(in, tick, baseline, acc)) {
            break; // stop at the first corrupt block; keep what came before
        }
        if (baseline) {
            acc.hasBaseline = true;
        }
    }
    return acc.hasBaseline;
}

World toWorld(const Accumulated& acc) {
    World world;
    world.setTicks(acc.ticks);
    for (const Page& page : acc.pages) {
        world.adopt(page);
    }
    for (const Stroke& stroke : acc.strokes) {
        world.adoptStroke(stroke);
    }
    for (const SpaceState& space : acc.spaces) {
        world.adoptSpace(space);
    }
    return world;
}

} // namespace

bool saveDocument(const std::string& path, const DocumentState& state,
                  const World& world) {
    // Read what the file already describes, both to diff against and to be
    // sure we are not about to append to somebody else's file format.
    Accumulated previous;
    bool exists = false;
    {
        std::ifstream probe(path, std::ios::binary);
        exists = static_cast<bool>(probe);
    }
    if (exists && !readAccumulated(path, previous)) {
        return false;
    }

    if (!previous.hasBaseline) {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        if (!out) {
            return false;
        }
        out << kMagic << '\n';
        writeBaseline(out, state, world);
        return out.good();
    }

    // Append only the differences. An unchanged workspace writes nothing.
    std::ostringstream delta;
    if (!writeDelta(delta, previous, state, world)) {
        return true;
    }

    std::ofstream out(path, std::ios::binary | std::ios::app);
    if (!out) {
        return false;
    }
    out << delta.str();
    return out.good();
}

bool loadDocument(const std::string& path, DocumentState& state, World& world) {
    Accumulated acc;
    if (!readAccumulated(path, acc)) {
        return false;
    }
    state = acc.state;
    world = toWorld(acc);
    return true;
}

int countSnapshots(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return 0;
    }
    std::string line;
    if (!std::getline(in, line) || line != kMagic) {
        return 0;
    }
    int count = 0;
    while (std::getline(in, line)) {
        unsigned long long tick = 0;
        if (std::sscanf(line.c_str(), "snapshot %llu", &tick) == 1
            || std::sscanf(line.c_str(), "delta %llu", &tick) == 1) {
            ++count;
        }
    }
    return count;
}

} // namespace tapestry
