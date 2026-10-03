import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import org.kde.layershell 1.0 as LayerShell

// A placed note: layer-shell "top" surface at the drop point. It takes the keyboard
// only when clicked (on-demand), so typing elsewhere is never stolen.
Window {
    id: noteWin
    visible: true
    width: 240; height: 150
    color: "transparent"
    flags: Qt.FramelessWindowHint
    LayerShell.Window.layer: LayerShell.Window.LayerTop
    LayerShell.Window.anchors: LayerShell.Window.AnchorTop | LayerShell.Window.AnchorLeft
    LayerShell.Window.margins.left: NOTE_X
    LayerShell.Window.margins.top: NOTE_Y
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityOnDemand
    LayerShell.Window.exclusionZone: -1
    LayerShell.Window.scope: "tapestry-note"
    Rectangle {
        anchors.fill: parent; radius: 10
        color: "#f7f3d6"; border.color: "#2ecc71"; border.width: 2
        ColumnLayout {
            anchors.fill: parent; anchors.margins: 10; spacing: 6
            Text { text: "On: " + "NOTE_ON"; color: "#777"; font.pixelSize: 11; elide: Text.ElideRight
                   Layout.fillWidth: true }
            TextArea {
                id: body
                Layout.fillWidth: true; Layout.fillHeight: true
                placeholderText: "Write anything…"
                wrapMode: TextEdit.Wrap
                color: "#222"; font.pixelSize: 14
                background: null
                Component.onCompleted: forceActiveFocus()
            }
            RowLayout {
                Layout.alignment: Qt.AlignRight
                Button { text: "Discard"; onClicked: app.closeNote(NOTE_ID, "", false) }
                Button { text: "Save"; highlighted: true; onClicked: app.closeNote(NOTE_ID, body.text, true) }
            }
        }
    }
}
