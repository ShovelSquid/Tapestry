import QtQuick
import QtQuick.Window
import QtQuick.Controls
import org.kde.layershell 1.0 as LayerShell

// Edge tab: a small layer-shell surface anchored bottom-centre. Its whole area is the
// "hover strip": entering it makes the tab peek out; hovering the tab makes it a button.
// Pressing and dragging pulls a note out; while the button is held, Wayland keeps
// sending pointer events to this surface (implicit grab), even outside its bounds.
Window {
    id: tabWin
    visible: true
    width: 260; height: 70
    color: "transparent"
    flags: Qt.FramelessWindowHint
    LayerShell.Window.layer: LayerShell.Window.LayerTop
    LayerShell.Window.anchors: LayerShell.Window.AnchorBottom
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
    LayerShell.Window.exclusionZone: -1
    LayerShell.Window.scope: "tapestry-edge-tab"

    property bool near: strip.containsMouse
    property bool overTab: false
    property bool dragging: false

    MouseArea {
        id: strip
        anchors.fill: parent
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton
        onContainsMouseChanged: app.log("strip.hover", {inside: containsMouse})
        onPositionChanged: (m) => {
            const p = tab.mapFromItem(strip, m.x, m.y)
            tabWin.overTab = tab.contains(p) || tabWin.dragging
            if (tabWin.dragging) app.dragMove(m.x, m.y)
        }
        onPressed: (m) => {
            if (!tab.contains(tab.mapFromItem(strip, m.x, m.y))) { m.accepted = false; return }
            tabWin.dragging = true
            app.dragStart(m.x, m.y)
        }
        onReleased: (m) => {
            if (!tabWin.dragging) return
            tabWin.dragging = false
            app.dragEnd(m.x, m.y)
        }
    }

    // Idle sliver -> peek -> button.
    Rectangle {
        id: tab
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: tabWin.overTab ? 10 : (tabWin.near ? 6 : 2)
        width: tabWin.overTab ? 150 : (tabWin.near ? 90 : 56)
        height: tabWin.overTab ? 40 : (tabWin.near ? 18 : 6)
        radius: height / 2
        color: tabWin.overTab ? "#2ecc71" : (tabWin.near ? "#cc2ecc71" : "#882ecc71")
        Behavior on width { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
        Behavior on height { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
        Behavior on anchors.bottomMargin { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
        Behavior on color { ColorAnimation { duration: 140 } }
        Text {
            anchors.centerIn: parent
            visible: tabWin.overTab
            text: tabWin.dragging ? "drop anywhere" : "+  new note"
            color: "white"; font.bold: true; font.pixelSize: 15
        }
        Text {
            anchors.centerIn: parent
            visible: tabWin.near && !tabWin.overTab
            text: "+"; color: "white"; font.bold: true; font.pixelSize: 14
        }
    }
}
