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
    expect(inlines[0]).toEqual({ type: 'text', text: 'x' })
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
