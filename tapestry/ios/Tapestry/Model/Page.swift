import CoreGraphics

// What a page is. Mirrors core/Page.hpp: kind sets the accent colour today and
// behaviour later. Raw values are the on-disk names in the .tapestry format.
enum PageKind: String, CaseIterable, Identifiable {
    case note
    case conversation
    case file
    case settings

    var id: String { rawValue }

    var label: String {
        switch self {
        case .note: return "Note"
        case .conversation: return "Conversation"
        case .file: return "File"
        case .settings: return "Settings"
        }
    }
}

// Page header layout, in world units. Shared by hit-testing and drawing, as on
// desktop, so the two cannot drift apart.
enum PageMetrics {
    static let titleBarHeight = 40.0
    static let minimizeButtonSize = 20.0
    static let minimizeButtonMargin = 10.0
    static let minimumWidth = 180.0
    static let minimumHeight = 120.0
}

enum ResizeCorner {
    case topLeft, topRight, bottomLeft, bottomRight
}

// A page in world space. 1 world unit is 1 point at 100% zoom — "real reading
// size" — exactly as on desktop.
struct Page: Identifiable, Equatable {
    var id: UInt64
    var kind: PageKind
    var title: String
    var body: String
    var rect: CGRect
    var minimized = false

    // The full rect, or just the title bar when minimized. A minimized page's
    // hidden body is not hit-testable.
    var displayRect: CGRect {
        minimized
            ? CGRect(x: rect.minX, y: rect.minY, width: rect.width,
                     height: PageMetrics.titleBarHeight)
            : rect
    }

    var minimizeButtonRect: CGRect {
        CGRect(x: rect.maxX - PageMetrics.minimizeButtonMargin - PageMetrics.minimizeButtonSize,
               y: rect.minY + (PageMetrics.titleBarHeight - PageMetrics.minimizeButtonSize) * 0.5,
               width: PageMetrics.minimizeButtonSize,
               height: PageMetrics.minimizeButtonSize)
    }

    var titleBarRect: CGRect {
        CGRect(x: rect.minX, y: rect.minY, width: rect.width,
               height: PageMetrics.titleBarHeight)
    }

    // `radius` is a world-space distance derived from a screen-space touch
    // target, so handles stay equally easy to grab at any zoom.
    func resizeCorner(at point: CGPoint, radius: Double) -> ResizeCorner? {
        guard !minimized else { return nil }
        func near(_ x: Double, _ y: Double) -> Bool {
            abs(point.x - x) <= radius && abs(point.y - y) <= radius
        }
        if near(rect.minX, rect.minY) { return .topLeft }
        if near(rect.maxX, rect.minY) { return .topRight }
        if near(rect.minX, rect.maxY) { return .bottomLeft }
        if near(rect.maxX, rect.maxY) { return .bottomRight }
        return nil
    }
}

struct StrokePoint: Equatable {
    var position: CGPoint
    var pressure: Double // normalized 0...1
}

// A vector gesture in world space; pressure is per sample so width can vary
// along the mark.
struct Stroke: Identifiable, Equatable {
    var id: UInt64
    var points: [StrokePoint]
}
