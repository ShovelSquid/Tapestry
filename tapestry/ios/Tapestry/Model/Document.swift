import CoreGraphics
import Foundation

// Everything a saved workspace carries besides pages and strokes.
struct DocumentState: Equatable {
    var title = "Untitled tapestry"
    var invertScroll = false
    var panX = 0.0
    var panY = 0.0
    var zoom = 1.0
}

// The .tapestry file format, version 1 — a line-for-line port of
// core/Document.cpp so documents move freely between desktop and iOS.
//
//   tapestry 1
//   snapshot <tick>     full baseline, written once
//   ...
//   end
//   delta <tick>        only what changed since the previous version
//   ...
//   end
//
// See core/Document.hpp for the full list of block keys.
enum TapestryDocument {
    enum Failure: Error {
        case unreadable
        case notTapestry
        case writeFailed
    }

    static let magic = "tapestry 1"

    // Appends a baseline (new file) or a delta (existing file). Saving a state
    // identical to the newest version writes nothing.
    static func save(to url: URL, state: DocumentState, world: World) throws {
        var previous = Accumulated()
        if FileManager.default.fileExists(atPath: url.path) {
            guard let data = try? Data(contentsOf: url) else { throw Failure.unreadable }
            guard let acc = readAccumulated(data) else { throw Failure.notTapestry }
            previous = acc
        }

        if !previous.hasBaseline {
            var out = magic + "\n"
            writeBaseline(&out, state: state, world: world)
            do {
                try Data(out.utf8).write(to: url, options: .atomic)
            } catch {
                throw Failure.writeFailed
            }
            return
        }

        guard let delta = writeDelta(previous: previous, state: state, world: world) else {
            return // nothing changed
        }
        do {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data(delta.utf8))
        } catch {
            throw Failure.writeFailed
        }
    }

    // The newest version: baseline plus every delta, in order.
    static func load(from url: URL) throws -> (DocumentState, World) {
        guard let data = try? Data(contentsOf: url) else { throw Failure.unreadable }
        guard let acc = readAccumulated(data) else { throw Failure.notTapestry }
        var world = World()
        world.ticks = acc.ticks
        for page in acc.pages { world.adopt(page) }
        for stroke in acc.strokes { world.adoptStroke(stroke) }
        return (acc.state, world)
    }

    // MARK: - Accumulated state

    private struct Accumulated {
        var state = DocumentState()
        var pages: [Page] = []
        var strokes: [Stroke] = []
        var ticks: UInt64 = 0
        var hasBaseline = false
    }

    // Splits on '\n' bytes only, as std::getline does — a String split would
    // treat "\r\n" as one character and disagree with the desktop reader.
    private struct LineReader {
        let lines: [String]
        var index = 0

        init(_ data: Data) {
            lines = data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: false)
                .map { String(decoding: $0, as: UTF8.self) }
        }

        mutating func next() -> String? {
            guard index < lines.count else { return nil }
            defer { index += 1 }
            return lines[index]
        }
    }

    private static func readAccumulated(_ data: Data) -> Accumulated? {
        var reader = LineReader(data)
        guard reader.next() == magic else { return nil }

        var acc = Accumulated()
        while let line = reader.next() {
            let baselineTick = valueAfter(line, "snapshot").flatMap(leadingUInt)
            let deltaTick = baselineTick == nil
                ? valueAfter(line, "delta").flatMap(leadingUInt) : nil
            guard let tick = baselineTick ?? deltaTick else { continue }
            let baseline = baselineTick != nil
            if !baseline && !acc.hasBaseline { return nil }

            // Apply to a copy so a corrupt block leaves no partial changes.
            var working = acc
            guard applyBlock(&reader, tick: tick, baseline: baseline, acc: &working) else {
                break // keep every version before the first corrupt block
            }
            acc = working
            if baseline { acc.hasBaseline = true }
        }
        return acc.hasBaseline ? acc : nil
    }

    private static func applyBlock(_ reader: inout LineReader, tick: UInt64,
                                   baseline: Bool, acc: inout Accumulated) -> Bool {
        if baseline {
            acc.pages.removeAll()
            acc.strokes.removeAll()
            acc.state = DocumentState()
        }
        acc.ticks = tick

        while let line = reader.next() {
            if line == "end" { return true }

            if let value = valueAfter(line, "title") {
                acc.state.title = unescape(value)
            } else if let value = valueAfter(line, "camera") {
                let f = doubles(value)
                guard f.count >= 3 else { return false }
                acc.state.panX = f[0]
                acc.state.panY = f[1]
                acc.state.zoom = f[2]
            } else if let value = valueAfter(line, "settings") {
                let f = fields(value)
                guard f.count >= 2, f[0] == "invert", let invert = Int(f[1]) else { return false }
                acc.state.invertScroll = invert != 0
            } else if let value = valueAfter(line, "page") {
                let f = fields(value)
                guard f.count >= 7,
                      let id = UInt64(f[0]),
                      let kind = PageKind(rawValue: String(f[1])),
                      let minimized = Int(f[2]),
                      let x = Double(f[3]), let y = Double(f[4]),
                      let w = Double(f[5]), let h = Double(f[6]),
                      let titleLine = reader.next(), let title = valueAfter(titleLine, "ptitle"),
                      let bodyLine = reader.next(), let body = valueAfter(bodyLine, "pbody")
                else { return false }
                let page = Page(id: id, kind: kind, title: unescape(title), body: unescape(body),
                                rect: CGRect(x: x, y: y, width: w, height: h),
                                minimized: minimized != 0)
                // Updates in place (keeping draw order) or appends a new page.
                if let index = acc.pages.firstIndex(where: { $0.id == id }) {
                    acc.pages[index] = page
                } else {
                    acc.pages.append(page)
                }
            } else if let value = valueAfter(line, "pmove") {
                let f = fields(value)
                guard f.count >= 5, let id = UInt64(f[0]),
                      let x = Double(f[1]), let y = Double(f[2]),
                      let w = Double(f[3]), let h = Double(f[4]),
                      let index = acc.pages.firstIndex(where: { $0.id == id })
                else { return false }
                acc.pages[index].rect = CGRect(x: x, y: y, width: w, height: h)
            } else if let value = valueAfter(line, "pfold") {
                let f = fields(value)
                guard f.count >= 2, let id = UInt64(f[0]), let minimized = Int(f[1]),
                      let index = acc.pages.firstIndex(where: { $0.id == id })
                else { return false }
                acc.pages[index].minimized = minimized != 0
            } else if let value = valueAfter(line, "pname") {
                guard let parsed = idAndText(value),
                      let index = acc.pages.firstIndex(where: { $0.id == parsed.id })
                else { return false }
                acc.pages[index].title = unescape(parsed.text)
            } else if let value = valueAfter(line, "ptext") {
                guard let parsed = idAndText(value),
                      let index = acc.pages.firstIndex(where: { $0.id == parsed.id })
                else { return false }
                acc.pages[index].body = unescape(parsed.text)
            } else if let value = valueAfter(line, "drop") {
                guard let id = leadingUInt(value) else { return false }
                acc.pages.removeAll { $0.id == id }
            } else if let value = valueAfter(line, "order") {
                var reordered: [Page] = []
                for field in fields(value) {
                    guard let id = UInt64(field),
                          let page = acc.pages.first(where: { $0.id == id })
                    else { return false }
                    reordered.append(page)
                }
                guard reordered.count == acc.pages.count else { return false }
                acc.pages = reordered
            } else if let value = valueAfter(line, "strokes") {
                guard let count = leadingUInt(value) else { return false }
                var strokes: [Stroke] = []
                for _ in 0..<count {
                    guard let strokeLine = reader.next(),
                          let header = valueAfter(strokeLine, "stroke")
                    else { return false }
                    let h = fields(header)
                    guard h.count >= 2, let id = UInt64(h[0]), let pointCount = UInt64(h[1])
                    else { return false }
                    var points: [StrokePoint] = []
                    points.reserveCapacity(Int(min(pointCount, 1 << 16)))
                    for _ in 0..<pointCount {
                        guard let pointLine = reader.next(),
                              let body = valueAfter(pointLine, "spoint")
                        else { return false }
                        let p = doubles(body)
                        guard p.count >= 3 else { return false }
                        points.append(StrokePoint(position: CGPoint(x: p[0], y: p[1]),
                                                  pressure: min(max(p[2], 0), 1)))
                    }
                    strokes.append(Stroke(id: id, points: points))
                }
                acc.strokes = strokes
            } else {
                return false // unknown key — refuse rather than silently drop
            }
        }
        return false // EOF before "end"
    }

    // MARK: - Writing

    private static func writeBaseline(_ out: inout String, state: DocumentState, world: World) {
        out += "snapshot \(world.ticks)\n"
        out += "title \(escape(state.title))\n"
        writeCamera(&out, state)
        out += "settings invert \(state.invertScroll ? 1 : 0)\n"
        for page in world.pages { writePage(&out, page) }
        writeStrokes(&out, world.strokes)
        out += "end\n"
    }

    // Per-field diff against the file's newest version; nil when nothing
    // differs (including the tick).
    private static func writeDelta(previous: Accumulated, state: DocumentState,
                                   world: World) -> String? {
        var body = ""
        if state.title != previous.state.title {
            body += "title \(escape(state.title))\n"
        }
        if state.panX != previous.state.panX || state.panY != previous.state.panY
            || state.zoom != previous.state.zoom {
            writeCamera(&body, state)
        }
        if state.invertScroll != previous.state.invertScroll {
            body += "settings invert \(state.invertScroll ? 1 : 0)\n"
        }

        for page in world.pages {
            guard let before = previous.pages.first(where: { $0.id == page.id }),
                  before.kind == page.kind
            else {
                writePage(&body, page)
                continue
            }
            if before.rect != page.rect {
                body += "pmove \(page.id) \(num(page.rect.minX)) \(num(page.rect.minY)) "
                    + "\(num(page.rect.width)) \(num(page.rect.height))\n"
            }
            if before.minimized != page.minimized {
                body += "pfold \(page.id) \(page.minimized ? 1 : 0)\n"
            }
            if before.title != page.title {
                body += "pname \(page.id) \(escape(page.title))\n"
            }
            if before.body != page.body {
                body += "ptext \(page.id) \(escape(page.body))\n"
            }
        }

        for before in previous.pages where world.page(id: before.id) == nil {
            body += "drop \(before.id)\n"
        }

        if previous.pages.map(\.id) != world.pages.map(\.id) {
            body += "order " + world.pages.map { String($0.id) }.joined(separator: " ") + "\n"
        }

        if previous.strokes != world.strokes {
            writeStrokes(&body, world.strokes)
        }

        if body.isEmpty && world.ticks == previous.ticks { return nil }
        return "delta \(world.ticks)\n" + body + "end\n"
    }

    private static func writePage(_ out: inout String, _ page: Page) {
        out += "page \(page.id) \(page.kind.rawValue) \(page.minimized ? 1 : 0) "
            + "\(num(page.rect.minX)) \(num(page.rect.minY)) "
            + "\(num(page.rect.width)) \(num(page.rect.height))\n"
        out += "ptitle \(escape(page.title))\n"
        out += "pbody \(escape(page.body))\n"
    }

    private static func writeCamera(_ out: inout String, _ state: DocumentState) {
        out += "camera \(num(state.panX)) \(num(state.panY)) \(num(state.zoom))\n"
    }

    private static func writeStrokes(_ out: inout String, _ strokes: [Stroke]) {
        out += "strokes \(strokes.count)\n"
        for stroke in strokes {
            out += "stroke \(stroke.id) \(stroke.points.count)\n"
            for point in stroke.points {
                out += "spoint \(num(point.position.x)) \(num(point.position.y)) "
                    + "\(num(point.pressure))\n"
            }
        }
    }

    // MARK: - Field helpers

    // Full-precision round trip, matching the desktop's %.17g.
    private static func num(_ value: Double) -> String {
        String(format: "%.17g", value)
    }

    // Single-line strings: backslash and newline escaped.
    private static func escape(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\\": out.append(contentsOf: "\\\\".unicodeScalars)
            case "\n": out.append(contentsOf: "\\n".unicodeScalars)
            default: out.append(scalar)
            }
        }
        return String(out)
    }

    private static func unescape(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        var iterator = text.unicodeScalars.makeIterator()
        while let scalar = iterator.next() {
            if scalar == "\\", let next = iterator.next() {
                out.append(next == "n" ? "\n" : next)
            } else {
                out.append(scalar)
            }
        }
        return String(out)
    }

    // The value part of "key value", compared bytewise so a combining mark
    // after the space cannot hide the key.
    private static func valueAfter(_ line: String, _ key: String) -> String? {
        let prefix = Array((key + " ").utf8)
        guard line.utf8.starts(with: prefix) else { return nil }
        return String(decoding: line.utf8.dropFirst(prefix.count), as: UTF8.self)
    }

    private static func fields(_ value: String) -> [Substring] {
        value.split(whereSeparator: { $0 == " " || $0 == "\t" })
    }

    private static func doubles(_ value: String) -> [Double] {
        fields(value).compactMap { Double($0) }
    }

    private static func leadingUInt(_ value: String) -> UInt64? {
        fields(value).first.flatMap { UInt64($0) }
    }

    // "<id> <text>": like the desktop's "%llu %n", whitespace after the id is
    // skipped and the remainder is the (escaped) text.
    private static func idAndText(_ value: String) -> (id: UInt64, text: String)? {
        let bytes = Array(value.utf8)
        var i = 0
        while i < bytes.count, bytes[i] >= 0x30, bytes[i] <= 0x39 { i += 1 }
        guard i > 0, let id = UInt64(String(decoding: bytes[0..<i], as: UTF8.self)) else {
            return nil
        }
        while i < bytes.count, [0x20, 0x09, 0x0A, 0x0B, 0x0C, 0x0D].contains(bytes[i]) { i += 1 }
        return (id, String(decoding: bytes[i...], as: UTF8.self))
    }
}
