import CoreGraphics

// The model: every page in draw order (index 0 furthest back) plus vector
// strokes. A port of core/World.{hpp,cpp}.
struct World: Equatable {
    private(set) var pages: [Page] = []
    private(set) var strokes: [Stroke] = []
    private var nextId: UInt64 = 1
    private var nextStrokeId: UInt64 = 1
    var ticks: UInt64 = 0

    var isEmpty: Bool { pages.isEmpty && strokes.isEmpty }

    @discardableResult
    mutating func addPage(kind: PageKind, title: String, body: String, rect: CGRect) -> UInt64 {
        let page = Page(id: nextId, kind: kind, title: title, body: body, rect: rect)
        nextId += 1
        pages.append(page)
        return page.id
    }

    // Topmost page whose display rect contains the point.
    func pageIndex(at point: CGPoint) -> Int? {
        pages.lastIndex { $0.displayRect.contains(point) }
    }

    func pageIndex(id: UInt64) -> Int? {
        pages.firstIndex { $0.id == id }
    }

    func page(id: UInt64) -> Page? {
        pageIndex(id: id).map { pages[$0] }
    }

    mutating func updatePage(id: UInt64, _ change: (inout Page) -> Void) {
        guard let index = pageIndex(id: id) else { return }
        change(&pages[index])
    }

    mutating func removePage(id: UInt64) {
        pages.removeAll { $0.id == id }
    }

    // Moves one page to the top while keeping everyone else's relative order.
    mutating func bringToFront(id: UInt64) {
        guard let index = pageIndex(id: id), index != pages.count - 1 else { return }
        let page = pages.remove(at: index)
        pages.append(page)
    }

    mutating func beginStroke(_ first: StrokePoint) -> UInt64 {
        let stroke = Stroke(id: nextStrokeId, points: [first])
        nextStrokeId += 1
        strokes.append(stroke)
        return stroke.id
    }

    mutating func appendStrokePoint(id: UInt64, _ point: StrokePoint) {
        // The live stroke is almost always last; search from the end.
        guard let index = strokes.lastIndex(where: { $0.id == id }) else { return }
        strokes[index].points.append(point)
    }

    mutating func removeStroke(id: UInt64) {
        strokes.removeAll { $0.id == id }
    }

    mutating func removeAllStrokes() {
        strokes.removeAll()
    }

    // Union of every page's display rect and every stroke sample; nil when
    // there is nothing to frame.
    var contentBounds: CGRect? {
        var bounds: CGRect?
        func include(_ rect: CGRect) {
            bounds = bounds.map { $0.union(rect) } ?? rect
        }
        for page in pages { include(page.displayRect) }
        for stroke in strokes {
            for point in stroke.points {
                include(CGRect(x: point.position.x, y: point.position.y,
                               width: 0.001, height: 0.001))
            }
        }
        return bounds
    }

    // Deserialization: keep saved ids and move the counters past them.
    mutating func adopt(_ page: Page) {
        nextId = max(nextId, page.id + 1)
        pages.append(page)
    }

    mutating func adoptStroke(_ stroke: Stroke) {
        nextStrokeId = max(nextStrokeId, stroke.id + 1)
        strokes.append(stroke)
    }
}
