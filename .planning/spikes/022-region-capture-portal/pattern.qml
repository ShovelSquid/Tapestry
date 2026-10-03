import QtQuick
import QtQuick.Window
import org.kde.layershell 1.0 as LayerShell

// A 200x100 logical test card at a known position: 4 solid quadrants + 2px white border.
Window {
    visible: true
    width: 200; height: 100
    color: "white"
    flags: Qt.FramelessWindowHint | Qt.WindowTransparentForInput
    LayerShell.Window.layer: LayerShell.Window.LayerOverlay
    LayerShell.Window.anchors: LayerShell.Window.AnchorTop | LayerShell.Window.AnchorLeft
    LayerShell.Window.margins.left: X
    LayerShell.Window.margins.top: Y
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
    LayerShell.Window.exclusionZone: -1
    LayerShell.Window.scope: "tapestry-capture-test"
    Grid {
        x: 2; y: 2; columns: 2
        Rectangle { width: 98; height: 48; color: "#ff0000" }
        Rectangle { width: 98; height: 48; color: "#00ff00" }
        Rectangle { width: 98; height: 48; color: "#0000ff" }
        Rectangle { width: 98; height: 48; color: "#ff00ff" }
    }
}
