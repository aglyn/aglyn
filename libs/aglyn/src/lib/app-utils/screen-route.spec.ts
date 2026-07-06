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
  normalizeScreenSlug,
  SCREEN_ROOT_PATH,
  screenRoutePathToUrl,
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
