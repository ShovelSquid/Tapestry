import QtQuick
import QtQuick.Window
import org.kde.layershell 1.0 as LayerShell

// Full-screen, input-transparent overlay that draws the note being dragged.
Window {
    visible: true
    color: "transparent"
    flags: Qt.FramelessWindowHint | Qt.WindowTransparentForInput
    LayerShell.Window.layer: LayerShell.Window.LayerOverlay
    LayerShell.Window.anchors: LayerShell.Window.AnchorTop | LayerShell.Window.AnchorBottom
                               | LayerShell.Window.AnchorLeft | LayerShell.Window.AnchorRight
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
    LayerShell.Window.exclusionZone: -1
    LayerShell.Window.scope: "tapestry-drag-ghost"
    Rectangle {
        visible: app.ghostVisible
        x: app.ghostX - width / 2; y: app.ghostY - 20
        width: 240; height: 150; radius: 10
        color: "#f7f3d6"; opacity: 0.92
        border.color: "#2ecc71"; border.width: 2
        Text { x: 12; y: 10; text: "New note"; color: "#555"; font.pixelSize: 14 }
    }
}
