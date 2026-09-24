// gen_fixtures — writes the golden .actions fixtures. Test-side C++ encoder
// (tests/action_writer.hpp, the one encoder the suites use too); the
// .sha256 files beside them are produced by ddsim_replay --write-golden
// from the native-release build and then committed.
//
// Usage: ddsim_gen_fixtures <output-dir>
#include "action_writer.hpp"
#include "golden_support.hpp"

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace {

std::string header(const char* what) {
    return std::string("# ddsim golden fixture: ") + what +
           "\n# seed <u64> | action <tick> <hex> | checkpoint <tick>\n";
}

std::string actionLine(std::uint32_t tick, const std::vector<std::uint8_t>& bytes) {
    return "action " + std::to_string(tick) + " " + ddsim_test::hex(bytes) + "\n";
}

std::string actionLines(const std::vector<ddsim_test::StampedAction>& actions) {
    std::string out;
    for (const ddsim_test::StampedAction& a : actions) {
        out += actionLine(a.tick, a.bytes);
    }
    return out;
}

std::string checkpoints(std::initializer_list<std::uint32_t> ticks) {
    std::string out;
    for (const std::uint32_t t : ticks) {
        out += "checkpoint " + std::to_string(t) + "\n";
    }
    return out;
}

bool emit(const std::string& dir, const char* name, const std::string& text) {
    const std::string path = dir + "/" + name + ".actions";
    if (!ddsim_test::writeFile(path, text)) {
        std::fprintf(stderr, "cannot write %s\n", path.c_str());
        return false;
    }
    return true;
}

// Every stroke fixture: seed 42, the synthetic curve (u = t * 16384,
// v = ((t * 7) % 40 - 20) * 8192, pressure = min(65535, t * 546)), the
// default plane frame (origin 0, right +x, up +y), one StrokeSamples action
// per tick, StrokeEnd on the tick after the last sample.
ddsim_test::BrushSpec inkAs(std::uint32_t id) {
    ddsim_test::BrushSpec b = ddsim_test::preset_brush(0);
    b.id = id;
    return b;
}

ddsim_test::BrushSpec leadAs(std::uint32_t id) {
    ddsim_test::BrushSpec b = ddsim_test::preset_brush(3);
    b.id = id;
    return b;
}

} // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: ddsim_gen_fixtures <output-dir>\n");
        return 2;
    }
    const std::string dir = argv[1];

    // ---- 01-01 / 01-03 fixtures (unchanged) -------------------------------
    std::string noop = header("no actions; the tick and the seeded rng are the whole state");
    noop += "seed 42\n";
    noop += checkpoints({0, 1, 60, 600});
    if (!emit(dir, "noop", noop)) return 1;

    std::string one = header("one DefineBrush (id 1, \"ink\", mass 1.0, radius 0.75, spacing 0.5, identity curve) at tick 0");
    one += "seed 42\n";
    one += actionLine(0, ddsim_test::encodeDefineBrush(ddsim_test::inkBrush()));
    one += checkpoints({0, 1, 60, 600});
    if (!emit(dir, "one-brush", one)) return 1;

    // many-brushes: 50 DefineBrush actions, one per tick 0..49 (ids 1..50),
    // descriptions cycling through five strings — two of them multibyte
    // UTF-8 on purpose, because desc_len counts bytes — masses cycling
    // 1, 4, 16, 64; radius 0.75, spacing 0.5, identity curve.
    std::string many = header("50 DefineBrush actions at ticks 0..49 (ids 1..50); descriptions cycle ink / green rust / loneliness / \xe9\x9d\x92\xe8\x8b\x94 / rust \xe2\x9c\x93 (UTF-8 bytes); masses cycle 1, 4, 16, 64; radius 0.75, spacing 0.5, identity curve");
    many += "seed 7\n";
    const char* descriptions[5] = {"ink", "green rust", "loneliness", "\xe9\x9d\x92\xe8\x8b\x94", "rust \xe2\x9c\x93"};
    const std::int64_t masses[4] = {ddsim::fx64::ONE, ddsim::fx64::ONE * 4, ddsim::fx64::ONE * 16, ddsim::fx64::ONE * 64};
    for (std::uint32_t i = 0; i < 50; ++i) {
        ddsim_test::BrushSpec b = ddsim_test::inkBrush();
        b.id = i + 1;
        b.description = descriptions[i % 5];
        b.mass_raw = masses[i % 4];
        many += actionLine(i, ddsim_test::encodeDefineBrush(b));
    }
    many += checkpoints({0, 25, 50, 600});
    if (!emit(dir, "many-brushes", many)) return 1;

    // ---- 01-05 stroke fixtures --------------------------------------------
    {
        std::string text = header("one-stroke: ink (id 1) at tick 0; stroke ordinal 1 begins at tick 10, 120 synthetic samples one per tick (index 0) at ticks 10..129, StrokeEnd at 130");
        text += "seed 42\n";
        text += actionLine(0, ddsim_test::encodeDefineBrush(inkAs(1)));
        std::vector<ddsim_test::StampedAction> actions;
        const std::uint32_t end = ddsim_test::stroke_actions(actions, 1, 1, 10, 120, 1, {});
        if (end != 130) return 3;
        text += actionLines(actions);
        text += checkpoints({10, 70, 130, 600});
        if (!emit(dir, "one-stroke", text)) return 1;
    }
    {
        std::string text = header("four-per-tick: the one-stroke curve with samples t = 4k..4k+3 sharing tick 10+k (indices 0..3) over ticks 10..39, StrokeEnd at 40 (pitfall 5: several samples per tick)");
        text += "seed 42\n";
        text += actionLine(0, ddsim_test::encodeDefineBrush(inkAs(1)));
        std::vector<ddsim_test::StampedAction> actions;
        const std::uint32_t end = ddsim_test::stroke_actions(actions, 1, 1, 10, 120, 4, {});
        if (end != 40) return 3;
        text += actionLines(actions);
        text += checkpoints({10, 25, 40, 600});
        if (!emit(dir, "four-per-tick", text)) return 1;
    }
    {
        std::string text = header("gap: the one-stroke curve one sample per tick from tick 10, but ticks 40, 41, 42 carry no samples (the pen paused); samples resume at 43, the last at 132, StrokeEnd at 133");
        text += "seed 42\n";
        text += actionLine(0, ddsim_test::encodeDefineBrush(inkAs(1)));
        std::vector<ddsim_test::StampedAction> actions;
        const std::uint32_t end = ddsim_test::stroke_actions(actions, 1, 1, 10, 120, 1, {40, 41, 42});
        if (end != 133) return 3;
        text += actionLines(actions);
        text += checkpoints({39, 43, 133, 600});
        if (!emit(dir, "gap", text)) return 1;
    }
    {
        std::string text = header("two-strokes: ink (id 1) at tick 0 and lead (id 2, mass 64) at tick 1; stroke 1 (ink) samples at ticks 10..69, end 70; stroke 2 (lead) samples at ticks 100..159, end 160");
        text += "seed 42\n";
        text += actionLine(0, ddsim_test::encodeDefineBrush(inkAs(1)));
        text += actionLine(1, ddsim_test::encodeDefineBrush(leadAs(2)));
        std::vector<ddsim_test::StampedAction> actions;
        if (ddsim_test::stroke_actions(actions, 1, 1, 10, 60, 1, {}) != 70) return 3;
        if (ddsim_test::stroke_actions(actions, 2, 2, 100, 60, 1, {}) != 160) return 3;
        text += actionLines(actions);
        text += checkpoints({69, 159, 600});
        if (!emit(dir, "two-strokes", text)) return 1;
    }
    {
        std::string text = header("two-strokes-inserted: two-strokes plus stroke ordinal 3 (ink) inserted in time at ticks 75..95, end 96 — ordinals in time order 1, 3, 2; every node of ordinals 1 and 2 must equal two-strokes");
        text += "seed 42\n";
        text += actionLine(0, ddsim_test::encodeDefineBrush(inkAs(1)));
        text += actionLine(1, ddsim_test::encodeDefineBrush(leadAs(2)));
        std::vector<ddsim_test::StampedAction> actions;
        if (ddsim_test::stroke_actions(actions, 1, 1, 10, 60, 1, {}) != 70) return 3;
        if (ddsim_test::stroke_actions(actions, 3, 1, 75, 21, 1, {}) != 96) return 3;
        if (ddsim_test::stroke_actions(actions, 2, 2, 100, 60, 1, {}) != 160) return 3;
        text += actionLines(actions);
        text += checkpoints({69, 95, 159, 600});
        if (!emit(dir, "two-strokes-inserted", text)) return 1;
    }
    {
        std::string text = header("brush-edit: ink (id 1) at tick 0; stroke 1 with brush 1 at ticks 10..69, end 70; brush 2 = ink edited (description \"ink\", mass 4) at tick 80; stroke 2 with brush 2 at ticks 100..159, end 160 — stroke 1 must replay identically with or without the edit");
        text += "seed 42\n";
        text += actionLine(0, ddsim_test::encodeDefineBrush(inkAs(1)));
        std::vector<ddsim_test::StampedAction> actions;
        if (ddsim_test::stroke_actions(actions, 1, 1, 10, 60, 1, {}) != 70) return 3;
        text += actionLines(actions);
        ddsim_test::BrushSpec edited = inkAs(2);
        edited.mass_raw = ddsim::fx64::ONE * 4;
        text += actionLine(80, ddsim_test::encodeDefineBrush(edited));
        actions.clear();
        if (ddsim_test::stroke_actions(actions, 2, 2, 100, 60, 1, {}) != 160) return 3;
        text += actionLines(actions);
        text += checkpoints({69, 80, 159, 600});
        if (!emit(dir, "brush-edit", text)) return 1;
    }
    {
        std::string text = header("presets: the four DD_PRESETS (ink 1, rust 4, clay 16, lead 64) defined at ticks 0..3 as ids 1..4, no strokes; the plugin's TS PRESETS encoding is compared against these bytes");
        text += "seed 42\n";
        for (std::uint32_t i = 0; i < ddsim::DD_PRESET_COUNT; ++i) {
            text += actionLine(i, ddsim_test::encodeDefineBrush(ddsim_test::preset_brush(i)));
        }
        text += checkpoints({3, 600});
        if (!emit(dir, "presets", text)) return 1;
    }

    std::printf("wrote %s/{noop,one-brush,many-brushes,one-stroke,four-per-tick,gap,two-strokes,two-strokes-inserted,brush-edit,presets}.actions\n",
                dir.c_str());
    return 0;
}
