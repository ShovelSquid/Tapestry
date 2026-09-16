/**
 * What the scanner claims a file says (D-31, D-33, D-34).
 *
 * Every assertion here is about restraint as much as detection: the label is
 * the whole line and never a paraphrase, a link inside a code fence is not a
 * link, and a frontmatter block it cannot parse leaves `data` null rather than
 * a half-understood guess.
 */

import { describe, expect, it } from 'vitest'
import { parseFrontmatterData, scanMarkdown } from './scan'

describe('scanMarkdown links', () => {
  it('labels a link with the whole literal line, never an extracted phrase', () => {
    const result = scanMarkdown('Best friends with [[Sable]]\n')

    expect(result.links).toHaveLength(1)
    expect(result.links[0]).toEqual({
      target: 'Sable',
      embed: false,
      // D-31 in one assertion: the sentence, not "best friends".
      line: 'Best friends with [[Sable]]',
      lineIndex: 0,
      occurrence: 0,
    })
  })

  it('gives every link on one line that same line as its label', () => {
    const line = 'Close friends with [[Sable]], [[Rune]], and [[Wren]]'
    const result = scanMarkdown(`${line}\n`)

    expect(result.links.map((link) => link.target)).toEqual(['Sable', 'Rune', 'Wren'])
    for (const link of result.links) {
      expect(link.line).toBe(line)
      expect(link.lineIndex).toBe(0)
    }
  })

  it('reads through aliases, headings and folder paths to the target', () => {
    const result = scanMarkdown('[[Sable|Sabby]]\n[[Sable#Past]]\n[[Characters/Sable]]\n')

    expect(result.links.map((link) => link.target)).toEqual([
      'Sable',
      'Sable',
      'Characters/Sable',
    ])
  })

  it('marks an embed as an embed', () => {
    const result = scanMarkdown('![[map.png]]\n')

    expect(result.links).toHaveLength(1)
    expect(result.links[0].embed).toBe(true)
    expect(result.links[0].target).toBe('map.png')

    expect(scanMarkdown('[[map.png]]\n').links[0].embed).toBe(false)
  })

  it('numbers repeats of the same target on the same line', () => {
    const result = scanMarkdown('[[Sable]] and [[Sable]]\n[[Sable]]\n')

    expect(result.links.map((link) => link.occurrence)).toEqual([0, 1, 0])
    expect(result.links[2].line).toBe('[[Sable]]')
  })

  it('drops the trailing CR from the line it records', () => {
    const result = scanMarkdown('line one\r\nlinked to [[Rune]]\r\n')

    // md.text keeps the CR because it is one of the file's bytes; md.line does
    // not, because a line ending is not part of what the line says.
    expect(result.links[0].line).toBe('linked to [[Rune]]')
    expect(result.links[0].line).not.toContain('\r')
  })
})

describe('scanMarkdown code', () => {
  it('ignores links and tags inside a fenced block', () => {
    const result = scanMarkdown('```\n[[ghost]] #ghosttag\n```\nreal [[Rune]] #real\n')

    expect(result.links.map((link) => link.target)).toEqual(['Rune'])
    expect(result.tags).toEqual(['#real'])
  })

  it('ignores a tilde fence too', () => {
    const result = scanMarkdown('~~~\n[[ghost]]\n~~~\n[[Rune]]\n')

    expect(result.links.map((link) => link.target)).toEqual(['Rune'])
  })

  it('does not treat a backtick-wrapped tag as a tag', () => {
    // Cast.md writes tags as `#Guy` and means them as code [research A4].
    const result = scanMarkdown('`#character` is how it is written, and #nightshift is real\n')

    expect(result.tags).toEqual(['#nightshift'])
  })

  it('ignores a link inside an inline code span', () => {
    const result = scanMarkdown('write `[[like this]]` to link to [[Rune]]\n')

    expect(result.links.map((link) => link.target)).toEqual(['Rune'])
  })
})

describe('scanMarkdown tags', () => {
  it('keeps literal tokens in file order without duplicates', () => {
    const result = scanMarkdown('#character and #nightshift\nagain #character\n')

    expect(result.tags).toEqual(['#character', '#nightshift'])
  })

  it('does not treat a pure number as a tag', () => {
    const result = scanMarkdown('#2024 was a year, #character is a tag\n')

    expect(result.tags).toEqual(['#character'])
  })

  it('does not treat a mid-word hash as a tag', () => {
    const result = scanMarkdown('issue#42 and a#b\n')

    expect(result.tags).toEqual([])
  })
})

describe('scanMarkdown frontmatter', () => {
  it('recognises a block only when line 0 opens it and a closer exists', () => {
    const withBlock = scanMarkdown('---\ntitle: Front\n---\nbody\n')
    expect(withBlock.frontmatter?.raw).toBe('title: Front')
    expect(withBlock.frontmatter?.data).toEqual({ title: 'Front' })

    // An opener with no closer is just text, not a block.
    expect(scanMarkdown('---\ntitle: Front\nbody\n').frontmatter).toBeNull()

    // A `---` further down the file is a horizontal rule.
    expect(scanMarkdown('body\n---\ntitle: Front\n---\n').frontmatter).toBeNull()
  })

  it('does not scan links or tags inside the frontmatter block', () => {
    const result = scanMarkdown('---\nlink: "[[Ghost]]"\ntag: "#ghost"\n---\n[[Rune]] #real\n')

    expect(result.links.map((link) => link.target)).toEqual(['Rune'])
    expect(result.tags).toEqual(['#real'])
  })

  it('parses the keys a note actually uses', () => {
    const result = scanMarkdown(
      '---\ntitle: Welcome\nwritten by: the sample\ntags: [sample, intro]\n---\nbody\n',
    )

    expect(result.frontmatter?.data).toEqual({
      title: 'Welcome',
      'written by': 'the sample',
      tags: ['sample', 'intro'],
    })
  })

  it('keeps the raw text and reports no data when the block cannot be read', () => {
    const result = scanMarkdown('---\n\tbadly: indented\n---\nbody\n')

    expect(result.frontmatter?.raw).toBe('\tbadly: indented')
    expect(result.frontmatter?.data).toBeNull()
  })

  it('refuses anchors and aliases outright rather than expanding them', () => {
    // T-02.2-35: a parser with no alias support cannot expand a
    // billion-laughs bomb at all. The raw text still survives verbatim.
    const bomb = ['a: &x ["lol","lol","lol"]', 'b: *x', 'c: *x'].join('\n')

    expect(parseFrontmatterData(bomb)).toBeNull()
    expect(scanMarkdown(`---\n${bomb}\n---\n`).frontmatter?.raw).toBe(bomb)
  })
})
