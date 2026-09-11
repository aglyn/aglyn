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
  formatCollectionLinkValue,
  formatScreenLinkValue,
  isScreenLinkBroken,
  nodesReferenceScreen,
  parseCollectionLinkValue,
  parseScreenLinkValue,
  resolveScreenHref,
  screenLinkTargetOptions,
  screenRoutesAnswerFor,
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

/**
 * A content collection's LISTING page as a link target (AGL-2799).
 *
 * The pickers offered screens and nothing else, so aglyn.com's drawer could
 * not point at `/blog` and linked it as a typed address — one that follows no
 * rename and that no broken-link check can see. A listing link stores the
 * collection's id and resolves through the same routing map a screen does.
 */
describe('a collection listing as a link target (AGL-2799)', () => {
  const ROUTES = {
    ...SCREENS,
    'collection:blog': 'blog',
    'collection:yQuEudFcgR': 'newsroom',
  }
  const LABELS = {
    home: 'Home',
    pricing: 'Pricing',
    about: 'About',
    'collection:blog': 'Blog',
    'collection:yQuEudFcgR': 'Press',
  }

  describe('the stored value', () => {
    it('names the collection by id and round-trips', () => {
      expect(formatCollectionLinkValue('blog')).toBe('collection:blog')
      expect(parseCollectionLinkValue('collection:blog')).toBe('blog')
      expect(parseCollectionLinkValue(' collection: yQuEudFcgR ')).toBe(
        'yQuEudFcgR',
      )
    })

    it('is stored as the listing key itself, never as a screen reference', () => {
      // `screen:collection:blog` would be a reference to a screen that does
      // not exist, and would read as one everywhere a screen id is compared.
      expect(formatScreenLinkValue('collection:blog')).toBe('collection:blog')
      expect(parseScreenLinkValue('collection:blog')).toBe('collection:blog')
    })

    it('reads nothing else as a listing', () => {
      expect(parseCollectionLinkValue('collection:')).toBeUndefined()
      expect(parseCollectionLinkValue('/blog')).toBeUndefined()
      expect(parseCollectionLinkValue('screen:blog')).toBeUndefined()
      expect(parseCollectionLinkValue('blog')).toBeUndefined()
      expect(parseCollectionLinkValue(undefined)).toBeUndefined()
    })

    it('arrives as a target from either slot, and beats a typed address', () => {
      expect(splitLinkValue('collection:blog', undefined)).toEqual({
        screenId: 'collection:blog',
      })
      // The slot a `Link`-typed component prop can land it in (AGL-1335).
      expect(splitLinkValue(undefined, 'collection:blog')).toEqual({
        screenId: 'collection:blog',
      })
      expect(splitLinkValue('collection:blog', '/blog')).toEqual({
        screenId: 'collection:blog',
      })
    })

    it('leaves every existing shape meaning what it meant', () => {
      expect(formatScreenLinkValue('pricing')).toBe('screen:pricing')
      expect(parseScreenLinkValue('screen:pricing')).toBe('pricing')
      expect(parseScreenLinkValue('/blog')).toBeUndefined()
      expect(splitLinkValue('pricing', undefined)).toEqual({
        screenId: 'pricing',
      })
      expect(splitLinkValue(undefined, '/blog')).toEqual({ href: '/blog' })
      expect(splitLinkValue(undefined, 'https://aglyn.com/blog')).toEqual({
        href: 'https://aglyn.com/blog',
      })
    })
  })

  describe('resolution', () => {
    it('resolves a listing to its address', () => {
      expect(resolveScreenHref(ROUTES, 'collection:blog')).toBe('/blog')
      expect(resolveScreenHref(ROUTES, 'collection:yQuEudFcgR')).toBe(
        '/newsroom',
      )
    })

    it('follows a renamed slug, because the value names the collection', () => {
      expect(
        resolveScreenHref(
          { ...ROUTES, 'collection:blog': 'articles' },
          'collection:blog',
        ),
      ).toBe('/articles')
    })
  })

  describe('a collection that is gone', () => {
    it('is a broken link, as an unpublished screen is', () => {
      expect(resolveScreenHref(ROUTES, 'collection:gone')).toBeUndefined()
      expect(isScreenLinkBroken(ROUTES, 'collection:gone')).toBe(true)
      expect(isScreenLinkBroken(ROUTES, 'collection:blog')).toBe(false)
    })

    it('is named in the picker as a listing, with the stored value kept', () => {
      expect(unresolvedScreenOption('collection:gone', ROUTES)).toEqual({
        value: 'collection:gone',
        label:
          '⚠ Unavailable collection listing (gone) — deleted or has no slug',
      })
      expect(unresolvedScreenOption('collection:blog', ROUTES)).toBeUndefined()
    })
  })

  describe('a map that has heard of only one kind of target', () => {
    it('does not condemn a screen link before the screens arrive', () => {
      const listingsOnly = { 'collection:blog': 'blog' }
      expect(screenRoutesAnswerFor(listingsOnly, 'pricing')).toBe(false)
      expect(isScreenLinkBroken(listingsOnly, 'screen:pricing')).toBe(false)
      expect(unresolvedScreenOption('pricing', listingsOnly)?.label).toBe(
        'pricing',
      )
    })

    it('does not condemn a listing link before the collections arrive', () => {
      expect(screenRoutesAnswerFor(SCREENS, 'collection:blog')).toBe(false)
      expect(isScreenLinkBroken(SCREENS, 'collection:blog')).toBe(false)
      expect(unresolvedScreenOption('collection:blog', SCREENS)?.label).toBe(
        'collection:blog',
      )
    })

    it('judges each kind once its own half is there', () => {
      expect(screenRoutesAnswerFor(ROUTES, 'r_RYOXo-98')).toBe(true)
      expect(screenRoutesAnswerFor(ROUTES, 'collection:gone')).toBe(true)
      expect(isScreenLinkBroken(ROUTES, 'r_RYOXo-98')).toBe(true)
    })
  })

  describe('screenLinkTargetOptions — what both pickers offer', () => {
    it('offers each listing by its collection’s name and address, marked as a listing', () => {
      const options = screenLinkTargetOptions(ROUTES, LABELS)
      expect(options).toContainEqual({
        value: 'collection:blog',
        label: 'Blog (/blog) — collection listing',
        kind: 'collection-listing',
      })
      expect(options).toContainEqual({
        value: 'collection:yQuEudFcgR',
        label: 'Press (/newsroom) — collection listing',
        kind: 'collection-listing',
      })
    })

    it('offers the screens exactly as the pickers already labeled them', () => {
      const options = screenLinkTargetOptions(ROUTES, LABELS)
      expect(options).toContainEqual({
        value: 'home',
        label: 'Home (/)',
        kind: 'screen',
      })
      expect(options).toContainEqual({
        value: 'about',
        label: 'About (/company/about)',
        kind: 'screen',
      })
      expect(screenLinkTargetOptions({ pricing: 'pricing' }, undefined)).toEqual(
        [{ value: 'pricing', label: 'pricing (/pricing)', kind: 'screen' }],
      )
    })

    it('lists the screens first, in each picker’s own order, then the listings', () => {
      expect(
        screenLinkTargetOptions(ROUTES, LABELS, 'path').map((o) => o.value),
      ).toEqual(['home', 'about', 'pricing', 'collection:blog', 'collection:yQuEudFcgR'])
      expect(
        screenLinkTargetOptions(ROUTES, LABELS, 'label').map((o) => o.value),
      ).toEqual(['about', 'home', 'pricing', 'collection:blog', 'collection:yQuEudFcgR'])
    })

    it('names an unlabeled listing by its collection id, never by the raw key', () => {
      expect(
        screenLinkTargetOptions({ 'collection:blog': 'blog' }, undefined),
      ).toEqual([
        {
          value: 'collection:blog',
          label: 'blog (/blog) — collection listing',
          kind: 'collection-listing',
        },
      ])
    })

    it('offers nothing before a map has arrived', () => {
      expect(screenLinkTargetOptions(undefined, LABELS)).toEqual([])
    })
  })
})
