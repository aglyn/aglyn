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
  AI_AGENT_USER_AGENTS,
  buildRobotsTxt,
  isPageIndexable,
  statusPageScreenIds,
  isScreenIndexable,
  isSearchDiscouraged,
} from './search-indexing'

describe('search-indexing policy (AGL-1263)', () => {
  describe('isSearchDiscouraged', () => {
    it('is off for a host that has never heard of the switch', () => {
      expect(isSearchDiscouraged(undefined)).toBe(false)
      expect(isSearchDiscouraged(null)).toBe(false)
      expect(isSearchDiscouraged({})).toBe(false)
      expect(isSearchDiscouraged({ seo: {} })).toBe(false)
    })

    it('is on only for an explicit true', () => {
      expect(
        isSearchDiscouraged({ seo: { discourageSearchEngines: true } }),
      ).toBe(true)
      expect(
        isSearchDiscouraged({ seo: { discourageSearchEngines: false } }),
      ).toBe(false)
    })

    it('does not treat a truthy non-boolean as on', () => {
      // The field is written by a Switch and cleared with `deleteField()`, so
      // a string here means something upstream went wrong. De-indexing a
      // customer's whole site is not the right response to a bad value.
      expect(
        isSearchDiscouraged({
          seo: { discourageSearchEngines: 'yes' as never },
        }),
      ).toBe(false)
    })
  })

  describe('isScreenIndexable', () => {
    it('indexes a public screen, and one that predates the field', () => {
      expect(isScreenIndexable({ visibility: HostScreenVisibility.PUBLIC })).toBe(
        true,
      )
      expect(isScreenIndexable({})).toBe(true)
      expect(isScreenIndexable(undefined)).toBe(true)
    })

    it('excludes every gated visibility, not just UNLISTED', () => {
      // The old sitemap had no visibility test at all and the old metadata
      // tested `=== UNLISTED`. A password-protected page was therefore
      // submitted to search engines as a canonical URL that answers with a
      // password form.
      for (const visibility of [
        HostScreenVisibility.UNLISTED,
        HostScreenVisibility.PRIVATE,
        HostScreenVisibility.PASSWORD,
        HostScreenVisibility.AUTHENTICATED,
        HostScreenVisibility.AUTHORIZED,
      ]) {
        expect(isScreenIndexable({ visibility })).toBe(false)
      }
    })

    it('does not mistake UNLISTED for PUBLIC through its shared bit', () => {
      // `UNLISTED === PUBLIC | (1 << 2)`, so a bitmask test written as
      // `visibility & PUBLIC` would pass for both. The control that catches
      // that mistake.
      expect(
        HostScreenVisibility.UNLISTED & HostScreenVisibility.PUBLIC,
      ).toBeTruthy()
      expect(
        isScreenIndexable({ visibility: HostScreenVisibility.UNLISTED }),
      ).toBe(false)
    })
  })

  describe('isPageIndexable', () => {
    const publicScreen = { visibility: HostScreenVisibility.PUBLIC }

    it('needs both controls to allow it', () => {
      expect(isPageIndexable({ host: {}, screen: publicScreen })).toBe(true)
      expect(
        isPageIndexable({
          host: { seo: { discourageSearchEngines: true } },
          screen: publicScreen,
        }),
      ).toBe(false)
      expect(
        isPageIndexable({
          host: {},
          screen: { visibility: HostScreenVisibility.UNLISTED },
        }),
      ).toBe(false)
    })

    it('answers for a surface with no screen at all', () => {
      // Collection lists and blog entries have a host but no screen doc; the
      // site-level switch still has to reach them.
      expect(isPageIndexable({ host: {} })).toBe(true)
      expect(
        isPageIndexable({ host: { seo: { discourageSearchEngines: true } } }),
      ).toBe(false)
    })

    it('turns back ON when the switch is cleared', () => {
      // The direction that matters most: a control that cannot be undone is
      // worse than no control. `deleteField()` leaves the key absent.
      const discouraged = { seo: { discourageSearchEngines: true } }
      expect(isPageIndexable({ host: discouraged, screen: publicScreen })).toBe(
        false,
      )
      expect(isPageIndexable({ host: { seo: {} }, screen: publicScreen })).toBe(
        true,
      )
    })
  })

  describe('buildRobotsTxt', () => {
    it('allows everything and names the sitemap by default', () => {
      const body = buildRobotsTxt({ host: {}, origin: 'https://shop.example.com' })
      expect(body.startsWith('User-agent: *\nAllow: /\n')).toBe(true)
      expect(body.endsWith('Sitemap: https://shop.example.com/sitemap.xml\n')).toBe(
        true,
      )
    })

    it('omits the sitemap line rather than emitting "undefined"', () => {
      const body = buildRobotsTxt({ host: {} })
      expect(body.startsWith('User-agent: *\nAllow: /\n')).toBe(true)
      expect(body).not.toContain('Sitemap:')
      expect(body).not.toContain('undefined')
    })

    it('names every AI agent in its own group (AGL-2716)', () => {
      // A named group is a STATEMENT, where the wildcard is only the absence
      // of a restriction — and it is the line an owner edits to change the
      // decision later.
      const body = buildRobotsTxt({ host: {}, origin: 'https://shop.example.com' })
      for (const agent of AI_AGENT_USER_AGENTS) {
        expect(body).toContain(`User-agent: ${agent}\nAllow: /`)
      }
      expect(AI_AGENT_USER_AGENTS).toContain('ClaudeBot')
      expect(AI_AGENT_USER_AGENTS).toContain('ChatGPT-User')
      expect(AI_AGENT_USER_AGENTS).toContain('Google-Extended')
      expect(AI_AGENT_USER_AGENTS).toContain('DeepSeekBot')
      expect(AI_AGENT_USER_AGENTS).toContain('ora-agent')
    })

    it('parses as groups separated by a blank line', () => {
      // `robots.txt` groups end at a blank line. Without one, a following
      // `User-agent:` continues the PREVIOUS group's agent list instead of
      // starting a new record — harmless here, since every group says the same
      // thing, but the file would no longer mean what it appears to.
      const body = buildRobotsTxt({ host: {} })
      const groups = body.trim().split('\n\n')
      expect(groups.length).toBe(1 + AI_AGENT_USER_AGENTS.length)
      for (const group of groups) {
        expect(group.split('\n')[0].startsWith('User-agent: ')).toBe(true)
      }
    })

    it('drops the named groups too when search is discouraged', () => {
      // A named group would OUTRANK the wildcard: `robots.txt` precedence
      // gives the most specific matching group, so an `Allow` under
      // `User-agent: ClaudeBot` would invite the readers the switch refuses.
      const body = buildRobotsTxt({
        host: { seo: { discourageSearchEngines: true } },
      })
      expect(body).toBe('User-agent: *\nDisallow: /\n')
      for (const agent of AI_AGENT_USER_AGENTS) {
        expect(body).not.toContain(agent)
      }
    })

    it('disallows everything and names no sitemap when discouraged', () => {
      const body = buildRobotsTxt({
        host: { seo: { discourageSearchEngines: true } },
        origin: 'https://shop.example.com',
      })
      expect(body).toBe('User-agent: *\nDisallow: /\n')
      // Handing a crawler an index of the site you just told it to skip is
      // the contradiction this whole module exists to remove — so the origin
      // must be absent, not merely unlinked.
      expect(body).not.toContain('Sitemap')
      expect(body).not.toContain('shop.example.com')
      expect(body).not.toContain('Allow: /')
    })
  })
})

describe('statusPageScreenIds (AGL-2716)', () => {
  it('excludes a screen published at a bare status path', () => {
    expect([
      ...statusPageScreenIds({ screens: { a: '/404', b: '503', c: '/pricing' } }),
    ].sort()).toEqual(['a', 'b'])
  })

  it('keeps a real page whose slug merely contains a status code', () => {
    expect(
      statusPageScreenIds({ screens: { a: '/404-guide', b: '/products/503' } }).size,
    ).toBe(0)
  })

  it('excludes a BOUND error screen even at an ordinary path', () => {
    expect([
      ...statusPageScreenIds({
        screens: { oops: '/whoops' },
        errorScreens: { 500: 'oops' },
      }),
    ]).toEqual(['oops'])
  })

  it('excludes the not-found binding', () => {
    expect([...statusPageScreenIds({ notFoundScreenId: 'nf' })]).toEqual(['nf'])
  })

  it('is empty for a host with nothing to exclude', () => {
    expect(statusPageScreenIds(null).size).toBe(0)
    expect(statusPageScreenIds({}).size).toBe(0)
  })
})
