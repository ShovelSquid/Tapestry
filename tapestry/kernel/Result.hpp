#pragma once

#include <utility>
#include <variant>

namespace tapestry::kernel {

// Either a value or an error — exactly one, always. Apple libc++ 15 ships no
// std::expected, so this is the small subset the kernel needs: the factories
// return Expected<std::unique_ptr<…>, OpenFailure>, submit returns
// Expected<CommitResult, Rejection>, and every caller checks ok() before
// touching value(). T and E must be distinct types.
template <class T, class E>
class Expected {
public:
    Expected(T value) : m_state(std::in_place_index<0>, std::move(value)) {}
    Expected(E error) : m_state(std::in_place_index<1>, std::move(error)) {}

    bool ok() const { return m_state.index() == 0; }
    explicit operator bool() const { return ok(); }

    // Precondition: ok(). Reading the wrong side throws
    // std::bad_variant_access rather than handing back garbage.
    T& value() & { return std::get<0>(m_state); }
    const T& value() const& { return std::get<0>(m_state); }
    T&& value() && { return std::get<0>(std::move(m_state)); }
    const E& error() const { return std::get<1>(m_state); }

private:
    std::variant<T, E> m_state;
};

} // namespace tapestry::kernel
