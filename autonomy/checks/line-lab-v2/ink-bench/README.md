# Wave 1 ink frame check

200 notes drawn with `<InkLine>` (240×150 world px, each seeded by its
index) in a CSS-scaled plane, 3 of them selected so the blue takes over and
waves every frame. It measures rAF intervals from 1 s to 4 s after load in
Electron.

    R=~/Tapestrees/ui
    $R/node_modules/.bin/esbuild bench.tsx --bundle --jsx=automatic \
      --define:process.env.NODE_ENV='"production"' --minify --outfile=bench.js
    (cd $R/app && npx electron $R/autonomy/checks/line-lab-v2/ink-bench/shot.cjs 0.5 out.png)

`bench.js` is a build output and is not committed.

Result on 2026-09-25 (this Mac): at zoom 0.5 and at zoom 2, 60 fps, p95 frame
17.4 ms, max 17.7 ms. In Node, building all 200 outlines once takes 82 ms
(about 10.7 kB of path each), and 3 waving outlines cost 0.39 ms per frame.
Screenshots: `ink-wave1-zoom50.png`, `ink-wave1-zoom200.png`. The weight
scales with the zoom, and the blue replaces the pencil.
