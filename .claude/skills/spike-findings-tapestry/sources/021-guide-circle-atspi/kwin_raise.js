// KWin script: bring window PID to the front (keepAbove ON/OFF), report geometry + state.
const w = workspace.windowList().find(w => w.pid === PID && w.normalWindow && w.caption);
let st = null;
if (w) {
  w.minimized = false; w.keepAbove = KEEP; workspace.raiseWindow(w); workspace.activeWindow = w;
  st = {client: [w.clientGeometry.x, w.clientGeometry.y, w.clientGeometry.width, w.clientGeometry.height],
        active: workspace.activeWindow === w, keepAbove: w.keepAbove, minimized: w.minimized};
}
callDBus("org.tapestry.Spike", "/", "org.tapestry.Spike", "report", JSON.stringify(st));
