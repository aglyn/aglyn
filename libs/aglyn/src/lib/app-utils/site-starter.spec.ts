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

import { SITE_FONT_PAIRINGS } from './site-font-pairings'
import {
  SITE_STARTER_ARTIFACT_TYPE,
  SITE_THEME_BASES,
  SITE_STARTER_MAX_SCREENS,
  matchSiteStarterFacets,
  siteStarterFacetFields,
  siteStarterFacetsOf,
  siteStarterRefusal,
  type SiteStarterFacets,
  type SiteStarterKnownIds,
  type SiteStarterPayload,
} from './site-starter'

const KNOWN: SiteStarterKnownIds = {
  kinds: new Set(['trades', 'restaurant']),
  bases: new Set(SITE_THEME_BASES),
  fonts: new Set(SITE_FONT_PAIRINGS.map((pairing) => pairing.id)),
}

const FACETS: SiteStarterFacets = { kind: 'trades', base: 'bootstrap', fonts: 'oswald', pages: 4, mode: 'base' }

const home = { slug: '/', displayName: 'Home', nodes: {} }
const about = { slug: 'about', displayName: 'About', nodes: {} }

const payload = (over: Partial<SiteStarterPayload> = {}): SiteStarterPayload => ({
  mode: 'base',
  facets: FACETS,
  theme: { kind: 'builtin', base: 'bootstrap', brand: { light: {} }, fonts: 'oswald' },
  screens: [home, about],
  layout: { nodes: {} },
  ...over,
})

describe('site starter facets (AGL-4049)', () => {
  it('is listed under its own artifact type', () => {
    expect(SITE_STARTER_ARTIFACT_TYPE).toBe('siteStarter')
  })

  it('round-trips through the fields a publish stamps', () => {
    expect(siteStarterFacetsOf(siteStarterFacetFields(FACETS))).toEqual(FACETS)
    const none: SiteStarterFacets = { kind: null, base: null, fonts: null, pages: 0, mode: 'ai' }
    expect(siteStarterFacetsOf(siteStarterFacetFields(none))).toEqual(none)
  })

  it('reads a malformed or missing field as none', () => {
    expect(siteStarterFacetsOf({ starterKind: 3, starterBase: '  ', starterPages: -2, starterMode: 'other' })).toEqual({
      kind: null,
      base: null,
      fonts: null,
      pages: 0,
      mode: 'base',
    })
    expect(siteStarterFacetsOf({ starterPages: 3.7 }).pages).toBe(3)
  })

  it('matches every facet a filter names, and any where it names none', () => {
    expect(matchSiteStarterFacets(FACETS, {})).toBe(true)
    expect(matchSiteStarterFacets(FACETS, { kind: 'trades', mode: 'base' })).toBe(true)
    expect(matchSiteStarterFacets(FACETS, { kind: 'restaurant' })).toBe(false)
    expect(matchSiteStarterFacets(FACETS, { mode: 'ai' })).toBe(false)
    expect(matchSiteStarterFacets({ ...FACETS, fonts: null }, { fonts: null })).toBe(true)
  })
})

describe('siteStarterRefusal (AGL-4049)', () => {
  it('passes a starter that can start a site', () => {
    expect(siteStarterRefusal(payload())).toBeNull()
    expect(siteStarterRefusal(payload({ mode: 'ai', answers: { businessType: '' } }))).toBeNull()
    expect(siteStarterRefusal(payload({ theme: { kind: 'full', theme: {} as never }, facets: { ...FACETS, base: null, fonts: null } }))).toBeNull()
  })

  it('refuses a starter with no published Home page at /', () => {
    const refusal = 'A starter needs a published Home page at /'
    expect(siteStarterRefusal(payload({ screens: [about] }))).toBe(refusal)
    expect(siteStarterRefusal(payload({ screens: [{ ...home, published: false }] }))).toBe(refusal)
    expect(siteStarterRefusal(payload({ screens: [] }))).toBe(refusal)
  })

  it('refuses a starter with no shared layout', () => {
    expect(siteStarterRefusal(payload({ layout: null }))).toBe('A starter needs a shared layout')
  })

  it('refuses more pages than the cap', () => {
    const screens = [home, ...Array.from({ length: SITE_STARTER_MAX_SCREENS }, (_, i) => ({ slug: `p${i}` }))]
    expect(siteStarterRefusal(payload({ screens }))).toMatch(/at most 25 pages/)
    expect(siteStarterRefusal(payload({ screens: screens.slice(0, SITE_STARTER_MAX_SCREENS) }))).toBeNull()
  })

  it('refuses a kind, base or font pairing outside the sets its caller knows', () => {
    expect(siteStarterRefusal(payload(), KNOWN)).toBeNull()
    expect(siteStarterRefusal(payload({ facets: { ...FACETS, kind: 'spaceport' } }), KNOWN)).toMatch(/Unknown site kind/)
    expect(siteStarterRefusal(payload({ facets: { ...FACETS, base: 'win95' } }), KNOWN)).toMatch(/Unknown base theme/)
    expect(siteStarterRefusal(payload({ facets: { ...FACETS, fonts: 'comic' } }), KNOWN)).toMatch(/Unknown font pairing/)
    expect(
      siteStarterRefusal(payload({ theme: { kind: 'builtin', base: 'win95', brand: { light: {} }, fonts: null } }), KNOWN),
    ).toMatch(/Unknown base theme/)
    expect(
      siteStarterRefusal(payload({ theme: { kind: 'builtin', base: 'minimal', brand: { light: {} }, fonts: 'comic' } }), KNOWN),
    ).toMatch(/Unknown font pairing/)
  })

  it('checks no id its caller passes no set for: the core keeps no list of kinds', () => {
    const odd = payload({
      facets: { ...FACETS, kind: 'spaceport', base: 'win95', fonts: 'comic' },
      theme: { kind: 'builtin', base: 'win95', brand: { light: {} }, fonts: 'comic' },
    })
    expect(siteStarterRefusal(odd)).toBeNull()
    expect(siteStarterRefusal(odd, { kinds: KNOWN.kinds })).toMatch(/Unknown site kind/)
    expect(siteStarterRefusal(payload({ facets: { ...FACETS, kind: null } }), KNOWN)).toBeNull()
  })

  it('refuses an AI starter without its answers', () => {
    expect(siteStarterRefusal(payload({ mode: 'ai' }))).toBe('An AI starter needs the questions it asks')
  })
})
