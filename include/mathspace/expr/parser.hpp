// mathspace/expr/parser.hpp — text to Ast.
//
// The grammar, lowest precedence first (mathspace_plan.md, phase 2):
//
//   expr     := 'if' expr 'then' expr 'else' expr | cmp
//   cmp      := add [ ('<' | '<=' | '>' | '>=' | '==' | '!=') add ]
//   add      := mul { ('+' | '-') mul }
//   mul      := unary { ('*' | '/') unary }
//   unary    := '-' unary | postfix
//   postfix  := primary { '.' lane }              lane := x | y | z | w | 0..7
//   primary  := number | '(' expr ')' | '[' expr { ',' expr } ']'
//             | builtin '(' expr { ',' expr } ')' | ref
//   ref      := 'self' '.' name | 'other' '.' name | 'space' '.' name
//             | 'world' '.' name | 'node' '(' 'n' digits ')' '.' name
//   number   := digits [ '.' digits ]
//   name     := [A-Za-z_] [A-Za-z0-9_]*
//
// `if` is a keyword expression at the lowest level, so `if c then a else b`
// takes the rest of the input as its else branch; nest one inside a
// comparison with parentheses. Comparison is non-associative: `a < b < c`
// is a parse error rather than a silent bool-times-number.
//
// A number literal must lie on the Q32.32 grid exactly. The integer part
// is read into a 64-bit accumulator and must be below 2^31 (the negative
// end is reached through unary minus); the fraction is read as a digit
// string and turned into 32 binary digits by doubling it 32 times, and any
// non-zero digit left afterwards makes the literal inexact and the parse
// fails with InexactNumber. No floating-point type is involved, so the
// forbidden-token gate stays green and so does the promise that a literal
// means exactly what it says (the same rule image.js applies to `real`
// properties, so text and stored values agree).
//
// Parsing is recursive descent bounded by MAX_DEPTH nesting levels and
// MAX_NODES nodes; either limit is an error, never a stack overflow. A
// failed parse returns the error code and the byte offset in the source
// where it was detected, and an empty Ast.
#pragma once

#include <cstdint>
#include <string_view>

#include "mathspace/expr/ast.hpp"

namespace mathspace::expr {

enum class ParseError : std::uint8_t {
    Ok = 0,
    UnexpectedChar,   // a byte the grammar has no use for
    UnexpectedEnd,    // input ended inside an expression
    UnexpectedToken,  // a token that cannot start or continue here
    TrailingInput,    // a complete expression followed by more text
    InexactNumber,    // a decimal that is not k / 2^32
    NumberTooLarge,   // integer part at or above 2^31, or more than 32 fraction digits
    UnknownFunction,  // `name(` where name is not a builtin
    BadArity,         // wrong number of arguments for the builtin
    BadComponent,     // `.q` or `.9`: not a lane name
    BadNodeId,        // `node(...)` without `n<digits>` inside, or zero
    BadName,          // a field name that fails valid_field_name
    VectorTooLong,    // more than MAX_DIM components
    TooDeep,          // nesting beyond MAX_DEPTH
    TooManyNodes,     // more than MAX_NODES nodes
};

const char* parse_error_name(ParseError e);

struct ParseResult {
    Ast ast;
    ParseError error = ParseError::Ok;
    std::uint32_t offset = 0; // byte offset of the error, or of the end on success

    bool ok() const { return error == ParseError::Ok; }
};

ParseResult parse(std::string_view source);

// The literal rule alone, for tests and for the plugin boundary: `text` is
// `digits [ '.' digits ]` with nothing else (no sign, no whitespace).
ParseError parse_literal(std::string_view text, std::int64_t& raw);

} // namespace mathspace::expr
