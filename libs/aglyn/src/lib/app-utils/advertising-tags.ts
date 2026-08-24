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
 * The VENDOR-AGNOSTIC advertising-tag gate.
 *
 * ## The hole this closes
 *
 * Until now the consent machinery could gate exactly one thing: Google. The
 * `advertising` category has existed since AGL-1649 and it is honest — it
 * follows the visitor's posture exactly, so a prior-consent visitor needs an
 * explicit accept and GPC never carries it — but the
 * only ENFORCEMENT it ever reached was {@link consentModeSignals}, four
 * strings handed to `gtag`. A non-Google tag could not be consent-gated at
 * all, because nothing in the repo knew how to gate one. Deciding to deploy a
 * Meta Pixel with that as the state of the art would have meant either
 * shipping it ungated or inventing a second consent implementation beside the
 * first — the outcome AGL-1579 explicitly ruled out.
 *
 * This module is the missing enforcement channel, built for vendors in
 * general and populated with one descriptor. **Deploying the Meta Pixel is a
 * separate decision and this module does not take it** — see "What is NOT
 * wired" below.
 *
 * ## Why the gate is STRUCTURAL
 *
 * The lesson AGL-1498 paid for and AGL-1608 paid for again: a boolean checked
 * before each call is not a gate. A resident tag fires on its own — GA4
 * enhanced measurement re-created `_ga_YW5PG16YTM` on aglyn.com after a
 * hand-run sweep to zero cookies, from one scroll to the footer — so the only
 * enforcement that holds is the tag never being in the document.
 *
 * So the shape here mirrors the GA gate exactly:
 *
 * - {@link resolveAdvertisingTags} is a PURE verdict over the host document
 *   and the visitor's stored record. It returns the tags that may exist. An
 *   ungranted visitor gets an empty array, the component renders no
 *   `<Script>`, and no request goes to the vendor. Not loaded-then-suppressed:
 *   not loaded.
 * - {@link revokeAdvertisingTags} exists because the gate CANNOT unload a tag.
 *   Dropping the element on a mid-pageview withdrawal leaves the vendor's
 *   script executing, so withdrawal additionally revokes consent on the
 *   resident tag, removes its script elements, and sweeps its cookies — in
 *   that order, for the AGL-1608 reason: sweeping first deletes the cookies
 *   and immediately gets them back.
 *
 * ## The five conditions, all independent, all required
 *
 * 1. **{@link isPlatformMarketingHost}** — Aglyn's own marketing site, never a
 *    customer's. This is the DPA §3.2 boundary: Aglyn promises customers it
 *    does not "sell"/"share" Customer Personal Data, and an ad pixel on a
 *    customer's published site — or in the console — would breach that. Note
 *    the console needs no condition of its own: it does not render the tenant
 *    runtime's analytics component at all, so there is no mount point to gate.
 * 2. **{@link analyticsMayEmit}** — a real production deployment. AGL-2067's
 *    finding was that `next dev` and Vercel PREVIEW builds resolve
 *    `aglyn.com`'s host document exactly as production does; without this a
 *    preview deploy would build real retargeting audiences out of our own
 *    engineers.
 * 3. **{@link hostConsentRequired}** — the consent machinery is actually live
 *    for this site. A host that switched the tool off (`consent.disabled`)
 *    runs their own CMP and ours has no answer on file to act on.
 * 4. **{@link advertisingGrantedByRecord}** — the host asks about advertising
 *    AND the visitor's record grants that specific category. This is
 *    where the region behaviour is INHERITED rather than reimplemented: an
 *    EEA/UK visitor pre-choice has no record, an unknown-region visitor has no
 *    record, and `gpc-opt-out` cannot carry a grant. A US `implied` visitor
 *    CAN (AGL-2402), which is the point of the widening — and it is still the
 *    posture deciding, not this file, because an `implied` record is only ever
 *    written outside the prior-consent regions. There is deliberately no
 *    country logic in this file.
 * 5. **A configured, well-formed account id for a KNOWN vendor.** The gate
 *    describes what may load; the host document decides what is configured.
 *
 * ## What is NOT wired, and why that is the point
 *
 * No host document carries an `analytics.adTags` entry. The Meta descriptor
 * below is a description of how that vendor would be loaded and — more
 * importantly — how it would be torn down; it is inert until someone writes a
 * pixel id onto the `aglyn-marketing` host. That makes deployment a DATA
 * change reviewed on its own merits, exactly as configuring GA is, rather than
 * something that rides along with this mechanism.
 *
 * ## Why customer sites are excluded outright rather than offered this
 *
 * A customer-facing "run your own ad pixel" feature is a different product
 * decision with its own consent copy, its own cookie-policy rows and its own
 * DPA implications. Nothing here forecloses it. What this module must not do
 * is arrive as that feature by accident.
 */

import {
  analyticsMayEmit,
  type AnalyticsEnvironment,
  readAnalyticsEnvironment,
} from './analytics-environment'
import { isPlatformMarketingHost } from './platform-marketing-host'
import {
  ADVERTISING_COOKIE_PREFIXES,
  advertisingGrantedByRecord,
  clearCookiesWithPrefixes,
  hostConsentRequired,
  type StoredVisitorConsent,
  type VisitorConsentHost,
} from './visitor-consent'

/**
 * The attribute every script element this module renders carries.
 *
 * Load-bearing for the teardown, not decoration. {@link revokeAdvertisingTags}
 * acts ONLY on elements carrying it, so a vendor tag a customer pasted into
 * their own site's Custom HTML is never touched by our withdrawal path — we
 * did not load it, we do not know what basis it runs on, and silently killing
 * it would be us configuring a customer's site. Its value is the vendor id.
 */
export const ADVERTISING_TAG_ATTRIBUTE = 'data-aglyn-ad-tag'

/**
 * One advertising vendor, described completely enough to LOAD it and — the
 * half that is easy to forget and impossible to retrofit — to STOP it.
 *
 * Every field exists because withdrawal needs it. A vendor that cannot be
 * revoked, whose script cannot be found in the document, and whose cookies are
 * not named, cannot be consent-gated at all; requiring the descriptor to
 * answer all three is what stops a future vendor being added load-only.
 *
 * TWO SHAPES, since AGL-2486. A vendor we MOUNT answers all three and every
 * field below is required of it. A {@link AdvertisingVendor.sweepOnly} vendor
 * answers only the third, because there is no script of ours to find or stop —
 * its cookies are a side effect of a tag another module owns. The mount fields
 * are therefore optional at the type level and mandatory in practice for
 * anything without that flag, which `advertising-tag-gate.spec.tsx` asserts.
 * `cookiePrefixes` stays required of BOTH: naming the cookies is the one thing
 * no vendor is excused from, and it is what the Cookie Policy is written from.
 */
export interface AdvertisingVendor {
  /** Stable key: the `analytics.adTags` map key and the attribute value. */
  readonly id: string
  /** Human name, for the cookie policy and the consent copy. */
  readonly label: string
  /**
   * A vendor this module never LOADS — its cookies are a side effect of a tag
   * some other module owns (today: the GA4 gtag that `site-analytics.tsx`
   * mounts, which writes `_gcl_*` once `ad_storage` is granted). AGL-2486.
   *
   * It is a member of this registry because the registry's job is every
   * advertising artifact that touches the browser, and because the disclosure
   * guard in `cookie-inventory.spec.ts` keys on `cookiePrefixes` — a vendor
   * missing from here is a vendor missing from the Cookie Policy. Meta being
   * present while Google was absent is the asymmetry that produced the gap.
   *
   * Such a vendor declares `id`, `label` and `cookiePrefixes` and NOTHING
   * else: there is no script to mount, none to remove, and no vendor-specific
   * consent call — GA's own consent-mode signals carry the state. The mount
   * fields below are therefore optional, and `advertising-tag-gate.spec.tsx`
   * asserts every vendor WITHOUT this flag still declares all of them, so the
   * original invariant — a vendor that cannot be revoked cannot be gated —
   * survives for everything that does load.
   */
  readonly sweepOnly?: true
  /**
   * Strict format check on the configured account id. The id lands inside an
   * inline script, so this is load-bearing exactly as
   * `GA_MEASUREMENT_ID_PATTERN` is (the AGL-138 concern).
   */
  readonly accountIdPattern?: RegExp
  /** The vendor library URL. Constant — no interpolation reaches it. */
  readonly scriptSrc?: string
  /**
   * Substring that identifies a RESIDENT script element for this vendor,
   * used together with {@link ADVERTISING_TAG_ATTRIBUTE} at teardown.
   */
  readonly scriptMatch?: string
  /** Cookie-name prefixes this vendor sets, swept on withdrawal. */
  readonly cookiePrefixes: readonly string[]
  /** The inline boot snippet, built from a FORMAT-CHECKED account id. */
  readonly bootSnippet?: (accountId: string) => string
  /**
   * Tell a RESIDENT tag what the visitor decided. The vendor's own documented
   * opt-out mechanism — the `ga-disable-<id>` analogue — reached through
   * whatever global it left behind. Called in both directions, so a visitor
   * who withdraws and changes their mind in one pageview is not silently
   * unmeasured until they navigate.
   */
  readonly setConsent?: (
    scope: Record<string, unknown>,
    granted: boolean,
  ) => void
}

/**
 * Meta (Facebook/Instagram) Pixel.
 *
 * ## What happens to `_fbp` / `_fbc` on withdrawal: they are DELETED
 *
 * Not merely stopped. The decision is inherited, not invented: AGL-1606
 * settled that a withdrawal "cleans up, it does not merely stop adding" for
 * the GA equivalents, and there is no honest reading under which Meta's
 * first-party identifiers get a softer rule than Google's. Both are
 * browser-lifetime identifiers written by an advertising tag under a consent
 * the visitor has just withdrawn.
 *
 * They are swept with the SAME ladder as `_ga` — the exact hostname and every
 * domain up to the registrable one — because Meta writes them the same way GA
 * does: path `/`, first-party, at the registrable domain. A deletion aimed at
 * the exact hostname would silently no-op.
 *
 * Two limits, stated rather than glossed. Any copy Meta already ingested is
 * gone from our reach — deletion stops future joins, it does not retract past
 * ones; the CPRA opt-out title on the control is about the ongoing "share",
 * which this does stop. And a cookie written at a path other than `/` is not
 * reachable through `document.cookie`; Meta does not write one.
 *
 * ## Why `consent revoke` is called BEFORE the sweep
 *
 * `fbq('consent', 'revoke')` is Meta's documented CMP control and the exact
 * counterpart of the `ga-disable-<id>` flag. Skipping it and going straight to
 * the cookies reproduces AGL-1608: the resident pixel's next automatic event
 * re-writes `_fbp` and the sweep un-does itself inside the same pageview.
 */
export const META_PIXEL_VENDOR: AdvertisingVendor = {
  id: 'meta',
  label: 'Meta Pixel',
  // Meta pixel ids are numeric; the length band is generous on both sides
  // rather than pinned to today's 15-16 digits.
  accountIdPattern: /^[0-9]{8,20}$/,
  scriptSrc: 'https://connect.facebook.net/en_US/fbevents.js',
  scriptMatch: 'connect.facebook.net',
  cookiePrefixes: ['_fbp', '_fbc'],
  bootSnippet: (accountId: string) =>
    // Meta's own shim, then an EXPLICIT grant, then init. The explicit grant
    // is the AGL-1622 move applied to this vendor: the tag's first hit should
    // carry a state someone actually chose rather than the vendor's built-in
    // default, and declaring it before `init` means the automatic PageView is
    // already covered by it. Reached only where the gate said yes.
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}" +
    '(window,document);' +
    "fbq('consent', 'grant');" +
    `fbq('init', '${accountId}');` +
    "fbq('track', 'PageView');",
  setConsent: (scope: Record<string, unknown>, granted: boolean) => {
    try {
      const fbq = scope.fbq
      if (typeof fbq === 'function') {
        ;(fbq as (...args: unknown[]) => void)(
          'consent',
          granted ? 'grant' : 'revoke',
        )
      }
    } catch {
      // A tag that throws on its own consent call is one we cannot silence
      // that way; the element removal and the cookie sweep still stand.
    }
  },
}

/**
 * Google advertising storage — a SWEEP-ONLY vendor (AGL-2486).
 *
 * There is no Google ad script for this module to load. `_gcl_*` and `_gac_*`
 * are written by the GA4 gtag that `site-analytics.tsx` already mounts, once
 * the visitor's `ad_storage` is granted. So the tag is somebody else's to
 * mount and somebody else's to signal; what belongs here is the half nobody
 * owned, which is the cookies.
 *
 * `_gcl_au` is the specific reason this exists. It does not begin with `_ga`,
 * so {@link ANALYTICS_COOKIE_PREFIXES} never reached it, and `revokeAdvertisingTags`
 * could not either — that function acts on marked script ELEMENTS, and there
 * has never been one for Google. The cookie therefore survived every
 * withdrawal on every surface. See {@link ADVERTISING_COOKIE_PREFIXES} for why
 * the prefix is `_gcl` ALONE and cannot reach `_ga`/`_gid`.
 *
 * ⚠️ `_gac` is NOT in that list and must not be added back. It is written
 * under the analytics loader, sits in the `Google Analytics` row of
 * `apps/console/constants/cookie-inventory.ts`, and is already swept by the
 * `_ga` prefix; `advertising-cookie-sweep.spec.ts` pins it as analytics-owned.
 * An earlier version of this comment named it here, and a published Cookie
 * Policy line describing `_gac` as advertising-gated traces to exactly that.
 *
 * The prefixes are IMPORTED rather than restated. They are consumed in two
 * places — the universal sweep in `storeVisitorConsent` and the element-scoped
 * one below — and a second copy would be a second thing to forget.
 */
export const GOOGLE_ADS_VENDOR: AdvertisingVendor = {
  id: 'google-ads',
  label: 'Google advertising',
  sweepOnly: true,
  cookiePrefixes: ADVERTISING_COOKIE_PREFIXES,
}

/**
 * Every vendor this gate knows how to tear down — which is a SUPERSET of the
 * vendors it knows how to load, now that a sweep-only member exists.
 */
export const ADVERTISING_VENDORS: readonly AdvertisingVendor[] = [
  META_PIXEL_VENDOR,
  GOOGLE_ADS_VENDOR,
]

/**
 * The host fields this module reads, on top of the consent ones.
 *
 * `adTags` maps a vendor id to that vendor's account id. NO host document
 * carries it today; see the module comment on why deployment is a separate,
 * reviewable data change rather than a consequence of merging this.
 */
export interface AdvertisingTagHost extends VisitorConsentHost {
  analytics?: {
    gaMeasurementId?: string
    /** Vendor id → account id. Absent on every site that exists. */
    adTags?: Record<string, string> | null
  } | null
}

/** A vendor that may load, paired with the id it was configured with. */
export interface ResolvedAdvertisingTag {
  readonly vendor: AdvertisingVendor
  readonly accountId: string
}

/**
 * The whole verdict: which advertising tags may exist in this document, for
 * this visitor, on this site, right now?
 *
 * Pure, and empty is the answer to every question it cannot answer — an absent
 * host, an unreadable record, an unknown vendor id, a malformed account id.
 * See the module comment for the five conditions and why each one is separate.
 *
 * `stored` is the CLIENT-resolved record. Like the GA gate, this is evaluated
 * after hydration only: tenant pages are ISR-cached, so the server HTML must
 * be identical for every visitor and cannot carry a tag one of them granted.
 */
export function resolveAdvertisingTags(
  host: AdvertisingTagHost | null | undefined,
  stored: StoredVisitorConsent | null | undefined,
  env: AnalyticsEnvironment = readAnalyticsEnvironment(),
): ResolvedAdvertisingTag[] {
  if (isPlatformMarketingHost(host) === false) return []
  if (analyticsMayEmit(env) === false) return []
  if (hostConsentRequired(host) === false) return []
  if (advertisingGrantedByRecord(host, stored) === false) return []
  const configured = host?.analytics?.adTags
  if (!configured) return []
  const tags: ResolvedAdvertisingTag[] = []
  for (const vendor of ADVERTISING_VENDORS) {
    // Sweep-only: nothing to mount, and no `accountIdPattern` to test with.
    // Skipped explicitly rather than left to fail a pattern check, so a stray
    // `adTags['google-ads']` cannot conjure a script (AGL-2486).
    if (vendor.sweepOnly || !vendor.accountIdPattern) continue
    const accountId = String(configured[vendor.id] ?? '')
    if (vendor.accountIdPattern.test(accountId)) {
      tags.push({ vendor, accountId })
    }
  }
  return tags
}

/**
 * The script elements THIS MODULE put in the document for a given vendor —
 * both the inline boot and the library, since a vendor mounts as a pair.
 *
 * Scoped by {@link ADVERTISING_TAG_ATTRIBUTE}, which is the clause that keeps
 * a pixel a customer pasted into their own Custom HTML out of our teardown.
 * An element that carries the attribute but whose `src` points somewhere other
 * than this vendor is excluded as well: the attribute is ours to write, so a
 * mismatch means something rewrote it and the safe reading is "not ours".
 * An element with NO `src` is the inline boot and passes — it has no URL to
 * disagree with.
 */
function markedVendorElements(vendor: AdvertisingVendor): Element[] {
  if (typeof document === 'undefined') return []
  // A sweep-only vendor has no script of ours and therefore no element that
  // could be "ours" (AGL-2486). Returning early is also what stops an absent
  // `scriptMatch` reaching `src.includes(...)` below — an empty string there
  // would have matched EVERY marked script, handing one vendor's teardown
  // another vendor's elements.
  if (vendor.sweepOnly || !vendor.scriptMatch) return []
  try {
    const selector = `script[${ADVERTISING_TAG_ATTRIBUTE}="${vendor.id}"]`
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      const src = String((element as HTMLScriptElement).src ?? '')
      return src === '' || src.includes(vendor.scriptMatch)
    })
  } catch {
    // A hostile or absent DOM: nothing we can prove is ours.
    return []
  }
}

/** Every vendor whose tag this module loaded and that is still resident. */
export function residentAdvertisingVendors(): AdvertisingVendor[] {
  return ADVERTISING_VENDORS.filter(
    (vendor) => markedVendorElements(vendor).length > 0,
  )
}

/**
 * Stop every advertising tag THIS MODULE loaded, and return the vendor ids it
 * acted on — which is what makes the withdrawal assertable rather than
 * assumed.
 *
 * Three steps, in this order and for these reasons:
 *
 * 1. **Revoke on the resident tag.** The gate cannot unload a script that has
 *    already executed. This is the vendor's own kill switch and it is what
 *    actually stops the next automatic event.
 * 2. **Remove the script elements.** So the structural property the gate
 *    asserts — the vendor's script is not in this document — is restored and
 *    not merely claimed. React unmounting its `<Script>` does not reliably do
 *    this: `next/script` injects into the head and leaves it there.
 * 3. **Sweep the cookies.** Last, because steps 1 and 2 are what stop them
 *    coming straight back (AGL-1608).
 *
 * Acts only on tags carrying {@link ADVERTISING_TAG_ATTRIBUTE}. On a customer
 * site — where this module never loaded anything — it is a no-op that touches
 * no cookie, which is the only correct behaviour: their pixel, if any, runs on
 * a basis that is not ours to withdraw.
 */
export function revokeAdvertisingTags(hostname?: string | null): string[] {
  if (typeof window === 'undefined') return []
  const acted: string[] = []
  const scope = window as unknown as Record<string, unknown>
  for (const vendor of ADVERTISING_VENDORS) {
    // A sweep-only vendor cannot be gated on something of ours being resident,
    // because nothing of ours ever is (AGL-2486). The element check below is
    // what USED to make this loop skip Google entirely, which is how `_gcl_au`
    // survived every withdrawal.
    if (vendor.sweepOnly) {
      const swept = clearCookiesWithPrefixes(vendor.cookiePrefixes, hostname)
      if (swept.length > 0) acted.push(vendor.id)
      continue
    }
    const elements = markedVendorElements(vendor)
    if (elements.length === 0) continue
    acted.push(vendor.id)
    vendor.setConsent?.(scope, false)
    for (const element of elements) {
      try {
        element.remove()
      } catch {
        // A detached or frozen node: the revoke above still stands.
      }
    }
    clearCookiesWithPrefixes(vendor.cookiePrefixes, hostname)
  }
  return acted
}

/**
 * Re-grant on a tag that is still resident — the symmetric half.
 *
 * A visitor who withdraws and changes their mind inside one pageview would
 * otherwise stay silently un-tracked until they navigated, because a re-
 * rendered `<Script>` cannot re-execute a library the browser already ran.
 * `setResidentAnalyticsTags` is symmetric for exactly this reason and this is
 * the same move for a second channel.
 *
 * Returns the vendor ids it reached; empty when nothing is resident, which is
 * the normal case — a re-grant after the elements were removed goes through
 * the gate and loads a fresh tag instead.
 */
export function restoreAdvertisingTags(): string[] {
  if (typeof window === 'undefined') return []
  const scope = window as unknown as Record<string, unknown>
  const acted: string[] = []
  for (const vendor of residentAdvertisingVendors()) {
    vendor.setConsent?.(scope, true)
    acted.push(vendor.id)
  }
  return acted
}
