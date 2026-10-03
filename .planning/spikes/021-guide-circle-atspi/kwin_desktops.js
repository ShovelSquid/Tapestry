const cur = workspace.currentDesktop;
const out = workspace.windowList().filter(w => w.normalWindow && w.caption).map(w => ({
  caption: w.caption.slice(0, 40), pid: w.pid,
  desktops: w.desktops.map(d => d.name), onAll: w.onAllDesktops,
  onCurrent: w.onAllDesktops || w.desktops.indexOf(cur) >= 0,
  activities: w.activities, minimized: w.minimized, hidden: w.hidden,
  client: [Math.round(w.clientGeometry.x), Math.round(w.clientGeometry.y)],
}));
callDBus("org.tapestry.Spike", "/", "org.tapestry.Spike", "report",
         JSON.stringify({current: cur.name, activity: workspace.currentActivity, windows: out}));
