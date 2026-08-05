#pragma once

#include <optional>
#include <string>

namespace tapestry {

// Native where available. The returned path is absolute and uses the host
// platform's normal separators. Cancellation is not an error.
std::optional<std::string> chooseDocumentToOpen();
std::optional<std::string> chooseDocumentToSave(const std::string& suggestedPath);

} // namespace tapestry
