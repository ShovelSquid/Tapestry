#pragma once

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Record.hpp"
#include "kernel/Result.hpp"

#include <cstddef>
#include <string>
#include <string_view>

// The .tree codec: structs to bytes and bytes to structs, nothing else. No
// file, no stream, no clock — bytes in, bytes out — so the same functions
// serve the journal, the tests and the truncation and bit-flip sweeps.
namespace tapestry::kernel::tree {

// Hard limits checked before any allocation of a counted body, so a crafted
// byte count cannot become an allocation bomb.
inline constexpr std::size_t kMaxRecordBytes = 64u << 20;
inline constexpr std::size_t kMaxLineBytes = 1u << 20;

// One record exactly as it will sit in the file, plus the digest that seals
// it (the same value written on its `@end` line).
struct Encoded {
    std::string bytes;
    Digest digest;
};

// `@tree 1 <bytes>` + body + `@end sha256:<hex>`; digest over the head line
// and body exactly as written.
Encoded encodeHeader(const HeaderRecord& record);

// `@commit <seq> <bytes>` + body + `@end sha256:<hex>`. Body lines in fixed
// order: parent, branch, recorded, tick, actor, message (when non-empty), the
// ops, then extension lines verbatim. Inline text never carries a raw LF —
// any text containing one, or longer than 80 bytes, is written as a
// `<<DELIM` block whose delimiter (TEXT, TEXT1, TEXT2 …) is the first that
// equals no line of the text.
Encoded encodeCommit(const CommitRecord& record);

// Why a record could not be decoded, and where. Every failure carries the
// byte offset of the offending line or record. atEof is the flag the journal
// uses to tell a torn tail (the record could not be completed before the end
// of the input) from corruption of bytes that are all present.
struct DecodeFailure {
    enum class Reason {
        Truncated,      // the input ended inside this record
        BadEnvelope,    // the head or @end line is malformed
        DigestMismatch, // the @end digest is not the SHA-256 of the counted bytes
        ChainBreak,     // parent is not the previous record's digest
        SeqGap,         // seq is not previous + 1
        TickMismatch,   // tick is not the tick the world is at
        UnsupportedOp,  // an op verb this kernel does not know (never skipped)
        BadLine,        // a header line that does not parse
        BadValue,       // a value that does not parse for its declared type
        InvalidUtf8,    // a NUL byte or an invalid UTF-8 sequence in the body
        LimitExceeded,  // a byte count or line longer than the limits above
        NotATree        // the input does not begin with `@tree 1 <bytes>`
    } reason;
    std::size_t offset;
    std::string detail;
    bool atEof;
};

struct DecodedHeader {
    HeaderRecord record;
    Digest digest;
    std::size_t end; // offset of the first byte after the record
};

struct DecodedCommit {
    CommitRecord record;
    Digest digest;
    std::size_t begin;
    std::size_t end;
};

// Decodes the header record at offset 0. Anything that does not start with
// `@tree 1 <bytes>` is NotATree at offset 0.
Expected<DecodedHeader, DecodeFailure> decodeHeader(std::string_view file);

// Decodes one commit record starting at `offset`, verifying its envelope and
// digest first, then that it chains from `expectedParent`, carries
// `expectedSeq` and applies at `expectedTick`, then every body line. Unknown
// `x-` lines are kept; any other unknown verb is UnsupportedOp.
Expected<DecodedCommit, DecodeFailure> decodeCommit(std::string_view file, std::size_t offset,
    const Digest& expectedParent, CommitSeq expectedSeq, Tick expectedTick);

} // namespace tapestry::kernel::tree
