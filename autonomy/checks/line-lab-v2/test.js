(async () => {
const out = []; const log = (k, v) => out.push(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = window.__ll, st = L.st, cv = L.cv;
await sleep(100);
const b = cv.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
// Task 1
log('outputs', [...document.querySelectorAll('output[data-for]')].map(o => o.dataset.for + '=' + o.textContent).join(' | '));
log('bobKeys', document.getElementById('bobKeys').value);
log('reset', document.getElementById('reset').textContent);
// Task 2: red dot eases in and back, no snap
const rx = cx - 150 + 4, ry = cy - 100 + 4;
ev('pointermove', rx, ry); await sleep(90); const mid = st.red;
ev('pointermove', cx, cy); const seq = []; for (let i = 0; i < 16; i++) { await sleep(16); seq.push(+st.red.toFixed(3)); }
let maxDrop = 0; let prev = mid; for (const v of seq) { maxDrop = Math.max(maxDrop, prev - v); prev = v; }
log('red mid-grow', +mid.toFixed(3)); log('red after leave', seq); log('red max drop per frame', +maxDrop.toFixed(3));
ev('pointermove', cx + 400, cy); await sleep(900);
// Task 4: light in from entry, out toward exit
ev('pointermove', cx - 148, cy); await sleep(900);
const inL = L.lightNow(performance.now()); log('light after enter (local)', { x: Math.round(inL.x), y: Math.round(inL.y), a: +inL.a.toFixed(2) });
ev('pointermove', cx + 152, cy + 20); const exitSeq = [];
for (let i = 0; i < 5; i++) { await sleep(200); const l = L.lightNow(performance.now()); exitSeq.push({ x: Math.round(l.x), y: Math.round(l.y), a: +l.a.toFixed(2) }); }
log('light exiting toward (302,120)', exitSeq);
// re-enter mid-exit continues from current light
ev('pointermove', cx - 148, cy); await sleep(900); ev('pointermove', cx + 152, cy); await sleep(200);
ev('pointermove', cx, cy - 98); const re = L.lightNow(performance.now() + 1); log('re-enter mid-exit: light a (should be >0, continuing)', +re.a.toFixed(2));
ev('pointermove', cx + 400, cy + 300); await sleep(900);
// Task 6: selection replaces pencil
function pencilInBand(){
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; const s = cv.width / b.width; let n = 0, blue = 0;
  const X0 = (b.width / 2 - 150) * s, X1 = (b.width / 2 + 150) * s, Y0 = (b.height / 2 - 100) * s, Y1 = (b.height / 2 + 100) * s, band = 6 * s;
  for (let y = Math.floor(Y0 - band); y < Y1 + band; y++) for (let x = Math.floor(X0 - band); x < X1 + band; x++) {
    const inner = x > X0 + band && x < X1 - band && y > Y0 + band && y < Y1 - band; if (inner) continue;
    if (x < X0 + 40 * s && y < Y0 + 40 * s) continue; // corner dots
    const i = (y * c.width + x) * 4, r = d[i], gg = d[i + 1], bb = d[i + 2];
    if (r < 120 && gg < 120 && bb < 120 && Math.abs(r - bb) < 30) n++;
    if (bb > 200 && r < 150) blue++;
  }
  return { pencil: n, blue };
}
log('band before select', pencilInBand());
ev('pointerdown', cx + 150, cy + 30); ev('pointerup', cx + 150, cy + 30); ev('pointermove', cx + 140, cy + 30);
await sleep(60); log('band early grow (sel ' + st.sel.toFixed(2) + ')', pencilInBand()); await sleep(240); log('band mid-grow (sel ' + st.sel.toFixed(2) + ')', pencilInBand());
await sleep(600); log('band after select (sel ' + st.sel.toFixed(2) + ')', pencilInBand());
// Task 5: particles on velocity change
const seen = new Set(); let tracking = true; (async () => { while (tracking) { st.particles.forEach(p => seen.add(p)); await sleep(8); } })();
const phase = async (name, fn) => { const before = seen.size; await fn(); await sleep(40); log('particles during ' + name, seen.size - before); };
let px = cx, py = cy; ev('pointerdown', px, py);
await phase('start (0 -> 1 px/ms right)', async () => { for (let i = 0; i < 20; i++) { px += 8; ev('pointermove', px, py); await sleep(8); } });
await phase('steady straight drag', async () => { for (let i = 0; i < 60; i++) { px += 8; ev('pointermove', px, py); await sleep(8); } });
await phase('gentle curve', async () => { for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI / 4; px += 8 * Math.cos(a); py += 8 * Math.sin(a); ev('pointermove', px, py); await sleep(8); } });
let dirs = [];
await phase('sharp turn (to straight down)', async () => { const n0 = seen.size; for (let i = 0; i < 30; i++) { py += 8; ev('pointermove', px, py); await sleep(8); } await sleep(150); dirs = [...seen].slice(n0).map(p => [+p.vx.toFixed(2), +p.vy.toFixed(2)]); });
log('turn particle dirs (vx,vy)', dirs);
await phase('stop', async () => { await sleep(300); });
ev('pointerup', px, py); tracking = false;
document.getElementById('result').textContent = out.join('\n');
})();
