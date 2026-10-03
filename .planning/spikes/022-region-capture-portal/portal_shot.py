"""Spike 022: take screenshots through org.freedesktop.portal.Screenshot.

Usage: python3 portal_shot.py [--interactive] [--count N]
Prints, per call: response code, ms, image URI, pixel size. Images are moved
to results/tmp/ for the checker and deleted by it.
"""
import sys, time, json, argparse, os, shutil, secrets, datetime
import dbus
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
portal = bus.get_object('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
LOG = []

def log(cat, **kw):
    LOG.append({'t': datetime.datetime.now().isoformat(timespec='milliseconds'), 'cat': cat, **kw})
    print(cat, kw, flush=True)

def screenshot(interactive=False, timeout_s=60):
    token = 'tapestry' + secrets.token_hex(4)
    sender = bus.get_unique_name()[1:].replace('.', '_')
    handle = '/org/freedesktop/portal/desktop/request/%s/%s' % (sender, token)
    out, loop = {}, GLib.MainLoop()
    def on_response(code, results):
        out['code'] = int(code); out['results'] = {str(k): str(v) for k, v in results.items()}
        loop.quit()
    bus.add_signal_receiver(on_response, 'Response', 'org.freedesktop.portal.Request',
                            'org.freedesktop.portal.Desktop', handle)
    t0 = time.time()
    portal.Screenshot('', {'handle_token': token, 'interactive': dbus.Boolean(interactive)},
                      dbus_interface='org.freedesktop.portal.Screenshot')
    GLib.timeout_add_seconds(timeout_s, loop.quit)
    loop.run()
    out['ms'] = round((time.time() - t0) * 1000)
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--interactive', action='store_true')
    ap.add_argument('--count', type=int, default=1)
    ap.add_argument('--keep', action='store_true', help='keep the last image for the checker')
    a = ap.parse_args()
    v = portal.Get('org.freedesktop.portal.Screenshot', 'version',
                   dbus_interface='org.freedesktop.DBus.Properties')
    log('portal.version', version=int(v))
    os.makedirs('results/tmp', exist_ok=True)
    for i in range(a.count):
        r = screenshot(a.interactive)
        uri = r.get('results', {}).get('uri', '')
        path = uri.replace('file://', '')
        size = None
        if path and os.path.exists(path):
            from PIL import Image
            with Image.open(path) as im: size = im.size
            if a.keep and i == a.count - 1:
                shutil.move(path, 'results/tmp/last.png')
            else:
                os.remove(path)  # never keep the user's screen
        log('portal.shot', n=i + 1, code=r.get('code'), ms=r['ms'], size=size,
            saved_to_dir=os.path.dirname(path) if path else None)
    json.dump({'events': LOG}, open('results/portal-%s.json' % ('interactive' if a.interactive else 'quiet'), 'w'), indent=1)
