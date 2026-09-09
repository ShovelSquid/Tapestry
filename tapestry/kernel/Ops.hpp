#pragma once

#include "kernel/Ids.hpp"
#include "kernel/Value.hpp"

#include <map>
#include <string>
#include <string_view>
#include <variant>

namespace tapestry::kernel {

// Who is responsible for a commit: `actor <kind> <id>`. The kind is one of
// human, plugin or system and the id is one token (a user name, a plugin
// name, a subsystem). The kernel never writes a commit without an actor, so a
// reader can always tell a person's edit from a plugin's or the kernel's own.
struct Actor {
    std::string kind;
    std::string id;
};

// What a `set` line addresses: a node or an edge, never a bare integer.
using Target = std::variant<NodeId, EdgeId>;

// `create-node n<k> <type>` followed by one `set` line per initial property
// (emitted in std::map key order). An id of 0 asks the kernel to assign the
// next one at prepare time; a non-zero id is a committed id being replayed
// from a record and must equal the next id exactly.
struct CreateNode {
    NodeId id;
    std::string type;
    std::map<std::string, Value> props;
};

// `set <n<k>|e<k>> <key> <type> <value>`: writes one typed property on an
// existing node or edge, replacing any earlier value.
struct SetProperty {
    Target target;
    std::string key;
    Value value;
};

// The op vocabulary the tracer path knows. Plan 03 appends UnsetProperty,
// CreateEdge, DeleteNode, DeleteEdge and Advance; the variant grows, nothing
// here changes shape.
using Op = std::variant<CreateNode, SetProperty>;

// One of exactly human, plugin or system.
inline bool isValidActorKind(std::string_view kind) {
    return kind == "human" || kind == "plugin" || kind == "system";
}

// A single token as the file grammar uses it: non-empty, no space, no tab,
// no line break, no other control byte. Everything else — including
// non-ASCII UTF-8 — is allowed, so a plugin type such as
// `acme.widgets/gizmo@7` or a user name in any script is one token.
inline bool isToken(std::string_view text) {
    if (text.empty()) {
        return false;
    }
    for (const char ch : text) {
        const auto c = static_cast<unsigned char>(ch);
        if (c < 0x20 || c == 0x7F || c == ' ') {
            return false;
        }
    }
    return true;
}

// A property key: [A-Za-z_][A-Za-z0-9_.:-]*. Tighter than a token on purpose
// — keys are identifiers a reader scans by eye, and a fixed ASCII shape keeps
// `set` lines unambiguous no matter what the value holds.
inline bool isValidKey(std::string_view key) {
    if (key.empty()) {
        return false;
    }
    const auto isAlpha = [](char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); };
    const auto isDigit = [](char c) { return c >= '0' && c <= '9'; };
    if (!isAlpha(key[0]) && key[0] != '_') {
        return false;
    }
    for (const char c : key.substr(1)) {
        if (!isAlpha(c) && !isDigit(c) && c != '_' && c != '.' && c != ':' && c != '-') {
            return false;
        }
    }
    return true;
}

} // namespace tapestry::kernel
