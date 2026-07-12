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
  overlayActiveAt,
  overlayMatchesPath,
  overlayPatternMatches,
  resolveActiveOverlays,
  type HostOverlay,
} from './overlays'

describe('marketing overlays (AGL-251)', () => {
  it('matches exact paths and prefix globs', () => {
    expect(overlayPatternMatches('/pricing', '/pricing')).toBe(true)
    expect(overlayPatternMatches('/pricing', '/pricing/enterprise')).toBe(false)
    expect(overlayPatternMatches('/blog/*', '/blog/post-1')).toBe(true)
    expect(overlayPatternMatches('/blog/*', '/blog')).toBe(true)
    expect(overlayPatternMatches('/blog/*', '/blogroll')).toBe(false)
    expect(overlayPatternMatches('/*', '/anything')).toBe(true)
  })

  it('treats no include patterns as every page, excludes win', () => {
    expect(overlayMatchesPath({}, '/anywhere')).toBe(true)
    expect(
      overlayMatchesPath({ pathPatterns: ['/pricing'] }, '/pricing'),
    ).toBe(true)
    expect(overlayMatchesPath({ pathPatterns: ['/pricing'] }, '/')).toBe(false)
    expect(
      overlayMatchesPath(
        { pathPatterns: ['/blog/*'], excludePathPatterns: ['/blog/draft'] },
        '/blog/draft',
      ),
    ).toBe(false)
  })

  it('honors the schedule window', () => {
    expect(overlayActiveAt({}, 1000)).toBe(true)
    expect(overlayActiveAt({ startAtMs: 2000 }, 1000)).toBe(false)
    expect(overlayActiveAt({ startAtMs: 500, endAtMs: 1500 }, 1000)).toBe(true)
    expect(overlayActiveAt({ endAtMs: 900 }, 1000)).toBe(false)
  })

  it('resolves the first active bar and popup by order', () => {
    const overlays: Array<HostOverlay & { $id?: string }> = [
      {
        $id: 'late-bar',
        kind: 'bar',
        order: 2,
        bar: { text: 'Second' },
      },
      {
        $id: 'early-bar',
        kind: 'bar',
        order: 1,
        bar: { text: 'First' },
      },
      {
        $id: 'off-bar',
        kind: 'bar',
        enabled: false,
        order: 0,
        bar: { text: 'Disabled' },
      },
      {
        $id: 'pricing-popup',
        kind: 'popup',
        pathPatterns: ['/pricing'],
        popup: { body: 'Deal!' },
      },
    ]
    const home = resolveActiveOverlays(overlays, { path: '/', nowMs: 1 })
    expect(home.bar?.$id).toBe('early-bar')
    expect(home.popup).toBeNull()
    const pricing = resolveActiveOverlays(overlays, {
      path: '/pricing',
      nowMs: 1,
    })
    expect(pricing.popup?.$id).toBe('pricing-popup')
  })
})
