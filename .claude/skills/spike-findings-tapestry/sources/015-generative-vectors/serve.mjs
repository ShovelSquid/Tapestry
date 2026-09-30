// Serves .planning/spikes over 127.0.0.1 so the page can import gen.mjs and
// three from ../node_modules. Run `npm install` in .planning/spikes once.
//
//   node serve.mjs          then open the printed URL

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }

const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' })
  createReadStream(path).pipe(res)
})
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${server.address().port}/015-generative-vectors/index.html`)
})
