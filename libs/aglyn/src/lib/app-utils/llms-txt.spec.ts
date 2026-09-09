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

import { absoluteSiteUrl, buildLlmsTxt } from './llms-txt'

const ORIGIN = 'https://acme.test'

describe('absoluteSiteUrl', () => {
  it('joins with exactly one slash, however the parts are written', () => {
    expect(absoluteSiteUrl(ORIGIN, 'pricing')).toBe('https://acme.test/pricing')
    expect(absoluteSiteUrl(`${ORIGIN}/`, '/pricing')).toBe('https://acme.test/pricing')
    expect(absoluteSiteUrl(ORIGIN, '/')).toBe('https://acme.test/')
    expect(absoluteSiteUrl(ORIGIN, '')).toBe('https://acme.test/')
  })
})

describe('buildLlmsTxt — llmstxt.org format', () => {
  const minimal = buildLlmsTxt({ siteName: 'Acme', origin: ORIGIN })

  it('opens with the H1 the format requires, and only one', () => {
    expect(minimal.split('\n')[0]).toBe('# Acme')
    expect(minimal.match(/^# /gm)).toHaveLength(1)
  })

  it('puts the summary in a blockquote directly under the H1', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      description: 'Industrial widgets since 1998.',
    })
    expect(out).toContain('# Acme\n\n> Industrial widgets since 1998.')
  })

  it('emits every H2 section as a file list of [name](url) items', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      pages: [{ path: '/pricing', title: 'Pricing' }],
      collections: [{ slug: 'blog', name: 'Blog', entryCount: 42 }],
    })
    const lines = out.split('\n')
    let section: string | null = null
    for (const line of lines) {
      if (line.startsWith('## ')) {
        section = line
        continue
      }
      if (!section || !line.trim()) continue
      if (!line.startsWith('- ')) continue
      // The required hyperlink, per the spec's "file list" definition.
      expect(line).toMatch(/^- \[[^\]]+\]\([^)]+\)(: .+)?$/)
    }
    expect(section).not.toBeNull()
  })

  it('ends with exactly one newline', () => {
    expect(minimal.endsWith('\n')).toBe(true)
    expect(minimal.endsWith('\n\n')).toBe(false)
  })
})

describe('buildLlmsTxt — when-to-use guidance', () => {
  it('names the section the audit and the reader both look for', () => {
    expect(buildLlmsTxt({ siteName: 'Acme', origin: ORIGIN })).toContain(
      '## When to use this site',
    )
  })

  it('leads with the author’s own words when they wrote any', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      description: 'Widgets.',
      agent: { whenToUse: 'Use Acme for load ratings on ANSI B18 fasteners.' },
    })
    // Above the derived section, and above the negotiation note.
    expect(out.indexOf('Use Acme for load ratings')).toBeGreaterThan(
      out.indexOf('> Widgets.'),
    )
    expect(out.indexOf('Use Acme for load ratings')).toBeLessThan(
      out.indexOf('## When to use this site'),
    )
  })

  it('still derives checkable guidance when the author wrote none', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      collections: [{ slug: 'blog', name: 'Field notes', entryCount: 12 }],
      hasSearch: true,
    })
    expect(out).toContain('[Field notes](https://acme.test/blog)')
    expect(out).toContain('12 published entries')
    expect(out).toContain('[Search this site](https://acme.test/search?q=)')
    expect(out).toContain('[OpenAPI description](https://acme.test/openapi.json)')
    expect(out).toContain('[Sitemap index](https://acme.test/sitemap.xml)')
  })

  it('says entry, not entries, for a collection of one', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      collections: [{ slug: 'news', entryCount: 1 }],
    })
    expect(out).toContain('1 published entry,')
  })

  it('says nothing about a count it does not have', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      collections: [{ slug: 'news' }],
    })
    expect(out).toContain('the published entries')
    expect(out).not.toContain('undefined')
  })

  it('prefers the collection’s own description over the derived sentence', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      collections: [{ slug: 'news', name: 'News', description: 'Press releases.' }],
    })
    expect(out).toContain('Press releases. — the published entries, newest first')
  })

  it('publishes a contact route only when the site has one', () => {
    expect(buildLlmsTxt({ siteName: 'Acme', origin: ORIGIN })).not.toContain('mailto:')
    expect(
      buildLlmsTxt({ siteName: 'Acme', origin: ORIGIN, contactEmail: 'hi@acme.test' }),
    ).toContain('- [Contact a person](mailto:hi@acme.test)')
  })
})

describe('buildLlmsTxt — the negotiation contract', () => {
  it('states both conventions, so an agent that knows either gets clean text', () => {
    const out = buildLlmsTxt({ siteName: 'Acme', origin: ORIGIN })
    expect(out).toContain('Accept: text/markdown')
    expect(out).toContain('append `.md` to any path')
    expect(out).toContain('https://acme.test/about.md')
    expect(out).toContain('vary on `Accept`')
  })
})

describe('buildLlmsTxt — escaping', () => {
  it('escapes brackets that would close a link label early', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      pages: [{ path: '/x', title: 'Docs [beta]' }],
    })
    expect(out).toContain('- [Docs \\[beta\\]](https://acme.test/x)')
  })

  it('collapses newlines in a title so one item stays one line', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      pages: [{ path: '/x', title: 'Two\nlines' }],
    })
    expect(out).toContain('- [Two lines](https://acme.test/x)')
  })
})
