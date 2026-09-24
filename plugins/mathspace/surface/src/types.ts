/** Types for the plugin's CommonJS files as the bundle sees them. */
export interface Engine {
  destroy(): void
}

export interface Image {
  notes: string[]
  views: string[]
  problems: Array<{ id: string; key: string; reason: string }>
}

export interface Projection {
  views: Array<{ id: string; error?: string }>
  points: Array<{ id: string; byView: Record<string, [number, number] | null> }>
}
