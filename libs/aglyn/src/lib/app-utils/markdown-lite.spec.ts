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
  isInternalMarkdownHref,
  parseMarkdownInlines,
  parseMarkdownLite,
  serializeMarkdownInlines,
  serializeMarkdownLite,
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
    'h1 and h4 are not headings': '# not a heading\n\n#### also not',
    'unsafe link degrades to text': 'x [y](javascript:alert(1)) z',
    'protocol-relative link degrades to text': 'x [y](//evil.example) z',
    'unsafe image block is dropped': 'before\n\n![x](/relative.png)\n\nafter',
    'surrounding whitespace': '\n\n  ## Padded  \n\n  body  \n\n',
    'empty document': '',
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
