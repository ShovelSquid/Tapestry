"""Spike 021: point at a named control in a running app with a green circle.

Usage: python3 guide.py <app-substring> "<control name>" [--seconds N] [--log results/run.json]

1. AT-SPI: find the app, find the control by name, and build the path of
   ancestors that must be opened (e.g. File -> Save As...).
2. KWin script: get the app window's client geometry (matched by pid), because
   on Wayland AT-SPI screen coordinates are only window-relative.
3. Layer-shell overlay: draw a pulsing green ring over the first step that is
   showing; re-resolve every 250 ms so it follows the menu as it opens.
"""
import sys, json, time, argparse, datetime, os
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
from PyQt6.QtCore import QObject, pyqtProperty, pyqtSignal, QTimer, QUrl
from PyQt6.QtGui import QGuiApplication, QRegion
from PyQt6.QtQml import QQmlApplicationEngine
from probe_tree import walk, find_app
from kwin_query import query as kwin_query
import dbus, dbus.service

LOG = []
def log(cat, **kw):
    LOG.append({'t': datetime.datetime.now().isoformat(timespec='milliseconds'), 'cat': cat, **kw})
    print(cat, kw, flush=True)

def showing(n):
    s = n.get_state_set()
    return s.contains(Atspi.StateType.SHOWING) and s.contains(Atspi.StateType.VISIBLE)

def find_path(app, name):
    """Return [ancestor menu items..., target] for the best match."""
    best = None
    for node, depth, path in walk(app):
        try:
            if (node.get_name() or '').strip().lower() == name.strip().lower():
                best = node; break
        except Exception:
            pass
    if best is None:
        return None
    chain, n = [best], best.get_parent()
    while n is not None and n.get_role_name() not in ('frame', 'application'):
        if n.get_role_name() in ('menu item', 'menu') and (n.get_name() or ''):
            chain.append(n)
        n = n.get_parent()
    return list(reversed(chain))

class Guide(QObject):
    targetsChanged = pyqtSignal()
    def __init__(self, app_sub, name):
        super().__init__()
        self._targets, self.app_sub, self.name, self.events = [], app_sub, name, 0
        self.app = find_app(app_sub)
        if not self.app:
            log('error', msg='app not in AT-SPI tree', app=app_sub); sys.exit(2)
        self.pid = self.app.get_process_id()
        t0 = time.time()
        self.chain = find_path(self.app, name)
        log('atspi.path', ms=round((time.time()-t0)*1000),
            path=[c.get_name() for c in self.chain] if self.chain else None)
        if not self.chain:
            sys.exit(3)
        self.refresh_window()

    def refresh_window(self):
        t0 = time.time()
        wins = [w for w in (kwin_query('kwin_windows.js') or []) if w['pid'] == self.pid and w['caption']]
        here = [w for w in wins if w['onCurrent'] and not w['minimized']]
        self.client = here[0]['client'] if here else None
        log('kwin.window', ms=round((time.time()-t0)*1000), client=self.client,
            elsewhere=[w['desktops'] for w in wins if w not in here])
        if wins and not here:
            log('guide.notice', msg='%s is open on another desktop: %s' % (self.app_sub, wins[0]['desktops']))

    def on_kwin_event(self, ev):
        w = ev.get('window')
        if not w or w['pid'] != self.pid or not w['caption']:
            return
        self.events += 1
        if self.events <= 3 or ev['kind'] != 'geometry':
            log('kwin.event', kind=ev['kind'], client=w['client'], onCurrent=w['onCurrent'])
        old = self.client
        self.client = w['client'] if (w['onCurrent'] and not w['minimized']) else None
        if self.client != old:
            log('kwin.push', kind=ev['kind'], client=self.client)
            self.tick()

    @pyqtProperty('QVariantList', notify=targetsChanged)
    def targets(self): return self._targets

    def set_targets(self, new):
        if new != self._targets:
            self._targets = new
            log('overlay.target', targets=new)
            self.targetsChanged.emit()

    def tick(self):
        if not self.client:
            # Window minimised or on another desktop: the overlay belongs to the
            # screen, not a desktop, so hiding means clearing the targets.
            self.set_targets([]); return
        # The deepest showing step is where the user should click next.
        step = None
        for i, node in enumerate(self.chain):
            try:
                if showing(node):
                    step = (i, node)
            except Exception:
                pass
        if step is None:
            new = []
        else:
            i, node = step
            e = node.get_extents(Atspi.CoordType.WINDOW)
            ox, oy = self.client[0], self.client[1]
            # Popup menus are separate surfaces: their items are relative to the popup.
            # Add the parent menu item's position (popup opens under/next to it).
            parent = node.get_parent()
            if i > 0 and parent is not None and parent.get_role_name() in ('menu', 'menu item'):
                pe = self.chain[i-1].get_extents(Atspi.CoordType.WINDOW)
                ox += pe.x; oy += pe.y + pe.height
            new = [{'x': ox + e.x, 'y': oy + e.y, 'w': e.width, 'h': e.height,
                    'label': node.get_name(), 'step': i + 1}]
        self.set_targets(new)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('app'); ap.add_argument('name')
    ap.add_argument('--seconds', type=float, default=30)
    ap.add_argument('--log', default='results/run.json')
    a = ap.parse_args()
    qapp = QGuiApplication(sys.argv)
    guide = Guide(a.app, a.name)
    # Persistent KWin script pushes window changes to us over D-Bus.
    # Qt's Linux event loop runs on GLib, so the GLib-integrated session bus dispatches here too.
    bus = dbus.SessionBus()
    class Receiver(dbus.service.Object):
        @dbus.service.method('org.tapestry.Guide', in_signature='s')
        def event(self, payload):
            guide.on_kwin_event(json.loads(payload))
    bus_name = dbus.service.BusName('org.tapestry.Guide', bus)
    receiver = Receiver(bus, '/guide')
    scripting = bus.get_object('org.kde.KWin', '/Scripting')
    plugin = 'tapestry_guide_%d' % os.getpid()
    sid = scripting.loadScript(os.path.abspath('kwin_follow.js'), plugin, signature='ss',
                               dbus_interface='org.kde.kwin.Scripting')
    bus.get_object('org.kde.KWin', '/Scripting/Script%d' % sid).run(dbus_interface='org.kde.kwin.Script')
    log('kwin.follow', plugin=plugin)
    eng = QQmlApplicationEngine()
    eng.rootContext().setContextProperty('guide', guide)
    eng.load(QUrl.fromLocalFile(os.path.abspath('overlay.qml')))
    if not eng.rootObjects():
        log('error', msg='QML failed'); sys.exit(4)
    win = eng.rootObjects()[0]
    win.setMask(QRegion(0, 0, 1, 1))  # belt and braces: tiny input region
    log('overlay.shown', size=[win.width(), win.height()], dpr=win.devicePixelRatio())
    t = QTimer(); t.timeout.connect(guide.tick); t.start(250); guide.tick()
    QTimer.singleShot(int(a.seconds*1000), qapp.quit)
    rc = qapp.exec()
    scripting.unloadScript(plugin, dbus_interface='org.kde.kwin.Scripting')
    os.makedirs(os.path.dirname(a.log), exist_ok=True)
    json.dump({'events': LOG, 'summary': {'count': len(LOG), 'app': a.app, 'name': a.name}},
              open(a.log, 'w'), indent=1)
