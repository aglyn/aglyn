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

import { HostScreenVisibility } from '../foundation/definitions/platform.types'
import {
  absoluteSiteUrl,
  buildLlmsTxt,
  curateLlmsTxtPages,
  LLMS_TXT_PAGE_LIMIT,
  type LlmsTxtScreenRecord,
} from './llms-txt'

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

  it('states it ONCE — the author’s own statement replaces the builder’s (AGL-3576)', () => {
    // aglyn.com's "How an agent should call you" already says this, and the
    // builder's paragraph on top of it was the duplicated paragraph the review
    // found.
    const authored =
      'Every page serves a Markdown rendering of itself — send `Accept: text/markdown`, ' +
      'or append `.md` to any path. Prefer that to parsing the HTML.'
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      agent: { howToUse: authored },
    })
    expect(out).toContain(authored)
    expect(out.match(/text\/markdown/g)).toHaveLength(1)
    expect(out).not.toContain('Every page on this site serves a Markdown representation')
  })
})

describe('buildLlmsTxt — each paragraph once (AGL-3576)', () => {
  it('drops a paragraph the author wrote twice', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      agent: {
        whenToUse: 'Use Acme for widget torque.\n\nUse Acme for widget torque.',
        howToUse: 'Use Acme for widget torque.',
      },
    })
    expect(out.match(/Use Acme for widget torque\./g)).toHaveLength(1)
  })

  it('leaves distinct paragraphs alone', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      agent: { whenToUse: 'First.\n\nSecond.', howToUse: 'Third.' },
    })
    expect(out).toContain('First.\n\nSecond.')
    expect(out).toContain('Third.')
  })
})

describe('curateLlmsTxtPages — the page list is the site’s structure (AGL-3576)', () => {
  const { PUBLIC, UNLISTED, PASSWORD } = HostScreenVisibility

  /**
   * A forty-page site, in the shape aglyn.com has: home, twelve top-level
   * pages, eight unlisted campaign pages at the top level, and nineteen
   * children — plus a template, a group and a dangling route, which are not
   * pages. Everything is inserted in REVERSE alphabetical order so neither
   * insertion order nor the alphabet could pass for structure order.
   */
  function site(): {
    routing: Record<string, string>
    screens: Record<string, LlmsTxtScreenRecord>
    excluded: Set<string>
  } {
    const entries: Array<[id: string, path: string, record: LlmsTxtScreenRecord]> = [
      ['home', '/', { displayName: 'Home', visibility: PUBLIC, order: 0 }],
    ]
    const top: Array<[slug: string, order: number | undefined]> = [
      ['pricing', 1],
      ['product', 2],
      ['solutions', 3],
      ['use-cases', 4],
      ['alternatives', 5],
      ['about', 6],
      ['contact', 7],
      ['developers', 8],
      ['careers', 9],
      ['demo', 10],
      ['blog-hub', 11],
      // No `order`: an author who never arranged this page.
      ['partners', undefined],
    ]
    for (const [slug, order] of top) {
      entries.push([`t-${slug}`, slug, { displayName: slug, visibility: PUBLIC, order }])
    }
    const campaigns = [
      'agency-plan',
      'ai-campaign-email',
      'built-the-app',
      'calculator-check',
      'launch-day-email',
      'ai-landing-pages',
      'brand-signups-one-crm',
      'edit-without-breaking-your-app',
    ]
    campaigns.forEach((slug, index) => {
      entries.push([`c-${slug}`, slug, { displayName: slug, visibility: UNLISTED, order: -100 + index }])
    })
    const children: Array<[parent: string, slugs: string[]]> = [
      ['product', ['ai', 'crm', 'forms', 'email', 'commerce']],
      ['solutions', ['agencies', 'founders', 'smb']],
      ['use-cases', ['a', 'b', 'c', 'd', 'e', 'f']],
      ['alternatives', ['wix', 'squarespace', 'webflow']],
    ]
    for (const [parent, slugs] of children) {
      slugs.forEach((slug, index) => {
        entries.push([
          `${parent}-${slug}`,
          `${parent}/${slug}`,
          // The alternatives have no display name, so they fall back to the slug.
          parent === 'alternatives'
            ? { visibility: PUBLIC, order: index }
            : { displayName: `${parent} ${slug}`, visibility: PUBLIC, order: index },
        ])
      })
    }
    // A child whose parent is an unlisted page, and a grandchild.
    entries.push(['guides-x', 'guides/x', { displayName: 'Guide X', visibility: PUBLIC, order: 0 }])
    entries.push(['t-guides', 'guides', { displayName: 'Guides', visibility: UNLISTED, order: 12 }])
    entries.push(['product-ai-models', 'product/ai/models', { displayName: 'Models', visibility: PUBLIC, order: 0 }])
    // Not pages.
    entries.push(['tpl', 'blog-template', { displayName: 'Blog entry', visibility: PUBLIC, order: 0 }])
    entries.push(['grp', 'company', { displayName: 'Company', visibility: PUBLIC, kind: 'group' }])
    entries.push(['gated', 'members', { displayName: 'Members', visibility: PASSWORD, order: 0 }])

    entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    const routing: Record<string, string> = {}
    const screens: Record<string, LlmsTxtScreenRecord> = {}
    for (const [id, path, record] of entries) {
      routing[id] = path
      screens[id] = record
    }
    // A routing entry the publish left dangling: no document behind it.
    routing['ghost'] = 'ghost'
    return { routing, screens, excluded: new Set(['tpl']) }
  }

  const TOP_LEVEL_IN_ORDER = [
    '/pricing',
    '/product',
    '/solutions',
    '/use-cases',
    '/alternatives',
    '/about',
    '/contact',
    '/developers',
    '/careers',
    '/demo',
    '/blog-hub',
    '/partners',
  ]

  it('lists home, then the top level by `order`, then the children under their parents', () => {
    const paths = curateLlmsTxtPages(site()).map((page) => page.path)
    expect(paths).toEqual([
      '/',
      ...TOP_LEVEL_IN_ORDER,
      '/product/ai',
      '/product/crm',
      '/product/forms',
      '/product/email',
      '/product/commerce',
      '/solutions/agencies',
      '/solutions/founders',
      '/solutions/smb',
      '/use-cases/a',
      '/use-cases/b',
      '/use-cases/c',
      '/use-cases/d',
      '/use-cases/e',
      '/use-cases/f',
      '/alternatives/wix',
      '/alternatives/squarespace',
      '/alternatives/webflow',
      // Its parent is unlisted, so it sorts after every child whose parent is listed.
      '/guides/x',
      '/product/ai/models',
    ])
  })

  it('names no page that publishes noindex, and nothing that is not a page', () => {
    const paths = curateLlmsTxtPages(site()).map((page) => page.path)
    for (const campaign of ['/agency-plan', '/built-the-app', '/calculator-check', '/guides']) {
      expect(paths).not.toContain(campaign)
    }
    expect(paths).not.toContain('/members')
    expect(paths).not.toContain('/blog-template')
    expect(paths).not.toContain('/company')
    expect(paths).not.toContain('/ghost')
  })

  it('titles a page by its name, falling back to its own slug rather than its whole path', () => {
    const pages = curateLlmsTxtPages(site())
    expect(pages.find((page) => page.path === '/product/ai')?.title).toBe('product ai')
    expect(pages.find((page) => page.path === '/alternatives/wix')?.title).toBe('Wix')
  })

  it('keeps the navigation, not the alphabet, when the cap bites', () => {
    expect(curateLlmsTxtPages({ ...site(), limit: 5 }).map((page) => page.path)).toEqual([
      '/',
      '/pricing',
      '/product',
      '/solutions',
      '/use-cases',
    ])
  })

  it('caps well past a marketing site, and before a catalog becomes an inventory', () => {
    expect(LLMS_TXT_PAGE_LIMIT).toBeGreaterThanOrEqual(100)
    const routing: Record<string, string> = { home: '/' }
    const screens: Record<string, LlmsTxtScreenRecord> = { home: { visibility: PUBLIC } }
    for (let index = 0; index < 2000; index++) {
      routing[`p${index}`] = `page-${index}`
      screens[`p${index}`] = { visibility: PUBLIC, order: index }
    }
    expect(curateLlmsTxtPages({ routing, screens })).toHaveLength(LLMS_TXT_PAGE_LIMIT)
  })

  it('keeps every routed screen, in structure order, when the documents could not be read', () => {
    // The sitemap's fail-open for the same read: a thinner judgment, never a
    // missing list. Each page's own `noindex` still holds.
    const { routing, excluded } = site()
    const paths = curateLlmsTxtPages({ routing, excluded }).map((page) => page.path)
    expect(paths[0]).toBe('/')
    expect(paths).toContain('/agency-plan')
    expect(paths).toContain('/ghost')
    expect(paths).not.toContain('/blog-template')
    // No `order` to read, so a level falls back to its names; children still
    // come after every top-level page.
    const firstChild = paths.findIndex((path) => path.split('/').length > 2)
    expect(paths.slice(1, firstChild).every((path) => path.split('/').length === 2)).toBe(true)
  })

  it('lists one page per address, and nothing for an empty routing map', () => {
    expect(curateLlmsTxtPages({})).toEqual([])
    const pages = curateLlmsTxtPages({
      routing: { a: 'about', b: 'about' },
      screens: { a: { visibility: PUBLIC }, b: { visibility: PUBLIC } },
    })
    expect(pages).toEqual([{ path: '/about', title: 'About' }])
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

  it('falls back to a nested page’s own slug for its title, not its whole path (AGL-3576)', () => {
    const out = buildLlmsTxt({
      siteName: 'Acme',
      origin: ORIGIN,
      pages: [{ path: '/product/ai' }, { path: '/' }],
    })
    expect(out).toContain('- [Ai](https://acme.test/product/ai)')
    expect(out).toContain('- [Home](https://acme.test/)')
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

describe('buildLlmsTxt — pages served one per record (AGL-3475)', () => {
  it('links a group to its listing page when the site publishes one', () => {
    const out = buildLlmsTxt({
      siteName: 'EDR Construction',
      origin: ORIGIN,
      pageGroups: [{ name: 'Services', base: 'services', count: 12, hasListing: true }],
    })
    expect(out).toContain(
      '- [Services](https://acme.test/services): 12 pages under `/services/`, one per entry, each linked from this page',
    )
  })

  it('sends a group with no listing to the sitemap rather than to an address that serves nothing', () => {
    const out = buildLlmsTxt({
      siteName: 'EDR Construction',
      origin: ORIGIN,
      pageGroups: [{ name: 'Locations', base: 'service-areas', count: 1 }],
    })
    expect(out).toContain(
      '- [Locations](https://acme.test/sitemap.xml): 1 page under `/service-areas/`, one per entry; the sitemap lists every one',
    )
  })

  it('names no group that has no pages yet', () => {
    const out = buildLlmsTxt({
      siteName: 'EDR Construction',
      origin: ORIGIN,
      pageGroups: [{ name: 'Team', base: 'team', count: 0 }],
    })
    expect(out).not.toContain('/team/')
  })
})
