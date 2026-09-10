/**
 * tapestry_addon — Node native addon wrapping tapestry::kernel::Kernel.
 *
 * Exposes the kernel's create, open, submit, and world-read methods to
 * Node.js through node-addon-api (Napi::ObjectWrap). Each method converts
 * between JavaScript values and the kernel's typed C++ structures, keeping
 * all validation in the kernel itself.
 *
 * Thread safety: the addon is called from the Electron main process's event
 * loop — single-threaded, matching the kernel's single-writer model.
 */

#include <napi.h>

#include "kernel/Kernel.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Value.hpp"
#include "kernel/World.hpp"

#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace {

using namespace tapestry::kernel;

// ---------------------------------------------------------------------------
// Value conversion: C++ kernel Value <-> JavaScript
// ---------------------------------------------------------------------------

/** Convert a kernel Value to a JS object { type, value }. */
Napi::Object valueToJS(Napi::Env env, const Value& val) {
    auto obj = Napi::Object::New(env);
    obj.Set("type", Napi::String::New(env, typeName(val.type)));
    switch (val.type) {
        case ValueType::Text:
            obj.Set("value", Napi::String::New(env, val.text));
            break;
        case ValueType::Int:
            obj.Set("value", Napi::Number::New(env, static_cast<double>(val.integer)));
            break;
        case ValueType::Real:
            obj.Set("value", Napi::Number::New(env, val.real));
            break;
        case ValueType::Bool:
            obj.Set("value", Napi::Boolean::New(env, val.boolean));
            break;
        case ValueType::Ref:
            obj.Set("value", Napi::String::New(env, val.text));
            break;
        case ValueType::Time:
            obj.Set("value", Napi::String::New(env, val.text));
            break;
    }
    return obj;
}

/** Convert a property map to a JS object of { key: { type, value } }. */
Napi::Object propsToJS(Napi::Env env, const std::map<std::string, Value>& props) {
    auto obj = Napi::Object::New(env);
    for (const auto& [key, val] : props) {
        obj.Set(key, valueToJS(env, val));
    }
    return obj;
}

// ---------------------------------------------------------------------------
// Input validation helpers
//
// The addon is compiled with NAPI_DISABLE_CPP_EXCEPTIONS: a failed As<>()
// cast does not throw, it sets a pending JS exception and returns a default.
// Throwing a second time while one is pending is a fatal N-API error that
// aborts the whole process, so every conversion below checks the JS type
// first, throws at most once, and returns immediately afterwards.
// ---------------------------------------------------------------------------

/** Throw a JS TypeError unless an exception is already pending. */
void throwTypeError(Napi::Env env, const std::string& message) {
    if (!env.IsExceptionPending()) {
        Napi::TypeError::New(env, message).ThrowAsJavaScriptException();
    }
}

/** Throw a JS RangeError unless an exception is already pending. */
void throwRangeError(Napi::Env env, const std::string& message) {
    if (!env.IsExceptionPending()) {
        Napi::RangeError::New(env, message).ThrowAsJavaScriptException();
    }
}

/** Largest magnitude a JS number represents exactly as an integer (2^53). */
constexpr double kMaxSafeInteger = 9007199254740992.0;

/**
 * Read a JS number as an exact integer. Int64Value() silently truncates
 * fractions and saturates out-of-range values, which would write a number
 * the user never entered into the readable history. Rejects non-numbers,
 * NaN/Infinity, fractional values, and magnitudes above 2^53.
 */
bool requireSafeInteger(Napi::Env env, Napi::Value v, const char* what, int64_t& out) {
    if (!v.IsNumber()) {
        throwTypeError(env, std::string(what) + " must be a number");
        return false;
    }
    double d = v.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(d) || std::floor(d) != d || d < -kMaxSafeInteger || d > kMaxSafeInteger) {
        throwRangeError(env, std::string(what) + " must be a safe integer");
        return false;
    }
    out = static_cast<int64_t>(d);
    return true;
}

/** Read a required string field from a JS object. Throws and returns false on failure. */
bool requireString(Napi::Env env, Napi::Object obj, const char* key, std::string& out) {
    Napi::Value v = obj.Get(key);
    if (!v.IsString()) {
        throwTypeError(env, std::string("Expected string field '") + key + "'");
        return false;
    }
    out = v.As<Napi::String>().Utf8Value();
    return true;
}

/** Convert a JS value to a kernel Value based on type information. */
Value jsToValue(Napi::Env env, const std::string& typeStr, Napi::Value jsVal) {
    if (typeStr == "text" || typeStr == "ref" || typeStr == "time") {
        if (!jsVal.IsString()) {
            throwTypeError(env, typeStr + " value must be a string");
            return Value::ofText("");
        }
        std::string s = jsVal.As<Napi::String>().Utf8Value();
        if (typeStr == "text") return Value::ofText(s);
        if (typeStr == "ref") return Value::ofRef(s);
        return Value::ofTime(s);
    } else if (typeStr == "int") {
        int64_t num = 0;
        if (!requireSafeInteger(env, jsVal, "int value", num)) return Value::ofText("");
        return Value::ofInt(num);
    } else if (typeStr == "real") {
        if (!jsVal.IsNumber()) {
            throwTypeError(env, "real value must be a number");
            return Value::ofText("");
        }
        return Value::ofReal(jsVal.As<Napi::Number>().DoubleValue());
    } else if (typeStr == "bool") {
        if (!jsVal.IsBoolean()) {
            throwTypeError(env, "bool value must be a boolean");
            return Value::ofText("");
        }
        return Value::ofBool(jsVal.As<Napi::Boolean>().Value());
    }
    throwTypeError(env, "Unknown value type: " + typeStr);
    return Value::ofText("");
}

/**
 * Convert a JS value to a kernel Value, inferring the type from the JS type.
 * Used when no explicit type field is provided in a property map.
 */
Value jsToValueInferred(Napi::Env env, Napi::Value jsVal) {
    if (jsVal.IsString()) {
        return Value::ofText(jsVal.As<Napi::String>().Utf8Value());
    } else if (jsVal.IsNumber()) {
        double d = jsVal.As<Napi::Number>().DoubleValue();
        // If the number is an integer and fits in int64, use Int.
        constexpr double kMaxSafeInt64 = 9223372036854774784.0;
        if (std::floor(d) == d && d >= static_cast<double>(INT64_MIN)
            && d <= kMaxSafeInt64) {
            return Value::ofInt(static_cast<int64_t>(d));
        }
        return Value::ofReal(d);
    } else if (jsVal.IsBoolean()) {
        return Value::ofBool(jsVal.As<Napi::Boolean>().Value());
    }
    throwTypeError(env, "Cannot infer kernel value type from JS value");
    return Value::ofText("");
}

/** Parse a target string like "n1" or "e2" into a Target variant. */
Target parseTarget(Napi::Env env, const std::string& targetStr) {
    if (!targetStr.empty() && targetStr[0] == 'n') {
        auto nid = parseNodeId(targetStr);
        if (nid) return *nid;
    } else if (!targetStr.empty() && targetStr[0] == 'e') {
        auto eid = parseEdgeId(targetStr);
        if (eid) return *eid;
    }
    throwTypeError(env, "Invalid target id: " + targetStr);
    return NodeId{0};
}

/**
 * Convert a JS property object to a C++ property map. The JS object can be:
 *   { key: { type: "text", value: "hello" } }   — explicit type
 *   { key: "hello" }                              — inferred type
 * Returns early (with a pending JS exception) on the first malformed entry.
 */
std::map<std::string, Value> jsPropsToMap(Napi::Env env, Napi::Object jsProps) {
    std::map<std::string, Value> result;
    auto names = jsProps.GetPropertyNames();
    for (uint32_t i = 0; i < names.Length(); i++) {
        Napi::Value keyVal = names.Get(i);
        if (!keyVal.IsString()) {
            throwTypeError(env, "Property keys must be strings");
            return result;
        }
        std::string key = keyVal.As<Napi::String>().Utf8Value();
        Napi::Value propVal = jsProps.Get(key);
        if (propVal.IsObject() && !propVal.IsNull()) {
            auto propObj = propVal.As<Napi::Object>();
            if (propObj.Has("type") && propObj.Has("value")) {
                std::string typeStr;
                if (!requireString(env, propObj, "type", typeStr)) return result;
                result[key] = jsToValue(env, typeStr, propObj.Get("value"));
                if (env.IsExceptionPending()) return result;
                continue;
            }
        }
        result[key] = jsToValueInferred(env, propVal);
        if (env.IsExceptionPending()) return result;
    }
    return result;
}

/**
 * Convert a single JS op object to a kernel Op variant. Every field is
 * type-checked before it is read; on the first malformed field a JS
 * TypeError is thrown and a placeholder op is returned — callers must check
 * env.IsExceptionPending() before using the result.
 */
Op jsToOp(Napi::Env env, Napi::Object jsOp) {
    std::string verb;
    if (!requireString(env, jsOp, "op", verb)) return Advance{0};

    if (verb == "createNode") {
        CreateNode cn;
        cn.id = NodeId{0}; // kernel assigns
        if (!requireString(env, jsOp, "type", cn.type)) return Advance{0};
        if (jsOp.Has("props") && jsOp.Get("props").IsObject()) {
            cn.props = jsPropsToMap(env, jsOp.Get("props").As<Napi::Object>());
            if (env.IsExceptionPending()) return Advance{0};
        }
        return cn;
    } else if (verb == "setProperty") {
        SetProperty sp;
        std::string targetStr;
        if (!requireString(env, jsOp, "target", targetStr)) return Advance{0};
        sp.target = parseTarget(env, targetStr);
        if (env.IsExceptionPending()) return Advance{0};
        if (!requireString(env, jsOp, "key", sp.key)) return Advance{0};
        std::string typeStr;
        if (!requireString(env, jsOp, "type", typeStr)) return Advance{0};
        sp.value = jsToValue(env, typeStr, jsOp.Get("value"));
        if (env.IsExceptionPending()) return Advance{0};
        return sp;
    } else if (verb == "unsetProperty") {
        UnsetProperty up;
        std::string targetStr;
        if (!requireString(env, jsOp, "target", targetStr)) return Advance{0};
        up.target = parseTarget(env, targetStr);
        if (env.IsExceptionPending()) return Advance{0};
        if (!requireString(env, jsOp, "key", up.key)) return Advance{0};
        return up;
    } else if (verb == "createEdge") {
        CreateEdge ce;
        ce.id = EdgeId{0}; // kernel assigns
        std::string fromStr;
        std::string toStr;
        if (!requireString(env, jsOp, "from", fromStr)) return Advance{0};
        if (!requireString(env, jsOp, "to", toStr)) return Advance{0};
        auto fromId = parseNodeId(fromStr);
        auto toId = parseNodeId(toStr);
        if (!fromId) {
            throwTypeError(env, "Invalid 'from' node id in createEdge");
            return Advance{0};
        }
        if (!toId) {
            throwTypeError(env, "Invalid 'to' node id in createEdge");
            return Advance{0};
        }
        ce.from = *fromId;
        ce.to = *toId;
        if (!requireString(env, jsOp, "label", ce.label)) return Advance{0};
        if (jsOp.Has("props") && jsOp.Get("props").IsObject()) {
            ce.props = jsPropsToMap(env, jsOp.Get("props").As<Napi::Object>());
            if (env.IsExceptionPending()) return Advance{0};
        }
        return ce;
    } else if (verb == "deleteNode") {
        std::string idStr;
        if (!requireString(env, jsOp, "id", idStr)) return Advance{0};
        auto nid = parseNodeId(idStr);
        if (!nid) {
            throwTypeError(env, "Invalid node id in deleteNode");
            return Advance{0};
        }
        return DeleteNode{*nid};
    } else if (verb == "deleteEdge") {
        std::string idStr;
        if (!requireString(env, jsOp, "id", idStr)) return Advance{0};
        auto eid = parseEdgeId(idStr);
        if (!eid) {
            throwTypeError(env, "Invalid edge id in deleteEdge");
            return Advance{0};
        }
        return DeleteEdge{*eid};
    } else if (verb == "advance") {
        int64_t ticks = 0;
        if (!requireSafeInteger(env, jsOp.Get("ticks"), "advance.ticks", ticks)) return Advance{0};
        if (ticks < 0) {
            throwRangeError(env, "advance.ticks must be a non-negative integer");
            return Advance{0};
        }
        Advance adv;
        adv.ticks = static_cast<Tick>(ticks);
        return adv;
    }

    throwTypeError(env, "Unknown op verb: " + verb);
    return Advance{0};
}

// ---------------------------------------------------------------------------
// TapestryAddon — Napi::ObjectWrap wrapping tapestry::kernel::Kernel
// ---------------------------------------------------------------------------

class TapestryAddon : public Napi::ObjectWrap<TapestryAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "TapestryAddon", {
            StaticMethod<&TapestryAddon::Create>("create"),
            StaticMethod<&TapestryAddon::Open>("open"),
            InstanceMethod<&TapestryAddon::Submit>("submit"),
            InstanceMethod<&TapestryAddon::GetNodes>("getNodes"),
            InstanceMethod<&TapestryAddon::GetNode>("getNode"),
            InstanceMethod<&TapestryAddon::GetEdges>("getEdges"),
            InstanceMethod<&TapestryAddon::Status>("status"),
            InstanceMethod<&TapestryAddon::ReplayUpTo>("replayUpTo"),
            InstanceMethod<&TapestryAddon::GetLastSeq>("getLastSeq"),
            InstanceMethod<&TapestryAddon::Close>("close"),
        });

        auto* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("TapestryAddon", func);
        return exports;
    }

    TapestryAddon(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<TapestryAddon>(info) {}

    /** Static: create(path, worldName) -> TapestryAddon wrapper */
    static Napi::Value Create(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
            Napi::TypeError::New(env, "create(path: string, worldName: string)")
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string path = info[0].As<Napi::String>().Utf8Value();
        std::string worldName = info[1].As<Napi::String>().Utf8Value();

        auto result = Kernel::create(path, worldName);
        if (!result.ok()) {
            Napi::Error::New(env, "Kernel::create failed: " + result.error().detail)
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        auto* constructor = env.GetInstanceData<Napi::FunctionReference>();
        auto wrapper = constructor->New({});
        auto* addon = Napi::ObjectWrap<TapestryAddon>::Unwrap(wrapper);
        addon->m_kernel = std::move(result.value());
        return wrapper;
    }

    /** Static: open(path) -> TapestryAddon wrapper */
    static Napi::Value Open(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "open(path: string)")
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string path = info[0].As<Napi::String>().Utf8Value();

        auto result = Kernel::open(path, OpenPolicy::Existing);
        if (!result.ok()) {
            Napi::Error::New(env, "Kernel::open failed: " + result.error().detail)
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        auto* constructor = env.GetInstanceData<Napi::FunctionReference>();
        auto wrapper = constructor->New({});
        auto* addon = Napi::ObjectWrap<TapestryAddon>::Unwrap(wrapper);
        addon->m_kernel = std::move(result.value());
        return wrapper;
    }

    /**
     * submit(actorKind, actorId, message, ops) -> { seq, digest, nodeIds, edgeIds }
     *
     * Converts the JS ops array into C++ Op variants, constructs a Proposal,
     * and delegates to Kernel::submit(). Returns the commit result or throws.
     */
    Napi::Value Submit(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }
        // Validate every argument before any conversion or kernel access. A
        // non-array `ops` used to fall through to Kernel::submit with zero
        // ops, durably appending an empty commit before the error reached JS.
        if (info.Length() < 4 || !info[0].IsString() || !info[1].IsString()
            || !info[2].IsString() || !info[3].IsArray()) {
            Napi::TypeError::New(env,
                "submit(actorKind: string, actorId: string, message: string, ops: Op[])")
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        Proposal proposal;
        proposal.actor.kind = info[0].As<Napi::String>().Utf8Value();
        proposal.actor.id = info[1].As<Napi::String>().Utf8Value();
        proposal.message = info[2].As<Napi::String>().Utf8Value();

        auto jsOps = info[3].As<Napi::Array>();
        const uint32_t opCount = jsOps.Length();
        for (uint32_t i = 0; i < opCount; i++) {
            Napi::Value el = jsOps.Get(i);
            if (!el.IsObject() || el.IsNull()) {
                throwTypeError(env, "op " + std::to_string(i) + " must be an object");
                return env.Null();
            }
            proposal.ops.push_back(jsToOp(env, el.As<Napi::Object>()));
            if (env.IsExceptionPending()) return env.Null();
        }
        // Never touch the kernel while a JS exception is pending.
        if (env.IsExceptionPending()) return env.Null();

        auto result = m_kernel->submit(proposal);
        if (!result.ok()) {
            Napi::Error::New(env, "Kernel rejected: " + result.error().detail)
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        auto& cr = result.value();
        auto obj = Napi::Object::New(env);
        obj.Set("seq", Napi::Number::New(env, static_cast<double>(cr.seq)));
        obj.Set("digest", Napi::String::New(env, cr.digest.hex));

        auto nodeIds = Napi::Array::New(env, cr.nodeIds.size());
        for (size_t i = 0; i < cr.nodeIds.size(); i++) {
            nodeIds.Set(static_cast<uint32_t>(i),
                Napi::String::New(env, format(cr.nodeIds[i])));
        }
        obj.Set("nodeIds", nodeIds);

        auto edgeIds = Napi::Array::New(env, cr.edgeIds.size());
        for (size_t i = 0; i < cr.edgeIds.size(); i++) {
            edgeIds.Set(static_cast<uint32_t>(i),
                Napi::String::New(env, format(cr.edgeIds[i])));
        }
        obj.Set("edgeIds", edgeIds);

        return obj;
    }

    /** getNodes() -> [{ id, type, props }] */
    Napi::Value GetNodes(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }

        const auto& world = m_kernel->world();
        auto ids = world.nodeIds();
        auto arr = Napi::Array::New(env, ids.size());
        uint32_t outIdx = 0;
        for (size_t i = 0; i < ids.size(); i++) {
            const auto* node = world.node(ids[i]);
            if (!node) continue;
            auto obj = Napi::Object::New(env);
            obj.Set("id", Napi::String::New(env, format(node->id)));
            obj.Set("type", Napi::String::New(env, node->type));
            obj.Set("props", propsToJS(env, node->props));
            arr.Set(outIdx++, obj);
        }
        arr.Set("length", Napi::Number::New(env, outIdx));
        return arr;
    }

    /** getNode(id) -> { id, type, props } | null */
    Napi::Value GetNode(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "getNode(id: string)")
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        auto idStr = info[0].As<Napi::String>().Utf8Value();
        auto nid = parseNodeId(idStr);
        if (!nid) {
            return env.Null();
        }

        const auto* node = m_kernel->world().node(*nid);
        if (!node) {
            return env.Null();
        }

        auto obj = Napi::Object::New(env);
        obj.Set("id", Napi::String::New(env, format(node->id)));
        obj.Set("type", Napi::String::New(env, node->type));
        obj.Set("props", propsToJS(env, node->props));
        return obj;
    }

    /** getEdges() -> [{ id, from, to, label, props }] */
    Napi::Value GetEdges(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }

        const auto& world = m_kernel->world();
        auto ids = world.edgeIds();
        auto arr = Napi::Array::New(env, ids.size());
        uint32_t outIdx = 0;
        for (size_t i = 0; i < ids.size(); i++) {
            const auto* edge = world.edge(ids[i]);
            if (!edge) continue;
            auto obj = Napi::Object::New(env);
            obj.Set("id", Napi::String::New(env, format(edge->id)));
            obj.Set("from", Napi::String::New(env, format(edge->from)));
            obj.Set("to", Napi::String::New(env, format(edge->to)));
            obj.Set("label", Napi::String::New(env, edge->label));
            obj.Set("props", propsToJS(env, edge->props));
            arr.Set(outIdx++, obj);
        }
        arr.Set("length", Napi::Number::New(env, outIdx));
        return arr;
    }

    /** status() -> { kind, offset, bytes, lastGoodSeq, reason } */
    Napi::Value Status(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }

        const auto& s = m_kernel->status();
        auto obj = Napi::Object::New(env);
        const char* kindStr = "Ok";
        switch (s.kind) {
            case JournalStatus::Kind::Ok: kindStr = "Ok"; break;
            case JournalStatus::Kind::TornTail: kindStr = "TornTail"; break;
            case JournalStatus::Kind::Corrupt: kindStr = "Corrupt"; break;
        }
        obj.Set("kind", Napi::String::New(env, kindStr));
        obj.Set("offset", Napi::Number::New(env, static_cast<double>(s.offset)));
        obj.Set("bytes", Napi::Number::New(env, static_cast<double>(s.bytes)));
        obj.Set("lastGoodSeq", Napi::Number::New(env, static_cast<double>(s.lastGoodSeq)));
        obj.Set("reason", Napi::String::New(env, s.reason));
        return obj;
    }

    /**
     * replayUpTo(seq) — rebuild the in-memory world from journal commits up
     * to the given seq. Used by undo/redo (D-22). The journal is never modified.
     */
    Napi::Value ReplayUpTo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "replayUpTo(seq: number)")
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        int64_t seqValue = 0;
        if (!requireSafeInteger(env, info[0], "replayUpTo seq", seqValue)) return env.Null();
        if (seqValue < 0) {
            throwRangeError(env, "replayUpTo seq must be a non-negative integer");
            return env.Null();
        }
        m_kernel->replayUpTo(static_cast<CommitSeq>(seqValue));
        return env.Undefined();
    }

    /**
     * close() — release the kernel now rather than when V8 collects this
     * wrapper. The journal sink holds an exclusive file lock for its whole
     * lifetime, so without an explicit close a world could not be reopened
     * (by this process or a relaunched one) until garbage collection ran.
     * Safe to call more than once; later method calls report "No kernel loaded".
     */
    Napi::Value Close(const Napi::CallbackInfo& info) {
        m_kernel.reset();
        return info.Env().Undefined();
    }

    /** getLastSeq() -> number — the highest committed seq in the journal. */
    Napi::Value GetLastSeq(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!m_kernel) {
            Napi::Error::New(env, "No kernel loaded").ThrowAsJavaScriptException();
            return env.Null();
        }
        return Napi::Number::New(env, static_cast<double>(m_kernel->lastSeq()));
    }

private:
    std::unique_ptr<Kernel> m_kernel;
};

} // anonymous namespace

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return TapestryAddon::Init(env, exports);
}

NODE_API_MODULE(tapestry_addon, InitAll)
