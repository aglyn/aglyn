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
  buildScreenRouteEntries,
  collectScreenDescendantIds,
  composeScreenRoutePath,
  findScreenIdByRoutePath,
  linkableScreenRoutes,
  normalizeScreenSlug,
  ownScreenSlugFromRoutePath,
  SCREEN_ROOT_PATH,
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  screenClaimsToBeAPage,
  screenRoutePathToUrl,
  screenSlugHasPathSeparator,
  wouldCreateScreenCycle,
} from './screen-route'

describe('normalizeScreenSlug', () => {
  it('normalizes the root path', () => {
    expect(normalizeScreenSlug('/')).toBe(SCREEN_ROOT_PATH)
    expect(normalizeScreenSlug(' / ')).toBe(SCREEN_ROOT_PATH)
  })

  it('returns undefined for empty or unsalvageable input', () => {
    expect(normalizeScreenSlug('')).toBeUndefined()
    expect(normalizeScreenSlug('   ')).toBeUndefined()
    expect(normalizeScreenSlug(null)).toBeUndefined()
    expect(normalizeScreenSlug(undefined)).toBeUndefined()
    expect(normalizeScreenSlug('###')).toBeUndefined()
  })

  it('produces lowercase url-safe segments without slashes', () => {
    expect(normalizeScreenSlug('About Us')).toBe('about-us')
    expect(normalizeScreenSlug('/layout-test/')).toBe('layout-test')
    expect(normalizeScreenSlug('Hello,  World!')).toBe('hello-world')
    expect(normalizeScreenSlug('a--b---c')).toBe('a-b-c')
    expect(normalizeScreenSlug('-edge-')).toBe('edge')
    expect(normalizeScreenSlug('snake_case')).toBe('snake_case')
  })
})

/**
 * A `/` a person types into a SLUG field (AGL-2572).
 *
 * The field holds one segment, and `normalizeScreenSlug` reaches one by
 * deleting every disallowed character — so the separator vanished and
 * `alternatives/webflow` was stored as `alternativeswebflow`. The normalizer's
 * contract is right; what was missing is anybody asking the question before
 * the value reached it.
 */
describe('screenSlugHasPathSeparator', () => {
  it('sees the separator the normalizer would delete', () => {
    expect(screenSlugHasPathSeparator('alternatives/webflow')).toBe(true)
    expect(screenSlugHasPathSeparator('press/aglyn-opens-early-access')).toBe(
      true,
    )
    expect(screenSlugHasPathSeparator('/company/about/')).toBe(true)
  })

  it('leaves the home page alone', () => {
    expect(screenSlugHasPathSeparator(SCREEN_ROOT_PATH)).toBe(false)
    expect(screenSlugHasPathSeparator(' / ')).toBe(false)
    // `normalizeScreenSlug` already answers `undefined` for these; a bare run
    // of slashes describes no hierarchy to refuse over.
    expect(screenSlugHasPathSeparator('//')).toBe(false)
  })

  it('accepts what the normalizer has always handled', () => {
    expect(screenSlugHasPathSeparator('webflow')).toBe(false)
    expect(screenSlugHasPathSeparator('About Us')).toBe(false)
    // Leading and trailing slashes are stripped deliberately, not deleted from
    // the middle of a word, so they are not a separator.
    expect(screenSlugHasPathSeparator('/layout-test/')).toBe(false)
  })

  it('answers false for nothing', () => {
    expect(screenSlugHasPathSeparator('')).toBe(false)
    expect(screenSlugHasPathSeparator('   ')).toBe(false)
    expect(screenSlugHasPathSeparator(null)).toBe(false)
    expect(screenSlugHasPathSeparator(undefined)).toBe(false)
  })

  /**
   * The refusal names the alternative. A field that only said "invalid" would
   * leave the author retyping the same path.
   */
  it('is refused with wording that says what to do instead', () => {
    expect(SCREEN_SLUG_PATH_SEPARATOR_MESSAGE).toContain('one path segment')
    expect(SCREEN_SLUG_PATH_SEPARATOR_MESSAGE).toContain('parent screen')
  })

  /**
   * The pairing that matters: the values this predicate refuses are exactly
   * the ones the normalizer would have glued, and the ones it passes come back
   * from the normalizer whole.
   */
  it('refuses precisely what the normalizer would glue', () => {
    expect(normalizeScreenSlug('alternatives/webflow')).toBe(
      'alternativeswebflow',
    )
    expect(screenSlugHasPathSeparator('alternatives/webflow')).toBe(true)

    expect(normalizeScreenSlug('/layout-test/')).toBe('layout-test')
    expect(normalizeScreenSlug(SCREEN_ROOT_PATH)).toBe(SCREEN_ROOT_PATH)
  })
})

describe('findScreenIdByRoutePath', () => {
  const screens = { home: '/', about: 'about' }

  it('finds the owning screen id', () => {
    expect(findScreenIdByRoutePath(screens, '/')).toBe('home')
    expect(findScreenIdByRoutePath(screens, 'about')).toBe('about')
  })

  it('returns undefined for unowned paths or missing maps', () => {
    expect(findScreenIdByRoutePath(screens, 'missing')).toBeUndefined()
    expect(findScreenIdByRoutePath(undefined, '/')).toBeUndefined()
  })
})

describe('screenRoutePathToUrl', () => {
  it('prefixes non-root paths with a slash', () => {
    expect(screenRoutePathToUrl('/')).toBe('/')
    expect(screenRoutePathToUrl('about')).toBe('/about')
  })
})

describe('composeScreenRoutePath', () => {
  const screens = {
    home: { slug: '/' },
    company: { slug: 'company' },
    about: { slug: 'about', parentId: 'company' },
    team: { slug: 'team', parentId: 'about' },
    homeChild: { slug: 'news', parentId: 'home' },
    unslugged: { parentId: 'company' },
    orphan: { slug: 'orphan', parentId: 'missing' },
  }

  it('composes ancestor chains into slash-joined paths', () => {
    expect(composeScreenRoutePath('company', screens)).toBe('company')
    expect(composeScreenRoutePath('about', screens)).toBe('company/about')
    expect(composeScreenRoutePath('team', screens)).toBe('company/about/team')
  })

  it('treats the home screen as an empty segment', () => {
    expect(composeScreenRoutePath('home', screens)).toBe(SCREEN_ROOT_PATH)
    expect(composeScreenRoutePath('homeChild', screens)).toBe('news')
  })

  it('returns undefined for unslugged screens, broken chains, and rooted parents', () => {
    expect(composeScreenRoutePath('unslugged', screens)).toBeUndefined()
    expect(composeScreenRoutePath('orphan', screens)).toBeUndefined()
    expect(
      composeScreenRoutePath('rootedChild', {
        rootedChild: { slug: '/', parentId: 'company' },
        company: { slug: 'company' },
      }),
    ).toBeUndefined()
  })

  it('returns undefined on parent cycles', () => {
    const cyclic = {
      a: { slug: 'a', parentId: 'b' },
      b: { slug: 'b', parentId: 'a' },
    }
    expect(composeScreenRoutePath('a', cyclic)).toBeUndefined()
  })
})

describe('collectScreenDescendantIds', () => {
  const screens = {
    company: { slug: 'company' },
    about: { slug: 'about', parentId: 'company' },
    team: { slug: 'team', parentId: 'about' },
    blog: { slug: 'blog' },
  }

  it('returns children and grandchildren', () => {
    expect(collectScreenDescendantIds('company', screens)).toEqual([
      'about',
      'team',
    ])
    expect(collectScreenDescendantIds('about', screens)).toEqual(['team'])
    expect(collectScreenDescendantIds('blog', screens)).toEqual([])
  })
})

describe('buildScreenRouteEntries', () => {
  const screens = {
    company: { slug: 'company' },
    about: { slug: 'about', parentId: 'company' },
    team: { slug: 'team', parentId: 'about' },
    draft: { parentId: 'company' },
  }

  it('returns composed paths for the screen and its descendants', () => {
    expect(buildScreenRouteEntries('company', screens, {})).toEqual({
      company: 'company',
      about: 'company/about',
      team: 'company/about/team',
    })
  })

  it('nulls previously published entries whose chain broke', () => {
    const unslugged = { ...screens, about: { parentId: 'company' } }
    const routingMap = { about: 'company/about', team: 'company/about/team' }
    expect(buildScreenRouteEntries('about', unslugged, routingMap)).toEqual({
      about: null,
      team: null,
    })
  })

  it('omits unresolvable screens that were never published', () => {
    expect(buildScreenRouteEntries('draft', screens, {})).toEqual({})
  })

  /**
   * A MOVE IS NOT A PUBLISH (AGL-2571).
   *
   * An entry in the host's `screens` map is the whole of what makes a path
   * reachable, so minting one publishes the screen. Assigning a parent to an
   * unpublished screen that merely carried a slug did exactly that, and the
   * besigner toolbar — which reads this map — then offered `Unpublish` and an
   * enabled `Live` link for a page that 404s.
   */
  describe('publish: false', () => {
    it('never registers a screen that has no entry today', () => {
      expect(
        buildScreenRouteEntries('about', screens, {}, { publish: false }),
      ).toEqual({})
    })

    it('rewrites the entries that already exist', () => {
      const routingMap = { about: 'about' }
      expect(
        buildScreenRouteEntries('about', screens, routingMap, {
          publish: false,
        }),
      ).toEqual({ about: 'company/about' })
    })

    it('leaves an unpublished descendant out while moving a live one', () => {
      // `team` is live under `about`; `about` itself is live; `draft` is not.
      const routingMap = { about: 'about', team: 'about/team' }
      expect(
        buildScreenRouteEntries('company', screens, routingMap, {
          publish: false,
        }),
      ).toEqual({ about: 'company/about', team: 'company/about/team' })
    })

    it('still removes an entry whose chain no longer resolves', () => {
      const unslugged = { ...screens, about: { parentId: 'company' } }
      const routingMap = { about: 'company/about', team: 'company/about/team' }
      expect(
        buildScreenRouteEntries('about', unslugged, routingMap, {
          publish: false,
        }),
      ).toEqual({ about: null, team: null })
    })
  })
})

/**
 * The slug field holds ONE segment; the routing map holds the composed path
 * (AGL-2572). Seeding that field from the map has to take the screen's own
 * segment — the besigner seeded the whole path, `normalizeScreenSlug` deleted
 * the interior `/`, and the glued result was stored as the screen's slug.
 */
describe('ownScreenSlugFromRoutePath', () => {
  it('returns the last segment of a composed path', () => {
    expect(ownScreenSlugFromRoutePath('alternatives/webflow')).toBe('webflow')
    expect(ownScreenSlugFromRoutePath('company/about/team')).toBe('team')
    expect(ownScreenSlugFromRoutePath('about')).toBe('about')
  })

  it('keeps the home page as the root path', () => {
    expect(ownScreenSlugFromRoutePath(SCREEN_ROOT_PATH)).toBe(SCREEN_ROOT_PATH)
  })

  it('answers undefined for nothing', () => {
    expect(ownScreenSlugFromRoutePath(undefined)).toBeUndefined()
    expect(ownScreenSlugFromRoutePath(null)).toBeUndefined()
    expect(ownScreenSlugFromRoutePath('')).toBeUndefined()
  })

  /**
   * The whole point: what comes back must survive `normalizeScreenSlug`
   * unchanged. The composed path does not — that is the defect.
   */
  it('survives the normalizer that glues a raw path', () => {
    expect(normalizeScreenSlug('alternatives/webflow')).toBe(
      'alternativeswebflow',
    )
    expect(
      normalizeScreenSlug(
        ownScreenSlugFromRoutePath('alternatives/webflow') as string,
      ),
    ).toBe('webflow')
  })
})

describe('wouldCreateScreenCycle', () => {
  const screens = {
    company: { slug: 'company' },
    about: { slug: 'about', parentId: 'company' },
    team: { slug: 'team', parentId: 'about' },
  }

  it('rejects self and descendants as parents', () => {
    expect(wouldCreateScreenCycle('company', 'company', screens)).toBe(true)
    expect(wouldCreateScreenCycle('company', 'team', screens)).toBe(true)
    expect(wouldCreateScreenCycle('team', 'company', screens)).toBe(false)
    expect(wouldCreateScreenCycle('company', undefined, screens)).toBe(false)
  })
})

/**
 * One predicate, two callers (AGL-1383): `getScreen` refuses what
 * `countBillableScreens` does not charge for. Two matching filters in two
 * repos' worth of distance is how the disagreement started — the runtime
 * served `kind: 'email'` screens the cap had already forgiven.
 */
describe('screenClaimsToBeAPage', () => {
  it('accepts an ordinary screen', () => {
    expect(screenClaimsToBeAPage({})).toBe(true)
    expect(screenClaimsToBeAPage({ kind: 'page' })).toBe(true)
    // Neighbouring values that must NOT be caught by the template exclusion —
    // `templates` is a different collection entirely (AGL-666).
    expect(screenClaimsToBeAPage({ kind: 'templates' })).toBe(true)
    expect(screenClaimsToBeAPage({ kind: 'Template' })).toBe(true)
    // Explicit nulls are what importers and a restore leave behind.
    expect(screenClaimsToBeAPage({ deletedAt: null, kind: undefined })).toBe(true)
  })

  it('rejects the claims the screen cap subtracts on', () => {
    expect(screenClaimsToBeAPage({ kind: 'email' })).toBe(false)
    // AGL-1400: an entry template composes `/{collection}/{entry}` and has no
    // address of its own. It is the third exclusion, and the first one that is
    // a fact about the screen rather than about some other document.
    expect(screenClaimsToBeAPage({ kind: 'template' })).toBe(false)
    expect(screenClaimsToBeAPage({ deletedAt: { seconds: 1 } })).toBe(false)
    // A Firestore Timestamp is an object; so is the `_seconds` shape a JSON
    // round trip leaves. Any non-null value means deleted.
    expect(screenClaimsToBeAPage({ deletedAt: { _seconds: 1 } })).toBe(false)
    expect(screenClaimsToBeAPage({ deletedAt: 0 })).toBe(false)
  })

  it('treats a missing document as not a page', () => {
    expect(screenClaimsToBeAPage(null)).toBe(false)
    expect(screenClaimsToBeAPage(undefined)).toBe(false)
  })
})

describe('linkableScreenRoutes', () => {
  // The live aglyn.com shape (AGL-1998): the blog's list template is published
  // under its own slug, which 404s, and serves `/blog`; the entry template is
  // published under a slug that 404s and serves nothing at all.
  const raw = {
    home: '/',
    blogListTmpl: 'blog-list-template',
    blogEntryTmpl: 'blog-entry-template',
    changelog: 'changelog',
  }

  it('leaves the map alone when nothing is routed differently', () => {
    expect(linkableScreenRoutes(raw)).toEqual(raw)
  })

  it('offers a list template at the collection route it actually serves', () => {
    const routes = linkableScreenRoutes(raw, {
      routedElsewhere: { blogListTmpl: 'blog' },
      unrouted: ['blogListTmpl', 'blogEntryTmpl'],
    })
    // The whole issue: a screen link CAN now point at the site's blog index…
    expect(routes?.blogListTmpl).toBe('blog')
    // …and the two paths that 404 are gone, so the picker cannot offer either.
    expect(routes).not.toHaveProperty('blogEntryTmpl')
    expect(Object.values(routes ?? {})).not.toContain('blog-list-template')
    expect(Object.values(routes ?? {})).not.toContain('blog-entry-template')
    // Untouched screens keep their entries, root included.
    expect(routes?.home).toBe('/')
    expect(routes?.changelog).toBe('changelog')
  })

  it('routes a list template that was never published at all', () => {
    const routes = linkableScreenRoutes(
      { home: '/' },
      { routedElsewhere: { blogListTmpl: 'blog' } },
    )
    expect(routes?.blogListTmpl).toBe('blog')
  })

  it('normalizes an override spelled as a URL', () => {
    // `//blog` would be an absolute URL to the HOST named `blog`, so a leading
    // slash here takes the link off the site.
    const routes = linkableScreenRoutes(raw, {
      routedElsewhere: { blogListTmpl: '/blog/' },
    })
    expect(routes?.blogListTmpl).toBe('blog')
  })

  it('ignores an empty override rather than routing a screen to nowhere', () => {
    const routes = linkableScreenRoutes(raw, {
      routedElsewhere: { blogListTmpl: '', changelog: null as never },
    })
    expect(routes?.blogListTmpl).toBe('blog-list-template')
    expect(routes?.changelog).toBe('changelog')
  })

  it('keeps "no map yet" distinct from "an empty map"', () => {
    // `ScreenLinkContext` reads undefined as "nothing resolves yet"; `{}` says
    // every link is dead, which is what a mid-load canvas must not render.
    expect(linkableScreenRoutes(undefined)).toBeUndefined()
    expect(linkableScreenRoutes(null, { unrouted: ['x'] })).toBeUndefined()
    expect(linkableScreenRoutes({})).toEqual({})
  })

  it('does not mutate the map it was given', () => {
    const source = { ...raw }
    linkableScreenRoutes(source, {
      routedElsewhere: { blogListTmpl: 'blog' },
      unrouted: ['blogEntryTmpl'],
    })
    expect(source).toEqual(raw)
  })
})
