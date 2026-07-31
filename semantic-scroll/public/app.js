/* Semantic Scroll — infinite spatial canvas of connected notes.
   Everything lives in *world* coordinates. The screen is a window onto that
   world: screen = world * view.k + view.(x,y). Only UI chrome is in screen space. */

const transcript = [
  {role:'user', text:`how to recover an anonymous interaction with chat with important information if browser remained open`},
  {role:'assistant', text:`If the browser tab is still open, your chances are much better than if it has been closed. Don't refresh or close the tab; copy anything visible immediately. Check the tab's Back history, Chrome history, and the exact chatgpt.com/c/ URL.`},
  {role:'user', text:`this login is the same tab, where I logged in. im on chrome but I dont see the previous chat on the side`},
  {role:'assistant', text:`If login replaced the anonymous session, it may not appear in your account sidebar. Hold or right-click Chrome's Back button, inspect history for an earlier /c/ URL, and avoid refreshing while checking.`},
  {role:'user', text:`it looks like chatgpt.com/c/`},
  {role:'assistant', text:`That indicates a specific conversation URL. Preserve it, compare it with earlier /c/ entries in Chrome history, and open possible older IDs in a separate tab.`},
  {role:'user', text:`ah its ok. could you create a small web server that displays this entire note as is, with the same UI and everything, just as a full scroll from top to bottom all of my replies and yours, in a full space? then, at the bottom, have the keyboard input area, which when inputting elongates the scroll from that point. Or, instead of that, if you wanted to you could click a blue connection button at the bottom (of the scroll page in the input area), creates a blue line from the center of the scroll to the vector of the new note, which follows the mouse. When clicking, shows the boundaries in a satisfying animation into, as white corners around the edges of the page boundaries, which is the same width as the scroll and is normal regular page dimensions. Very thin, small white corners, that have a blue fluid sim wave of force or water that expands throughout the boundaries of the page, yet without going further.

Can create connections from words, letters, phrases, using letters as the base individual selection possibility, to any other words, letters, phrases, etc. Each connection has a highlighted area, and shows the connection to what it is highlighted to. Can make new notes in the middle of the connections, to an automated prompt of what the connection between the inputs are, and what it evokes/is trying to say.

So can map out interactions, and prompt pages, by drawing connections between them, and then digging deep and making connections between passages. Page boundaries can be smaller, for smaller notes, or words, or whatnot. Can drag and drop around the edges of the borders to resize them, to any size.

There should be a light effect that feels natural and subtle around the text; with it glowing in a real life light kind of way, with the patterns and shapes and forms. New text should glow white, brighter first, before fading to a dull white, faded pink base that the white is illuminating. White is energy, and should resonate when connections are more distinct.

There should be a model; and it is prompted, and then pinged 60hz a second to see how its neural connections are updating and moving displaying in the top left as a 3d animation visualization contained fully within a sphere. Can be dragged around. The pings also ping new prompts, by simulating energy adapting and moving out from the letters (each letter has a different energy value, as well as color value), in a simulated fashion, to move around to other letters procedurally, and spread its energy. Connections should prompt energy, and energy should spread out to connections, to then create new connections with other words and pages, and then also be able to ping out fully circular radio pings to see what other words are nearby spatially, determine if any connections have been made, and then build the lines between them to connect, feelers at first and like a fungus, searching for the meaning in between.

This should be a simulation that updates, and doesn't need to be a web server. It could be simulated natively in chrono, writing it all in C++ for the simulation, as long as text will look the exact same as this current UI, just being able to be updated in a different way?

Let me know if you need to write this in a doc, so that it can be referred to and saved, as is verbatim with this current full interaction, to then be put into the simulation. The simulation basically runs a web server that communicates to you and prompts you with different questions, just possibly at the same time.`}
];

const rootBody = document.querySelector('#root-body');
for (const m of transcript) {
  const el = document.createElement('section');
  el.className = `message ${m.role}`;
  const role = document.createElement('span'); role.className='role'; role.textContent=m.role;
  const text = document.createElement('div'); text.className='text'; text.textContent=m.text;
  el.append(role,text); rootBody.append(el);
}

document.querySelector('#instance').textContent = location.port ? `:${location.port}` : '';

const stage   = document.querySelector('#stage');
const scene   = document.querySelector('#scene');
const objects = document.querySelector('#objects');
const linkLayer = document.querySelector('#link-layer');
const status  = document.querySelector('#status');
const grid    = document.querySelector('#grid');

const state = {
  view:{x:0, y:0, k:1},          // world -> screen transform
  objs:new Map(),                // id -> object {el,x,y,kind,layer,...}
  links:[],                      // {a,b,strength,kind} with anchors
  layers:[], activeLayer:null,
  pending:null,                  // in-progress text connection
  proposal:null,                 // blob -> ghost blob -> note flow
  mouse:{x:innerWidth/2, y:innerHeight/2},   // screen
  world:{x:0, y:0},                          // mouse in world
  particles:[],                  // world-space
  dragging:null,
  wheelMode:'zoom'
};
let idN = 0;
const uid = p => `${p}-${++idN}`;

/* ------------------------------------------------------------------ view */
const MIN_K = 0.05, MAX_K = 6;

function applyView(){
  const {x,y,k} = state.view;
  scene.style.transform = `translate(${x}px,${y}px) scale(${k})`;
  const gs = 32 * k;
  grid.style.setProperty('--gs', `${gs}px`);
  grid.style.setProperty('--gx', `${x % gs}px`);
  grid.style.setProperty('--gy', `${y % gs}px`);
  document.querySelector('#zoom-readout').textContent = `${Math.round(k*100)}%`;
}
function screenToWorld(sx, sy){
  return {x:(sx - state.view.x)/state.view.k, y:(sy - state.view.y)/state.view.k};
}
function worldToScreen(wx, wy){
  return {x:wx*state.view.k + state.view.x, y:wy*state.view.k + state.view.y};
}
function panBy(dx, dy){ state.view.x += dx; state.view.y += dy; applyView(); }
function zoomAt(sx, sy, factor){
  const k = Math.min(MAX_K, Math.max(MIN_K, state.view.k * factor));
  const f = k / state.view.k;
  // keep the world point under the cursor pinned to the cursor
  state.view.x = sx - (sx - state.view.x) * f;
  state.view.y = sy - (sy - state.view.y) * f;
  state.view.k = k;
  applyView();
}

/* wheel: zoom at cursor, or pan. Trackpad pinch (ctrlKey) always zooms,
   horizontal trackpad deltas always pan. */
stage.addEventListener('wheel', e => {
  e.preventDefault();
  const pinch = e.ctrlKey || e.metaKey;
  const lateral = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (pinch)                                   zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY*0.01));
  else if (e.shiftKey)                         panBy(-e.deltaY, 0);
  else if (lateral || state.wheelMode==='pan') panBy(-e.deltaX, -e.deltaY);
  else                                         zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY*0.0016));
}, {passive:false});

/* drag the empty background to pan — unbounded in every direction */
let panStart = null;
stage.addEventListener('pointerdown', e => {
  if (e.button === 1 || (!e.target.closest('.note, .blob') && e.button === 0)) {
    panStart = {x:e.clientX, y:e.clientY, vx:state.view.x, vy:state.view.y, moved:false};
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
  }
});
stage.addEventListener('pointermove', e => {
  if (!panStart) return;
  const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
  if (Math.hypot(dx,dy) > 3) panStart.moved = true;
  if (!panStart.moved) return;
  state.view.x = panStart.vx + dx; state.view.y = panStart.vy + dy; applyView();
});
stage.addEventListener('pointerup', e => {
  const wasDrag = panStart?.moved;
  panStart = null; stage.classList.remove('panning');
  if (!wasDrag) onStageClick(e);
});

addEventListener('keydown', e => {
  if (e.target.matches('textarea, [contenteditable="true"]')) return;
  const step = 90;
  if (e.key === 'ArrowLeft')  panBy(step, 0);
  if (e.key === 'ArrowRight') panBy(-step, 0);
  if (e.key === 'ArrowUp')    panBy(0, step);
  if (e.key === 'ArrowDown')  panBy(0, -step);
  if (e.key === '0')          frameAll();
  if (e.key === '+' || e.key === '=') zoomAt(innerWidth/2, innerHeight/2, 1.2);
  if (e.key === '-')          zoomAt(innerWidth/2, innerHeight/2, 1/1.2);
  if (e.key === 'Escape')     { cancelProposal(); cancelConnect(); }
});

/* ------------------------------------------------- Orient: Reset / frame all */
/* fit every visible object into the free area between the panels */
function frameAll(){
  const items = [...state.objs.values()].filter(o => !o.ghost && layerOf(o).visible);
  if (!items.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of items){
    const r = boundsOf(o);
    minX = Math.min(minX, r.x);       minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  const wide = innerWidth > 760;
  const gutterL = wide ? 220 : 0, gutterR = wide ? 240 : 10;   // orb, side panel
  const pad = 60;
  const availW = Math.max(120, innerWidth - gutterL - gutterR - pad*2);
  const availH = Math.max(120, innerHeight - 48 - 90 - pad*2); // topbar, composer
  const k = Math.min(MAX_K, Math.max(MIN_K,
    Math.min(availW/Math.max(1, maxX-minX), availH/Math.max(1, maxY-minY))));
  const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
  state.view = {
    k,
    x: gutterL + availW/2 + pad - cx*k,
    y: 48 + availH/2 + pad - cy*k
  };
  applyView();
  status.textContent = `Oriented — ${items.length} objects framed.`;
}
document.querySelector('#orient').onclick = frameAll;
document.querySelector('#zoom-in').onclick  = () => zoomAt(innerWidth/2, innerHeight/2, 1.25);
document.querySelector('#zoom-out').onclick = () => zoomAt(innerWidth/2, innerHeight/2, 1/1.25);
document.querySelector('#wheel-mode').onclick = e => {
  state.wheelMode = state.wheelMode === 'zoom' ? 'pan' : 'zoom';
  e.target.textContent = `Wheel: ${state.wheelMode === 'zoom' ? 'Zoom' : 'Pan'}`;
};

/* ---------------------------------------------------------------- layers */
function addLayer(name, activate = true){
  const layer = {id:uid('layer'), name:name || `Layer ${state.layers.length+1}`, visible:true, locked:false};
  state.layers.push(layer);
  if (activate) state.activeLayer = layer.id;
  renderLayers();
  return layer;
}
const layerById = id => state.layers.find(l => l.id === id);
const layerOf   = o  => layerById(o.layer) || state.layers[0];

function renderLayers(){
  const list = document.querySelector('#layer-list');
  list.innerHTML = '';
  state.layers.forEach((l, i) => {
    const n = [...state.objs.values()].filter(o => o.layer === l.id && !o.ghost).length;
    const li = document.createElement('li');
    li.className = l.id === state.activeLayer ? 'active' : '';
    li.innerHTML = `<button class="ltoggle ${l.visible?'on':''}" data-act="vis" title="Visibility">${l.visible?'◉':'○'}</button>`
                 + `<span class="lname"></span><span class="lcount">${n}</span>`
                 + `<button class="ltoggle ${l.locked?'on':''}" data-act="lock" title="Lock">${l.locked?'🔒':'🔓'}</button>`;
    li.querySelector('.lname').textContent = l.name;
    li.onclick = e => {
      const act = e.target.dataset?.act;
      if (act === 'vis')       l.visible = !l.visible;
      else if (act === 'lock') l.locked  = !l.locked;
      else                     state.activeLayer = l.id;
      renderLayers(); syncLayerStyles();
    };
    li.querySelector('.lname').ondblclick = e => {
      e.stopPropagation();
      const v = prompt('Layer name', l.name); if (v) { l.name = v; renderLayers(); }
    };
    li.style.order = String(-i);
    list.append(li);
  });
}
/* objects inherit their layer's visibility, lock and stacking */
function syncLayerStyles(){
  for (const o of state.objs.values()){
    const l = layerOf(o), idx = state.layers.indexOf(l);
    o.el.classList.toggle('hidden-layer', !l.visible);
    o.el.classList.toggle('locked', l.locked);
    o.el.classList.toggle('dim', l.id !== state.activeLayer);
    o.el.style.zIndex = String(10 + idx*10 + (o.kind === 'blob' ? 1 : 0));
  }
}
document.querySelector('#add-layer').onclick = () => { addLayer(); syncLayerStyles(); };

/* --------------------------------------------------------------- objects */
function register(o){ state.objs.set(o.id, o); measure(o); positionOf(o); renderLayers(); syncLayerStyles(); return o; }

/* size is cached: reading offsetWidth inside the physics loop would force a
   synchronous layout on every frame. Re-measure only when something changes. */
function measure(o){
  if (o.kind === 'blob'){ o.w = o.h = o.span*2; return o; }
  o.w = o.el.offsetWidth; o.h = o.el.offsetHeight;
  if (o.kind === 'root') o.y = o.h/2;          // transcript is pinned at top = 0
  return o;
}
/* every object stores its *center* in world coords */
function positionOf(o){
  if (o.kind === 'root') return;               // placed by CSS
  o.el.style.left = `${o.x - o.w/2}px`;
  o.el.style.top  = `${o.y - o.h/2}px`;
}
function boundsOf(o){ return {x:o.x - o.w/2, y:o.y - o.h/2, w:o.w, h:o.h}; }
function moveTo(o, x, y){ o.x = x; o.y = y; positionOf(o); }

/* the transcript is a landmark: it lives on a layer, but nothing pushes it */
const rootEl = document.querySelector('[data-note-id="root"]');
const rootObj = {id:'root', el:rootEl, kind:'root', x:0, y:0, w:900, h:0};

function createNote(text, wx, wy, layer = state.activeLayer){
  const el = document.querySelector('#note-template').content.firstElementChild.cloneNode(true);
  const o = {id:uid('note'), el, kind:'note', x:wx, y:wy, layer};
  el.dataset.noteId = o.id;
  const body = el.querySelector('.note-body');
  body.textContent = text; body.classList.add('fresh');
  objects.append(el);
  makeDraggable(o, el.querySelector('.drag-handle'));
  makeResizable(o, el.querySelector('.resize-handle'));
  pulse(el);
  return register(o);
}

function createBlob(wx, wy, {ghost = false, R = 46, layer = state.activeLayer} = {}){
  const el = document.querySelector('#blob-template').content.firstElementChild.cloneNode(true);
  const amp = R * 0.16;
  const o = {id:uid('blob'), el, kind:'blob', x:wx, y:wy, R, amp, span:R+amp*2+6,
             seed:Math.random()*100, ghost, layer,
             svg:el.querySelector('.blob-svg'),
             path:el.querySelector('.blob-path'),
             inner:el.querySelector('.blob-inner'),
             halo:el.querySelector('.blob-halo')};
  if (ghost) el.classList.add('ghost');
  el.style.width = el.style.height = `${o.span*2}px`;
  o.svg.setAttribute('viewBox', `${-o.span} ${-o.span} ${o.span*2} ${o.span*2}`);
  objects.append(el);
  if (!ghost){
    makeDraggable(o, el);
    el.addEventListener('click', e => { if (!el._moved) { e.stopPropagation(); onBlobClick(o); } });
  }
  return register(o);
}

function removeObj(o){ o.el.remove(); state.objs.delete(o.id); renderLayers(); }

/* the wavy circumference: several harmonics riding on a circle */
function blobPath(R, amp, seed, t, pts = 120){
  let d = '';
  for (let i = 0; i < pts; i++){
    const a = i/pts * Math.PI*2;
    const r = R + amp * (
        Math.sin(a*9  + t*1.10 + seed) * 0.50 +
        Math.sin(a*15 - t*0.80 + seed*1.7) * 0.26 +
        Math.sin(a*5  + t*0.55 + seed*0.4) * 0.30);
    d += (i ? 'L' : 'M') + (Math.cos(a)*r).toFixed(2) + ',' + (Math.sin(a)*r).toFixed(2);
  }
  return d + 'Z';
}
function drawBlobs(t){
  for (const o of state.objs.values()){
    if (o.kind !== 'blob') continue;
    if (!layerOf(o).visible) continue;
    const wob = o.ghost ? 0.72 : 1;             // a proposal ripples more faintly
    o.path.setAttribute ('d', blobPath(o.R,       o.amp*wob,     o.seed,   t));
    o.inner.setAttribute('d', blobPath(o.R*0.62,  o.amp*0.7*wob, o.seed+3, t*0.8, 80));
    o.halo.setAttribute ('d', blobPath(o.R*1.22,  o.amp*1.5*wob, o.seed+7, t*0.6, 80));
  }
}

/* ------------------------------------------------ blob → ghost → note flow */
function onBlobClick(blob){
  if (state.proposal && state.proposal.from === blob) return commitProposal();
  cancelProposal();
  const ghost = createBlob(blob.x + blob.R*2.6, blob.y - blob.R*1.4,
                           {ghost:true, R:blob.R*0.86, layer:blob.layer});
  state.proposal = {from:blob, ghost};
  state.links.push({a:anchor(blob), b:anchor(ghost), strength:.4, faint:true, temp:true});
  blob.el.classList.add('armed');
  pulseBlob(blob);
  status.textContent = 'A proposal is forming — click again to settle it into a note.';
}
function commitProposal(){
  const {from, ghost} = state.proposal;
  const note = createNote(
    `Emerging from the blob\n\nThis note condensed out of a proposal at ${Math.round(ghost.x)}, ${Math.round(ghost.y)}. Rewrite it — it is a third object between the field and the thought.`,
    ghost.x, ghost.y, from.layer);
  state.links = state.links.filter(l => !l.temp);
  state.links.push({a:anchor(from), b:anchor(note), strength:.75});
  emitBurst(ghost, 26); emitBurst(from, 14);
  removeObj(ghost); from.el.classList.remove('armed');
  state.proposal = null;
  status.textContent = 'Note settled. It will push its neighbours on this layer.';
}
function cancelProposal(){
  if (!state.proposal) return;
  removeObj(state.proposal.ghost);
  state.proposal.from.el.classList.remove('armed');
  state.links = state.links.filter(l => !l.temp);
  state.proposal = null;
}
/* The ghost trails the cursor so the second click chooses where the note lands,
   but it never falls back into its parent — below a minimum separation it is
   pushed back out along the parent→cursor direction. */
function trailGhost(){
  if (!state.proposal) return;
  const {from, ghost:g} = state.proposal;
  let tx = state.world.x, ty = state.world.y;
  const dx = tx - from.x, dy = ty - from.y, d = Math.hypot(dx, dy);
  const min = from.R + g.R + 46;
  if (d < min){
    const a = d > 0.001 ? Math.atan2(dy, dx) : Math.atan2(g.y-from.y, g.x-from.x);
    tx = from.x + Math.cos(a)*min; ty = from.y + Math.sin(a)*min;
  }
  moveTo(g, g.x + (tx - g.x)*0.14, g.y + (ty - g.y)*0.14);
}
/* the second click anywhere in open space settles the proposal into a note.
   Clicks landing on a note are left alone so text stays editable. */
function onStageClick(e){
  if (state.proposal && !e.target.closest('.blob, .note')) commitProposal();
}
function pulseBlob(o){
  o.el.animate([{transform:'scale(1)'},{transform:'scale(1.09)'},{transform:'scale(1)'}],
               {duration:420, easing:'cubic-bezier(.16,.76,.36,1)'});
}

/* ------------------------------------------------------ drag / resize / push */
function makeDraggable(o, handle){
  handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', e => {
    if (layerOf(o).locked) return;
    e.stopPropagation();
    o.el._moved = false;
    const start = {sx:e.clientX, sy:e.clientY, x:o.x, y:o.y};
    state.dragging = o;
    handle.setPointerCapture(e.pointerId);
    const move = ev => {
      const dx = (ev.clientX - start.sx)/state.view.k, dy = (ev.clientY - start.sy)/state.view.k;
      if (Math.hypot(ev.clientX-start.sx, ev.clientY-start.sy) > 4) o.el._moved = true;
      moveTo(o, start.x + dx, start.y + dy);
    };
    /* _moved is *not* cleared here — the click event fires after pointerup and
       needs to know whether this gesture was a drag. It resets on next press. */
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      state.dragging = null;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
function makeResizable(o, handle){
  handle.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const start = {sx:e.clientX, sy:e.clientY, w:o.el.offsetWidth, h:o.el.offsetHeight};
    handle.setPointerCapture(e.pointerId);
    const move = ev => {
      o.el.style.width  = `${Math.max(120, start.w + (ev.clientX-start.sx)/state.view.k)}px`;
      o.el.style.height = `${Math.max(90,  start.h + (ev.clientY-start.sy)/state.view.k)}px`;
      measure(o); positionOf(o);
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

/* soft separation: objects on the same layer refuse to overlap.
   The transcript and anything held or locked acts as an immovable wall. */
const PUSH = 0.16, GAP = 14;
const movable = o => o.kind !== 'root' && state.dragging !== o && !layerOf(o).locked;
function relax(){
  const items = [...state.objs.values()].filter(o => !o.ghost && layerOf(o).visible);
  for (let i = 0; i < items.length; i++){
    for (let j = i+1; j < items.length; j++){
      const A = items[i], B = items[j];
      if (A.layer !== B.layer) continue;                 // different levels pass through
      const a = boundsOf(A), b = boundsOf(B);
      const ox = Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x) + GAP;
      const oy = Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y) + GAP;
      if (ox <= 0 || oy <= 0) continue;
      let dx = 0, dy = 0;
      if (ox < oy) dx = (A.x <= B.x ? -1 : 1) * ox * PUSH;
      else         dy = (A.y <= B.y ? -1 : 1) * oy * PUSH;
      const aFree = movable(A), bFree = movable(B);
      if (aFree && bFree){ moveTo(A, A.x+dx/2, A.y+dy/2); moveTo(B, B.x-dx/2, B.y-dy/2); }
      else if (aFree)    { moveTo(A, A.x+dx, A.y+dy); }
      else if (bFree)    { moveTo(B, B.x-dx, B.y-dy); }
    }
  }
}

/* ----------------------------------------------------------------- links */
/* an anchor is either a text mark inside the transcript or a whole object */
const anchor = o => ({kind:'obj', id:o.id});
const markAnchor = el => ({kind:'mark', el});
function anchorPoint(a){
  if (a.kind === 'obj'){ const o = state.objs.get(a.id); return o ? {x:o.x, y:o.y} : null; }
  const r = a.el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return screenToWorld(r.left + r.width/2, r.top + r.height/2);
}
function drawLinks(){
  linkLayer.replaceChildren();
  for (const l of state.links){
    const a = anchorPoint(l.a), b = anchorPoint(l.b);
    if (!a || !b) continue;
    const bend = Math.max(50, Math.abs(b.x-a.x)*0.35);
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d', `M${a.x},${a.y} C${a.x+bend},${a.y} ${b.x-bend},${b.y} ${b.x},${b.y}`);
    p.setAttribute('class', `semantic-link${l.faint ? ' link-faint' : ''}`);
    p.style.opacity = l.faint ? .55 : .5 + l.strength*.5;
    linkLayer.append(p);
  }
  if (state.pending){
    const a = anchorPoint(state.pending.anchor), b = state.world;
    if (a){
      const p = document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d', `M${a.x},${a.y} Q${(a.x+b.x)/2},${Math.min(a.y,b.y)-80} ${b.x},${b.y}`);
      p.setAttribute('class','semantic-link feeler');
      linkLayer.append(p);
    }
  }
}

/* --------------------------------------------------- text selection links */
function selectionData(){
  const s = getSelection(); if (!s || s.rangeCount === 0 || s.isCollapsed) return null;
  const r = s.getRangeAt(0);
  const node = r.commonAncestorContainer;
  const note = node.nodeType === 1 ? node.closest('.note') : node.parentElement?.closest('.note');
  if (!note) return null;
  const rect = r.getBoundingClientRect(); if (!rect.width && !rect.height) return null;
  return {text:s.toString(), range:r.cloneRange(), note};
}
function markRange(d){
  const span = document.createElement('span'); span.className = 'selection-mark';
  try { d.range.surroundContents(span); }
  catch { const frag = d.range.extractContents(); span.append(frag); d.range.insertNode(span); }
  d.mark = span; d.anchor = markAnchor(span); getSelection().removeAllRanges(); return d;
}
function pulse(el, x=50, y=50){
  el.style.setProperty('--wx', `${x}%`); el.style.setProperty('--wy', `${y}%`);
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}
function beginConnect(){
  const d = selectionData();
  if (!d) { status.textContent = 'Select a word, letter, or phrase first.'; return; }
  state.pending = markRange(d);
  document.querySelector('#connect').textContent = 'Finish connection';
  document.querySelector('#cancel').hidden = false;
  status.textContent = 'Now select the destination text.';
  pulse(d.note);
}
function finishConnect(){
  const d = selectionData();
  if (!d) { status.textContent = 'Select destination text, then press Finish connection.'; return; }
  const b = markRange(d), a = state.pending;
  if (a.mark === b.mark) return;
  const link = {a:a.anchor, b:b.anchor, strength:Math.min(1, .25 + (a.text.length+b.text.length)/80)};
  state.links.push(link);
  pulse(b.note); spawnInterpretation(a, b);
  const pa = anchorPoint(a.anchor), pb = anchorPoint(b.anchor);
  if (pa) emitBurst(pa, 18); if (pb) emitBurst(pb, 18);
  state.pending = null;
  document.querySelector('#connect').textContent = 'Connect selection';
  document.querySelector('#cancel').hidden = true;
  status.textContent = 'Connection formed.';
}
function spawnInterpretation(a, b){
  const p1 = anchorPoint(a.anchor), p2 = anchorPoint(b.anchor);
  if (!p1 || !p2) return;
  const text = `Between “${a.text.trim()}” and “${b.text.trim()}”\n\nA possible bridge: both passages appear to exchange structure through attention. The connection becomes a third object that can be questioned, moved, and expanded.`;
  createNote(text, (p1.x+p2.x)/2 + 560, (p1.y+p2.y)/2);
}
function cancelConnect(){
  if (!state.pending) return;
  state.pending = null;
  document.querySelector('#connect').textContent = 'Connect selection';
  document.querySelector('#cancel').hidden = true;
  status.textContent = 'Connection cancelled.';
}

document.querySelector('#connect').onclick = () => state.pending ? finishConnect() : beginConnect();
document.querySelector('#cancel').onclick = cancelConnect;
document.querySelector('#append').onclick = () => {
  const input = document.querySelector('#input'), v = input.value.trim(); if (!v) return;
  const el = document.createElement('section');
  el.className = 'message user fresh';
  el.innerHTML = '<span class="role">user</span><div class="text"></div>';
  el.querySelector('.text').textContent = v;
  rootBody.append(el); input.value = ''; input.style.height = 'auto';
  pulse(rootEl); measure(rootObj);              // the transcript just grew
  const r = el.getBoundingClientRect();
  panBy(0, innerHeight*0.62 - (r.top + r.height/2));
};
document.querySelector('#input').addEventListener('input', e => {
  e.target.style.height = 'auto'; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px';
});
document.querySelector('#input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); document.querySelector('#append').click(); }
});
document.querySelector('#add-blob').onclick = () => {
  const b = createBlob(state.world.x, state.world.y); pulseBlob(b);
  status.textContent = 'Blob placed. Click it to open a proposal.';
};
document.querySelector('#add-note').onclick = () =>
  createNote('New note', state.world.x, state.world.y);

addEventListener('pointermove', e => {
  state.mouse = {x:e.clientX, y:e.clientY};
  state.world = screenToWorld(e.clientX, e.clientY);
});
addEventListener('resize', applyView);

/* -------------------------------------------------------------- energy */
const ec = document.querySelector('#energy'), ectx = ec.getContext('2d');
function emitBurst(p, n){
  for (let i = 0; i < n; i++)
    state.particles.push({x:p.x, y:p.y, a:Math.random()*Math.PI*2, s:0.3+Math.random()*1.2, l:50+Math.random()*80});
}
function drawEnergy(){
  ec.width = innerWidth*devicePixelRatio; ec.height = innerHeight*devicePixelRatio;
  ectx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  ectx.clearRect(0,0,innerWidth,innerHeight);
  ectx.globalCompositeOperation = 'lighter';
  for (const p of state.particles){
    p.x += Math.cos(p.a)*p.s; p.y += Math.sin(p.a)*p.s; p.l--;
    const s = worldToScreen(p.x, p.y);
    ectx.beginPath(); ectx.arc(s.x, s.y, 1.1*state.view.k + .4, 0, Math.PI*2);
    ectx.fillStyle = `rgba(110,160,255,${Math.max(0,p.l/130)*.35})`; ectx.fill();
  }
  state.particles = state.particles.filter(p => p.l > 0);
}

/* ----------------------------------------------------------------- orb */
const orb = document.querySelector('#neural-orb'), oc = document.querySelector('#orb-canvas'), ctx = oc.getContext('2d');
const nodes = Array.from({length:52}, () => {
  const a = Math.random()*Math.PI*2, z = Math.random()*2-1, r = Math.sqrt(1-z*z);
  return {x:r*Math.cos(a), y:r*Math.sin(a), z, phase:Math.random()*6.28};
});
let tick = 0;
function drawOrb(){
  ctx.clearRect(0,0,220,220); tick += .012;
  const P = nodes.map(n => {
    const x = n.x*Math.cos(tick) - n.z*Math.sin(tick), z = n.x*Math.sin(tick) + n.z*Math.cos(tick);
    return {x:110+x*77, y:110+n.y*77, z};
  });
  for (let i = 0; i < P.length; i++) for (let j = i+1; j < P.length; j++){
    const d = Math.hypot(P[i].x-P[j].x, P[i].y-P[j].y);
    if (d < 35){ ctx.strokeStyle = `rgba(75,135,255,${(1-d/35)*.22})`; ctx.beginPath(); ctx.moveTo(P[i].x,P[i].y); ctx.lineTo(P[j].x,P[j].y); ctx.stroke(); }
  }
  for (const p of P.sort((a,b)=>a.z-b.z)){
    ctx.fillStyle = `rgba(200,220,255,${.25+(p.z+1)*.28})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.2+(p.z+1)*.7, 0, 6.28); ctx.fill();
  }
}
let od = null;
orb.onpointerdown = e => { od = {x:e.clientX, y:e.clientY, l:orb.offsetLeft, t:orb.offsetTop}; orb.setPointerCapture(e.pointerId); };
orb.onpointermove = e => { if (!od) return; orb.style.left = od.l+e.clientX-od.x+'px'; orb.style.top = od.t+e.clientY-od.y+'px'; };
orb.onpointerup = () => od = null;

/* ---------------------------------------------------------------- boot */
const [LTranscript, LNotes, LField] = [addLayer('Transcript'), addLayer('Notes'), addLayer('Field')];
rootObj.layer = LTranscript.id;
register(rootObj);

state.activeLayer = LField.id;
createBlob(760, 240);
createBlob(-800, 700, {R:34});
state.activeLayer = LTranscript.id;   // the scroll reads at full strength on open
renderLayers(); syncLayerStyles();

/* open at reading zoom on the head of the transcript; Orient: Reset frames all */
state.view = {k:1, x:(innerWidth - (innerWidth > 760 ? 230 : 0))/2, y:64};
applyView();

let last = performance.now(), frames = 0, t = 0;
function loop(now){
  t += 0.016;
  trailGhost(); relax(); drawBlobs(t); drawLinks(); drawEnergy(); drawOrb();
  frames++;
  if (now - last > 500){
    document.querySelector('#hz').textContent = Math.round(frames*1000/(now-last)) + ' Hz';
    frames = 0; last = now;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
