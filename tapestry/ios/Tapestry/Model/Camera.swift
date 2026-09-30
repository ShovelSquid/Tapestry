import CoreGraphics

// The window onto the world: screen = world * zoom + pan. A port of
// core/Camera.{hpp,cpp}; view state only, never part of the model.
struct Camera: Equatable {
    // Interactive zoom band. setZoom may leave it; pinching from outside the
    // band walks back gradually instead of snapping.
    static let minZoom = 0.05
    static let maxZoom = 6.0
    static let absoluteMinZoom = 1e-6
    static let absoluteMaxZoom = 1e6

    var pan = CGPoint.zero
    var zoom = 1.0

    func screenToWorld(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom)
    }

    func worldToScreen(_ p: CGPoint) -> CGPoint {
        CGPoint(x: p.x * zoom + pan.x, y: p.y * zoom + pan.y)
    }

    func project(_ rect: CGRect) -> CGRect {
        let origin = worldToScreen(rect.origin)
        return CGRect(x: origin.x, y: origin.y,
                      width: rect.width * zoom, height: rect.height * zoom)
    }

    func visibleWorldRect(_ size: CGSize) -> CGRect {
        let topLeft = screenToWorld(.zero)
        let bottomRight = screenToWorld(CGPoint(x: size.width, y: size.height))
        return CGRect(x: topLeft.x, y: topLeft.y,
                      width: bottomRight.x - topLeft.x,
                      height: bottomRight.y - topLeft.y)
    }

    mutating func panBy(_ dx: Double, _ dy: Double) {
        pan.x += dx
        pan.y += dy
    }

    // Zooms about a screen point, keeping the world point under it pinned.
    mutating func scale(by factor: Double, at anchor: CGPoint) {
        let lo = min(Self.minZoom, zoom)
        let hi = max(Self.maxZoom, zoom)
        let target = min(max(zoom * factor, lo), hi)
        apply(target / zoom, at: anchor)
        zoom = target
    }

    mutating func setZoom(_ value: Double, at anchor: CGPoint) {
        let target = min(max(value, Self.absoluteMinZoom), Self.absoluteMaxZoom)
        apply(target / zoom, at: anchor)
        zoom = target
    }

    private mutating func apply(_ applied: Double, at anchor: CGPoint) {
        pan.x = anchor.x - (anchor.x - pan.x) * applied
        pan.y = anchor.y - (anchor.y - pan.y) * applied
    }

    // Pans so a world point sits at the centre of `viewport`.
    mutating func center(on world: CGPoint, in viewport: CGRect) {
        pan.x = viewport.midX - world.x * zoom
        pan.y = viewport.midY - world.y * zoom
    }

    // Fits a world rect inside `viewport` (screen space) with a margin.
    mutating func frame(_ world: CGRect, in viewport: CGRect, margin: Double) {
        let availW = max(1, viewport.width - margin * 2)
        let availH = max(1, viewport.height - margin * 2)
        let fit = min(availW / max(1e-6, world.width), availH / max(1e-6, world.height))
        zoom = min(max(fit, Self.minZoom), Self.maxZoom)
        center(on: CGPoint(x: world.midX, y: world.midY), in: viewport)
    }
}
