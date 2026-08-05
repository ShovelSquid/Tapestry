#include "render/Fonts.hpp"

#include <nanovg.h>

#include <cstdio>
#include <string>

namespace tapestry {
namespace {

// Tries each path in order and returns the first face nanovg accepts.
int loadFirst(NVGcontext* vg, const char* name,
              const char* const* candidates, int count) {
    for (int i = 0; i < count; ++i) {
        const int handle = nvgCreateFont(vg, name, candidates[i]);
        if (handle != -1) {
            std::printf("tapestry: %s font %s\n", name, candidates[i]);
            return handle;
        }
    }
    return -1;
}

} // namespace

FontSet loadFonts(NVGcontext* vg, const char* assetDir) {
    const std::string bundledRegular = std::string(assetDir) + "/fonts/ui.ttf";
    const std::string bundledBold = std::string(assetDir) + "/fonts/ui-bold.ttf";

    const char* const regularCandidates[] = {
        bundledRegular.c_str(),
#if defined(__APPLE__)
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
#elif defined(_WIN32)
        "C:/Windows/Fonts/segoeui.ttf",
#else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
#endif
    };

    const char* const boldCandidates[] = {
        bundledBold.c_str(),
#if defined(__APPLE__)
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
#elif defined(_WIN32)
        "C:/Windows/Fonts/segoeuib.ttf",
#else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
#endif
    };

    FontSet fonts;
    fonts.regular = loadFirst(vg, "ui", regularCandidates,
        static_cast<int>(sizeof(regularCandidates) / sizeof(*regularCandidates)));
    fonts.bold = loadFirst(vg, "ui-bold", boldCandidates,
        static_cast<int>(sizeof(boldCandidates) / sizeof(*boldCandidates)));

    if (fonts.bold == -1) {
        fonts.bold = fonts.regular;
    }
    if (fonts.regular == -1) {
        std::printf("tapestry: no ui font found — on-screen text disabled\n");
    }
    return fonts;
}

} // namespace tapestry
