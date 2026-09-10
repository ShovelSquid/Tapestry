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

/** Convert a JS value to a kernel Value based on type information. */
Value jsToValue(Napi::Env env, const std::string& typeStr, Napi::Value jsVal) {
    if (typeStr == "text") {
        return Value::ofText(jsVal.As<Napi::String>().Utf8Value());
    } else if (typeStr == "int") {
        auto num = jsVal.As<Napi::Number>().Int64Value();
        return Value::ofInt(num);
    } else if (typeStr == "real") {
        return Value::ofReal(jsVal.As<Napi::Number>().DoubleValue());
    } else if (typeStr == "bool") {
        return Value::ofBool(jsVal.As<Napi::Boolean>().Value());
    } else if (typeStr == "ref") {
        return Value::ofRef(jsVal.As<Napi::String>().Utf8Value());
    } else if (typeStr == "time") {
        return Value::ofTime(jsVal.As<Napi::String>().Utf8Value());
    }
    Napi::TypeError::New(env, "Unknown value type: " + typeStr).ThrowAsJavaScriptException();
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
        if (std::floor(d) == d && d >= static_cast<double>(INT64_MIN)
            && d <= static_cast<double>(INT64_MAX)) {
            return Value::ofInt(static_cast<int64_t>(d));
        }
        return Value::ofReal(d);
    } else if (jsVal.IsBoolean()) {
        return Value::ofBool(jsVal.As<Napi::Boolean>().Value());
    }
    Napi::TypeError::New(env, "Cannot infer kernel value type from JS value")
        .ThrowAsJavaScriptException();
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
    Napi::TypeError::New(env, "Invalid target id: " + targetStr)
        .ThrowAsJavaScriptException();
    return NodeId{0};
}

/**
 * Convert a JS property object to a C++ property map. The JS object can be:
 *   { key: { type: "text", value: "hello" } }   — explicit type
 *   { key: "hello" }                              — inferred type
 */
std::map<std::string, Value> jsPropsToMap(Napi::Env env, Napi::Object jsProps) {
    std::map<std::string, Value> result;
    auto names = jsProps.GetPropertyNames();
    for (uint32_t i = 0; i < names.Length(); i++) {
        std::string key = names.Get(i).As<Napi::String>().Utf8Value();
        Napi::Value propVal = jsProps.Get(key);
        if (propVal.IsObject() && !propVal.IsNull()) {
            auto propObj = propVal.As<Napi::Object>();
            if (propObj.Has("type") && propObj.Has("value")) {
                std::string typeStr = propObj.Get("type").As<Napi::String>().Utf8Value();
                result[key] = jsToValue(env, typeStr, propObj.Get("value"));
                continue;
            }
        }
        result[key] = jsToValueInferred(env, propVal);
    }
    return result;
}

/** Convert a single JS op object to a kernel Op variant. */
Op jsToOp(Napi::Env env, Napi::Object jsOp) {
    std::string verb = jsOp.Get("op").As<Napi::String>().Utf8Value();

    if (verb == "createNode") {
        CreateNode cn;
        cn.id = NodeId{0}; // kernel assigns
        cn.type = jsOp.Get("type").As<Napi::String>().Utf8Value();
        if (jsOp.Has("props") && jsOp.Get("props").IsObject()) {
            cn.props = jsPropsToMap(env, jsOp.Get("props").As<Napi::Object>());
        }
        return cn;
    } else if (verb == "setProperty") {
        SetProperty sp;
        sp.target = parseTarget(env, jsOp.Get("target").As<Napi::String>().Utf8Value());
        sp.key = jsOp.Get("key").As<Napi::String>().Utf8Value();
        std::string typeStr = jsOp.Get("type").As<Napi::String>().Utf8Value();
        sp.value = jsToValue(env, typeStr, jsOp.Get("value"));
        return sp;
    } else if (verb == "unsetProperty") {
        UnsetProperty up;
        up.target = parseTarget(env, jsOp.Get("target").As<Napi::String>().Utf8Value());
        up.key = jsOp.Get("key").As<Napi::String>().Utf8Value();
        return up;
    } else if (verb == "createEdge") {
        CreateEdge ce;
        ce.id = EdgeId{0}; // kernel assigns
        auto fromId = parseNodeId(jsOp.Get("from").As<Napi::String>().Utf8Value());
        auto toId = parseNodeId(jsOp.Get("to").As<Napi::String>().Utf8Value());
        if (!fromId) {
            Napi::TypeError::New(env, "Invalid 'from' node id in createEdge")
                .ThrowAsJavaScriptException();
            return Advance{0};
        }
        if (!toId) {
            Napi::TypeError::New(env, "Invalid 'to' node id in createEdge")
                .ThrowAsJavaScriptException();
            return Advance{0};
        }
        ce.from = *fromId;
        ce.to = *toId;
        ce.label = jsOp.Get("label").As<Napi::String>().Utf8Value();
        if (jsOp.Has("props") && jsOp.Get("props").IsObject()) {
            ce.props = jsPropsToMap(env, jsOp.Get("props").As<Napi::Object>());
        }
        return ce;
    } else if (verb == "deleteNode") {
        auto nid = parseNodeId(jsOp.Get("id").As<Napi::String>().Utf8Value());
        if (!nid) {
            Napi::TypeError::New(env, "Invalid node id in deleteNode")
                .ThrowAsJavaScriptException();
            return Advance{0};
        }
        return DeleteNode{*nid};
    } else if (verb == "deleteEdge") {
        auto eid = parseEdgeId(jsOp.Get("id").As<Napi::String>().Utf8Value());
        if (!eid) {
            Napi::TypeError::New(env, "Invalid edge id in deleteEdge")
                .ThrowAsJavaScriptException();
            return Advance{0};
        }
        return DeleteEdge{*eid};
    } else if (verb == "advance") {
        Advance adv;
        adv.ticks = static_cast<Tick>(jsOp.Get("ticks").As<Napi::Number>().Int64Value());
        return adv;
    }

    Napi::TypeError::New(env, "Unknown op verb: " + verb).ThrowAsJavaScriptException();
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
        if (info.Length() < 4) {
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
        for (uint32_t i = 0; i < jsOps.Length(); i++) {
            proposal.ops.push_back(jsToOp(env, jsOps.Get(i).As<Napi::Object>()));
            if (env.IsExceptionPending()) return env.Null();
        }

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

        auto seq = static_cast<CommitSeq>(info[0].As<Napi::Number>().Int64Value());
        m_kernel->replayUpTo(seq);
        return env.Undefined();
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
