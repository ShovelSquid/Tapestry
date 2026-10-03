// Persistent KWin script: push window geometry/focus/desktop changes to org.tapestry.Guide.
function info(w) {
  const cur = workspace.currentDesktop;
  return {
    caption: w.caption, resourceClass: w.resourceClass, pid: w.pid,
    active: w === workspace.activeWindow, minimized: w.minimized,
    onCurrent: w.onAllDesktops || w.desktops.indexOf(cur) >= 0,
    desktops: w.desktops.map(d => d.name),
    client: [w.clientGeometry.x, w.clientGeometry.y, w.clientGeometry.width, w.clientGeometry.height],
  };
}
function send(kind, w) {
  callDBus("org.tapestry.Guide", "/guide", "org.tapestry.Guide", "event",
           JSON.stringify({kind: kind, window: w ? info(w) : null}));
}
function watch(w) {
  if (!w.normalWindow) return;
  w.clientGeometryChanged.connect(() => send("geometry", w));
  w.minimizedChanged.connect(() => send("minimized", w));
  w.desktopsChanged.connect(() => send("desktops", w));
}
workspace.windowList().forEach(watch);
workspace.windowAdded.connect(w => { watch(w); send("added", w); });
workspace.windowRemoved.connect(w => send("removed", w));
workspace.windowActivated.connect(w => send("activated", w));
// Desktop switched: every window's onCurrent may have changed, so push them all.
workspace.currentDesktopChanged.connect(() => workspace.windowList().forEach(w => { if (w.normalWindow) send("desktop", w); }));
workspace.windowList().forEach(w => { if (w.normalWindow) send("initial", w); });
