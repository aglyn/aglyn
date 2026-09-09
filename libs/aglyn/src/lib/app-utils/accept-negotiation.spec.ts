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
  HTML_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  isPageUnacceptable,
  negotiateMediaType,
  notAcceptableBody,
  parseAcceptHeader,
  varyWithAccept,
  wantsMarkdown,
} from './accept-negotiation'

const PAGE = [HTML_MEDIA_TYPE, MARKDOWN_MEDIA_TYPE]
const MARKDOWN_ONLY = [MARKDOWN_MEDIA_TYPE]

describe('parseAcceptHeader', () => {
  it('defaults an absent q to 1 and lowercases the range', () => {
    expect(parseAcceptHeader('Text/Markdown')).toEqual([
      { type: 'text', subtype: 'markdown', q: 1 },
    ])
  })

  it('reads q values and tolerates surrounding whitespace', () => {
    expect(parseAcceptHeader('text/markdown, text/html ; q=0.8')).toEqual([
      { type: 'text', subtype: 'markdown', q: 1 },
      { type: 'text', subtype: 'html', q: 0.8 },
    ])
  })

  it('treats a malformed q as ABSENT, never as a refusal', () => {
    // A typo must not be able to turn an ordinary request into a 406.
    expect(parseAcceptHeader('text/markdown;q=abc')[0].q).toBe(1)
    expect(parseAcceptHeader('text/markdown;q=')[0].q).toBe(1)
  })

  it('clamps out-of-range q values', () => {
    expect(parseAcceptHeader('text/html;q=9')[0].q).toBe(1)
    expect(parseAcceptHeader('text/html;q=-2')[0].q).toBe(0)
  })

  it('ignores parameters that follow q — those are response parameters', () => {
    expect(parseAcceptHeader('text/html;q=0.5;q=1')[0].q).toBe(0.5)
  })

  it('drops ranges it cannot read rather than widening them', () => {
    expect(parseAcceptHeader('nonsense, text/html')).toEqual([
      { type: 'text', subtype: 'html', q: 1 },
    ])
    // A wildcard type with a concrete subtype is unsatisfiable.
    expect(parseAcceptHeader('*/plain')).toEqual([])
  })

  it('returns nothing for an absent or empty header', () => {
    expect(parseAcceptHeader(null)).toEqual([])
    expect(parseAcceptHeader('   ')).toEqual([])
  })
})

/**
 * The published acceptmarkdown.com conformance vectors, verbatim. They are the
 * externally-visible contract this module exists to satisfy, so they are
 * asserted as a table rather than paraphrased into prose assertions.
 */
describe('negotiateMediaType — acceptmarkdown.com test vectors', () => {
  const cases: Array<{
    accept: string | null
    produces: string[]
    expected: string | null
    label: string
  }> = [
    { accept: 'text/markdown', produces: PAGE, expected: MARKDOWN_MEDIA_TYPE, label: 'markdown' },
    {
      accept: 'text/markdown, text/html;q=0.8',
      produces: PAGE,
      expected: MARKDOWN_MEDIA_TYPE,
      label: 'markdown',
    },
    { accept: 'text/html', produces: PAGE, expected: HTML_MEDIA_TYPE, label: 'html' },
    {
      accept: 'text/markdown;q=0, text/html',
      produces: PAGE,
      expected: HTML_MEDIA_TYPE,
      label: 'html',
    },
    { accept: 'text/markdown;q=0', produces: MARKDOWN_ONLY, expected: null, label: '406' },
    { accept: null, produces: PAGE, expected: HTML_MEDIA_TYPE, label: 'html (default)' },
    { accept: '*/*', produces: PAGE, expected: HTML_MEDIA_TYPE, label: 'html (default)' },
  ]

  for (const { accept, produces, expected, label } of cases) {
    it(`${accept ?? '(no Accept)'} → ${label}`, () => {
      expect(negotiateMediaType(accept, produces)).toBe(expected)
    })
  }
})

describe('negotiateMediaType', () => {
  it('serves HTML to a real Chrome document request', () => {
    // The exact header the guide names as the one a substring test gets wrong.
    const chrome =
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
      'image/webp,*/*;q=0.8'
    expect(negotiateMediaType(chrome, PAGE)).toBe(HTML_MEDIA_TYPE)
    expect(wantsMarkdown(chrome)).toBe(false)
  })

  it('lets an exact q=0 beat a wildcard that would have accepted it', () => {
    // Specificity, not q, decides which entry speaks for a media type —
    // otherwise `text/*` here would read as an acceptance of markdown.
    expect(negotiateMediaType('text/markdown;q=0, text/*', PAGE)).toBe(
      HTML_MEDIA_TYPE,
    )
  })

  it('honors a subtype wildcard when nothing more specific matches', () => {
    expect(negotiateMediaType('text/*', PAGE)).toBe(HTML_MEDIA_TYPE)
  })

  it('prefers the higher q even when the server prefers the other', () => {
    expect(negotiateMediaType('text/html;q=0.3, text/markdown;q=0.9', PAGE)).toBe(
      MARKDOWN_MEDIA_TYPE,
    )
  })

  it('ignores media-type parameters on the produced type', () => {
    expect(
      negotiateMediaType('text/markdown', ['text/markdown; charset=utf-8']),
    ).toBe('text/markdown; charset=utf-8')
  })

  it('treats a refusals-only header as a constraint, not a demand', () => {
    /*
      The pair the published gotcha and the vector table pin together. The same
      header is a fallback when something else survives the refusal and a 406
      when nothing does — so neither "score unlisted types as zero" nor "ignore
      q=0" can produce both answers.
    */
    expect(negotiateMediaType('text/markdown;q=0', PAGE)).toBe(HTML_MEDIA_TYPE)
    expect(negotiateMediaType('text/markdown;q=0', MARKDOWN_ONLY)).toBeNull()
    expect(negotiateMediaType('*/*;q=0', PAGE)).toBeNull()
  })

  it('is null only when every representation is refused or unmatched', () => {
    expect(negotiateMediaType('application/pdf', PAGE)).toBeNull()
    expect(negotiateMediaType('text/html;q=0, text/markdown;q=0', PAGE)).toBeNull()
    expect(negotiateMediaType('text/markdown', [])).toBeNull()
  })

  it('never 406s a request that merely missed one representation', () => {
    expect(isPageUnacceptable('text/html')).toBe(false)
    expect(isPageUnacceptable(null)).toBe(false)
    expect(isPageUnacceptable('*/*')).toBe(false)
    expect(isPageUnacceptable('text/markdown;q=0')).toBe(false)
  })
})

describe('wantsMarkdown', () => {
  it.each([
    ['text/markdown', true],
    ['text/markdown;q=0.9, text/html;q=0.5', true],
    ['text/markdown, text/plain', true],
    ['text/html', false],
    ['*/*', false],
    ['', false],
    ['text/markdown;q=0', false],
  ])('%s → %s', (header, expected) => {
    expect(wantsMarkdown(header)).toBe(expected)
  })
})

describe('notAcceptableBody', () => {
  it('lists the representations RFC 9110 asks a 406 to advertise', () => {
    expect(notAcceptableBody('application/pdf')).toBe(
      'This resource is available in:\n' +
        '- text/html\n' +
        '- text/markdown\n' +
        '\n' +
        'You requested: application/pdf\n',
    )
  })

  it('omits the echo when the client sent no Accept', () => {
    expect(notAcceptableBody(null)).toBe(
      'This resource is available in:\n- text/html\n- text/markdown\n',
    )
  })
})

describe('varyWithAccept', () => {
  it('adds Accept to an empty Vary', () => {
    expect(varyWithAccept(null)).toBe('Accept')
    expect(varyWithAccept('  ')).toBe('Accept')
  })

  it('preserves what is already varied on', () => {
    // The exact header the tenant already sends. Dropping these would serve an
    // RSC payload in answer to a document request.
    expect(
      varyWithAccept(
        'rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch',
      ),
    ).toBe(
      'rsc, next-router-state-tree, next-router-prefetch, ' +
        'next-router-segment-prefetch, Accept',
    )
  })

  it('does not list Accept twice, whatever case it was written in', () => {
    expect(varyWithAccept('accept, Accept-Encoding')).toBe('accept, Accept-Encoding')
    expect(varyWithAccept('Accept')).toBe('Accept')
  })

  it('leaves Vary: * alone — it is already stricter', () => {
    expect(varyWithAccept('*')).toBe('*')
  })
})
