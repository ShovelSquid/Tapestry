"""Spike 023: bottom-centre edge tab -> drag out a note -> write -> save out of sight.

Usage: python3 edge_tab.py [--minutes 10]
Notes are appended to results/notes.jsonl (gitignored: it holds what you wrote); every
interaction is logged with ISO timestamps to results/session-<time>.jsonl as it happens.
"""
import sys, os, json, time, datetime, argparse, signal
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, os.path.join(HERE, '..', '021-guide-circle-atspi'))
from PyQt6.QtCore import QObject, pyqtSlot, pyqtProperty, pyqtSignal, QUrl, QTimer
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtQml import QQmlApplicationEngine
from kwin_query import query as kwin_query

LOG = []
os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
STREAM = os.path.join(HERE, 'results', 'session-%s.jsonl' % datetime.datetime.now().strftime('%H%M%S'))
def log(cat, **kw):
    e = {'t': datetime.datetime.now().isoformat(timespec='milliseconds'), 'cat': cat, **kw}
    LOG.append(e)
    print(cat, kw, flush=True)
    # Written as it happens: a killed session (closed terminal, SIGTERM) still leaves its log.
    with open(STREAM, 'a') as f: f.write(json.dumps(e) + '\n')

TAB_W, TAB_H = 260, 70

class App(QObject):
    ghostChanged = pyqtSignal()
    def __init__(self, engine):
        super().__init__()
        self.engine, self._gx, self._gy, self._gv = engine, 0, 0, False
        self.notes, self.next_id, self.drag_t0 = {}, 1, None
        g = QGuiApplication.primaryScreen().geometry()
        self.screen = (g.width(), g.height())
        self.tab_origin = ((g.width() - TAB_W) / 2, g.height() - TAB_H)
        log('screen', logical=self.screen, tab_origin=self.tab_origin)

    def to_global(self, x, y):
        return self.tab_origin[0] + x, self.tab_origin[1] + y

    @pyqtProperty(float, notify=ghostChanged)
    def ghostX(self): return self._gx
    @pyqtProperty(float, notify=ghostChanged)
    def ghostY(self): return self._gy
    @pyqtProperty(bool, notify=ghostChanged)
    def ghostVisible(self): return self._gv

    @pyqtSlot(str, 'QVariant')
    def log(self, cat, data): log(cat, **(data.toVariant() if hasattr(data, 'toVariant') else data))

    @pyqtSlot(float, float)
    def dragStart(self, x, y):
        self.drag_t0, self.moves = time.time(), 0
        self._gx, self._gy = self.to_global(x, y); self._gv = True; self.ghostChanged.emit()
        log('drag.start', at=[round(self._gx), round(self._gy)])

    @pyqtSlot(float, float)
    def dragMove(self, x, y):
        self.moves += 1
        self._gx, self._gy = self.to_global(x, y); self.ghostChanged.emit()

    @pyqtSlot(float, float)
    def dragEnd(self, x, y):
        gx, gy = self.to_global(x, y)
        self._gv = False; self.ghostChanged.emit()
        dist = ((gx - self.to_global(TAB_W / 2, TAB_H)[0]) ** 2 + (gy - self.tab_origin[1]) ** 2) ** 0.5
        log('drag.end', at=[round(gx), round(gy)], moves=self.moves,
            ms=round((time.time() - self.drag_t0) * 1000), outside_tab=not (0 <= x <= TAB_W and 0 <= y <= TAB_H))
        if dist < 60:
            log('drag.cancel', reason='dropped on the tab'); return
        self.place_note(gx, gy)

    def place_note(self, gx, gy):
        nid = self.next_id; self.next_id += 1
        # What the user was looking at when the note was dropped: the active window.
        wins = kwin_query(os.path.join(HERE, '..', '021-guide-circle-atspi', 'kwin_windows.js')) or []
        active = next((w for w in wins if w.get('active')), None)
        on = active['caption'] if active else 'desktop'
        x = int(max(0, min(self.screen[0] - 240, gx - 120))); y = int(max(0, min(self.screen[1] - 150, gy - 20)))
        qml = open('note.qml').read()
        for k, v in {'NOTE_X': str(x), 'NOTE_Y': str(y), 'NOTE_ID': str(nid),
                     'NOTE_ON': on.replace('"', "'")[:60]}.items():
            qml = qml.replace(k, v)
        path = os.path.join(HERE, 'results', '.note-%d.qml' % nid)
        open(path, 'w').write(qml)
        before = len(self.engine.rootObjects())
        self.engine.load(QUrl.fromLocalFile(path))
        win = self.engine.rootObjects()[before]
        self.notes[nid] = {'win': win, 'x': x, 'y': y, 'on': active, 't0': time.time(), 'path': path}
        log('note.placed', id=nid, at=[x, y], on=on)

    @pyqtSlot(int, str, bool)
    def closeNote(self, nid, text, save):
        n = self.notes.pop(nid, None)
        if not n: return
        n['win'].close(); n['win'].deleteLater(); os.remove(n['path'])
        rec = {'id': nid, 'saved': save, 'text': text, 'at': [n['x'], n['y']],
               'on': {k: n['on'][k] for k in ('caption', 'resourceClass', 'pid', 'client')} if n['on'] else None,
               'created': datetime.datetime.fromtimestamp(n['t0']).isoformat(timespec='seconds'),
               'open_s': round(time.time() - n['t0'], 1)}
        if save:
            with open('results/notes.jsonl', 'a') as f: f.write(json.dumps(rec) + '\n')
        log('note.saved' if save else 'note.discarded', id=nid, chars=len(text), open_s=rec['open_s'])

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--minutes', type=float, default=10); a = ap.parse_args()
    qapp = QGuiApplication(sys.argv)
    eng = QQmlApplicationEngine()
    app = App(eng)
    eng.rootContext().setContextProperty('app', app)
    for f in ('ghost.qml', 'tab.qml'):
        eng.load(QUrl.fromLocalFile(os.path.join(HERE, f)))
    if len(eng.rootObjects()) != 2:
        log('error', msg='QML failed to load'); sys.exit(1)
    log('ready', hint='move the cursor to the bottom middle of the screen')
    signal.signal(signal.SIGINT, lambda *_: qapp.quit())
    signal.signal(signal.SIGTERM, lambda *_: qapp.quit())
    signal.signal(signal.SIGHUP, lambda *_: qapp.quit())
    keep = QTimer(); keep.start(200); keep.timeout.connect(lambda: None)  # let Python see Ctrl+C
    QTimer.singleShot(int(a.minutes * 60000), qapp.quit)
    qapp.exec()
    path = 'results/session-%s.json' % datetime.datetime.now().strftime('%H%M%S')
    json.dump({'events': LOG, 'summary': {'events': len(LOG),
               'notes_saved': sum(1 for e in LOG if e['cat'] == 'note.saved'),
               'drags': sum(1 for e in LOG if e['cat'] == 'drag.end')}}, open(path, 'w'), indent=1)
    print('log written to', path)
