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

import { showsPlatformAttribution } from '@aglyn/aglyn/server'
import getHost from './get-host'
import getOrgBilling from './get-org-billing'

/**
 * May THIS host's pages carry the Aglyn fingerprint? (AGL-2088)
 *
 * Resolves a tenant host (subdomain, `cname--` sentinel, or alias) to its org
 * and asks the one shared predicate. Two consumers — `generateMetadata`, for
 * the `<meta name="generator">` tag, and the lockdown-verdict route, which
 * carries the answer out to the edge middleware for `x-powered-by` — so the
 * rule is derived ONCE and cannot drift between the head and the headers the
 * way `removeBranding` drifted across surfaces before `resolveBrandingProfile`
 * pulled it together.
 *
 * Costs no extra Firestore read on the render path: both lookups are the same
 * `withRenderCache` entries `loadPageData` already populated for this request.
 *
 * ⚠️ FAILS CLOSED, on every branch — unknown host, missing org, thrown error.
 * The tempting shape is `!checkEntitlement(org, 'whiteLabel')`, and it is
 * wrong: `getOrgBilling` fails open with `org: null`, and a null org resolves
 * as the FREE plan, so a transient Firestore error on an Agency site would
 * stamp the generator tag onto the one site that pays not to have it. Nothing
 * downstream can recover from that; a missing sample is recoverable on the
 * next request.
 */
export async function hostShowsPlatformAttribution(
  host: string,
): Promise<boolean> {
  try {
    const hostRes = await getHost({ host: host as never })
    if (!hostRes.host?.$id) return false
    const orgRes = await getOrgBilling({ hostId: hostRes.host.$id })
    return showsPlatformAttribution(orgRes.org)
  } catch (error) {
    console.error('[platform-attribution] failed', error)
    return false
  }
}

export default hostShowsPlatformAttribution
