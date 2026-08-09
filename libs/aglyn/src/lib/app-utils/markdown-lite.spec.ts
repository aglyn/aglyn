/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  collectMarkdownHeadings,
  isInternalMarkdownHref,
  markdownInlinesToText,
  parseMarkdownInlines,
  parseMarkdownLite,
  serializeMarkdownInlines,
  serializeMarkdownLite,
  slugifyHeading,
} from './markdown-lite'

describe('markdown-lite', () => {
  it('parses headings, paragraphs, lists, and images into blocks', () => {
    const blocks = parseMarkdownLite(
      '## Title\n\nHello **world** and *more*.\n\n- one\n- two\n\n![Logo](https://cdn.example.com/logo.png)',
    )
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'image',
    ])
    expect((blocks[0] as any).level).toBe(2)
    expect((blocks[2] as any).items).toHaveLength(2)
    expect((blocks[3] as any).src).toBe('https://cdn.example.com/logo.png')
  })

  it('parses inline bold/italic/links with plain text between', () => {
    const inlines = parseMarkdownInlines(
      'go **bold**, then [docs](https://example.com) end',
    )
    expect(inlines).toEqual([
      { type: 'text', text: 'go ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ', then ' },
      { type: 'link', text: 'docs', href: 'https://example.com' },
      { type: 'text', text: ' end' },
    ])
  })

  it('drops unsafe urls instead of emitting them', () => {
    const inlines = parseMarkdownInlines('[x](javascript:alert(1))')
    // The degraded link text and the unconsumed trailing `)` merge into ONE
    // canonical text inline (AGL-582) — adjacent text runs never split.
    expect(inlines).toEqual([{ type: 'text', text: 'x)' }])
    expect(inlines.every((inline) => inline.type === 'text')).toBe(true)
    // An unsafe image never yields an image block — it degrades to text.
    expect(
      parseMarkdownLite('![x](javascript:alert(1))').every(
        (block) => block.type !== 'image',
      ),
    ).toBe(true)
  })

  it('keeps site-relative links but not protocol-relative ones (AGL-582)', () => {
    expect(parseMarkdownInlines('[about](/about)')).toEqual([
      { type: 'link', text: 'about', href: '/about' },
    ])
    // //host would silently leave the site — degrade to text.
    expect(parseMarkdownInlines('[x](//evil.example)')).toEqual([
      { type: 'text', text: 'x' },
    ])
    // Site-relative IMAGES stay unsupported; media URLs are absolute.
    expect(
      parseMarkdownLite('![x](/img.png)').every(
        (block) => block.type !== 'image',
      ),
    ).toBe(true)
  })

  it('parses a fenced code block verbatim, blank lines and all (AGL-974)', () => {
    const blocks = parseMarkdownLite(
      'Before\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nAfter',
    )
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'code',
      'paragraph',
    ])
    expect(blocks[1]).toEqual({
      type: 'code',
      lang: 'ts',
      text: 'const a = 1\n\nconst b = 2',
    })
  })

  it('runs an unterminated fence to the end of the document (AGL-974)', () => {
    // A README sliced at LISTING_README_MAX_CHARS ends mid-snippet.
    expect(parseMarkdownLite('```\nhalf a snippet')).toEqual([
      { type: 'code', lang: '', text: 'half a snippet' },
    ])
  })

  it('parses a pipe table, squaring ragged rows off (AGL-974)', () => {
    const blocks = parseMarkdownLite(
      '| Prop | What it does | Default |\n' +
        '| --- | :-: | ---: |\n' +
        '| `size` | **how** big | 8 |\n' +
        '| lonely |',
    )
    expect(blocks).toHaveLength(1)
    const table = blocks[0] as any
    expect(table.type).toBe('table')
    expect(table.align).toEqual(['left', 'center', 'right'])
    expect(table.header.map((cell: any[]) => cell[0]?.text)).toEqual([
      'Prop',
      'What it does',
      'Default',
    ])
    // Every row carries exactly header.length cells; the short one pads.
    expect(table.rows.map((row: any[]) => row.length)).toEqual([3, 3])
    expect(table.rows[0][1]).toEqual([
      { type: 'bold', text: 'how' },
      { type: 'text', text: ' big' },
    ])
    expect(table.rows[1][2]).toEqual([])
  })

  it('needs a delimiter row before it calls something a table (AGL-974)', () => {
    // Prose that happens to contain pipes stays prose.
    expect(
      parseMarkdownLite('a | b\nc | d').map((block) => block.type),
    ).toEqual(['paragraph'])
  })

  it('reads a `#` heading as a heading, not literal text (AGL-1082)', () => {
    // The exact document that shipped wrong: listing ChiOYRKDeI rendered its
    // first row as the literal `# Office Hours`.
    const blocks = parseMarkdownLite('# Office Hours\n\n## What it does')
    const heading = (text: string) => ({
      type: 'heading',
      level: 2,
      inlines: [{ type: 'text', text }],
    })
    expect(blocks).toEqual([heading('Office Hours'), heading('What it does')])
    // No block anywhere still carries the hash as prose.
    expect(JSON.stringify(blocks)).not.toContain('#')
  })

  it('clamps every ATX level onto the two the union carries (AGL-1082)', () => {
    // The renderers read `level === 2 ? h2 : h3`, so a value outside 2|3 would
    // typecheck clean and render silently wrong in five places.
    for (const hashes of [1, 2, 3, 4, 5, 6]) {
      const [block] = parseMarkdownLite(`${'#'.repeat(hashes)} Title`)
      expect(block.type).toBe('heading')
      expect((block as any).level).toBe(hashes <= 2 ? 2 : 3)
      expect((block as any).inlines).toEqual([{ type: 'text', text: 'Title' }])
    }
  })

  it('still needs a hash run and a space to be a heading (AGL-1082)', () => {
    // Seven hashes is not an ATX heading in CommonMark either, and `#tag`
    // without a space is prose — widening the run must not eat those.
    for (const text of ['####### Too deep', '#NoSpace', '# ']) {
      expect(parseMarkdownLite(text).map((block) => block.type)).toEqual([
        'paragraph',
      ])
    }
  })

  it('parses a `> ` line as a quote, not literal text (AGL-1315)', () => {
    const blocks = parseMarkdownLite('> To be or not to be.')
    expect(blocks).toEqual([
      { type: 'quote', inlines: [{ type: 'text', text: 'To be or not to be.' }] },
    ])
  })

  it('groups consecutive `> ` lines into ONE quote, joined like a paragraph (AGL-1315)', () => {
    const blocks = parseMarkdownLite('> line one\n> line two\n>\n> line three')
    expect(blocks).toEqual([
      {
        type: 'quote',
        inlines: [{ type: 'text', text: 'line one line two line three' }],
      },
    ])
  })

  it('keeps quotes and paragraphs apart, with inline marks inside the quote (AGL-1315)', () => {
    const blocks = parseMarkdownLite(
      'Before.\n\n> A **bold** quote\n\nAfter.',
    )
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'quote',
      'paragraph',
    ])
    expect((blocks[1] as any).inlines).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' quote' },
    ])
  })

  it('a chunk merely containing a `>` line stays a paragraph (AGL-1315)', () => {
    const blocks = parseMarkdownLite('prose line\n> not a quote here')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        inlines: [{ type: 'text', text: 'prose line > not a quote here' }],
      },
    ])
  })

  it('a `> ` inside a code fence is snippet text, never a quote (AGL-1315)', () => {
    const blocks = parseMarkdownLite('```\n> quoted-looking line\n```')
    expect(blocks).toEqual([
      { type: 'code', lang: '', text: '> quoted-looking line' },
    ])
  })

  it('does not nest quotes — a second `>` is text of the quote (AGL-1315)', () => {
    const blocks = parseMarkdownLite('> > deep')
    expect(blocks).toEqual([
      { type: 'quote', inlines: [{ type: 'text', text: '> deep' }] },
    ])
  })

  it('parses a `1. ` line as an ordered list, not a paragraph (AGL-1320)', () => {
    const blocks = parseMarkdownLite('1. Only step')
    expect(blocks).toEqual([
      {
        type: 'orderedList',
        start: 1,
        items: [[{ type: 'text', text: 'Only step' }]],
      },
    ])
  })

  it('groups consecutive numbered lines into ONE ordered list (AGL-1320)', () => {
    // The shape /legal/dmca needs: the statutory elements as items, not one
    // run-on paragraph. `1)` is the same marker as `1.`.
    const blocks = parseMarkdownLite('1. first\n2) second\n3. third')
    expect(blocks).toEqual([
      {
        type: 'orderedList',
        start: 1,
        items: [
          [{ type: 'text', text: 'first' }],
          [{ type: 'text', text: 'second' }],
          [{ type: 'text', text: 'third' }],
        ],
      },
    ])
  })

  it('preserves an author start number other than 1 (AGL-1320)', () => {
    const blocks = parseMarkdownLite('7. seven\n8. eight')
    expect((blocks[0] as any).start).toBe(7)
    expect((blocks[0] as any).items).toHaveLength(2)
    // A counter-notice continuing at 7 must not silently restart at 1.
    expect(serializeMarkdownLite(blocks)).toBe('7. seven\n8. eight')
  })

  it('keeps inline marks inside an item, and bullets apart from numbers (AGL-1320)', () => {
    const blocks = parseMarkdownLite(
      'Intro.\n\n- bullet\n\n1. A **bold** step\n2. a [link](https://x.io) step\n\nOutro.',
    )
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'list',
      'orderedList',
      'paragraph',
    ])
    expect((blocks[2] as any).items[0]).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' step' },
    ])
    expect((blocks[2] as any).items[1]).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'link', text: 'link', href: 'https://x.io' },
      { type: 'text', text: ' step' },
    ])
  })

  it('prose reading `1997. A good year` stays prose (AGL-1320)', () => {
    // CommonMark's guard, and the reason an ordered list may only interrupt a
    // paragraph when it starts at 1: a year, a price or a footnote number
    // mid-sentence must not silently become a list.
    const blocks = parseMarkdownLite(
      'The web grew up in\n1997. A good year for the web.',
    )
    expect(blocks.map((block) => block.type)).toEqual(['paragraph'])
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      inlines: [
        {
          type: 'text',
          text: 'The web grew up in 1997. A good year for the web.',
        },
      ],
    })
    // A marker needs its separating space, exactly like `#NoSpace`.
    expect(parseMarkdownLite('1.no space').map((block) => block.type)).toEqual([
      'paragraph',
    ])
  })

  it('an ordered list interrupts a paragraph when it starts at 1 (AGL-1320)', () => {
    // The DMCA shape: an introducing line with the statutory elements
    // directly beneath it, no blank line between. It used to join into one
    // run-on paragraph on a LIVE legal page.
    const blocks = parseMarkdownLite(
      'A notice must include:\n1. a signature;\n2. the work.',
    )
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        inlines: [{ type: 'text', text: 'A notice must include:' }],
      },
      {
        type: 'orderedList',
        start: 1,
        items: [
          [{ type: 'text', text: 'a signature;' }],
          [{ type: 'text', text: 'the work.' }],
        ],
      },
    ])
  })

  it('bullets interrupt a paragraph freely (AGL-1320)', () => {
    const blocks = parseMarkdownLite('You may not:\n- do this\n- or that')
    expect(blocks).toEqual([
      { type: 'paragraph', inlines: [{ type: 'text', text: 'You may not:' }] },
      {
        type: 'list',
        items: [
          [{ type: 'text', text: 'do this' }],
          [{ type: 'text', text: 'or that' }],
        ],
      },
    ])
  })

  it('an ordered run starting at 7 mid-paragraph stays prose (AGL-1320)', () => {
    const blocks = parseMarkdownLite('Intro line:\n7. seven\n8. eight')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        inlines: [{ type: 'text', text: 'Intro line: 7. seven 8. eight' }],
      },
    ])
    // But a chunk that OPENS with it is interrupting nothing, so the author's
    // start number still survives — the counter-notice resuming at seven.
    const standalone = parseMarkdownLite('7. seven\n8. eight')
    expect(standalone.map((block) => block.type)).toEqual(['orderedList'])
    expect((standalone[0] as any).start).toBe(7)
  })

  it('a list ends at the first non-item line, which starts a paragraph (AGL-1320)', () => {
    const blocks = parseMarkdownLite(
      'Steps:\n1. first\n2. second\nThat is all.\n- and a bullet',
    )
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'orderedList',
      'paragraph',
      'list',
    ])
    expect((blocks[2] as any).inlines).toEqual([
      { type: 'text', text: 'That is all.' },
    ])
  })

  it('a fence holding `1. ` is untouched by the interrupt rule (AGL-1320)', () => {
    // Fences are cut out before chunking, so nothing inside one is ever
    // scanned for markers — intro line or not.
    const blocks = parseMarkdownLite(
      'Run it:\n\n```bash\nnpm i thing\n1. not a list\n- nor this\n```\n\nDone.',
    )
    expect(blocks).toEqual([
      { type: 'paragraph', inlines: [{ type: 'text', text: 'Run it:' }] },
      {
        type: 'code',
        lang: 'bash',
        text: 'npm i thing\n1. not a list\n- nor this',
      },
      { type: 'paragraph', inlines: [{ type: 'text', text: 'Done.' }] },
    ])
  })

  it('a `1. ` inside a code fence is snippet text, never a list (AGL-1320)', () => {
    const blocks = parseMarkdownLite('```bash\n1. npm i thing\n2. done\n```')
    expect(blocks).toEqual([
      { type: 'code', lang: 'bash', text: '1. npm i thing\n2. done' },
    ])
  })

  it('does not nest ordered items — an indented one is a sibling (AGL-1320)', () => {
    // The dialect has no nesting anywhere; indentation is trimmed, so the
    // sub-item degrades to a visible sibling rather than to prose.
    const blocks = parseMarkdownLite('1. top\n    1. sub')
    expect(blocks).toEqual([
      {
        type: 'orderedList',
        start: 1,
        items: [
          [{ type: 'text', text: 'top' }],
          [{ type: 'text', text: 'sub' }],
        ],
      },
    ])
  })

  it('renumbers a `1. 1. 1.` source contiguously (AGL-1320)', () => {
    // Only the FIRST marker is read, so the lazy markdown idiom normalizes.
    const blocks = parseMarkdownLite('1. a\n1. b\n1. c')
    expect((blocks[0] as any).start).toBe(1)
    expect(serializeMarkdownLite(blocks)).toBe('1. a\n2. b\n3. c')
  })

  it('classifies internal hrefs for AppLink rendering (AGL-582)', () => {
    expect(isInternalMarkdownHref('/blog/post')).toBe(true)
    expect(isInternalMarkdownHref('//evil.example')).toBe(false)
    expect(isInternalMarkdownHref('https://example.com')).toBe(false)
  })
})

describe('serializeMarkdownLite (AGL-582)', () => {
  /**
   * Representative documents the WYSIWYG editor must round-trip. Each is
   * checked for BOTH properties below: model identity after one round-trip
   * and string stability after a second one.
   */
  const corpus: Record<string, string> = {
    'plain paragraph': 'Hello world.',
    'heading + paragraph + list + image':
      '## Title\n\nHello **world** and *more*.\n\n- one\n- two\n\n' +
      '![Logo](https://cdn.example.com/logo.png)',
    'h3 heading with inline marks': '### A **bold** and *slanted* heading',
    'adjacent bold then italic': '**a***b*',
    'adjacent italic then bold': '*a***b**',
    'adjacent bold runs': '**a****b**',
    'bold at paragraph edges': '**start** middle **end**',
    'text with a lone asterisk': 'a * b stays plain',
    'unbalanced double asterisk': 'a ** b stays plain',
    'external link with query string':
      'See [docs](https://example.com/a?b=c&d=e) for details.',
    'internal site-relative link': 'Go to [pricing](/pricing) today.',
    'link with parens-free URL path':
      '[release notes](https://example.com/notes/v2)',
    'image with empty alt': '![](https://cdn.example.com/pic.png)',
    'list run with inline marks':
      '- plain item\n- **bold** item\n- a [link](https://example.com) item',
    'asterisk bullets normalize to dashes': '* one\n* two\n* three',
    'many blank lines between blocks': '## A\n\n\n\n\nB\n\n\n\nC',
    'multi-line paragraph joins with a space': 'line one\nline two',
    'h1 and h4 clamp onto the two rendered levels (AGL-1082)':
      '# top level\n\n#### deep level',
    'unsafe link degrades to text': 'x [y](javascript:alert(1)) z',
    'protocol-relative link degrades to text': 'x [y](//evil.example) z',
    'unsafe image block is dropped': 'before\n\n![x](/relative.png)\n\nafter',
    'surrounding whitespace': '\n\n  ## Padded  \n\n  body  \n\n',
    'empty document': '',
    'fenced code block with a language':
      'Install it:\n\n```bash\nnpm i thing\n```\n\nDone.',
    'code block with blank lines and no language':
      '```\nconst a = 1\n\nconst b = 2\n```',
    'empty code fence': '```\n```',
    'code block whose text looks like markdown': '```md\n## not a heading\n- x\n```',
    'unterminated fence runs to the end': '```ts\nconst a = 1',
    'table with alignments':
      '| Prop | Does | Default |\n| :-- | :-: | --: |\n| size | how big | 8 |',
    'table with no body rows': '| A | B |\n| --- | --- |',
    'ragged table rows square off':
      '| A | B | C |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |',
    'table cells with inline marks':
      '| Prop | Docs |\n| --- | --- |\n| **size** | [read](https://example.com) |',
    'table with an empty cell': '| A | B |\n| --- | --- |\n|  | 2 |',
    'pipes in prose are not a table': 'a | b\nc | d',
    'single-line quote (AGL-1315)': '> To be or not to be.',
    'multi-line quote joins to one line': '> line one\n> line two',
    'quote with inline marks': '> A **bold** and *slanted* [q](https://x.io)',
    'quote between paragraphs': 'Before.\n\n> The quote.\n\nAfter.',
    'ordered list (AGL-1320)': '1. first\n2. second\n3. third',
    'ordered list with a non-1 start': '7. seven\n8. eight',
    'ordered list with `)` markers normalizes to `.`': '1) a\n2) b',
    'lazy `1. 1. 1.` renumbers contiguously': '1. a\n1. b\n1. c',
    'ordered items with inline marks':
      '1. **bold** step\n2. a [link](https://example.com) step',
    'ordered list between paragraphs':
      'Before.\n\n1. step one\n2. step two\n\nAfter.',
    'bullets and numbers stay separate blocks': '- bullet\n\n1. number',
    'DMCA shape: heading, prose, enumerated elements':
      '## Notice\n\nA notice must include:\n\n1. A **signature**.\n' +
      '2. The work.\n3. The material.\n4. Your contact [details](/legal).\n' +
      '5. A good-faith statement.\n6. A statement under penalty of perjury.',
    // The same document authored the NATURAL way — no blank line between the
    // introducing line and its items (AGL-1320). The split chunk has to come
    // back through the serializer as the same paragraph + list pair.
    'DMCA shape authored with no blank line before the elements':
      '## Notice\n\nA notice must include:\n1. A **signature**.\n' +
      '2. The work.\n3. Your contact [details](/legal).',
    'bullets interrupting a paragraph': 'You may not:\n- do this\n- or that',
    'ordered run at 7 mid-paragraph stays prose':
      'Intro line:\n7. seven\n8. eight',
    'prose reading `1997. A good year` stays prose':
      'The web grew up in\n1997. A good year for the web.',
    'list then a trailing paragraph, all one chunk':
      'Steps:\n1. first\n2. second\nThat is all.',
    'two interrupted lists in one chunk':
      'Do:\n- a\n- b\nThen:\n1. one\n2. two',
    'README shape: heading, table, fence':
      '## Config\n\n| Prop | Default |\n| --- | --- |\n| size | 8 |\n\n' +
      '```ts\nregister({ size: 8 })\n```\n\nThat is all.',
  }

  it.each(Object.entries(corpus))(
    'round-trips the model: %s',
    (_name, text) => {
      const model = parseMarkdownLite(text)
      const serialized = serializeMarkdownLite(model)
      // parse(serialize(parse(text))) is deep-equal to parse(text) — the
      // visual editor can rebuild the exact model from what it stores.
      expect(parseMarkdownLite(serialized)).toEqual(model)
    },
  )

  it.each(Object.entries(corpus))(
    'serialization is stable under a second round-trip: %s',
    (_name, text) => {
      const once = serializeMarkdownLite(parseMarkdownLite(text))
      const twice = serializeMarkdownLite(parseMarkdownLite(once))
      expect(twice).toBe(once)
    },
  )

  it('emits the canonical dialect forms', () => {
    expect(
      serializeMarkdownLite([
        { type: 'heading', level: 3, inlines: [{ type: 'text', text: 'Hi' }] },
        {
          type: 'paragraph',
          inlines: [
            { type: 'text', text: 'a ' },
            { type: 'bold', text: 'b' },
            { type: 'italic', text: 'c' },
            { type: 'link', text: 'd', href: '/d' },
          ],
        },
        {
          type: 'list',
          items: [
            [{ type: 'text', text: 'one' }],
            [{ type: 'text', text: 'two' }],
          ],
        },
        { type: 'image', src: 'https://x.example/p.png', alt: 'pic' },
      ]),
    ).toBe(
      '### Hi\n\na **b***c*[d](/d)\n\n- one\n- two\n\n' +
        '![pic](https://x.example/p.png)',
    )
  })

  it('separates a paragraph from a following list with a blank line (AGL-1320)', () => {
    // The blank line is what makes the interrupt split round-trip: written
    // back this way, the pair re-parses to the pair rather than to one chunk
    // that has to be re-split.
    const model = parseMarkdownLite('A notice must include:\n1. a signature;')
    expect(serializeMarkdownLite(model)).toBe(
      'A notice must include:\n\n1. a signature;',
    )
    expect(parseMarkdownLite(serializeMarkdownLite(model))).toEqual(model)
    expect(
      serializeMarkdownLite(parseMarkdownLite('You may not:\n- do this')),
    ).toBe('You may not:\n\n- do this')
  })

  it('normalizes editor models the dialect cannot represent', () => {
    // No escape syntax exists, so unrepresentable characters drop instead
    // of corrupting the document, and empty blocks/items are omitted —
    // exactly what the parser would discard anyway.
    expect(
      serializeMarkdownLite([
        { type: 'paragraph', inlines: [{ type: 'bold', text: 'a*b' }] },
        { type: 'paragraph', inlines: [{ type: 'text', text: '  ' }] },
        {
          type: 'list',
          items: [[{ type: 'text', text: 'kept' }], [], [{ type: 'text', text: ' ' }]],
        },
        {
          type: 'paragraph',
          inlines: [{ type: 'link', text: 'x]y', href: 'https://a b.example/(c)' }],
        },
      ]),
    ).toBe('**ab**\n\n- kept\n\n[xy](https://ab.example/(c)')
  })

  it('serializes inline runs standalone', () => {
    expect(
      serializeMarkdownInlines([
        { type: 'text', text: 'multi\nline' },
        { type: 'bold', text: 'b' },
      ]),
    ).toBe('multi line**b**')
  })
})

describe('markdown-lite heading anchors (AGL-1162)', () => {
  it('reads a heading as its plain words, marks and links removed', () => {
    const [heading] = parseMarkdownLite(
      '## The **fine** print and [terms](https://example.com)',
    )
    expect(markdownInlinesToText((heading as any).inlines)).toBe(
      'The fine print and terms',
    )
  })

  it('slugifies the way a hand-written anchor would', () => {
    expect(slugifyHeading('Your Rights & Choices')).toBe('your-rights-choices')
    expect(slugifyHeading('  Section 4.2 — Retention  ')).toBe(
      'section-4-2-retention',
    )
    // Accents fold to their base letter rather than becoming an
    // unreadable percent-encoded id.
    expect(slugifyHeading('Résumé')).toBe('resume')
    // A heading with nothing sluggable still has to be linkable.
    expect(slugifyHeading('!!!')).toBe('section')
  })

  it('is deterministic — re-pasting the same source keeps every anchor', () => {
    const source = '## One\n\ntext\n\n### Two\n\nmore'
    const first = collectMarkdownHeadings(parseMarkdownLite(source))
    const again = collectMarkdownHeadings(parseMarkdownLite(source))
    expect(again).toEqual(first)
    expect(first.map((entry) => entry.slug)).toEqual(['one', 'two'])
  })

  it('numbers duplicate headings instead of colliding', () => {
    const headings = collectMarkdownHeadings(
      parseMarkdownLite('## Notice\n\n## Notice\n\n## Notice'),
    )
    expect(headings.map((entry) => entry.slug)).toEqual([
      'notice',
      'notice-2',
      'notice-3',
    ])
  })

  it('does not hand a suffixed slug to a heading that already owns it', () => {
    // The trap a plain counter falls into: `## Notice` twice wants
    // `notice-2`, and `## Notice 2` slugifies to exactly that.
    const headings = collectMarkdownHeadings(
      parseMarkdownLite('## Notice\n\n## Notice 2\n\n## Notice'),
    )
    expect(headings.map((entry) => entry.slug)).toEqual([
      'notice',
      'notice-2',
      'notice-3',
    ])
    expect(new Set(headings.map((entry) => entry.slug)).size).toBe(3)
  })

  it('reports the level and the block index each heading came from', () => {
    const blocks = parseMarkdownLite('intro\n\n## Top\n\nbody\n\n### Sub')
    expect(collectMarkdownHeadings(blocks)).toEqual([
      { level: 2, text: 'Top', slug: 'top', index: 1 },
      { level: 3, text: 'Sub', slug: 'sub', index: 3 },
    ])
  })

  it('gives an out-of-range ATX heading the same anchor treatment', () => {
    // `#` and `####`+ clamp onto the two rendered levels (AGL-1082), so a
    // README-shaped document still gets a complete set of anchors.
    const headings = collectMarkdownHeadings(
      parseMarkdownLite('# Privacy Policy\n\n#### Deep note'),
    )
    expect(headings).toEqual([
      { level: 2, text: 'Privacy Policy', slug: 'privacy-policy', index: 0 },
      { level: 3, text: 'Deep note', slug: 'deep-note', index: 1 },
    ])
  })

  it('finds nothing in a document with no headings', () => {
    expect(collectMarkdownHeadings(parseMarkdownLite('just prose'))).toEqual([])
  })
})
