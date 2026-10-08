// Builds the surface-nets mesh off the main thread. Gets a snapshot of the particles, sends
// back typed arrays (transferred, not copied).

import { Blob, surfaceNets } from "./blob.js";

self.onmessage = ({ data }) => {
  const blob = Object.create(Blob.prototype);
  Object.assign(blob, data);
  blob.pack();
  const m = surfaceNets(blob, data.cell);
  self.postMessage(m, [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer]);
};
