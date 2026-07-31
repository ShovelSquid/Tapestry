#pragma once
#include "types.hpp"
#include <optional>
#include <string>
namespace living_field {
enum class CommandKind{SetFrequency,SetPhase,SetAxis,CreateNode,Solve,Unknown};
struct Command { CommandKind kind{CommandKind::Unknown}; std::uint32_t node{}; Vec3 vector{}; double value{}; };
std::optional<Command> parse_command(const std::string& line,std::string* error=nullptr);
}
