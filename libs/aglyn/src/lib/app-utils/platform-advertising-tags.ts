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
 * Which advertising tags may load on AGLYN'S OWN NON-TENANT SURFACES — the
 * console (`app.aglyn.com`, `auth.aglyn.com`) and the docs site
 * (`docs.aglyn.com`).
 *
 * ## Why this exists beside `advertising-tags.ts` rather than inside it
 *
 * {@link resolveAdvertisingTags} answers the same question for a TENANT page,
 * and every one of its inputs is a host document: the surface discriminator is
 * `isPlatformMarketingHost`, the configuration is `analytics.adTags`, and the
 * consent record is keyed per host id. None of those exist here. The console
 * and the docs are not sites anybody published; they are Aglyn's own
 * properties, so their ids come from build configuration and their consent
 * comes from the platform record.
 *
 * What is deliberately NOT duplicated is the vendor registry. Both resolvers
 * read {@link ADVERTISING_VENDORS}, so a vendor is described — loaded, torn
 * down, and its cookies named — exactly once. A second registry is how a
 * vendor comes to be revocable on one surface and resident forever on
 * another.
 *
 * ## Configuration, and why nothing is hardcoded
 *
 * ⛔ No default id, for any vendor. `analyticsMayEmit()` is true for ANY
 * production build, self-hosted ones included, so a hardcoded pixel id would
 * have every operator's console building retargeting audiences in Aglyn's ad
 * accounts out of their users. Unset means unset and nothing loads — the same
 * rule `platform-ad-conversions.ts` and the docs site's `DOCS_*` values are
 * built on, and the one this file follows rather than reinvents.
 *
 * A self-host operator's own advertising tags are their business: setting
 * these variables to their own ids is how they run them, and leaving them
 * unset is how they run none.
 *
 * ⚠️ `process.env.NAME` is inlined at BUILD time by Next and never the bracket
 * form, so every read below is written out literally. They are fixed when the
 * image is built rather than when it starts; changing ad accounts is a
 * rebuild.
 */

import {
  ADVERTISING_VENDORS,
  type ResolvedAdvertisingTag,
} from './advertising-tags'
import {
  analyticsMayEmit,
  type AnalyticsEnvironment,
  readAnalyticsEnvironment,
} from './analytics-environment'
import { GTM_CONTAINER_ID_PATTERN } from './visitor-consent'

/**
 * The build-configured account id for each vendor this surface can mount,
 * keyed by {@link AdvertisingVendor.id}.
 *
 * Read at CALL time rather than captured in a module constant, so a spec can
 * drive every branch — the alternative is a constant that can only ever be
 * observed in one state, which is the shape of a check that cannot fail.
 * `readAnalyticsEnvironment` is written the same way and for the same reason.
 */
export function readPlatformAdTagIds(): Record<string, string> {
  return {
    meta: process.env.NEXT_PUBLIC_META_PIXEL_ID || '',
    // The SAME variable the conversion reporter reads. One `AW-` account id
    // per deployment: a build that fired conversions into one advertiser and
    // built audiences in another would split a funnel that has to be joined,
    // and the second variable is the one that would go stale.
    'google-ads': process.env.NEXT_PUBLIC_ADS_CONVERSION_ID || '',
    linkedin: process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID || '',
  }
}

/** The build-configured Google Tag Manager container, or an empty string. */
export function readPlatformGtmContainerId(): string {
  return process.env.NEXT_PUBLIC_GTM_CONTAINER_ID || ''
}

/**
 * Which advertising tags may exist on this surface, for this visitor, right
 * now.
 *
 * Pure, and empty is the answer to every question it cannot answer — a build
 * that may not emit, a visitor who has not granted, an unconfigured vendor, a
 * malformed id.
 *
 * `advertisingGranted` is PASSED IN rather than read here, and that is the
 * whole of the arrangement this module is for. Each surface resolves consent
 * through the machinery it already has — the console through
 * `platformAdvertisingAllowed()` over its own posture-resolved record, the
 * docs site through the registrable-domain mirror of that same record — and
 * neither gets a second reading of a cookie from inside an analytics helper.
 * One resolver per surface, asked by the mount rather than re-implemented in
 * it.
 *
 * `analyticsMayEmit` is checked HERE and not left to the caller, because it is
 * the one condition that is a property of the BUILD rather than of the
 * visitor: `next dev` and any Vercel preview build resolve these ids exactly
 * as production does, and without this a preview deploy would build real
 * retargeting audiences out of our own engineers (AGL-2067).
 */
export function resolvePlatformAdvertisingTags(
  advertisingGranted: boolean,
  ids: Record<string, string> = readPlatformAdTagIds(),
  env: AnalyticsEnvironment = readAnalyticsEnvironment(),
): ResolvedAdvertisingTag[] {
  if (advertisingGranted !== true) return []
  if (analyticsMayEmit(env) === false) return []
  const tags: ResolvedAdvertisingTag[] = []
  for (const vendor of ADVERTISING_VENDORS) {
    // Sweep-only: nothing to mount, and no `accountIdPattern` to test with.
    // Skipped explicitly rather than left to fail a pattern check, so a stray
    // configured value cannot conjure a script.
    if (vendor.sweepOnly || !vendor.accountIdPattern) continue
    const accountId = String(ids[vendor.id] ?? '')
    // Strict format check, exactly as the tenant resolver applies: the id
    // lands inside an inline script (the AGL-138 concern), and a half-set
    // variable must read as absent rather than as an id.
    if (vendor.accountIdPattern.test(accountId)) {
      tags.push({ vendor, accountId })
    }
  }
  return tags
}

/**
 * The Google Tag Manager container this surface may load, or null.
 *
 * ## Why the gate here is ANALYTICS and never advertising
 *
 * A container is not a tag — it is a LOADER, and what it loads is decided in
 * Google's UI by whoever owns it, not here. The tenant runtime already settled
 * the rule this follows: a container cannot have a WEAKER gate than GA,
 * because it is the likeliest thing on a page to carry an advertising tag, and
 * it cannot have a stronger one either or a container-only surface would never
 * load at all. So it rides the analytics grant, and the advertising signals
 * the visitor did or did not give reach its tags through Consent Mode v2 —
 * which is why `PLATFORM_CONSENT_DEFAULT_COMMANDS` has to be declared before
 * `gtm.js` is requested and not after.
 *
 * ⚠️ A container's CONTENTS are not visible from this repository, and what is
 * in one is a disclosure obligation as much as a technical one: a tag added in
 * Google's UI appears in no inventory here and no spec can see it. That is a
 * reason to know what a container holds before configuring one on a surface,
 * not a reason for this function to be looser.
 *
 * ⛔ NO `<noscript>` iframe accompanies this anywhere, deliberately, and it is
 * the one piece of Google's standard snippet always omitted. That iframe fires
 * the container with no JavaScript — so no consent defaults, no gate, nothing
 * to suppress it. It is a consent bypass with a fallback's reputation. A
 * visitor with JavaScript off gets no container, which is the correct answer.
 */
export function resolvePlatformGtmContainerId(
  analyticsGranted: boolean,
  containerId: string = readPlatformGtmContainerId(),
  env: AnalyticsEnvironment = readAnalyticsEnvironment(),
): string | null {
  if (analyticsGranted !== true) return null
  if (analyticsMayEmit(env) === false) return null
  const candidate = String(containerId ?? '').trim()
  // Strict format check, same reason as the account ids above: the container
  // id lands inside an inline script.
  return GTM_CONTAINER_ID_PATTERN.test(candidate) ? candidate : null
}

/**
 * The inline boot for a Google Tag Manager container.
 *
 * The consent-mode declaration is NOT part of this string. Every surface that
 * calls it declares `PLATFORM_CONSENT_DEFAULT_COMMANDS` earlier and by its own
 * route — the console pushes them onto `dataLayer` before the Firebase SDK
 * boots gtag, the docs site emits them from its `ssrTemplate` ahead of every
 * plugin tag — and re-declaring a default mid-page re-DENIES what the first
 * one granted until an update lands. One declaration per document, made by
 * whoever is first.
 *
 * The `gtag` shim is defined anyway, because it is cheap and because
 * `dataLayer.push` of a plain array is the classic silent no-op if anything
 * downstream reaches for the function form.
 */
export function platformGtmBootSnippet(): string {
  return (
    'window.dataLayer=window.dataLayer||[];' +
    'function gtag(){dataLayer.push(arguments);}' +
    "dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});"
  )
}

/** The container library URL for `containerId`. */
export function platformGtmScriptSrc(containerId: string): string {
  return `https://www.googletagmanager.com/gtm.js?id=${containerId}`
}
