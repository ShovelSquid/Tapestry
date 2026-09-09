#include "kernel/Value.hpp"

namespace tapestry::kernel {

const char* typeName(ValueType) { return ""; }
std::optional<ValueType> parseTypeName(std::string_view) { return std::nullopt; }

Value Value::ofText(std::string) { return {}; }
Value Value::ofInt(std::int64_t) { return {}; }
Value Value::ofReal(double) { return {}; }
Value Value::ofBool(bool) { return {}; }
Value Value::ofRef(std::string) { return {}; }
Value Value::ofRef(NodeId) { return {}; }
Value Value::ofRef(EdgeId) { return {}; }
Value Value::ofTime(std::string) { return {}; }

bool operator==(const Value&, const Value&) { return false; }

std::string formatReal(double) { return {}; }
std::optional<double> parseReal(std::string_view) { return std::nullopt; }
std::string quoteText(std::string_view) { return {}; }
std::optional<std::string> unquoteText(std::string_view) { return std::nullopt; }
bool textNeedsBlock(std::string_view) { return false; }
std::string formatInline(const Value&) { return {}; }
std::optional<Value> parseValue(ValueType, std::string_view) { return std::nullopt; }

} // namespace tapestry::kernel
