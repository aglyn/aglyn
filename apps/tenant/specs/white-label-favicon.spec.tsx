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
 * The favicon a white-label site serves (AGL-2183).
 *
 * The defect was an ABSENCE — no `<link rel="icon">` at all — which is why it
 * survived AGL-1421: nothing was wrong on the page, the browser simply fell
 * back to the origin's `/favicon.ico`, and that file is Aglyn's mark. A test
 * asserting "the right icon renders" would have passed throughout. So the
 * assertions below are about which of four states the layout produces, and the
 * unconfigured white-label case — the one that was broken — asserts a
 * SUPPRESSING icon rather than merely a non-Aglyn one.
 *
 * The precedence itself is pure, so it is exercised directly rather than
 * through a rendered Server Component: `HostLayout` is `async`, reads
 * Firestore through two cached helpers, and mounting it would test the mocks.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  PLATFORM_BRANDING_PROFILE,
  showsPlatformAttribution,
} from '@aglyn/aglyn/server'

import {
  orgBrandFavicon,
  resolveSiteFaviconHref,
} from '../app/[host]/site-favicon'

/**
 * The REAL precedence, imported — not a copy of it.
 *
 * The first draft of this suite re-implemented the expression here, which
 * would have kept passing after the layout's behaviour moved: a guard testing
 * its own duplicate of the thing it guards. `resolveSiteFaviconHref` was
 * extracted for exactly that reason, and the layout calls this same function.
 */
const faviconFor = (
  siteFavicon: string | undefined,
  org: Record<string, unknown> | null,
): string | undefined =>
  resolveSiteFaviconHref({
    siteFavicon,
    brandFavicon: orgBrandFavicon(org as never),
    org: org as never,
  })

/** An Agency org: carries `whiteLabel`. */
const AGENCY = { $id: 'org-1', plan: 'agency' }
/** A Free org: platform attribution is expected and correct. */
const FREE = { $id: 'org-2', plan: 'free' }

describe('a white-label site never falls back to Aglyn’s mark', () => {
  it('serves the site’s own favicon when it has one', () => {
    expect(faviconFor('/api/media/cdn/site.png', AGENCY)).toBe(
      '/api/media/cdn/site.png',
    )
  })

  it('falls back to the ORG’s white-label mark — the half-dead field', () => {
    // `branding.faviconUrl` was read only by the console before this; an
    // agency's uploaded mark reached their own chrome and no visitor ever.
    const org = { ...AGENCY, brandingProfile: { faviconUrl: 'https://cdn.example/acme.ico' } }
    expect(faviconFor(undefined, org)).toBe('https://cdn.example/acme.ico')
  })

  it('SUPPRESSES with an empty data URL when neither is set', () => {
    // The case that was broken. `undefined` here means no <link> is emitted,
    // and the browser then requests the origin's /favicon.ico — Aglyn's.
    expect(faviconFor(undefined, AGENCY)).toBe('data:,')
  })

  it('an unresolved org suppresses too, never emits', () => {
    // getOrgBilling fails open with org: null, and resolveOrgEntitlements(null)
    // resolves to the FREE plan — so a transient Firestore error on an Agency
    // site would put our mark back in their tab if this leaned the other way.
    expect(faviconFor(undefined, null)).toBe('data:,')
    expect(faviconFor(undefined, {})).toBe('data:,')
  })

  it('a FREE site still gets the platform fallback, unchanged', () => {
    // The other direction. Suppressing here would blank the tab of every free
    // site for no reason — platform attribution is correct on that plan.
    expect(faviconFor(undefined, FREE)).toBeUndefined()
    expect(showsPlatformAttribution(FREE as never)).toBe(true)
  })

  it('the layout calls this function rather than inlining the rule', () => {
    // The extraction is what makes every assertion above about production
    // behaviour instead of about a copy. If the layout stops calling it, these
    // pass while the site serves whatever the layout decided instead.
    const layout = readFileSync(
      resolve(__dirname, '../app/[host]/layout.tsx'),
      'utf8',
    )
    expect(layout).toContain('resolveSiteFaviconHref(')
    expect(layout).toContain('orgBrandFavicon(')
  })

  it('the platform profile carries no favicon, so precedence cannot short-circuit', () => {
    // If the platform default ever gained one, the `data:,` branch would be
    // unreachable and this suite would keep passing while the fix was gone.
    expect(PLATFORM_BRANDING_PROFILE.faviconUrl).toBeNull()
  })
})
