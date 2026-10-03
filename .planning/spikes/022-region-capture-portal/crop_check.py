"""Spike 022: show a test card at logical (X, Y), capture via the portal, crop by
logical coords x scale, and check the quadrant colours. Deletes the capture.

Usage: python3 crop_check.py X Y
"""
import sys, os, subprocess, time, json
from PIL import Image
X, Y = int(sys.argv[1]), int(sys.argv[2])
qml = open('pattern.qml').read().replace('margins.left: X', 'margins.left: %d' % X).replace('margins.top: Y', 'margins.top: %d' % Y)
open('results/tmp/pattern_run.qml', 'w').write(qml)
card = subprocess.Popen(['python3', '-c', '''
import sys
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtQml import QQmlApplicationEngine
from PyQt6.QtCore import QUrl, QTimer
app = QGuiApplication(sys.argv); e = QQmlApplicationEngine()
e.load(QUrl.fromLocalFile("results/tmp/pattern_run.qml")); QTimer.singleShot(8000, app.quit); app.exec()
'''])
time.sleep(1.5)
subprocess.run(['python3', 'portal_shot.py', '--keep'], check=True, capture_output=True)
card.terminate()
im = Image.open('results/tmp/last.png').convert('RGB')
logical_w = 1695  # kscreen-doctor logical width
s = im.width / logical_w
def px(lx, ly): return im.getpixel((round(lx * s), round(ly * s)))
expect = {'red': (X + 51, Y + 26), 'green': (X + 149, Y + 26), 'blue': (X + 51, Y + 74), 'magenta': (X + 149, Y + 74)}
target = {'red': (255, 0, 0), 'green': (0, 255, 0), 'blue': (0, 0, 255), 'magenta': (255, 0, 255)}
res = {k: px(*v) for k, v in expect.items()}
ok = all(sum(abs(a - b) for a, b in zip(res[k], target[k])) < 30 for k in res)
# Edge accuracy: find the card's left/top white border edge in physical pixels.
row = round((Y + 26) * s)
left = next(x for x in range(round((X - 10) * s), round((X + 20) * s)) if im.getpixel((x, row)) == (255, 255, 255))
crop = im.crop((round(X * s), round(Y * s), round((X + 200) * s), round((Y + 100) * s)))
crop.save('results/crop-%d-%d.png' % (X, Y))  # only the test card, no user content
im.close(); os.remove('results/tmp/last.png')
out = {'X': X, 'Y': Y, 'scale': round(s, 4), 'colors': res, 'ok': ok,
       'left_edge_px': left, 'expected_left_px': round(X * s), 'crop_size': crop.size}
print(json.dumps(out))
json.dump(out, open('results/crop-%d-%d.json' % (X, Y), 'w'), indent=1)
