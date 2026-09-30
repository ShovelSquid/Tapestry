import UIKit

// Core Graphics port of render/Grid.cpp, render/Strokes.cpp and
// render/Pages.cpp. Typography is specified in world units and projected, so
// at 100% zoom a page reads like any other screen of text; as zoom drops the
// body greeks, then leaves only the card and its accent dot.
@MainActor
struct Renderer {
    // Page metrics, in world units.
    static let cornerRadius = 6.0
    static let padding = 16.0
    static let titleSize = 15.0
    static let bodySize = 14.0
    static let bodyLineHeight = 1.45

    // Settings rows, in world units.
    static let rowHeight = 44.0
    static let controlHeight = 30.0
    static let zoomFieldWidth = 96.0
    static let centerButtonWidth = 150.0
    static let toggleWidth = 46.0
    static let toggleHeight = 26.0

    // Projected sizes below which text is not worth drawing.
    static let minTitlePx = 5.0
    static let minBodyPx = 5.5
    static let minGreekPx = 1.6
    // Past this, glyphs are larger than any screen; laying them out would only
    // cost time (typed zoom can reach 1,000,000%).
    static let maxTextPx = 1500.0

    // Screen-space size of the drawn corner handles; touch targets are larger.
    static let handleSize = 11.0

    struct UiState {
        var selectedId: UInt64?
        var invertScroll = false
    }

    let world: World
    let camera: Camera
    let ui: UiState

    func draw(in ctx: CGContext, size: CGSize) {
        ctx.setFillColor(Theme.background.cgColor)
        ctx.fill(CGRect(origin: .zero, size: size))
        drawGrid(ctx, size)
        drawStrokes(ctx, size)
        drawPages(ctx, size)
    }

    // MARK: - Settings layout (shared with hit-testing)

    struct SettingsLayout {
        var zoomField: CGRect
        var centerButton: CGRect
        var invertToggle: CGRect
    }

    static func settingsLayout(_ page: Page) -> SettingsLayout {
        let rowStartY = page.rect.minY + PageMetrics.titleBarHeight + 12
        let controlRight = page.rect.maxX - padding
        func row(_ index: Int, _ width: Double, _ height: Double) -> CGRect {
            let rowY = rowStartY + rowHeight * Double(index)
            return CGRect(x: controlRight - width, y: rowY + (rowHeight - height) * 0.5,
                          width: width, height: height)
        }
        return SettingsLayout(zoomField: row(0, zoomFieldWidth, controlHeight),
                              centerButton: row(1, centerButtonWidth, controlHeight),
                              invertToggle: row(2, toggleWidth, toggleHeight))
    }

    static func settingsPageRect(topLeft: CGPoint) -> CGRect {
        CGRect(x: topLeft.x, y: topLeft.y, width: 320,
               height: PageMetrics.titleBarHeight + 12 + rowHeight * 3 + 16)
    }

    static func settingsControlsInteractive(zoom: Double) -> Bool {
        13.5 * zoom >= minBodyPx
    }

    // MARK: - Grid

    private static let baseSpacing = 32.0
    private static let minScreenSpacing = 14.0
    private static let maxScreenSpacing = 112.0
    private static let spacingStep = 4.0

    private func drawGrid(_ ctx: CGContext, _ size: CGSize) {
        let zoom = camera.zoom
        guard zoom > 0 else { return }

        var spacing = Self.baseSpacing
        while spacing * zoom < Self.minScreenSpacing { spacing *= Self.spacingStep }
        while spacing * zoom > Self.maxScreenSpacing { spacing /= Self.spacingStep }

        let world = camera.visibleWorldRect(size)
        let t = min(max((spacing * zoom - Self.minScreenSpacing)
                        / (Self.maxScreenSpacing - Self.minScreenSpacing), 0), 1)
        let minorAlpha = Int(10 + 26 * t)

        strokeLattice(ctx, spacing, world, size, Theme.rgba(255, 255, 255, minorAlpha))
        strokeLattice(ctx, spacing * Self.spacingStep, world, size, Theme.rgba(255, 255, 255, 30))
        strokeOrigin(ctx, size)
        drawLabels(ctx, spacing * Self.spacingStep, world, size)
    }

    private func strokeLattice(_ ctx: CGContext, _ spacing: Double, _ world: CGRect,
                               _ size: CGSize, _ color: UIColor) {
        let path = CGMutablePath()
        var wx = (world.minX / spacing).rounded(.down) * spacing
        while wx <= world.maxX {
            let sx = camera.worldToScreen(CGPoint(x: wx, y: 0)).x.rounded(.down) + 0.5
            path.move(to: CGPoint(x: sx, y: 0))
            path.addLine(to: CGPoint(x: sx, y: size.height))
            wx += spacing
        }
        var wy = (world.minY / spacing).rounded(.down) * spacing
        while wy <= world.maxY {
            let sy = camera.worldToScreen(CGPoint(x: 0, y: wy)).y.rounded(.down) + 0.5
            path.move(to: CGPoint(x: 0, y: sy))
            path.addLine(to: CGPoint(x: size.width, y: sy))
            wy += spacing
        }
        ctx.addPath(path)
        ctx.setStrokeColor(color.cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()
    }

    private func strokeOrigin(_ ctx: CGContext, _ size: CGSize) {
        let origin = camera.worldToScreen(.zero)
        let xVisible = origin.x >= 0 && origin.x <= size.width
        let yVisible = origin.y >= 0 && origin.y <= size.height
        guard xVisible || yVisible else { return }

        if xVisible {
            let sx = origin.x.rounded(.down) + 0.5
            ctx.move(to: CGPoint(x: sx, y: 0))
            ctx.addLine(to: CGPoint(x: sx, y: size.height))
        }
        if yVisible {
            let sy = origin.y.rounded(.down) + 0.5
            ctx.move(to: CGPoint(x: 0, y: sy))
            ctx.addLine(to: CGPoint(x: size.width, y: sy))
        }
        ctx.setStrokeColor(Theme.axis.cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()

        if xVisible && yVisible {
            ctx.setFillColor(Theme.originDot.cgColor)
            ctx.fillEllipse(in: CGRect(x: origin.x - 3, y: origin.y - 3, width: 6, height: 6))
        }
    }

    // Desmos-style coordinate labels: beside the axes while visible, pinned to
    // the nearest edge once they are not.
    private func drawLabels(_ ctx: CGContext, _ majorSpacing: Double, _ world: CGRect,
                            _ size: CGSize) {
        let gap = 6.0
        let edgePad = 4.0
        let origin = camera.worldToScreen(.zero)
        let xAxisOnScreen = origin.y >= 0 && origin.y <= size.height
        let yAxisOnScreen = origin.x >= 0 && origin.x <= size.width
        let rowY = min(max(origin.y + gap, edgePad), size.height - edgePad - 14)
        let colX = min(max(origin.x + gap, edgePad + 2), size.width - edgePad - 2)
        let font = UIFont.systemFont(ofSize: 11)

        var wx = (world.minX / majorSpacing).rounded(.down) * majorSpacing
        let xColor = xAxisOnScreen ? Theme.labelOnAxis : Theme.labelPinned
        while wx <= world.maxX {
            defer { wx += majorSpacing }
            if wx == 0 { continue }
            let sx = camera.worldToScreen(CGPoint(x: wx, y: 0)).x
            if sx < 14 || sx > size.width - 14 { continue }
            drawText(Self.coord(wx), font: font, color: xColor,
                     at: CGPoint(x: sx, y: rowY), align: .centerTop)
        }

        var wy = (world.minY / majorSpacing).rounded(.down) * majorSpacing
        let yColor = yAxisOnScreen ? Theme.labelOnAxis : Theme.labelPinned
        while wy <= world.maxY {
            defer { wy += majorSpacing }
            if wy == 0 { continue }
            let sy = camera.worldToScreen(CGPoint(x: 0, y: wy)).y
            if sy < 12 || sy > size.height - 12 { continue }
            drawText(Self.coord(wy), font: font, color: yColor,
                     at: CGPoint(x: colX, y: sy), align: .leftMiddle)
        }

        if xAxisOnScreen && yAxisOnScreen {
            drawText("0", font: font, color: Theme.labelOnAxis,
                     at: CGPoint(x: origin.x + gap, y: origin.y + gap), align: .leftTop)
        }
    }

    private static func coord(_ value: Double) -> String {
        abs(value - value.rounded()) < 1e-9
            ? String(format: "%.0f", value) : String(format: "%g", value)
    }

    // MARK: - Strokes

    private func drawStrokes(_ ctx: CGContext, _ size: CGSize) {
        let zoom = camera.zoom
        func width(_ pressure: Double) -> Double {
            max(0.8, (1.5 + min(max(pressure, 0), 1) * 10.5) * zoom)
        }
        let visible = camera.visibleWorldRect(size).insetBy(dx: -20 / zoom, dy: -20 / zoom)

        ctx.setStrokeColor(Theme.ink.cgColor)
        ctx.setFillColor(Theme.ink.cgColor)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        for stroke in world.strokes {
            guard let first = stroke.points.first else { continue }
            if stroke.points.count == 1 {
                let at = camera.worldToScreen(first.position)
                let r = width(first.pressure) * 0.5
                ctx.fillEllipse(in: CGRect(x: at.x - r, y: at.y - r, width: r * 2, height: r * 2))
                continue
            }
            for i in 1..<stroke.points.count {
                let a = stroke.points[i - 1]
                let b = stroke.points[i]
                // Cheap per-segment cull; long strokes mostly lie off screen
                // when zoomed in.
                if !visible.contains(a.position) && !visible.contains(b.position) { continue }
                ctx.move(to: camera.worldToScreen(a.position))
                ctx.addLine(to: camera.worldToScreen(b.position))
                ctx.setLineWidth(width((a.pressure + b.pressure) * 0.5))
                ctx.strokePath()
            }
        }
    }

    // MARK: - Pages

    private func drawPages(_ ctx: CGContext, _ size: CGSize) {
        let slack = 24 / max(camera.zoom, 1e-6)
        let visible = camera.visibleWorldRect(size).insetBy(dx: -slack, dy: -slack)
        for page in world.pages where page.displayRect.intersects(visible) {
            drawPage(ctx, page)
            if page.id == ui.selectedId {
                drawResizeHandles(ctx, page)
            }
        }
    }

    private func drawPage(_ ctx: CGContext, _ page: Page) {
        let zoom = camera.zoom
        let selected = page.id == ui.selectedId
        let card = camera.project(page.displayRect)
        let radius = Self.cornerRadius * zoom
        let accent = Theme.accent(page.kind)
        let cardPath = UIBezierPath(roundedRect: card, cornerRadius: radius).cgPath

        // Card with a soft drop shadow, so pages sit above the plane.
        let spread = max(2, 10 * zoom)
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: spread * 0.35), blur: spread,
                      color: Theme.rgba(0, 0, 0, 90).cgColor)
        ctx.addPath(cardPath)
        ctx.setFillColor(Theme.card.cgColor)
        ctx.fillPath()
        ctx.restoreGState()

        ctx.addPath(cardPath)
        ctx.setStrokeColor((selected ? accent.withAlphaComponent(200.0 / 255) : Theme.cardEdge).cgColor)
        ctx.setLineWidth(selected ? 2 : 1)
        ctx.strokePath()

        // Kind accent dot — still visible when text is not.
        let titlePx = Self.titleSize * zoom
        let dotR = max(1.5, 4 * zoom)
        let pad = Self.padding * zoom
        let titleBar = PageMetrics.titleBarHeight * zoom
        ctx.setFillColor(accent.withAlphaComponent(210.0 / 255).cgColor)
        ctx.fillEllipse(in: CGRect(x: card.minX + pad - dotR, y: card.minY + titleBar * 0.5 - dotR,
                                   width: dotR * 2, height: dotR * 2))

        if titlePx >= Self.minTitlePx && titlePx <= Self.maxTextPx && !page.title.isEmpty {
            let button = camera.project(page.minimizeButtonRect)
            let titleX = card.minX + pad + dotR * 3
            ctx.saveGState()
            ctx.clip(to: CGRect(x: titleX, y: card.minY,
                                width: max(0, button.minX - titleX), height: titleBar))
            drawText(page.title, font: .boldSystemFont(ofSize: titlePx), color: Theme.title,
                     at: CGPoint(x: titleX, y: card.minY + titleBar * 0.5), align: .leftMiddle)
            ctx.restoreGState()
        }

        drawMinimizeButton(ctx, page)
        if page.minimized { return }

        if card.height > titleBar * 1.5 {
            ctx.move(to: CGPoint(x: card.minX + pad * 0.75, y: card.minY + titleBar))
            ctx.addLine(to: CGPoint(x: card.maxX - pad * 0.75, y: card.minY + titleBar))
            ctx.setStrokeColor(Theme.divider.cgColor)
            ctx.setLineWidth(1)
            ctx.strokePath()
        }

        let bodyRect = CGRect(x: card.minX + pad, y: card.minY + titleBar + pad * 0.5,
                              width: card.width - pad * 2, height: card.height - titleBar - pad * 1.5)
        guard bodyRect.width > 0, bodyRect.height > 0 else { return }

        ctx.saveGState()
        ctx.clip(to: bodyRect)
        if page.kind == .settings {
            drawSettingsBody(ctx, page)
        } else if !page.body.isEmpty {
            let bodyPx = Self.bodySize * zoom
            if bodyPx > Self.maxTextPx {
                // Off-scale; leave the body blank.
            } else if bodyPx >= Self.minBodyPx {
                let style = NSMutableParagraphStyle()
                style.minimumLineHeight = bodyPx * Self.bodyLineHeight
                style.maximumLineHeight = bodyPx * Self.bodyLineHeight
                style.lineBreakMode = .byWordWrapping
                let text = NSAttributedString(string: page.body, attributes: [
                    .font: UIFont.systemFont(ofSize: bodyPx),
                    .foregroundColor: Theme.body,
                    .paragraphStyle: style,
                ])
                // Lay out against an unbounded height and let the clip trim,
                // matching nvgTextBox under a scissor.
                text.draw(with: CGRect(x: bodyRect.minX, y: bodyRect.minY,
                                       width: bodyRect.width, height: .greatestFiniteMagnitude),
                          options: [.usesLineFragmentOrigin], context: nil)
            } else if bodyPx >= Self.minGreekPx {
                drawGreekedBody(ctx, page.id, bodyRect, lineStep: bodyPx * Self.bodyLineHeight)
            }
        }
        ctx.restoreGState()
    }

    // Translucent bars standing in for lines of text, varied per page and line
    // so distant pages look like different documents.
    private func drawGreekedBody(_ ctx: CGContext, _ pageId: UInt64, _ rect: CGRect,
                                 lineStep: Double) {
        let barHeight = max(1, lineStep * 0.5)
        var line: UInt64 = 0
        var y = rect.minY
        while y + barHeight <= rect.maxY {
            var v = pageId &* 2_654_435_761 &+ line
            v ^= v >> 13
            let fraction = 0.55 + 0.4 * Double(v % 97) / 96
            ctx.addRect(CGRect(x: rect.minX, y: y, width: rect.width * fraction, height: barHeight))
            y += lineStep
            line += 1
        }
        ctx.setFillColor(Theme.greek.cgColor)
        ctx.fillPath()
    }

    // Minus when open, plus when minimized; strokes, not glyphs.
    private func drawMinimizeButton(_ ctx: CGContext, _ page: Page) {
        let r = camera.project(page.minimizeButtonRect)
        guard r.width >= 5 else { return }

        ctx.addPath(UIBezierPath(roundedRect: r, cornerRadius: r.width * 0.2).cgPath)
        ctx.setFillColor(Theme.rgba(255, 255, 255, 14).cgColor)
        ctx.fillPath()

        let arm = r.width * 0.28
        ctx.move(to: CGPoint(x: r.midX - arm, y: r.midY))
        ctx.addLine(to: CGPoint(x: r.midX + arm, y: r.midY))
        if page.minimized {
            ctx.move(to: CGPoint(x: r.midX, y: r.midY - arm))
            ctx.addLine(to: CGPoint(x: r.midX, y: r.midY + arm))
        }
        ctx.setStrokeColor(Theme.rgba(196, 205, 224, 180).cgColor)
        ctx.setLineWidth(max(1, r.width * 0.09))
        ctx.setLineCap(.butt)
        ctx.strokePath()
    }

    private func drawControlChrome(_ ctx: CGContext, _ r: CGRect, radius: Double) {
        let path = UIBezierPath(roundedRect: r, cornerRadius: radius).cgPath
        ctx.addPath(path)
        ctx.setFillColor(Theme.rgba(255, 255, 255, 14).cgColor)
        ctx.fillPath()
        ctx.addPath(path)
        ctx.setStrokeColor(Theme.rgba(255, 255, 255, 34).cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()
    }

    // Zoom, center-at-origin, invert-scroll — all in world units so the page
    // scales like any other.
    private func drawSettingsBody(_ ctx: CGContext, _ page: Page) {
        let zoom = camera.zoom
        guard Self.settingsControlsInteractive(zoom: zoom), 13.5 * zoom <= Self.maxTextPx else { return }

        let layout = Self.settingsLayout(page)
        let radius = 4 * zoom
        let labelFont = UIFont.systemFont(ofSize: 13.5 * zoom)
        let labelX = camera.worldToScreen(CGPoint(x: page.rect.minX + Self.padding, y: 0)).x
        let rows: [(String, CGRect)] = [("Zoom", layout.zoomField),
                                        ("View", layout.centerButton),
                                        ("Invert scroll", layout.invertToggle)]
        for (label, control) in rows {
            drawText(label, font: labelFont, color: Theme.body,
                     at: CGPoint(x: labelX, y: camera.project(control).midY), align: .leftMiddle)
        }

        let valueColor = Theme.rgba(222, 229, 244, 230)
        let zoomField = camera.project(layout.zoomField)
        drawControlChrome(ctx, zoomField, radius: radius)
        drawText(String(format: "%g%%", zoom * 100), font: labelFont, color: valueColor,
                 at: CGPoint(x: zoomField.midX, y: zoomField.midY), align: .centerMiddle)

        let center = camera.project(layout.centerButton)
        drawControlChrome(ctx, center, radius: radius)
        drawText("Center at origin", font: labelFont, color: valueColor,
                 at: CGPoint(x: center.midX, y: center.midY), align: .centerMiddle)

        let toggle = camera.project(layout.invertToggle)
        let pill = toggle.height * 0.5
        let pillPath = UIBezierPath(roundedRect: toggle, cornerRadius: pill).cgPath
        ctx.addPath(pillPath)
        ctx.setFillColor((ui.invertScroll ? Theme.rgba(168, 142, 235, 120)
                                          : Theme.rgba(255, 255, 255, 18)).cgColor)
        ctx.fillPath()
        ctx.addPath(pillPath)
        ctx.setStrokeColor(Theme.rgba(255, 255, 255, 34).cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()

        let knobR = pill * 0.72
        let knobX = ui.invertScroll ? toggle.maxX - pill : toggle.minX + pill
        ctx.setFillColor((ui.invertScroll ? Theme.rgba(222, 229, 244, 235)
                                          : Theme.rgba(196, 205, 224, 160)).cgColor)
        ctx.fillEllipse(in: CGRect(x: knobX - knobR, y: toggle.minY + pill - knobR,
                                   width: knobR * 2, height: knobR * 2))
    }

    private func drawResizeHandles(_ ctx: CGContext, _ page: Page) {
        guard !page.minimized else { return }
        let card = camera.project(page.rect)
        let half = Self.handleSize * 0.5
        for point in [CGPoint(x: card.minX, y: card.minY), CGPoint(x: card.maxX, y: card.minY),
                      CGPoint(x: card.minX, y: card.maxY), CGPoint(x: card.maxX, y: card.maxY)] {
            let r = CGRect(x: point.x - half, y: point.y - half,
                           width: Self.handleSize, height: Self.handleSize)
            let path = UIBezierPath(roundedRect: r, cornerRadius: 2.5).cgPath
            ctx.addPath(path)
            ctx.setFillColor(Theme.handleFill.cgColor)
            ctx.fillPath()
            ctx.addPath(path)
            ctx.setStrokeColor(Theme.handleEdge.cgColor)
            ctx.setLineWidth(1.5)
            ctx.strokePath()
        }
    }

    // MARK: - Text

    enum Align { case leftTop, leftMiddle, centerTop, centerMiddle }

    private func drawText(_ text: String, font: UIFont, color: UIColor, at point: CGPoint,
                          align: Align) {
        let string = NSAttributedString(string: text, attributes: [
            .font: font, .foregroundColor: color,
        ])
        let size = string.size()
        var origin = point
        switch align {
        case .leftTop: break
        case .leftMiddle: origin.y -= size.height * 0.5
        case .centerTop: origin.x -= size.width * 0.5
        case .centerMiddle:
            origin.x -= size.width * 0.5
            origin.y -= size.height * 0.5
        }
        string.draw(at: origin)
    }
}
