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
  authorHtmlToMarkdown,
  inlineAuthorHtmlToMarkdown,
} from './author-html-markdown'

describe('authorHtmlToMarkdown', () => {
  it('maps headings to their own level', () => {
    expect(authorHtmlToMarkdown('<h2>Pricing</h2>')).toBe('## Pricing')
    expect(authorHtmlToMarkdown('<h4>Fine print</h4>')).toBe('#### Fine print')
  })

  it('maps the inline marks', () => {
    expect(authorHtmlToMarkdown('<p><strong>Bold</strong> and <em>soft</em></p>')).toBe(
      '**Bold** and _soft_',
    )
    expect(authorHtmlToMarkdown('<p><del>gone</del></p>')).toBe('~~gone~~')
    expect(authorHtmlToMarkdown('<p>Run <code>npm ci</code></p>')).toBe(
      'Run `npm ci`',
    )
  })

  it('keeps a nested mark inside its link', () => {
    // The splice-on-close path: the `<strong>` markers are already in the
    // output buffer when the anchor closes, so rebuilding link text from the
    // tokens instead would silently drop the emphasis.
    expect(
      authorHtmlToMarkdown('<p>See <a href="https://x.test"><strong>docs</strong></a>.</p>'),
    ).toBe('See [**docs**](https://x.test).')
  })

  it('separates block elements with one blank line', () => {
    expect(authorHtmlToMarkdown('<p>One</p><p>Two</p>')).toBe('One\n\nTwo')
  })

  it('renders bullet and numbered lists, nested', () => {
    expect(authorHtmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
    expect(authorHtmlToMarkdown('<ol><li>first</li><li>second</li></ol>')).toBe(
      '1. first\n2. second',
    )
    expect(
      authorHtmlToMarkdown('<ul><li>a<ul><li>inner</li></ul></li></ul>'),
    ).toContain('  - inner')
  })

  it('keeps whitespace inside pre and fences it once', () => {
    expect(authorHtmlToMarkdown('<pre><code>a\n  b</code></pre>')).toBe(
      '```\na\n  b\n```',
    )
  })

  it('drops script and style WITH their contents', () => {
    expect(
      authorHtmlToMarkdown('<p>Keep</p><script>alert(1)</script><style>p{}</style>'),
    ).toBe('Keep')
  })

  it('unwraps an element it does not know rather than dropping it', () => {
    // The sanitizer's own rule. Silence is the failure an author cannot see.
    expect(authorHtmlToMarkdown('<marquee>Still here</marquee>')).toBe('Still here')
  })

  it('escapes markdown control characters in author text', () => {
    expect(authorHtmlToMarkdown('<p>2 * 3 _ 4</p>')).toBe('2 \\* 3 \\_ 4')
  })

  it('decodes character references', () => {
    expect(authorHtmlToMarkdown('<p>Tom &amp; Jerry&nbsp;&mdash; friends</p>')).toBe(
      'Tom & Jerry — friends',
    )
  })

  it('treats a stray < as literal text', () => {
    expect(authorHtmlToMarkdown('<p>a < b</p>')).toBe('a \\< b')
  })

  it('ignores an unmatched end tag', () => {
    expect(authorHtmlToMarkdown('<p>Text</em></p>')).toBe('Text')
  })

  it('absolutizes a site-relative link against the origin', () => {
    expect(
      authorHtmlToMarkdown('<a href="/pricing">Pricing</a>', {
        origin: 'https://example.test',
      }),
    ).toBe('[Pricing](https://example.test/pricing)')
  })

  it('leaves an already-absolute link alone', () => {
    expect(
      authorHtmlToMarkdown('<a href="https://other.test/x">X</a>', {
        origin: 'https://example.test',
      }),
    ).toBe('[X](https://other.test/x)')
  })

  it('emits a bare URL for an anchor with no text', () => {
    expect(authorHtmlToMarkdown('<a href="https://x.test"></a>')).toBe(
      'https://x.test',
    )
  })

  it('keeps link text when the anchor has no href', () => {
    expect(authorHtmlToMarkdown('<a>Unlinked</a>')).toBe('Unlinked')
  })

  it('resolves a media reference on an image', () => {
    const out = authorHtmlToMarkdown('<img src="/api/media/cdn/x.png" alt="A cat">', {
      origin: 'https://example.test',
    })
    expect(out).toBe('![A cat](https://example.test/api/media/cdn/x.png)')
  })

  it('drops an image whose source cannot be made fetchable', () => {
    // Same rule the email renderer states: a gap beats a broken-image box.
    expect(authorHtmlToMarkdown('<img src="/rel.png" alt="x">')).toBe('')
  })

  it('returns empty for empty input', () => {
    expect(authorHtmlToMarkdown('')).toBe('')
    expect(authorHtmlToMarkdown(undefined as unknown as string)).toBe('')
  })

  it('drops comments and doctypes', () => {
    expect(authorHtmlToMarkdown('<!-- hi --><p>Body</p>')).toBe('Body')
  })
})

describe('inlineAuthorHtmlToMarkdown', () => {
  it('keeps marks but flattens block structure to one line', () => {
    expect(inlineAuthorHtmlToMarkdown('<strong>Buy</strong> now')).toBe(
      '**Buy** now',
    )
    expect(inlineAuthorHtmlToMarkdown('<h2>Big</h2><p>label</p>')).toBe('Big label')
  })

  it('never emits a heading marker inside a control label', () => {
    expect(inlineAuthorHtmlToMarkdown('<h1>Go</h1>')).not.toContain('#')
  })

  it('turns a line break into a space', () => {
    expect(inlineAuthorHtmlToMarkdown('a<br>b')).toBe('a b')
  })
})
