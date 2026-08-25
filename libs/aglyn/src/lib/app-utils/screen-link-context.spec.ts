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
  BROKEN_SCREEN_LINK_ATTR,
  BROKEN_SCREEN_LINK_MESSAGE,
  brokenScreenLinkProps,
  formatScreenLinkValue,
  isScreenLinkBroken,
  nodesReferenceScreen,
  parseScreenLinkValue,
  resolveScreenHref,
  splitLinkValue,
  unresolvedScreenOption,
} from './screen-link-context'

const SCREENS = {
  home: '/',
  pricing: 'pricing',
  about: 'company/about',
}

describe('screen link values (AGL-1335)', () => {
  it('round-trips a picked screen id through the stored form', () => {
    const stored = formatScreenLinkValue('pricing')
    expect(stored).toBe('screen:pricing')
    expect(parseScreenLinkValue(stored)).toBe('pricing')
  })

  it('reads a legacy raw string as a literal href, never as an id', () => {
    // The nine live `/product/*` CTAs hold exactly this. Reading it as an
    // id would resolve to nothing and blank every one of them.
    expect(parseScreenLinkValue('/pricing')).toBeUndefined()
    expect(parseScreenLinkValue('https://example.com')).toBeUndefined()
    expect(parseScreenLinkValue('')).toBeUndefined()
    expect(parseScreenLinkValue(undefined)).toBeUndefined()
    expect(parseScreenLinkValue('screen:')).toBeUndefined()
  })

  it('resolves a prefixed value against the routing map like a bare id', () => {
    expect(resolveScreenHref(SCREENS, 'screen:pricing')).toBe('/pricing')
    expect(resolveScreenHref(SCREENS, 'pricing')).toBe('/pricing')
    expect(resolveScreenHref(SCREENS, 'screen:home')).toBe('/')
    expect(resolveScreenHref(SCREENS, 'screen:about')).toBe('/company/about')
    expect(resolveScreenHref(SCREENS, 'screen:gone')).toBeUndefined()
  })

  it('survives a rename: the same id resolves to the new path', () => {
    expect(resolveScreenHref(SCREENS, 'screen:pricing')).toBe('/pricing')
    expect(
      resolveScreenHref({ ...SCREENS, pricing: 'plans' }, 'screen:pricing'),
    ).toBe('/plans')
  })
})

describe('splitLinkValue (AGL-1335)', () => {
  it('routes a prefixed value from EITHER slot to the screen id', () => {
    expect(splitLinkValue('screen:pricing', undefined)).toEqual({
      screenId: 'pricing',
    })
    // What a `Link` prop bound into the External URL field produces.
    expect(splitLinkValue(undefined, 'screen:pricing')).toEqual({
      screenId: 'pricing',
    })
  })

  it('keeps a bare id in the screen slot working', () => {
    expect(splitLinkValue('pricing', undefined)).toEqual({
      screenId: 'pricing',
    })
  })

  it('treats an href-shaped value in the screen slot as a literal href', () => {
    // A legacy prop value bound into "Link to screen" would otherwise
    // resolve to nothing at all.
    expect(splitLinkValue('/pricing', undefined)).toEqual({ href: '/pricing' })
    expect(splitLinkValue('https://x.io', undefined)).toEqual({
      href: 'https://x.io',
    })
    expect(splitLinkValue('#top', undefined)).toEqual({ href: '#top' })
  })

  it('keeps the screen id winning over an href, as it has since AGL-139', () => {
    expect(splitLinkValue('pricing', 'https://x.io')).toEqual({
      screenId: 'pricing',
    })
  })

  it('passes a literal href through and trims it', () => {
    expect(splitLinkValue(undefined, '  /pricing ')).toEqual({
      href: '/pricing',
    })
    expect(splitLinkValue(undefined, undefined)).toEqual({})
    expect(splitLinkValue('', '')).toEqual({})
  })
})

/**
 * A screen link that points at nothing (AGL-1893).
 *
 * The live defect was on `aglyn.com/changelog` and `/newsroom`: `tabLink1`
 * held `r_RYOXo-98`, a screen AGL-1313 had unpublished, and every consumer
 * of that id drew a different conclusion from it — the strip stayed a nav
 * landmark, the tab was still skipped as "navigates", and only the HREF
 * came back empty. The result was a control that looked live and did
 * nothing. These pin the one predicate all of them now share.
 */
describe('a dead screen link (AGL-1893)', () => {
  describe('isScreenLinkBroken', () => {
    it('is true for an id the routing map has lost', () => {
      expect(isScreenLinkBroken(SCREENS, 'r_RYOXo-98')).toBe(true)
      // Through the `screen:` reference spelling as well (AGL-1335) — a
      // prop-fed link must not read as healthy where a picked one reads
      // as broken.
      expect(isScreenLinkBroken(SCREENS, 'screen:r_RYOXo-98')).toBe(true)
    })

    it('is false for a screen that resolves', () => {
      expect(isScreenLinkBroken(SCREENS, 'pricing')).toBe(false)
      expect(isScreenLinkBroken(SCREENS, 'home')).toBe(false)
    })

    it('is false when there is no link at all', () => {
      expect(isScreenLinkBroken(SCREENS, undefined)).toBe(false)
      expect(isScreenLinkBroken(SCREENS, null)).toBe(false)
      expect(isScreenLinkBroken(SCREENS, '')).toBe(false)
    })

    it('refuses to guess without a routing map', () => {
      // The load-bearing half. A surface that provides no map, or whose
      // live host subscription has not landed yet, knows nothing about the
      // host's screens — concluding "broken" there would disable a whole
      // navigation row on a customer's site for the beat before the map
      // arrives, and then put it back.
      expect(isScreenLinkBroken(undefined, 'pricing')).toBe(false)
      expect(isScreenLinkBroken({}, 'pricing')).toBe(false)
    })
  })

  describe('brokenScreenLinkProps', () => {
    it('says nothing about a healthy link', () => {
      expect(brokenScreenLinkProps(false, true)).toEqual({})
      expect(brokenScreenLinkProps(false, false)).toEqual({})
    })

    it('marks the element everywhere, explains it only in the editor', () => {
      // The live site gets the marker so a smoke pass can find every dead
      // control with one selector — but not the tooltip, which is authoring
      // instruction and none of a visitor's business.
      expect(brokenScreenLinkProps(true, false)).toEqual({
        [BROKEN_SCREEN_LINK_ATTR]: '',
      })
      expect(brokenScreenLinkProps(true, true)).toEqual({
        [BROKEN_SCREEN_LINK_ATTR]: '',
        title: BROKEN_SCREEN_LINK_MESSAGE,
      })
    })

    it('tells the author where to fix it, not just that it is wrong', () => {
      expect(BROKEN_SCREEN_LINK_MESSAGE).toMatch(/unpublished or deleted/)
      expect(BROKEN_SCREEN_LINK_MESSAGE).toMatch(/attributes panel/)
    })
  })

  describe('unresolvedScreenOption — the console picker', () => {
    it('names a stored screen the host no longer has', () => {
      const option = unresolvedScreenOption('r_RYOXo-98', SCREENS)
      expect(option?.label).toMatch(/Unavailable screen/)
      expect(option?.label).toContain('r_RYOXo-98')
    })

    it('keeps the stored value byte-for-byte', () => {
      // The option exists to SHOW the value, never to rewrite it: opening
      // the panel and saving must not turn a recoverable reference into
      // something else.
      expect(unresolvedScreenOption('screen:r_RYOXo-98', SCREENS)?.value).toBe(
        'screen:r_RYOXo-98',
      )
      expect(unresolvedScreenOption('r_RYOXo-98', SCREENS)?.value).toBe(
        'r_RYOXo-98',
      )
    })

    it('adds nothing for a value the picker can already show', () => {
      expect(unresolvedScreenOption('pricing', SCREENS)).toBeUndefined()
      expect(unresolvedScreenOption('screen:pricing', SCREENS)).toBeUndefined()
      expect(unresolvedScreenOption('', SCREENS)).toBeUndefined()
      expect(unresolvedScreenOption(undefined, SCREENS)).toBeUndefined()
    })

    it('names a plain address as what it is, not as a broken screen', () => {
      // The nine live `/product/*` CTAs (AGL-1894). Not broken — but just
      // as invisible in a picker built only from the routing map.
      const option = unresolvedScreenOption('/pricing', SCREENS)
      expect(option?.value).toBe('/pricing')
      expect(option?.label).toMatch(/Plain address/)
      expect(option?.label).not.toMatch(/Unavailable screen/)
    })

    it('does not cry "unavailable" before the map has loaded', () => {
      // Still needs an option or the field renders blank — but a warning
      // shown over every link for one beat is a warning authors learn to
      // ignore, so the id is shown plainly instead.
      const option = unresolvedScreenOption('pricing', {})
      expect(option?.value).toBe('pricing')
      expect(option?.label).toBe('pricing')
      expect(unresolvedScreenOption('pricing', undefined)?.label).toBe(
        'pricing',
      )
    })
  })
})

/**
 * The server-side half of the same value model (AGL-703).
 *
 * `/api/hosts/where-used` answers "what breaks if I delete this screen", and
 * a link is one of the three ways a screen is referenced. Kept beside the
 * parsing it depends on: a scan that disagreed with {@link splitLinkValue}
 * about what a stored value points at would be wrong about exactly the links
 * an author cannot see.
 */
describe('nodesReferenceScreen (AGL-703)', () => {
  const nodes = (props: Record<string, unknown>) => ({
    n1: { componentId: 'button', props },
  })

  it('matches the marked form and the legacy bare id', () => {
    expect(nodesReferenceScreen(nodes({ screenId: 'screen:about' }), 'about'))
      .toBe(true)
    expect(nodesReferenceScreen(nodes({ screenId: 'about' }), 'about')).toBe(
      true,
    )
  })

  it('walks nested items, where a nav strip keeps its targets', () => {
    // The case a shallow prop scan misses entirely — and it is most of the
    // internal links on a typical site.
    expect(
      nodesReferenceScreen(
        nodes({ items: [{ label: 'About', link: 'screen:about' }] }),
        'about',
      ),
    ).toBe(true)
  })

  it('does not match a plain address that merely looks similar', () => {
    expect(nodesReferenceScreen(nodes({ href: '/about' }), 'about')).toBe(false)
    expect(nodesReferenceScreen(nodes({ href: 'about-us' }), 'about')).toBe(
      false,
    )
  })

  it('is false for empty inputs rather than throwing', () => {
    expect(nodesReferenceScreen(null, 'about')).toBe(false)
    expect(nodesReferenceScreen(nodes({ screenId: 'about' }), '')).toBe(false)
  })
})
