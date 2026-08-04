#pragma once

#include "commands/Command.hpp"

#include <vector>

namespace sw {

// Phase 4: input becomes commands, commands are drained per tick in
// (tick, sequence) order and nothing else may reach the world.
class CommandQueue {
public:
    void push(const Command& command);

    // Returns the commands assigned to `tick`, sorted by sequence number.
    std::vector<Command> drain(Tick tick);

    bool empty() const;

private:
    std::vector<Command> m_pending;
    Sequence m_nextSequence {1};
};

} // namespace sw
