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

/**
 * The nav an error screen may show (AGL-2187).
 *
 * The load-bearing assertion in this file is the VISIBILITY one, and it is
 * written as an inclusion + an exclusion in the same fixture on purpose. The
 * host's routing map is every PUBLISHED screen — unlisted, password-protected,
 * members-only pages included — so a rule that forgot to filter would produce
 * a nav that reads perfectly and publishes the address of every gated page on
 * the site to anyone who mistypes a URL. A test that only asserted "About is
 * present" would pass just as happily against that rule.
 *
 * `HostScreenVisibility` is imported rather than spelled as numbers, because
 * the values are a bit field (`UNLISTED = PUBLIC | 4`) and a literal `2` in a
 * fixture is how a test ends up asserting against a visibility that does not
 * exist.
 */

import { HostScreenVisibility } from '@aglyn/aglyn/server'
import {
  buildSiteNavLinks,
  SITE_NAV_MAX_LABEL_LENGTH,
  siteNavLabelFromPath,
  type SiteNavScreen,
} from '../utils/site-nav'

const publicScreen = (
  id: string,
  displayName?: string,
  order?: number,
): SiteNavScreen => ({
  id,
  displayName,
  order,
  visibility: HostScreenVisibility.PUBLIC,
})

describe('buildSiteNavLinks — what may appear in an error screen nav', () => {
  it('lists public top-level pages, in the author’s order', () => {
    const links = buildSiteNavLinks({
      routing: { s1: 'about', s2: 'pricing', s3: 'contact' },
      screens: [
        publicScreen('s3', 'Contact', 3),
        publicScreen('s1', 'About', 1),
        publicScreen('s2', 'Pricing', 2),
      ],
    })
    expect(links).toEqual([
      { href: '/about', label: 'About' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/contact', label: 'Contact' },
    ])
  })

  it('excludes every non-PUBLIC visibility, and keeps the public one', () => {
    // One fixture, both directions. Each gated screen is a real page in the
    // routing map — which is exactly the state that made this necessary.
    const gated: Array<[string, HostScreenVisibility]> = [
      ['unlisted', HostScreenVisibility.UNLISTED],
      ['private', HostScreenVisibility.PRIVATE],
      ['investors', HostScreenVisibility.PASSWORD],
      ['members', HostScreenVisibility.AUTHENTICATED],
      ['admins', HostScreenVisibility.AUTHORIZED],
    ]
    const routing: Record<string, string> = { ok: 'about' }
    const screens: SiteNavScreen[] = [publicScreen('ok', 'About')]
    for (const [path, visibility] of gated) {
      routing[path] = path
      screens.push({ id: path, displayName: path, visibility })
    }

    const links = buildSiteNavLinks({ routing, screens, limit: 50 })

    // The control: without this the exclusion assertions below pass on an
    // empty array, which is the vacuous green this whole file exists to avoid.
    expect(links).toEqual([{ href: '/about', label: 'About' }])
    for (const [path] of gated) {
      expect(links.map((link) => link.href)).not.toContain(`/${path}`)
    }
  })

  it('treats a screen with no visibility field as public', () => {
    // Absent has always meant PUBLIC (`isScreenIndexable`), and a site that
    // predates the field would otherwise get no nav at all.
    const links = buildSiteNavLinks({
      routing: { s1: 'about' },
      screens: [{ id: 's1', displayName: 'About' }],
    })
    expect(links).toEqual([{ href: '/about', label: 'About' }])
  })

  it('excludes the home screen, child pages and template screens', () => {
    const links = buildSiteNavLinks({
      routing: {
        home: '/',
        about: 'about',
        nested: 'company/team',
        tmpl: 'blog-entry-template',
      },
      screens: [
        publicScreen('home', 'Home'),
        publicScreen('about', 'About'),
        publicScreen('nested', 'Team'),
        publicScreen('tmpl', 'Blog Entry Template'),
      ],
      templateScreenIds: new Set(['tmpl']),
      limit: 50,
    })
    // Home is reached by the mark and the explicit action; a child page is not
    // top-level; a template 404s at its own slug (AGL-1267), so a nav item
    // pointing at one would lead from a 404 to another 404.
    expect(links).toEqual([{ href: '/about', label: 'About' }])
  })

  it('ignores a screen the routing map does not name', () => {
    // The map is the route table: an unpublished or unrouted screen document
    // is not reachable at a path of its own, whatever the document says.
    const links = buildSiteNavLinks({
      routing: { routed: 'about' },
      screens: [publicScreen('routed', 'About'), publicScreen('orphan', 'Draft')],
    })
    expect(links).toEqual([{ href: '/about', label: 'About' }])
  })

  it('sorts screens with no order AFTER ordered ones, then alphabetically', () => {
    const links = buildSiteNavLinks({
      routing: { a: 'zebra', b: 'apple', c: 'first' },
      screens: [
        publicScreen('a', 'Zebra'),
        publicScreen('b', 'Apple'),
        publicScreen('c', 'First', 0),
      ],
    })
    // `order: 0` must not be swallowed by a falsy check — it is the FIRST
    // position in the console's screens list, not a missing value.
    expect(links.map((link) => link.label)).toEqual(['First', 'Apple', 'Zebra'])
  })

  it('falls back to a de-slugged label, and truncates a long one', () => {
    const long = 'A page name far longer than any navigation bar wants'
    const links = buildSiteNavLinks({
      routing: { s1: 'our-team', s2: 'long' },
      screens: [publicScreen('s1'), publicScreen('s2', long)],
    })
    // By href, not by index: neither screen carries an `order`, so the two
    // sort alphabetically by LABEL and the truncated one comes first.
    const byHref = Object.fromEntries(
      links.map((link) => [link.href, link.label]),
    )
    expect(byHref['/our-team']).toBe('Our Team')
    expect(byHref['/long']).toHaveLength(SITE_NAV_MAX_LABEL_LENGTH)
    expect(byHref['/long'].endsWith('…')).toBe(true)
    expect(long.startsWith(byHref['/long'].slice(0, -1).trimEnd())).toBe(true)
  })

  it('caps the number of links', () => {
    const routing: Record<string, string> = {}
    const screens: SiteNavScreen[] = []
    for (let index = 0; index < 20; index += 1) {
      routing[`s${index}`] = `page-${index}`
      screens.push(publicScreen(`s${index}`, `Page ${index}`, index))
    }
    expect(buildSiteNavLinks({ routing, screens })).toHaveLength(6)
    expect(buildSiteNavLinks({ routing, screens, limit: 2 })).toHaveLength(2)
    expect(buildSiteNavLinks({ routing, screens, limit: 0 })).toEqual([])
  })

  it('is empty, not broken, when there is nothing to show', () => {
    expect(buildSiteNavLinks({})).toEqual([])
    expect(buildSiteNavLinks({ routing: null, screens: null })).toEqual([])
    expect(buildSiteNavLinks({ routing: { s1: '' }, screens: [publicScreen('s1')] })).toEqual([])
  })
})

describe('siteNavLabelFromPath', () => {
  it.each([
    ['about', 'About'],
    ['our-team', 'Our Team'],
    ['case_studies', 'Case Studies'],
    ['company/about-us', 'About Us'],
    ['---', ''],
  ])('%s → %s', (path, expected) => {
    expect(siteNavLabelFromPath(path)).toBe(expected)
  })
})
