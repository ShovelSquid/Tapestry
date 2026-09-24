// mathspace/note.cpp — sorted-field helpers, see note.hpp.
#include "mathspace/note.hpp"

#include <algorithm>

namespace mathspace {

std::size_t field_lower_bound(const Note& note, std::string_view name) {
    const auto it = std::lower_bound(
        note.fields.begin(), note.fields.end(), name,
        [](const Field& f, std::string_view n) { return std::string_view{f.name} < n; });
    return static_cast<std::size_t>(it - note.fields.begin());
}

const Field* find_field(const Note& note, std::string_view name) {
    const std::size_t i = field_lower_bound(note, name);
    if (i < note.fields.size() && note.fields[i].name == name) {
        return &note.fields[i];
    }
    return nullptr;
}

Field* find_field(Note& note, std::string_view name) {
    return const_cast<Field*>(find_field(static_cast<const Note&>(note), name));
}

bool set_field(Note& note, Field field) {
    if (!field.valid()) {
        return false;
    }
    for (std::size_t lane = field.dim; lane < MAX_DIM; ++lane) {
        field.value[lane] = fx64{};
    }
    const std::size_t i = field_lower_bound(note, field.name);
    if (i < note.fields.size() && note.fields[i].name == field.name) {
        note.fields[i] = std::move(field);
    } else {
        note.fields.insert(note.fields.begin() + static_cast<std::ptrdiff_t>(i), std::move(field));
    }
    return true;
}

bool erase_field(Note& note, std::string_view name) {
    const std::size_t i = field_lower_bound(note, name);
    if (i < note.fields.size() && note.fields[i].name == name) {
        note.fields.erase(note.fields.begin() + static_cast<std::ptrdiff_t>(i));
        return true;
    }
    return false;
}

bool fields_well_formed(const Note& note) {
    for (std::size_t i = 0; i < note.fields.size(); ++i) {
        const Field& f = note.fields[i];
        if (!f.valid()) {
            return false;
        }
        if (i > 0 && !(note.fields[i - 1].name < f.name)) {
            return false;
        }
        for (std::size_t lane = f.dim; lane < MAX_DIM; ++lane) {
            if (f.value[lane] != fx64{}) {
                return false;
            }
        }
    }
    return true;
}

} // namespace mathspace
