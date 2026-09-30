import Combine
import SwiftUI
import UIKit

// The workspace canvas: draws through Renderer and turns touches into the
// desktop's drag modes. One finger follows the active tool (the desktop's
// mouse); two fingers always pan and pinch-zoom, whatever the tool.
final class CanvasView: UIView, UIGestureRecognizerDelegate {
    // Screen-space constants, in points.
    private static let dragDeadZone = 6.0      // desktop uses 3 px; fingers wobble more
    private static let handleTouchRadius = 22.0
    private static let doubleTapInterval = 0.3
    private static let doubleTapDistance = 30.0
    private static let fingerPressure = 0.55   // desktop's mouse fallback
    private static let zoomToolTapFactor = 1.5
    private static let zoomToolDragRate = 0.01

    let workspace: Workspace
    private var observation: AnyCancellable?

    private enum Drag {
        case idle
        case pan
        case page(id: UInt64, grab: CGPoint)
        case resize(id: UInt64, corner: ResizeCorner, fixed: CGPoint)
        case zoom(anchor: CGPoint, lastY: CGFloat)
        case brush(strokeId: UInt64)
    }

    // The one touch driving `drag`. Further fingers belong to the recognizers.
    private var trackedTouch: UITouch?
    private var drag = Drag.idle
    private var touchStart = CGPoint.zero
    private var lastPoint = CGPoint.zero
    private var touchStartTime: TimeInterval = 0
    private var moved = false
    private var wasSelectedAtStart = false

    private var lastTapTime: TimeInterval = 0
    private var lastTapPoint = CGPoint(x: -1000, y: -1000)

    init(workspace: Workspace) {
        self.workspace = workspace
        super.init(frame: .zero)
        backgroundColor = Theme.background
        isOpaque = true
        contentMode = .redraw
        isMultipleTouchEnabled = true

        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        pinch.delegate = self
        addGestureRecognizer(pinch)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleTwoFingerPan(_:)))
        pan.minimumNumberOfTouches = 2
        pan.allowedScrollTypesMask = .all // trackpad / mouse-wheel scrolling on iPad
        pan.delegate = self
        addGestureRecognizer(pan)

        // Redraw whenever anything the renderer reads changes. objectWillChange
        // fires before the mutation, but the draw it schedules runs after.
        observation = workspace.objectWillChange.sink { [weak self] _ in
            self?.setNeedsDisplay()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        updateViewport()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        updateViewport()
    }

    private func updateViewport() {
        workspace.viewSize = bounds.size
        let compact = traitCollection.horizontalSizeClass == .compact
        workspace.chromeInsets = UIEdgeInsets(
            top: safeAreaInsets.top + ChromeMetrics.headerHeight,
            left: safeAreaInsets.left,
            bottom: safeAreaInsets.bottom + (compact ? ChromeMetrics.paletteClearance : 0),
            right: safeAreaInsets.right)
        // Deferred: layout can run inside a SwiftUI update, where publishing
        // camera changes (initial framing) is not allowed.
        Task { @MainActor [workspace] in workspace.canvasDidLayout() }
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let renderer = Renderer(world: workspace.world, camera: workspace.camera,
                                ui: .init(selectedId: workspace.selectedId,
                                          invertScroll: workspace.invertScroll))
        renderer.draw(in: ctx, size: bounds.size)
    }

    // MARK: - Two-finger navigation

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func handlePinch(_ pinch: UIPinchGestureRecognizer) {
        guard pinch.state == .began || pinch.state == .changed else { return }
        workspace.camera.scale(by: pinch.scale, at: pinch.location(in: self))
        pinch.scale = 1
    }

    @objc private func handleTwoFingerPan(_ pan: UIPanGestureRecognizer) {
        guard pan.state == .began || pan.state == .changed else { return }
        let t = pan.translation(in: self)
        let sign = workspace.invertScroll ? -1.0 : 1.0
        workspace.camera.panBy(t.x * sign, t.y * sign)
        pan.setTranslation(.zero, in: self)
    }

    // MARK: - One-finger tools

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard trackedTouch == nil, let touch = touches.first else { return }
        trackedTouch = touch
        let point = touch.location(in: self)
        touchStart = point
        lastPoint = point
        touchStartTime = touch.timestamp
        moved = false
        wasSelectedAtStart = false
        beginDrag(at: point, touch: touch)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = trackedTouch, touches.contains(touch) else { return }
        let point = touch.location(in: self)
        if !moved && hypot(point.x - touchStart.x, point.y - touchStart.y) > Self.dragDeadZone {
            moved = true
        }

        switch drag {
        case .brush(let strokeId):
            // Coalesced touches keep fast Pencil strokes smooth.
            for sample in event?.coalescedTouches(for: touch) ?? [touch] {
                let world = workspace.camera.screenToWorld(sample.location(in: self))
                workspace.world.appendStrokePoint(id: strokeId,
                    StrokePoint(position: world, pressure: pressure(of: sample)))
            }
        case _ where !moved:
            break // inside the dead zone: still a tap
        case .pan:
            workspace.camera.panBy(point.x - lastPoint.x, point.y - lastPoint.y)
        case .page(let id, let grab):
            let world = workspace.camera.screenToWorld(point)
            workspace.world.updatePage(id: id) {
                $0.rect.origin = CGPoint(x: world.x - grab.x, y: world.y - grab.y)
            }
        case .resize(let id, let corner, let fixed):
            let world = workspace.camera.screenToWorld(point)
            workspace.world.updatePage(id: id) {
                $0.rect = Self.resized(corner: corner, fixed: fixed, to: world)
            }
        case .zoom(let anchor, let lastY):
            // Drag up to zoom in, down to zoom out, pinned at the touch-down point.
            workspace.camera.scale(by: exp(Double(lastY - point.y) * Self.zoomToolDragRate), at: anchor)
            drag = .zoom(anchor: anchor, lastY: point.y)
        case .idle:
            break
        }
        lastPoint = point
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = trackedTouch, touches.contains(touch) else { return }
        let point = touch.location(in: self)
        if !moved {
            handleTap(at: point, timestamp: touch.timestamp)
        }
        trackedTouch = nil
        drag = .idle
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = trackedTouch, touches.contains(touch) else { return }
        // A second finger arrived (the recognizers took over). A stroke that
        // began a moment ago was the first finger of a pinch, not a mark.
        if case .brush(let strokeId) = drag, touch.timestamp - touchStartTime < 0.3 {
            workspace.world.removeStroke(id: strokeId)
        }
        trackedTouch = nil
        drag = .idle
    }

    private func beginDrag(at point: CGPoint, touch: UITouch) {
        let camera = workspace.camera
        let world = camera.screenToWorld(point)

        switch workspace.tool {
        case .hand:
            drag = .pan
        case .zoom:
            drag = .zoom(anchor: point, lastY: point.y)
        case .brush:
            let id = workspace.world.beginStroke(StrokePoint(position: world, pressure: pressure(of: touch)))
            drag = .brush(strokeId: id)
        case .select:
            // Corner handles of the selected page win over whatever is beneath.
            if let id = workspace.selectedId, let page = workspace.world.page(id: id),
               let corner = page.resizeCorner(at: world, radius: Self.handleTouchRadius / camera.zoom) {
                drag = .resize(id: id, corner: corner, fixed: Self.opposite(corner, of: page.rect))
                wasSelectedAtStart = true
                return
            }
            if let index = workspace.world.pageIndex(at: world) {
                let page = workspace.world.pages[index]
                wasSelectedAtStart = workspace.selectedId == page.id
                workspace.world.bringToFront(id: page.id)
                workspace.selectedId = page.id
                drag = .page(id: page.id, grab: CGPoint(x: world.x - page.rect.minX,
                                                        y: world.y - page.rect.minY))
            } else {
                drag = .pan
            }
        }
    }

    private func handleTap(at point: CGPoint, timestamp: TimeInterval) {
        let isDoubleTap = timestamp - lastTapTime < Self.doubleTapInterval
            && hypot(point.x - lastTapPoint.x, point.y - lastTapPoint.y) < Self.doubleTapDistance
        lastTapTime = isDoubleTap ? 0 : timestamp
        lastTapPoint = point

        let world = workspace.camera.screenToWorld(point)
        switch drag {
        case .zoom:
            workspace.camera.scale(by: Self.zoomToolTapFactor, at: point)
        case .pan where workspace.tool == .select:
            // Empty space: a tap deselects, a double tap makes a note.
            workspace.selectedId = nil
            if isDoubleTap {
                workspace.createNote(atScreen: point)
            }
        case .page(let id, _):
            tapPage(id, at: world)
        default:
            break
        }
    }

    // Routes a tap on a page: minimize button, then settings controls, then —
    // for a page that was already selected — the text editor.
    private func tapPage(_ id: UInt64, at world: CGPoint) {
        guard let page = workspace.world.page(id: id) else { return }

        if page.minimizeButtonRect.contains(world) {
            workspace.world.updatePage(id: id) { $0.minimized.toggle() }
            return
        }

        if page.kind == .settings && !page.minimized
            && Renderer.settingsControlsInteractive(zoom: workspace.camera.zoom) {
            let layout = Renderer.settingsLayout(page)
            let slop = 6 / workspace.camera.zoom // forgiving touch targets
            if layout.zoomField.insetBy(dx: -slop, dy: -slop).contains(world) {
                workspace.isEditingZoom = true
                return
            }
            if layout.centerButton.insetBy(dx: -slop, dy: -slop).contains(world) {
                workspace.centerAtOrigin()
                return
            }
            if layout.invertToggle.insetBy(dx: -slop, dy: -slop).contains(world) {
                workspace.invertScroll.toggle()
                return
            }
        }

        guard wasSelectedAtStart else { return } // first tap only selects
        let inTitle = world.y < page.rect.minY + PageMetrics.titleBarHeight
        workspace.edit(id, field: inTitle || page.kind == .settings ? .title : .body)
    }

    private func pressure(of touch: UITouch) -> Double {
        guard touch.type == .pencil, touch.maximumPossibleForce > 0 else {
            return Self.fingerPressure
        }
        return min(max(Double(touch.force / touch.maximumPossibleForce), 0), 1)
    }

    // MARK: - Resize geometry

    private static func opposite(_ corner: ResizeCorner, of rect: CGRect) -> CGPoint {
        switch corner {
        case .topLeft: return CGPoint(x: rect.maxX, y: rect.maxY)
        case .topRight: return CGPoint(x: rect.minX, y: rect.maxY)
        case .bottomLeft: return CGPoint(x: rect.maxX, y: rect.minY)
        case .bottomRight: return CGPoint(x: rect.minX, y: rect.minY)
        }
    }

    // The dragged corner follows the touch; the opposite corner stays put, and
    // the page never shrinks below the desktop's minimum size.
    private static func resized(corner: ResizeCorner, fixed: CGPoint, to p: CGPoint) -> CGRect {
        let minW = PageMetrics.minimumWidth
        let minH = PageMetrics.minimumHeight
        let left = corner == .topLeft || corner == .bottomLeft
        let top = corner == .topLeft || corner == .topRight
        let x0 = left ? min(p.x, fixed.x - minW) : fixed.x
        let x1 = left ? fixed.x : max(p.x, fixed.x + minW)
        let y0 = top ? min(p.y, fixed.y - minH) : fixed.y
        let y1 = top ? fixed.y : max(p.y, fixed.y + minH)
        return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
    }
}

// Screen-space chrome sizes the canvas needs to keep content clear of.
enum ChromeMetrics {
    static let headerHeight = 44.0
    static let paletteClearance = 68.0
}

struct CanvasRepresentable: UIViewRepresentable {
    let workspace: Workspace

    func makeUIView(context: Context) -> CanvasView {
        CanvasView(workspace: workspace)
    }

    func updateUIView(_ view: CanvasView, context: Context) {
        view.setNeedsDisplay()
    }
}
