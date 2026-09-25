import { describe, expect, it } from 'vitest'
import {
  authorPaletteIndex,
  authorPattern,
  authorToken,
  orderAgentsByConnection,
  AUTHOR_PALETTE_SIZE,
} from './author-palette'

describe('orderAgentsByConnection', () => {
  it('orders agents by createdAt ascending', () => {
    const agents = [
      { name: 'gemini', createdAt: '2026-09-15T12:00:00Z' },
      { name: 'claude', createdAt: '2026-09-10T09:00:00Z' },
      { name: 'gpt', createdAt: '2026-09-20T09:00:00Z' },
    ]
    expect(orderAgentsByConnection(agents)).toEqual(['claude', 'gemini', 'gpt'])
  })
})

describe('authorToken / authorPattern / authorPaletteIndex', () => {
  const order = ['claude', 'gemini', 'gpt', 'grok', 'llama', 'sixth']

  it('a human actor is always the self token, solid, index 0', () => {
    expect(authorToken('user.kaelen', order)).toBe('--tap-author-self')
    expect(authorPattern('user.kaelen', order)).toBe('solid')
    expect(authorPaletteIndex('user.kaelen', order)).toBe(0)
  })

  it('the first five connected agents get distinct tokens, patterns and indices, in connection order', () => {
    expect(authorToken('agent.claude', order)).toBe('--tap-author-1')
    expect(authorToken('agent.gemini', order)).toBe('--tap-author-2')
    expect(authorToken('agent.gpt', order)).toBe('--tap-author-3')
    expect(authorToken('agent.grok', order)).toBe('--tap-author-4')
    expect(authorToken('agent.llama', order)).toBe('--tap-author-5')

    expect(authorPattern('agent.claude', order)).toBe('dotted')
    expect(authorPattern('agent.gemini', order)).toBe('dashed')
    expect(authorPattern('agent.gpt', order)).toBe('long-dash')
    expect(authorPattern('agent.grok', order)).toBe('dash-dot')
    expect(authorPattern('agent.llama', order)).toBe('double')

    expect(authorPaletteIndex('agent.claude', order)).toBe(1)
    expect(authorPaletteIndex('agent.llama', order)).toBe(5)
  })

  it('a sixth agent cycles the palette rather than running out of colours', () => {
    expect(authorToken('agent.sixth', order)).toBe('--tap-author-1')
    expect(authorPattern('agent.sixth', order)).toBe('dotted')
    expect(authorPaletteIndex('agent.sixth', order)).toBe(1)
  })

  it('an agent this renderer has never heard of reads as unknown, never a stolen colour', () => {
    expect(authorToken('agent.stranger', order)).toBe('--tap-author-unknown')
    expect(authorPattern('agent.stranger', order)).toBe('wavy')
    expect(authorPaletteIndex('agent.stranger', order)).toBe(6)
  })

  it('an observed edit (obsidian.bridge) and the UNKNOWN_AUTHOR sentinel both read as unknown', () => {
    expect(authorToken('obsidian.bridge', order)).toBe('--tap-author-unknown')
    expect(authorToken('unknown', order)).toBe('--tap-author-unknown')
  })

  it('AUTHOR_PALETTE_SIZE covers every index authorPaletteIndex can return', () => {
    const indices = [
      authorPaletteIndex('user.kaelen', order),
      ...order.map((name) => authorPaletteIndex(`agent.${name}`, order)),
      authorPaletteIndex('agent.stranger', order),
    ]
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(AUTHOR_PALETTE_SIZE)
    }
  })
})
