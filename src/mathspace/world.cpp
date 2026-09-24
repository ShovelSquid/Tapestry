// mathspace/world.cpp — the store's mutators, see world.hpp.
//
// Each mutator is written as: look everything up, decide, then write.
// Nothing is written before the last check has passed.
#include "mathspace/world.hpp"

#include <algorithm>

namespace mathspace {

const char* error_name(Error e) {
    switch (e) {
    case Error::Ok: return "Ok";
    case Error::BadDim: return "BadDim";
    case Error::BadName: return "BadName";
    case Error::BadKind: return "BadKind";
    case Error::NoSuchSpace: return "NoSuchSpace";
    case Error::NoSuchNote: return "NoSuchNote";
    case Error::NoSuchField: return "NoSuchField";
    case Error::PosDimMismatch: return "PosDimMismatch";
    case Error::SpaceNotEmpty: return "SpaceNotEmpty";
    case Error::LockedField: return "LockedField";
    case Error::DuplicateId: return "DuplicateId";
    case Error::TooManyFields: return "TooManyFields";
    case Error::BadBytes: return "BadBytes";
    case Error::BadAction: return "BadAction";
    }
    return "?";
}

std::size_t World::note_lower_bound(NoteId id) const {
    const auto it = std::lower_bound(notes.begin(), notes.end(), id,
                                     [](const Note& n, NoteId v) { return n.id < v; });
    return static_cast<std::size_t>(it - notes.begin());
}

const Note* World::find(NoteId id) const {
    if (!id.assigned()) {
        return nullptr;
    }
    const std::size_t i = note_lower_bound(id);
    if (i < notes.size() && notes[i].id == id) {
        return &notes[i];
    }
    return nullptr;
}

Note* World::find(NoteId id) {
    return const_cast<Note*>(static_cast<const World&>(*this).find(id));
}

const Note* World::find_space(SpaceId space) const {
    const Note* n = find(note_of(space));
    return (n != nullptr && n->kind == NoteKind::Space) ? n : nullptr;
}

std::uint8_t World::space_dim(SpaceId space) const {
    const Note* s = find_space(space);
    if (s == nullptr) {
        return 0;
    }
    const Field* pos = find_field(*s, POS_FIELD);
    return pos != nullptr ? pos->dim : 0;
}

std::size_t World::notes_in(SpaceId space) const {
    std::size_t count = 0;
    for (const Note& n : notes) {
        if (n.space == space && n.kind != NoteKind::Space) {
            ++count;
        }
    }
    return count;
}

namespace {

// The caller's id (the kernel's) must be nonzero and not already stored.
Error check_new_id(const World& w, NoteId id) {
    return (id.assigned() && w.find(id) == nullptr) ? Error::Ok : Error::DuplicateId;
}

void insert_note(World& w, Note note) {
    const std::size_t i = w.note_lower_bound(note.id);
    w.notes.insert(w.notes.begin() + static_cast<std::ptrdiff_t>(i), std::move(note));
}

} // namespace

Error World::create_space(NoteId id, std::uint8_t dim) {
    if (!valid_dim(dim)) {
        return Error::BadDim;
    }
    if (const Error e = check_new_id(*this, id); e != Error::Ok) {
        return e;
    }
    Note space;
    space.id = id;
    space.kind = NoteKind::Space;
    Field pos;
    pos.name = POS_FIELD;
    pos.dim = dim;
    mathspace::set_field(space, std::move(pos));
    insert_note(*this, std::move(space));
    notes_dirty = true;
    return Error::Ok;
}

Error World::create_note(NoteId id, SpaceId space, NoteKind kind) {
    if (kind == NoteKind::Space) {
        return Error::BadKind;
    }
    if (find_space(space) == nullptr) {
        return Error::NoSuchSpace;
    }
    if (const Error e = check_new_id(*this, id); e != Error::Ok) {
        return e;
    }
    Note note;
    note.id = id;
    note.space = space;
    note.kind = kind;
    insert_note(*this, std::move(note));
    notes_dirty = true;
    return Error::Ok;
}

Error World::set_field(NoteId note_id, Field field) {
    if (!valid_field_name(field.name)) {
        return Error::BadName;
    }
    if (!valid_dim(field.dim)) {
        return Error::BadDim;
    }
    Note* note = find(note_id);
    if (note == nullptr) {
        return Error::NoSuchNote;
    }
    if (field.name == POS_FIELD) {
        // A Space's pos defines its dim; a member's pos must match it.
        const std::uint8_t dim =
            note->kind == NoteKind::Space ? space_dim(space_of(note->id)) : space_dim(note->space);
        if (field.dim != dim) {
            return Error::PosDimMismatch;
        }
    }
    if (note->fields.size() >= MAX_FIELDS && find_field(*note, field.name) == nullptr) {
        return Error::TooManyFields;
    }
    mathspace::set_field(*note, std::move(field));
    notes_dirty = true;
    return Error::Ok;
}

Error World::delete_note(NoteId note_id) {
    const Note* note = find(note_id);
    if (note == nullptr) {
        return Error::NoSuchNote;
    }
    if (note->kind == NoteKind::Space && notes_in(space_of(note_id)) != 0) {
        return Error::SpaceNotEmpty;
    }
    const std::size_t i = static_cast<std::size_t>(note - notes.data());
    notes.erase(notes.begin() + static_cast<std::ptrdiff_t>(i));
    notes_dirty = true;
    return Error::Ok;
}

Error World::delete_field(NoteId note_id, std::string_view name) {
    Note* note = find(note_id);
    if (note == nullptr) {
        return Error::NoSuchNote;
    }
    if (find_field(*note, name) == nullptr) {
        return Error::NoSuchField;
    }
    if (note->kind == NoteKind::Space && name == POS_FIELD) {
        return Error::LockedField;
    }
    erase_field(*note, name);
    notes_dirty = true;
    return Error::Ok;
}

bool World::well_formed() const {
    for (std::size_t i = 0; i < notes.size(); ++i) {
        const Note& n = notes[i];
        if (!n.id.assigned() || !fields_well_formed(n)) {
            return false;
        }
        if (i > 0 && !(notes[i - 1].id < n.id)) {
            return false;
        }
        if (n.kind == NoteKind::Space) {
            if (n.space.assigned() || space_dim(space_of(n.id)) == 0) {
                return false;
            }
        } else {
            const std::uint8_t dim = space_dim(n.space);
            if (dim == 0) {
                return false;
            }
            const Field* pos = find_field(n, POS_FIELD);
            if (pos != nullptr && pos->dim != dim) {
                return false;
            }
        }
    }
    return true;
}

} // namespace mathspace
