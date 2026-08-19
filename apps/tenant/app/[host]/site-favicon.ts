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

import type * as Aglyn from '@aglyn/aglyn/server'
import {
  resolveBrandingProfile,
  showsPlatformAttribution,
} from '@aglyn/aglyn/server'

/**
 * Which favicon a published site serves, or `undefined` to emit no link at all
 * (AGL-2183).
 *
 * A separate pure function rather than an expression inside the layout, and
 * that is not tidiness: `HostLayout` is an async Server Component that reads
 * Firestore through two cached helpers, so a test of the layout is a test of
 * its mocks. Extracting the decision means the guard exercises the REAL
 * precedence instead of a copy of it that can drift silently — the failure
 * mode where a spec keeps passing after the behaviour it describes has moved.
 *
 * ## The four states, and why the third one exists
 *
 * `undefined` means the layout emits no `<link rel="icon">`, which makes the
 * browser request the origin's `/favicon.ico` — and on this app that file is
 * **Aglyn's mark**. That is correct on a free site, where platform attribution
 * is the deal, and it is a broken promise on a white-label customer's own
 * domain. AGL-1421 emitted a link only when the site had configured one and
 * noted the fallback in a comment; this closes the half it left open.
 *
 * `'data:,'` is the standard suppressing form: a valid, empty data URL. The
 * empty STRING would be worse than nothing, because it resolves against the
 * page and makes the browser fetch the page itself as an icon.
 *
 * ## Why `showsPlatformAttribution` and not a fresh entitlement check
 *
 * It already carries the asymmetry this decision needs: an unresolved org
 * SUPPRESSES. `getOrgBilling` fails open with `org: null` on a Firestore
 * error and `resolveOrgEntitlements(null)` resolves to the free plan, so a
 * transient read failure on an Agency site would otherwise put our mark back
 * in their tab. Suppressing wrongly costs a blank tab for one render;
 * emitting wrongly breaks a paid promise on a customer's domain.
 */
export function resolveSiteFaviconHref(options: {
  /** `seo.favicon`, already resolved to a fetchable src. */
  siteFavicon?: string
  /** The org's white-label mark, already resolved to a fetchable src. */
  brandFavicon?: string
  /** The billing/entitlement doc, or null when it could not be read. */
  org: Partial<Aglyn.AglynOrgBilling> | null | undefined
}): string | undefined {
  const { siteFavicon, brandFavicon, org } = options
  return (
    siteFavicon ||
    brandFavicon ||
    (showsPlatformAttribution(org) ? undefined : 'data:,')
  )
}

/** The org's white-label favicon before media resolution, or undefined. */
export function orgBrandFavicon(
  org: Partial<Aglyn.AglynOrgBilling> | null | undefined,
): string | undefined {
  return resolveBrandingProfile(org).faviconUrl ?? undefined
}
