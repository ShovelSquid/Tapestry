/**
 * The workspace-files plugin maps each workspace node type to its view.
 */

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PLUGIN_DIR = resolve(__dirname, '..', '..', '..', 'plugins', 'workspace-files')
const requirePlugin = createRequire(__filename)

describe('workspace-files plugin', () => {
  it('registers the three workspace node views', () => {
    const plugin = requirePlugin(resolve(PLUGIN_DIR, 'index.js')) as {
      name: string
      activate(context: unknown): void
    }
    const registered: Array<{ nodeType: string; displayName: string; component: string }> = []
    plugin.activate({ registerNodeView: (view: (typeof registered)[number]) => registered.push(view) })

    expect(plugin.name).toBe('workspace-files')
    expect(registered).toEqual([
      { nodeType: 'tapestry.workspace/text@1', displayName: 'Workspace file', component: 'WorkspaceFileCard' },
      {
        nodeType: 'tapestry.workspace/file@1',
        displayName: 'Workspace file (not text)',
        component: 'WorkspaceFileCard',
      },
      { nodeType: 'tapestry.workspace/folder@1', displayName: 'Workspace folder', component: 'WorkspaceFolderLabel' },
    ])
  })

  it('declares the same node types in its manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(PLUGIN_DIR, 'tapestry.plugin.json'), 'utf-8'))
    expect(manifest.name).toBe('workspace-files')
    expect(manifest.api).toBe('1')
    expect(manifest.contributions.nodeTypes).toEqual([
      'tapestry.workspace/text@1',
      'tapestry.workspace/file@1',
      'tapestry.workspace/folder@1',
    ])
  })
})
