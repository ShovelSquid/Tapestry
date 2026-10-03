// KWin script: report every normal window's geometry, desktop and stacking to the spike's D-Bus receiver.
const cur = workspace.currentDesktop;
const stack = workspace.stackingOrder;
const out = workspace.windowList().filter(w => w.normalWindow).map(w => ({
  caption: w.caption, resourceClass: w.resourceClass, pid: w.pid,
  active: w === workspace.activeWindow,
  onCurrent: w.onAllDesktops || w.desktops.indexOf(cur) >= 0,
  desktops: w.desktops.map(d => d.name), minimized: w.minimized,
  stackIndex: stack.indexOf(w),
  frame: [w.frameGeometry.x, w.frameGeometry.y, w.frameGeometry.width, w.frameGeometry.height],
  client: [w.clientGeometry.x, w.clientGeometry.y, w.clientGeometry.width, w.clientGeometry.height],
}));
callDBus("org.tapestry.Spike", "/", "org.tapestry.Spike", "report", JSON.stringify(out));
