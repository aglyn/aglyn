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
  formatEntryLinkValue,
  formatFeedLinkValue,
  formatScreenLinkValue,
  isScreenLinkBroken,
  linkTargetKind,
  nodesReferenceScreen,
  parseCollectionLinkValue,
  parseEntryLinkValue,
  parseFeedLinkValue,
  parseScreenLinkValue,
  resolveScreenHref,
  screenLinkTargetLabel,
  screenLinkTargetOptions,
  screenRoutesAnswerFor,
  splitLinkValue,
  unavailableScreenLabel,
  unresolvedScreenOption,
} from './screen-link-context'
import {
  bareFragmentLinkFieldProps,
  bareFragmentLinkWarning,
  bareFragmentOfLinkValue,
  SAFE_HREF_PATTERN,
} from './screen-link-value'

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

  /**
   * A link inside a markdown body (AGL-3118), which the parser now keeps and
   * the page renders. "What might I break" has to include the sentence in a
   * post, or a delete breaks it silently.
   */
  it('finds a target linked from a markdown body', () => {
    expect(
      nodesReferenceScreen(
        nodes({ content: 'Read [about us](screen:about) first.' }),
        'about',
      ),
    ).toBe(true)
    expect(
      nodesReferenceScreen(
        nodes({ content: 'Read [the blog](collection:blog) first.' }),
        'collection:blog',
      ),
    ).toBe(true)
  })

  it('does not match a body that links something else', () => {
    expect(
      nodesReferenceScreen(
        nodes({ content: 'Read [the news](collection:news) first.' }),
        'collection:blog',
      ),
    ).toBe(false)
    // The words around a link are not a link: only the target half counts.
    expect(
      nodesReferenceScreen(
        nodes({ content: 'The about screen is [here](/about).' }),
        'about',
      ),
    ).toBe(false)
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

    /**
     * A feed and an entry are link targets too (AGL-3118), and the pickers
     * treat them differently on purpose (AGL-3119): a feed is one more row
     * per collection, so it is listed; a site's entries are thousands, so
     * they are searched and never listed — the map holds only the few a page
     * references, which is not a list of what can be linked.
     */
    it('offers each feed after the listings, named after its collection', () => {
      const withFeeds = { ...ROUTES, 'feed:blog': 'blog/rss.xml' }
      const options = screenLinkTargetOptions(withFeeds, LABELS)
      expect(options).toContainEqual({
        value: 'feed:blog',
        label: 'Blog (/blog/rss.xml) — RSS feed',
        kind: 'feed',
      })
      expect(options[options.length - 1].value).toBe('feed:blog')
      expect(
        screenLinkTargetOptions({ 'feed:blog': 'blog/rss.xml' }, undefined)[0]
          .label,
      ).toBe('blog (/blog/rss.xml) — RSS feed')
    })

    it('offers no entry, even from a map that carries one', () => {
      const withEntry = { ...ROUTES, 'entry:blog/Hpy49': 'blog/hello' }
      expect(
        screenLinkTargetOptions(withEntry, LABELS).map((o) => o.value),
      ).toEqual(screenLinkTargetOptions(ROUTES, LABELS).map((o) => o.value))
    })

    it('names one target the way the picker labels it', () => {
      const withFeeds = { ...ROUTES, 'feed:blog': 'blog/rss.xml' }
      expect(screenLinkTargetLabel('about', withFeeds, LABELS)).toBe(
        'About (/company/about)',
      )
      expect(screenLinkTargetLabel('collection:blog', withFeeds, LABELS)).toBe(
        'Blog (/blog) — collection listing',
      )
      expect(screenLinkTargetLabel('feed:blog', withFeeds, LABELS)).toBe(
        'Blog (/blog/rss.xml) — RSS feed',
      )
      // Nothing the map does not hold, and no entry at all: an entry is named
      // by the search seam, which reads the entry itself.
      expect(screenLinkTargetLabel('gone', withFeeds, LABELS)).toBeUndefined()
      expect(
        screenLinkTargetLabel(
          'entry:blog/Hpy49',
          { ...withFeeds, 'entry:blog/Hpy49': 'blog/hello' },
          LABELS,
        ),
      ).toBeUndefined()
    })

    it('says which KIND of target a picker has lost', () => {
      expect(unavailableScreenLabel('feed:gone', true)).toBe(
        '⚠ Unavailable RSS feed (gone) — collection deleted or has no slug',
      )
      expect(unavailableScreenLabel('entry:blog/gone', true)).toBe(
        '⚠ Unavailable entry (gone) — unpublished or deleted',
      )
    })
  })
})

/**
 * A link field holding only `#fragment` (AGL-2867). The value is SAFE — it
 * passes the href guard and renders an anchor — which is exactly why it saves
 * without complaint and then goes nowhere on the published page.
 */
describe('a bare fragment in a link field (AGL-2867)', () => {
  it('is a value the href guard lets through, so nothing else would say anything', () => {
    expect(SAFE_HREF_PATTERN.test('#watch')).toBe(true)
  })

  it('names the id a bare fragment jumps to', () => {
    expect(bareFragmentOfLinkValue('#watch')).toBe('watch')
    expect(bareFragmentOfLinkValue('  #watch-the-demo ')).toBe('watch-the-demo')
  })

  it('leaves alone every value that is not that trap', () => {
    for (const value of [
      '',
      '#',
      // Scrolls to the top of the page with no element needed, in any case.
      '#top',
      '#TOP',
      // Not known until the page renders.
      '#{{prop.anchor}}',
      '/pricing',
      '/pricing#faq',
      'https://example.com/#watch',
      'screen:abc',
      undefined,
      42,
    ]) {
      expect(bareFragmentOfLinkValue(value)).toBeUndefined()
      expect(bareFragmentLinkWarning(value)).toBeUndefined()
    }
  })

  it('points the author at the interaction that does what the fragment was for', () => {
    const warning = bareFragmentLinkWarning('#watch') as string
    expect(warning).toContain('#watch')
    expect(warning).toContain('Scroll to element')
  })

  it('reaches the field as its helper text, from the live value', () => {
    expect(bareFragmentLinkFieldProps({}, { input: { value: '#watch' } })).toEqual({
      helperText: bareFragmentLinkWarning('#watch'),
    })
    // Nothing is returned otherwise, so the field's own description stays.
    expect(bareFragmentLinkFieldProps({}, { input: { value: '/pricing' } })).toEqual({})
    expect(bareFragmentLinkFieldProps({}, {})).toEqual({})
  })
})

/**
 * An ENTRY and a collection FEED as link targets (AGL-3118).
 *
 * Both are addressed by ids, so a renamed entry slug or collection slug moves
 * every link to them on the next render, and both ride the one routing map
 * every linking surface already resolves against.
 */
describe('entry and feed links (AGL-3118)', () => {
  const ROUTES = {
    home: '/',
    'collection:videos': 'videos',
    'feed:videos': 'videos/rss.xml',
    'entry:videos/Hpy49iVFX3': 'videos/every-client-site',
  }

  describe('the stored value', () => {
    it('names an entry by both ids and round-trips', () => {
      const value = formatEntryLinkValue('videos', 'Hpy49iVFX3')
      expect(value).toBe('entry:videos/Hpy49iVFX3')
      expect(parseEntryLinkValue(value)).toEqual({
        collectionId: 'videos',
        entryId: 'Hpy49iVFX3',
      })
      expect(parseEntryLinkValue(' entry: videos / Hpy49iVFX3 ')).toEqual({
        collectionId: 'videos',
        entryId: 'Hpy49iVFX3',
      })
    })

    it('reads only one well-formed entry link as an entry', () => {
      for (const value of [
        'entry:',
        'entry:videos',
        'entry:videos/',
        'entry:/Hpy49iVFX3',
        'entry:a/b/c',
        '/videos/every-client-site',
        'screen:entry',
        42,
        undefined,
      ]) {
        expect(parseEntryLinkValue(value)).toBeUndefined()
      }
    })

    it('names a feed by its collection id and round-trips', () => {
      expect(formatFeedLinkValue('videos')).toBe('feed:videos')
      expect(parseFeedLinkValue(' feed: videos ')).toBe('videos')
      expect(parseFeedLinkValue('feed:')).toBeUndefined()
      expect(parseFeedLinkValue('/videos/rss.xml')).toBeUndefined()
    })

    it('is stored as its own key, never wrapped as a screen reference', () => {
      expect(formatScreenLinkValue('entry:videos/Hpy49iVFX3')).toBe(
        'entry:videos/Hpy49iVFX3',
      )
      expect(formatScreenLinkValue('feed:videos')).toBe('feed:videos')
      expect(parseScreenLinkValue(' entry: videos / Hpy49iVFX3 ')).toBe(
        'entry:videos/Hpy49iVFX3',
      )
      expect(parseScreenLinkValue('feed:videos')).toBe('feed:videos')
    })

    it('arrives as a target from either slot, and beats a typed address', () => {
      expect(splitLinkValue('entry:videos/Hpy49iVFX3', undefined)).toEqual({
        screenId: 'entry:videos/Hpy49iVFX3',
      })
      expect(splitLinkValue(undefined, 'feed:videos')).toEqual({
        screenId: 'feed:videos',
      })
      expect(splitLinkValue('entry:videos/Hpy49iVFX3', '/videos/old-slug')).toEqual({
        screenId: 'entry:videos/Hpy49iVFX3',
      })
    })

    it('names each key by its kind', () => {
      expect(linkTargetKind('home')).toBe('screen')
      expect(linkTargetKind('collection:videos')).toBe('collection')
      expect(linkTargetKind('entry:videos/Hpy49iVFX3')).toBe('entry')
      expect(linkTargetKind('feed:videos')).toBe('feed')
    })
  })

  describe('resolution', () => {
    it('resolves an entry and a feed to their addresses', () => {
      expect(resolveScreenHref(ROUTES, 'entry:videos/Hpy49iVFX3')).toBe(
        '/videos/every-client-site',
      )
      expect(resolveScreenHref(ROUTES, 'feed:videos')).toBe('/videos/rss.xml')
    })

    it('follows a renamed entry, because the value names the entry', () => {
      expect(
        resolveScreenHref(
          { ...ROUTES, 'entry:videos/Hpy49iVFX3': 'films/one-console' },
          'entry:videos/Hpy49iVFX3',
        ),
      ).toBe('/films/one-console')
    })

    it('is a broken link once a map that knows entries has lost this one', () => {
      expect(isScreenLinkBroken(ROUTES, 'entry:videos/unpublished')).toBe(true)
      expect(isScreenLinkBroken(ROUTES, 'entry:videos/Hpy49iVFX3')).toBe(false)
    })
  })

  describe('a map that has not heard of entries', () => {
    const SITE = {
      home: '/',
      'collection:videos': 'videos',
      'feed:videos': 'videos/rss.xml',
    }

    it('does not condemn an entry link before the page asked for entries', () => {
      expect(screenRoutesAnswerFor(SITE, 'entry:videos/Hpy49iVFX3')).toBe(false)
      expect(isScreenLinkBroken(SITE, 'entry:videos/Hpy49iVFX3')).toBe(false)
    })

    it('still judges screens, listings and feeds on their own halves', () => {
      expect(screenRoutesAnswerFor(SITE, 'screen:home')).toBe(true)
      expect(screenRoutesAnswerFor(SITE, 'collection:videos')).toBe(true)
      expect(screenRoutesAnswerFor(SITE, 'feed:gone')).toBe(true)
      expect(isScreenLinkBroken(SITE, 'feed:gone')).toBe(true)
    })

    it('does not let a map of entries alone condemn a screen link', () => {
      const entriesOnly = { 'entry:videos/Hpy49iVFX3': 'videos/film' }
      expect(screenRoutesAnswerFor(entriesOnly, 'screen:home')).toBe(false)
      expect(isScreenLinkBroken(entriesOnly, 'screen:home')).toBe(false)
    })
  })
})
