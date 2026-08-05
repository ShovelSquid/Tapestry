#include "app/FileDialog.hpp"

#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>

#include <array>

namespace tapestry {
namespace {

std::optional<std::string> showDialog(bool save, const std::string& suggested) {
    std::array<char, 4096> path {};
    if (!suggested.empty()) {
        suggested.copy(path.data(), path.size() - 1);
    }
    OPENFILENAMEA dialog {};
    dialog.lStructSize = sizeof(dialog);
    dialog.lpstrFilter = "Tapestry documents\0*.tapestry\0All files\0*.*\0";
    dialog.lpstrFile = path.data();
    dialog.nMaxFile = static_cast<DWORD>(path.size());
    dialog.lpstrDefExt = "tapestry";
    dialog.Flags = OFN_PATHMUSTEXIST | (save
        ? OFN_OVERWRITEPROMPT
        : OFN_FILEMUSTEXIST);
    const BOOL accepted = save ? GetSaveFileNameA(&dialog) : GetOpenFileNameA(&dialog);
    return accepted ? std::optional<std::string>(path.data()) : std::nullopt;
}

} // namespace

std::optional<std::string> chooseDocumentToOpen() { return showDialog(false, ""); }
std::optional<std::string> chooseDocumentToSave(const std::string& suggestedPath) {
    return showDialog(true, suggestedPath);
}

} // namespace tapestry
#else
#include <array>
#include <cstdio>

namespace tapestry {
namespace {

std::optional<std::string> runChooser(const char* command) {
    std::array<char, 4096> result {};
    FILE* pipe = popen(command, "r");
    if (pipe == nullptr || std::fgets(result.data(), static_cast<int>(result.size()), pipe) == nullptr) {
        if (pipe != nullptr) {
            pclose(pipe);
        }
        return std::nullopt;
    }
    const int status = pclose(pipe);
    std::string path(result.data());
    while (!path.empty() && (path.back() == '\n' || path.back() == '\r')) {
        path.pop_back();
    }
    return status == 0 && !path.empty() ? std::optional<std::string>(path)
                                        : std::nullopt;
}

} // namespace

std::optional<std::string> chooseDocumentToOpen() {
    return runChooser("zenity --file-selection --title='Open Tapestry document' --file-filter='Tapestry documents | *.tapestry'");
}

std::optional<std::string> chooseDocumentToSave(const std::string&) {
    return runChooser("zenity --file-selection --save --confirm-overwrite --title='Save Tapestry document' --filename='workspace.tapestry' --file-filter='Tapestry documents | *.tapestry'");
}

} // namespace tapestry
#endif
