"""Find named controls in an app's accessibility tree and report their extents.

Usage: python3 probe_tree.py <app-name-substring> [name-substring ...]
Prints every matching node with role, SCREEN extents and WINDOW extents.
"""
import sys, json, time
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

def walk(node, depth=0, path=()):
    yield node, depth, path
    try:
        n = node.get_child_count()
    except Exception:
        return
    for i in range(min(n, 500)):
        try:
            c = node.get_child_at_index(i)
        except Exception:
            continue
        if c is not None:
            yield from walk(c, depth + 1, path + (i,))

def ext(node, coord):
    try:
        e = node.get_extents(coord)
        return [e.x, e.y, e.width, e.height]
    except Exception as ex:
        return str(ex)

def find_app(sub):
    d = Atspi.get_desktop(0)
    for i in range(d.get_child_count()):
        a = d.get_child_at_index(i)
        if a and sub.lower() in (a.get_name() or '').lower():
            return a
    return None

if __name__ == '__main__':
    app_sub, *names = sys.argv[1:]
    t0 = time.time()
    app = find_app(app_sub)
    if not app:
        print(json.dumps({'error': 'app not found', 'app': app_sub})); sys.exit(1)
    out, count = [], 0
    for node, depth, path in walk(app):
        count += 1
        try:
            name, role = node.get_name() or '', node.get_role_name()
        except Exception:
            continue
        if role in ('frame', 'window') and depth <= 1:
            out.append({'kind': 'window', 'name': name, 'role': role,
                        'screen': ext(node, Atspi.CoordType.SCREEN),
                        'window': ext(node, Atspi.CoordType.WINDOW)})
        if any(n.lower() in name.lower() for n in names):
            out.append({'kind': 'match', 'name': name, 'role': role, 'depth': depth,
                        'screen': ext(node, Atspi.CoordType.SCREEN),
                        'window': ext(node, Atspi.CoordType.WINDOW),
                        'showing': node.get_state_set().contains(Atspi.StateType.SHOWING)})
    print(json.dumps({'app': app.get_name(), 'nodes': count,
                      'ms': round((time.time() - t0) * 1000), 'results': out}, indent=1))
