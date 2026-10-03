// Persistent KWin script: push focus changes (with KWin's clock) to org.tapestry.Feed /feed.
function send(kind, w) {
  if (!w || !w.normalWindow) return;
  callDBus("org.tapestry.Feed", "/feed", "org.tapestry.Feed", "event", JSON.stringify({
    kind: kind, ts: Date.now(), caption: w.caption, resourceClass: w.resourceClass,
    desktopFile: w.desktopFileName, pid: w.pid,
    client: [w.clientGeometry.x, w.clientGeometry.y, w.clientGeometry.width, w.clientGeometry.height]}));
}
workspace.windowActivated.connect(w => send("activated", w));
workspace.windowList().forEach(w => w.captionChanged.connect(() => { if (w === workspace.activeWindow) send("caption", w); }));
workspace.windowAdded.connect(w => w.captionChanged.connect(() => { if (w === workspace.activeWindow) send("caption", w); }));
send("initial", workspace.activeWindow);
