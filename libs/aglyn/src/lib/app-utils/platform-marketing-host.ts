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
 * "Is this host AGLYN'S OWN marketing site, or a customer's?"
 *
 * `aglyn.com` is an ordinary tenant site on the platform — Firestore host
 * `aglyn-marketing`, `cname: aglyn.com`, resolved through the `default:`
 * custom-domain branch of `apps/tenant/middleware.ts`, which has no
 * `aglyn.com` case at all. Nothing in the routing layer knows it is ours, and
 * that is deliberate: the marketing site is dogfood, served by exactly the
 * code a customer gets.
 *
 * So a feature that must run on our own site and NOWHERE else needs a
 * discriminator, and this is the one the codebase already had.
 *
 * ## The mechanism: the GA4 property, not a hostname
 *
 * `site-analytics.tsx` has shipped this test twice already — for the
 * marketing `content_group` axis (AGL-1857) and for the internal
 * `traffic_type` stamp (AGL-2064) — with the argument written out both times:
 * a customer's site configures its own measurement id, so **same-property IS
 * the definition of "this is our surface"**. The id lived as a private
 * constant in that file; it is hoisted here so the third reader shares the
 * one definition rather than retyping the literal beside it.
 *
 * Reusing it buys three things a hostname literal would not:
 *
 * - **No new hardcoded host.** `selfhost-hardcoded-hosts.spec.ts` (AGL-2195)
 *   ratchets every `aglyn.(app|com|io)` occurrence in runtime source with an
 *   exact per-file count. A measurement id is not a hostname, so this module
 *   adds nothing to that allowlist and nothing for a self-hoster to edit.
 * - **It is DATA, not a build constant.** The verdict is a property of the
 *   resolved host document. A self-hosted or white-label deployment points its
 *   sites at its own GA property and can never match, no matter what domain it
 *   serves — which is the correct answer, since it is not our marketing site.
 * - **It cannot be claimed by a customer.** `gaMeasurementId` is customer
 *   writable, so in principle a customer could type our id into their own
 *   site's analytics field. {@link isAglynOperatedBrand} does not close that,
 *   and neither would a hostname check on a `cname` a customer also controls.
 *   What closes it is that this predicate only ever ADDS an Aglyn-owned tag to
 *   an Aglyn-owned property: the worst a customer achieves by pasting our id
 *   is polluting our own analytics, which they can already do and which
 *   AGL-2064's stamp exists to filter. It grants them nothing and exposes no
 *   Customer Personal Data — see `advertising-tags.ts` for why that boundary
 *   is the one that actually matters here.
 *
 * ## Why the brand check too
 *
 * Belt and braces for the self-host shape. A Docker operator who forked the
 * repo keeps the literal below in their build; {@link isAglynOperatedBrand}
 * is false the moment they set `NEXT_PUBLIC_PLATFORM_BRAND_NAME`, so the
 * predicate is false for them even if a host document somehow carried our id.
 * Two independent conditions, and the cheaper one is not the load-bearing one.
 *
 * ## What this deliberately does NOT decide
 *
 * Anything about the CONSOLE or the DOCS site. All three of Aglyn's domains
 * report to this same GA4 property, so the id alone does not separate
 * marketing from `app.aglyn.com`. It does not have to: this predicate takes a
 * tenant HOST DOCUMENT, and the console and the docs site have none — neither
 * is served by the tenant runtime and neither renders `SiteAnalytics`. The
 * separation there is structural (no mount point), not a matter of this
 * function getting it right.
 */

import { isAglynOperatedBrand } from './platform-brand'
import {
  resolveGaMeasurementId,
  type VisitorConsentHost,
} from './visitor-consent'

/**
 * The platform's own GA4 property. Public in every page the platform serves,
 * so holding it in source discloses nothing.
 *
 * Hoisted out of `site-analytics.tsx` so the two behaviours already
 * keyed on it and the advertising gate cannot drift onto different literals.
 */
export const PLATFORM_GA_MEASUREMENT_ID = 'G-YW5PG16YTM'

/**
 * Whether this resolved tenant host is Aglyn's own marketing site.
 *
 * `false` for every customer site, for every self-hosted deployment, and for
 * an absent or malformed host document. The default is the safe one in the
 * sense that matters: a feature scoped by this predicate does not run.
 */
export function isPlatformMarketingHost(
  host: VisitorConsentHost | null | undefined,
): boolean {
  if (isAglynOperatedBrand() === false) return false
  return resolveGaMeasurementId(host) === PLATFORM_GA_MEASUREMENT_ID
}
