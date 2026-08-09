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
  formatScreenLinkValue,
  parseScreenLinkValue,
  resolveScreenHref,
  splitLinkValue,
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
