import QtQuick
import QtQuick.Window
import org.kde.layershell 1.0 as LayerShell

// Full-screen, transparent, input-transparent overlay on the layer-shell "overlay" layer.
Window {
    id: win
    visible: true
    color: "transparent"
    flags: Qt.FramelessWindowHint | Qt.WindowTransparentForInput
    LayerShell.Window.layer: LayerShell.Window.LayerOverlay
    LayerShell.Window.anchors: LayerShell.Window.AnchorTop | LayerShell.Window.AnchorBottom
                               | LayerShell.Window.AnchorLeft | LayerShell.Window.AnchorRight
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
    LayerShell.Window.exclusionZone: -1
    LayerShell.Window.scope: "tapestry-guide"

    Repeater {
        model: guide.targets          // [{x, y, w, h, label, step}]
        delegate: Item {
            x: modelData.x - 10; y: modelData.y - 10
            width: modelData.w + 20; height: modelData.h + 20
            Rectangle {
                id: ring
                anchors.centerIn: parent
                // Circle for small, square-ish targets; pill for wide ones (menu items).
                property bool round: modelData.w < modelData.h * 1.8
                width: round ? Math.max(parent.width, parent.height) : parent.width
                height: round ? width : parent.height
                radius: round ? width / 2 : height / 2
                color: "transparent"
                border.color: "#2ecc71"; border.width: 4
                SequentialAnimation on scale {
                    loops: Animation.Infinite
                    NumberAnimation { from: 1.0; to: 1.12; duration: 600; easing.type: Easing.InOutQuad }
                    NumberAnimation { from: 1.12; to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
                }
            }
            Rectangle {
                anchors.top: ring.bottom; anchors.topMargin: 6
                anchors.horizontalCenter: parent.horizontalCenter
                color: "#2ecc71"; radius: 6
                width: lbl.implicitWidth + 16; height: lbl.implicitHeight + 8
                Text { id: lbl; anchors.centerIn: parent; color: "white"; font.bold: true
                       text: modelData.step + ". " + modelData.label }
            }
        }
    }
}
