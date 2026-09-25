/**
 * Observed changes read as author unknown (02.2 D-21, 02.7 D-06, D-18): the
 * watcher names who noticed a change, never who made it.
 */

import { describe, expect, it } from 'vitest'
import { actorBadgeText, actorSpokenText } from './ProvenanceBadge'

describe('actorBadgeText', () => {
  it('marks workspace.watcher as author unknown, on screen and spoken', () => {
    const watcher = { kind: 'plugin', id: 'workspace.watcher' }
    expect(actorBadgeText(watcher)).toBe('workspace.watcher · author unknown')
    expect(actorSpokenText(watcher)).toBe('workspace.watcher, author unknown')
  })

  it('keeps obsidian.bridge and the literal ids as they were', () => {
    expect(actorBadgeText({ kind: 'plugin', id: 'obsidian.bridge' })).toBe('obsidian.bridge · author unknown')
    expect(actorBadgeText({ kind: 'plugin', id: 'agent.claude' })).toBe('agent.claude')
    expect(actorBadgeText({ kind: 'human', id: 'kaelen' })).toBe('kaelen')
  })
})
