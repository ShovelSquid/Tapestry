"""Load a KWin script once and return what it reports over D-Bus.

Usage: python3 kwin_query.py kwin_windows.js   -> prints JSON to stdout
"""
import sys, os, json, dbus, dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
result = {}
loop = GLib.MainLoop()

class Receiver(dbus.service.Object):
    @dbus.service.method('org.tapestry.Spike', in_signature='s')
    def report(self, payload):
        result['data'] = json.loads(payload)
        loop.quit()

_registered = []

def query(script_path, timeout_ms=3000):
    global loop
    if not _registered:  # register the receiver once per process
        _registered.append((dbus.service.BusName('org.tapestry.Spike', bus), Receiver(bus, '/')))
    loop = GLib.MainLoop()
    result.clear()
    scripting = bus.get_object('org.kde.KWin', '/Scripting')
    plugin = 'tapestry_spike_%d' % os.getpid()
    sid = scripting.loadScript(os.path.abspath(script_path), plugin, signature='ss',
                               dbus_interface='org.kde.kwin.Scripting')
    bus.get_object('org.kde.KWin', '/Scripting/Script%d' % sid).run(
        dbus_interface='org.kde.kwin.Script')
    GLib.timeout_add(timeout_ms, loop.quit)
    loop.run()
    scripting.unloadScript(plugin, dbus_interface='org.kde.kwin.Scripting')
    return result.get('data')

if __name__ == '__main__':
    print(json.dumps(query(sys.argv[1]), indent=1))
