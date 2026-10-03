"""Spike 022 (comparison): live capture via org.freedesktop.portal.ScreenCast + PipeWire.

Usage: python3 screencast.py [--grabs 10]
1. CreateSession -> SelectSources(monitor, persist_mode=2, restore_token from last run) -> Start
   (KDE shows a chooser the first time; with a valid restore token it should not).
2. OpenPipeWireRemote -> GStreamer pipewiresrc -> appsink.
3. Times: dialog/start, first frame, and N on-demand grabs. Frames are never written to disk.
Token is kept in results/tmp/restore_token (gitignored scratch).
"""
import sys, os, time, json, secrets, argparse, datetime
import dbus
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst

os.chdir(os.path.dirname(os.path.abspath(__file__)))  # results/ always lands in the spike folder
DBusGMainLoop(set_as_default=True)
Gst.init(None)
bus = dbus.SessionBus()
portal = bus.get_object('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
SC = 'org.freedesktop.portal.ScreenCast'
TOKEN_FILE = 'results/tmp/restore_token'
LOG = []
def log(cat, **kw):
    LOG.append({'t': datetime.datetime.now().isoformat(timespec='milliseconds'), 'cat': cat, **kw})
    print(cat, kw, flush=True)

sender = bus.get_unique_name()[1:].replace('.', '_')
def call(method, *args, timeout_s=120):
    token = 'tapestry' + secrets.token_hex(4)
    handle = '/org/freedesktop/portal/desktop/request/%s/%s' % (sender, token)
    out, loop = {}, GLib.MainLoop()
    def on_response(code, results):
        out['code'] = int(code); out['results'] = results; loop.quit()
    bus.add_signal_receiver(on_response, 'Response', 'org.freedesktop.portal.Request',
                            'org.freedesktop.portal.Desktop', handle)
    opts = dict(args[-1]); opts['handle_token'] = token
    getattr(portal, method)(*args[:-1], opts, dbus_interface=SC)
    GLib.timeout_add_seconds(timeout_s, loop.quit)
    t0 = time.time(); loop.run()
    out['ms'] = round((time.time() - t0) * 1000)
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--grabs', type=int, default=10); a = ap.parse_args()
    os.makedirs('results/tmp', exist_ok=True)
    log('portal.version', version=int(portal.Get(SC, 'version', dbus_interface='org.freedesktop.DBus.Properties')))
    r = call('CreateSession', {'session_handle_token': 'tapestry' + secrets.token_hex(4)})
    session = str(r['results']['session_handle']); log('session', ms=r['ms'], code=r['code'])
    sel = {'types': dbus.UInt32(1), 'multiple': False, 'cursor_mode': dbus.UInt32(1), 'persist_mode': dbus.UInt32(2)}
    had_token = os.path.exists(TOKEN_FILE)
    if had_token:
        sel['restore_token'] = open(TOKEN_FILE).read().strip()
    r = call('SelectSources', dbus.ObjectPath(session), sel); log('select', ms=r['ms'], code=r['code'], had_token=had_token)
    r = call('Start', dbus.ObjectPath(session), '', {})
    log('start', ms=r['ms'], code=r['code'], note='includes any chooser dialog time')
    if r['code'] != 0:
        log('error', msg='Start refused or cancelled'); sys.exit(1)
    res = r['results']
    if 'restore_token' in res:
        open(TOKEN_FILE, 'w').write(str(res['restore_token']))
    streams = [(int(s[0]), {str(k): v for k, v in s[1].items()}) for s in res['streams']]
    node, props = streams[0]
    log('stream', node=node, size=[int(x) for x in props.get('size', [])], got_token='restore_token' in res)
    fd = portal.OpenPipeWireRemote(dbus.ObjectPath(session), {}, dbus_interface=SC).take()
    pipe = Gst.parse_launch('pipewiresrc fd=%d path=%d do-timestamp=true keepalive-time=1000 ! videoconvert ! '
                            'video/x-raw,format=RGB ! appsink name=sink max-buffers=1 drop=true sync=false' % (fd, node))
    sink = pipe.get_by_name('sink')
    # PipeWire only delivers a frame when the screen is damaged, so keep the newest
    # sample as it arrives; a grab then reads the cache and never waits for a change.
    latest = {'sample': None, 'n': 0, 't': None}
    def on_sample(snk):
        latest['sample'] = snk.emit('pull-sample'); latest['n'] += 1; latest['t'] = time.time()
        return Gst.FlowReturn.OK
    sink.set_property('emit-signals', True); sink.connect('new-sample', on_sample)
    t0 = time.time(); pipe.set_state(Gst.State.PLAYING)
    ctx = GLib.MainContext.default()
    while latest['sample'] is None and time.time() - t0 < 5:
        ctx.iteration(False); time.sleep(0.001)
    caps = latest['sample'].get_caps().get_structure(0) if latest['sample'] else None
    log('first_frame', ms=round((time.time() - t0) * 1000),
        size=[caps.get_value('width'), caps.get_value('height')] if caps else None)
    times, ages = [], []
    for i in range(a.grabs):
        end = time.time() + 0.2
        while time.time() < end: ctx.iteration(False); time.sleep(0.005)
        t1 = time.time(); smp = latest['sample']
        buf = smp.get_buffer(); ok, info = buf.map(Gst.MapFlags.READ); nbytes = info.size if ok else 0
        if ok: buf.unmap(info)
        times.append(round((time.time() - t1) * 1000, 2)); ages.append(round((t1 - latest['t']) * 1000))
    log('grabs', n=a.grabs, ms=times, median=sorted(times)[len(times) // 2], bytes=nbytes,
        frame_age_ms=ages, frames_received=latest['n'])
    pipe.set_state(Gst.State.NULL)
    bus.get_object('org.freedesktop.portal.Desktop', session).Close(dbus_interface='org.freedesktop.portal.Session')
    json.dump({'events': LOG}, open('results/screencast-%s.json' % ('restore' if had_token else 'first'), 'w'), indent=1)
