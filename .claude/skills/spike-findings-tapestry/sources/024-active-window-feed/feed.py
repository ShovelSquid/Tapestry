"""Spike 024: active-window feed + "which file is this window showing?" resolver.

Usage: python3 feed.py [--seconds 120]
A persistent KWin script pushes every focus/title change. For each, four guesses
at the document are made and logged with how long they took:
  title   - a file-like name parsed from the window title
  fd      - regular files the process holds open (+ editor swap files -> original)
  kactivities - newest resource this app opened in KDE's activity database
  xbel    - newest recently-used.xbel entry registered by this app
Verdicts per event: agreed path (2+ guesses agree), single guess, or nothing.
Logs go to results/feed-<time>.jsonl as they happen. Paths are logged; file
contents are never read.
"""
import os, re, sys, json, time, sqlite3, argparse, datetime, signal
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlparse
import dbus, dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
HOME = os.path.expanduser('~')
os.makedirs('results', exist_ok=True)
STREAM = 'results/feed-%s.jsonl' % datetime.datetime.now().strftime('%H%M%S')
def log(cat, **kw):
    e = {'t': datetime.datetime.now().isoformat(timespec='milliseconds'), 'cat': cat, **kw}
    print(cat, json.dumps(kw)[:300], flush=True)
    with open(STREAM, 'a') as f: f.write(json.dumps(e) + '\n')

# A file name: stem + "." + an extension starting with a letter ("notes.md", not "Unity 6.4").
FILE_RE = re.compile(r'([\w\-. ()\[\]]+\.[A-Za-z][A-Za-z0-9]{0,7})(?=\s|$|\s[—\-–:|*])')
SKIP_FD = ('/usr/', '/proc/', '/sys/', '/dev/', '/run/', '/var/', '/opt/', '/snap/')

def guess_title(caption):
    head = re.split(r'\s+[—–|]\s+', caption)[0].strip(' *')
    m = FILE_RE.search(head)
    return m.group(1).strip() if m else None

def guess_fd(pid):
    out = []
    try:
        for fd in os.listdir('/proc/%d/fd' % pid):
            try: p = os.readlink('/proc/%d/fd/%s' % (pid, fd))
            except OSError: continue
            if not p.startswith('/') or p.startswith(SKIP_FD) or '/.cache/' in p or '/.local/share/' in p and not p.endswith('-swp'):
                continue
            if p.endswith('.kate-swp'):  # Kate holds a swap file next to the document
                d, b = os.path.split(p); p = os.path.join(d, b[1:-len('.kate-swp')])
            if os.path.isfile(p) or os.path.isdir(p): out.append(p)
    except OSError:
        pass
    return sorted(set(out))

def guess_kactivities(app_id):
    db = os.path.join(HOME, '.local/share/kactivitymanagerd/resources/database')
    try:
        c = sqlite3.connect('file:%s?mode=ro' % db, uri=True, timeout=0.2)
        r = c.execute("select targettedResource, start from ResourceEvent where initiatingAgent in (?, ?) "
                      "and (targettedResource like '/%' or targettedResource like 'file:%') "
                      "order by start desc limit 1", (app_id, app_id.split('.')[-1])).fetchone()
        c.close()
        return unquote(urlparse(r[0]).path) if r else None
    except sqlite3.Error as e:
        return 'error: %s' % e

def guess_xbel(app_id):
    name = app_id.split('.')[-1].lower()
    try:
        root = ET.parse(os.path.join(HOME, '.local/share/recently-used.xbel')).getroot()
    except Exception:
        return None
    best = None
    for b in root.findall('bookmark'):
        apps = [a.get('name', '').lower() for a in b.iter('{http://www.freedesktop.org/standards/desktop-bookmarks}application')]
        if any(name in a for a in apps) and (best is None or b.get('modified', '') > best.get('modified', '')):
            best = b
    return unquote(urlparse(best.get('href')).path) if best is not None else None

def resolve(ev):
    t0 = time.time()
    title = guess_title(ev['caption'])
    fds = guess_fd(ev['pid'])
    kact = guess_kactivities(ev['resourceClass'])
    xbel = guess_xbel(ev['resourceClass'])
    cands = []
    # A guess "agrees" with the title when its basename is the title's file name.
    for src, val in (('fd', fds), ('kactivities', [kact] if kact else []), ('xbel', [xbel] if xbel else [])):
        for p in val:
            if not p.startswith('error'):
                cands.append((src, p, bool(title) and os.path.basename(p) == title))
    agreed = [c for c in cands if c[2]]
    if agreed:
        verdict, path = 'agreed', agreed[0][1]
    elif len(fds) == 1:
        verdict, path = 'fd-only', fds[0]
    elif kact and not kact.startswith('error') and ev['resourceClass'] in ('org.kde.dolphin',):
        verdict, path = 'kactivities-folder', kact   # file managers log the folder they show
    elif title:
        verdict, path = 'title-only', title
    else:
        verdict, path = 'none', None
    return {'verdict': verdict, 'path': path, 'title': title, 'fd': fds[:6], 'fd_count': len(fds),
            'kactivities': kact, 'xbel': xbel, 'resolve_ms': round((time.time() - t0) * 1000, 1)}

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--seconds', type=float, default=120); a = ap.parse_args()
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    loop = GLib.MainLoop()
    stats = {'events': 0, 'lat': []}
    class Feed(dbus.service.Object):
        @dbus.service.method('org.tapestry.Feed', in_signature='s')
        def event(self, payload):
            ev = json.loads(payload)
            lat = round(time.time() * 1000 - ev['ts'], 1)
            stats['events'] += 1; stats['lat'].append(lat)
            r = resolve(ev)
            log('focus', kind=ev['kind'], app=ev['resourceClass'], caption=ev['caption'][:80],
                pid=ev['pid'], latency_ms=lat, **r)
    name = dbus.service.BusName('org.tapestry.Feed', bus); Feed(bus, '/feed')
    scripting = bus.get_object('org.kde.KWin', '/Scripting')
    plugin = 'tapestry_feed_%d' % os.getpid()
    sid = scripting.loadScript(os.path.join(HERE, 'kwin_feed.js'), plugin, signature='ss',
                               dbus_interface='org.kde.kwin.Scripting')
    bus.get_object('org.kde.KWin', '/Scripting/Script%d' % sid).run(dbus_interface='org.kde.kwin.Script')
    log('ready', seconds=a.seconds, hint='switch between a few windows: an editor, Dolphin, a PDF, a browser')
    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, s, lambda *_: (loop.quit(), False)[1])
    GLib.timeout_add(int(a.seconds * 1000), loop.quit)
    loop.run()
    scripting.unloadScript(plugin, dbus_interface='org.kde.kwin.Scripting')
    L = sorted(stats['lat'])
    log('summary', events=stats['events'], latency_median_ms=L[len(L) // 2] if L else None,
        latency_max_ms=L[-1] if L else None)
