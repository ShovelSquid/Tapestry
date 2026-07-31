const http = require('http');
const fs = require('fs');
const path = require('path');

/* Additive port series. Each launch takes the next free slot above the base
   (3000, 3001, 3002 …) instead of failing on EADDRINUSE, so earlier instances
   keep serving and successive updates can be compared side by side.
   PORT sets the base, PORT_TRIES the width of the series, and STRICT_PORT=1
   disables the walk for tooling that must know the port up front. */
const BASE = Number(process.env.PORT || 3000);
const TRIES = Number(process.env.PORT_TRIES || 50);
const STRICT = process.env.STRICT_PORT === '1';

const ROOT = path.join(__dirname, 'public');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};

const server = http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(data);
  });
});

const skipped = [];

server.on('listening', () => {
  const {port} = server.address();
  fs.writeFileSync(path.join(__dirname, '.port'), String(port));
  console.log(`Semantic Scroll running at http://localhost:${port}`);
  if (skipped.length)
    console.log(`  series base ${BASE} · ${skipped.join(', ')} still held by earlier instances`);
});

server.on('error', err => {
  const port = server.__port;
  if (err.code !== 'EADDRINUSE') { console.error(err.message); process.exit(1); }
  if (STRICT) {
    console.error(`Port ${port} is in use and STRICT_PORT=1 is set.`);
    process.exit(1);
  }
  if (port - BASE + 1 >= TRIES) {
    console.error(`No free port in ${BASE}–${BASE + TRIES - 1}. Set PORT to a different base.`);
    process.exit(1);
  }
  skipped.push(port);
  listen(port + 1);
});

function listen(port){ server.__port = port; server.listen(port); }
listen(BASE);

/* .port records the most recently started instance. On shutdown only clear it
   if it still names us — a newer instance may have claimed it since. */
const PORT_FILE = path.join(__dirname, '.port');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  try {
    if (fs.readFileSync(PORT_FILE, 'utf8').trim() === String(server.__port)) fs.unlinkSync(PORT_FILE);
  } catch {}
  process.exit(0);
});
