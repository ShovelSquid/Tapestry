import sys,re
src=open('/Users/kaelencook/Tree/Design/Line Lab/line-lab.src.html').read().replace('__SAMPLE__','')
hook="const statusEl = document.getElementById('status');"
assert hook in src
src=src.replace(hook, "window.__ll = { st, P, lightNow, NOTE, cv, get shapes(){ return shapes; } };\n"+hook)
test=open(sys.argv[1]).read()
open(sys.argv[2],'w').write("<!doctype html><html><body>"+"<script>localStorage.clear();HTMLCanvasElement.prototype.setPointerCapture=()=>{};window.requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),16);</script>"+src+"<pre id='result'></pre><script>"+test+"</script></body></html>")
