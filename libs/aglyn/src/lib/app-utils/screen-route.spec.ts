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
  findScreenIdByRoutePath,
  normalizeScreenSlug,
  SCREEN_ROOT_PATH,
  screenRoutePathToUrl,
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
