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

/**
 * AGL-2708 — the precedence, and the totality.
 *
 * This module decides which of two cached documents a visitor is served, so
 * the two properties worth asserting are that it agrees with the client on
 * WHICH scheme wins, and that it answers at all for input it never wrote.
 * The first is what keeps a server render and the hydration after it from
 * disagreeing; the second is what keeps a guessed or stale URL from turning
 * into an error page, on a segment that is in the URL of every cached page on
 * every site.
 */
import {
  parseSchemeRouteSegment,
  resolveSchemeRouteSegment,
  SCHEME_ROUTE_SEGMENTS,
} from './scheme-route-segment'

describe('resolveSchemeRouteSegment', () => {
  it('takes the visitor’s explicit choice over the device', () => {
    // The case the switcher exists for: chosen Light on a dark laptop stays
    // light. Losing this is not a cosmetic bug — it silently overrides a
    // stated preference with a device default.
    expect(resolveSchemeRouteSegment('light', 'dark')).toBe('light')
    expect(resolveSchemeRouteSegment('dark', 'light')).toBe('dark')
  })

  it('falls to the device where the visitor chose nothing', () => {
    expect(resolveSchemeRouteSegment(null, 'dark')).toBe('dark')
    expect(resolveSchemeRouteSegment(null, 'light')).toBe('light')
  })

  it('falls to light where the request said neither', () => {
    // Firefox and Safari send no client hint, so this is their every request
    // until hydration can evaluate `prefers-color-scheme`.
    expect(resolveSchemeRouteSegment(null, null)).toBe('light')
  })

  it('does not treat "system" as a choice', () => {
    // The switcher writes `system` to mean "follow the device".
    // `parseThemeModeCookie` already reads it back as null; a caller passing a
    // raw cookie value must not be able to smuggle it in as a scheme.
    expect(resolveSchemeRouteSegment('system', 'dark')).toBe('dark')
    expect(resolveSchemeRouteSegment('system', null)).toBe('light')
  })
})

describe('parseSchemeRouteSegment', () => {
  it('round-trips every segment the resolver can emit', () => {
    for (const segment of SCHEME_ROUTE_SEGMENTS) {
      expect(parseSchemeRouteSegment(segment)).toBe(segment)
    }
  })

  it('renders the light document rather than refusing unknown input', () => {
    // Totality is the point: this segment is in the URL of every cached page,
    // so a stale bookmark, a crawler walking a guessed URL, or our own bug
    // must still get a page.
    for (const value of [
      undefined,
      null,
      '',
      'Dark',
      'system',
      'blue',
      '../../etc',
    ]) {
      expect(parseSchemeRouteSegment(value)).toBe('light')
    }
  })
})
