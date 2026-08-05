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
  buildRobotsTxt,
  isPageIndexable,
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
      expect(buildRobotsTxt({ host: {}, origin: 'https://shop.example.com' }))
        .toBe(
          'User-agent: *\nAllow: /\nSitemap: https://shop.example.com/sitemap.xml\n',
        )
    })

    it('omits the sitemap line rather than emitting "undefined"', () => {
      const body = buildRobotsTxt({ host: {} })
      expect(body).toBe('User-agent: *\nAllow: /\n')
      expect(body).not.toContain('undefined')
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
