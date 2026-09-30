#pragma once

// 013a: one world per NPC, in spike 012's schema. Every NPC holds its own
// copy of every fact it believes. There is no shared id between files and
// no notion of canon.

#include "Scenario.hpp"

#include <string>

namespace story::pernpc {

// Writes `<dir>/<npc>.tree` for one NPC and returns its path.
std::string build(const Scenario& scenario, const std::string& npc, const std::string& dir);

// Rewrites a fact's text in every NPC file that holds it. With no shared id,
// the only way to find "the same fact" is its old text. Returns the number of
// files that needed a commit.
int correctFact(const std::vector<std::string>& paths, const std::string& oldText, const std::string& newText);

} // namespace story::pernpc
