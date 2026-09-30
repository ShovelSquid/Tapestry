import SwiftUI
import UIKit

// The desktop palette, taken from the nanovg calls in render/ and app/main.cpp
// so both apps read as the same workspace.
enum Theme {
    static func rgba(_ r: Int, _ g: Int, _ b: Int, _ a: Int = 255) -> UIColor {
        UIColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255,
                blue: CGFloat(b) / 255, alpha: CGFloat(a) / 255)
    }

    static let background = rgba(14, 15, 18)
    static let card = rgba(30, 33, 43, 240)
    static let cardEdge = rgba(255, 255, 255, 28)
    static let divider = rgba(255, 255, 255, 18)
    static let title = rgba(222, 229, 244, 235)
    static let body = rgba(196, 205, 224, 200)
    static let greek = rgba(196, 205, 224, 34)
    static let handleFill = rgba(222, 229, 244, 245)
    static let handleEdge = rgba(92, 112, 175, 240)
    static let ink = rgba(128, 157, 244, 220)
    static let axis = rgba(90, 130, 220, 70)
    static let originDot = rgba(110, 150, 235, 160)
    static let labelOnAxis = rgba(150, 168, 205, 120)
    static let labelPinned = rgba(150, 168, 205, 160)

    static func accent(_ kind: PageKind) -> UIColor {
        switch kind {
        case .conversation: return rgba(110, 150, 235)
        case .file: return rgba(126, 204, 158)
        case .settings: return rgba(168, 142, 235)
        case .note: return rgba(232, 196, 120)
        }
    }

    // Chrome (header, tools, menus) as SwiftUI colours.
    static let header = Color(rgba(18, 20, 27, 238))
    static let headerRule = Color(rgba(100, 115, 150, 70))
    static let headerTitle = Color(rgba(200, 210, 232, 190))
    static let menuLabel = Color(rgba(214, 221, 238, 225))
    static let toolIdle = Color(rgba(48, 54, 70, 175))
    static let toolActive = Color(rgba(92, 112, 175, 210))
    static let toolGlyph = Color(rgba(225, 231, 245, 235))
    static let readout = Color(rgba(190, 205, 235, 150))
    static let panel = Color(rgba(27, 30, 39, 250))
    static let panelEdge = Color(rgba(110, 126, 165, 100))
    static let settingsAccent = Color(rgba(168, 142, 235))
}
