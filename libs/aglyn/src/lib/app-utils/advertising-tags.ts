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
 * `advertising` category has existed since AGL-1649 and it is honest — a
 * refusal always wins, and a host that never asked gets nothing — but the
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
 * ## The six conditions, all independent, all required
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
 *    AND the visitor explicitly said yes to that specific category. This is
 *    where the region behaviour is INHERITED rather than reimplemented: an
 *    EEA/UK visitor pre-choice has no record, an unknown-region visitor has no
 *    record, a US `implied` visitor's status cannot carry an advertising
 *    grant, and `gpc-opt-out` cannot either. There is deliberately no country
 *    logic in this file.
 * 5. **A configured, well-formed account id for a KNOWN vendor.** The gate
 *    describes what may load; the host document decides what is configured.
 * 6. **{@link readInternalTrafficOverride} is false** — this browser has not
 *    been declared one of ours. A GA4 data filter is PROPERTY-scoped: it drops
 *    `traffic_type: internal` hits from the GA4 property and has no reach into
 *    an `AW-`/Meta/LinkedIn destination at all, which are separate products
 *    reached by separate requests. Measured on `aglyn.com`: a flagged browser's
 *    pageview is correctly absent from GA4 while the same pageview still sends
 *    `ccm/collect`, `pagead/1p-user-list` (`is_vtc=1`) and
 *    `viewthroughconversion` to Google Ads, joining our own staff to the
 *    remarketing audiences those requests build. Excluding ourselves from the
 *    reports while still training the bidding on ourselves is the worse half of
 *    the problem, because it is the half nobody can see in a report.
 *
 *    This is the same browser-scoped opt-in the GA4 stamp uses, so one visit to
 *    `?aglyn_internal=1` covers both, and the two cannot drift apart into a
 *    browser that is internal for one product and external for the other. Note
 *    it is the BROWSER, not the account: staff ID-token claims are the console
 *    mechanism (AGL-1582) and there is no account to consult here.
 *
 *    {@link analyticsEnvironmentForcesInternal} is the other half of the same
 *    condition. Condition 2 passes under the non-production escape hatch, and a
 *    build that emits because someone asked it to is ours by definition — so
 *    the hatch must not hand a dev or preview build the real `AW-` id. Without
 *    this the hatch reopens precisely the hole condition 2 closes, which is why
 *    `INTERNAL_TRAFFIC_FORCED_SNIPPET` exists on the GA side.
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
  GOOGLE_ADS_ID_PATTERN,
  LINKEDIN_PARTNER_ID_PATTERN,
  META_PIXEL_ID_PATTERN,
} from './visitor-consent'
import {
  analyticsEnvironmentForcesInternal,
  analyticsMayEmit,
  type AnalyticsEnvironment,
  readAnalyticsEnvironment,
} from './analytics-environment'
import { readInternalTrafficOverride } from './internal-traffic'
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
   * Sweep this vendor's cookies even when no marked element is present.
   *
   * The element check is an OWNERSHIP test, not a liveness one: a pixel we did
   * not load is a pixel running on a basis that is not ours to withdraw, so
   * its cookies are not ours to clear either. `alwaysSweep` is for a vendor
   * whose cookies cannot belong to anybody else's tag on our surfaces —
   * Google's `_gcl_*`, which a GTM container or a bare gtag writes without any
   * marker of ours ever existing. That is the AGL-2486 case, and it is a
   * property of the COOKIE rather than of the loader.
   */
  readonly alwaysSweep?: true
  /**
   * Strict format check on the configured account id. The id lands inside an
   * inline script, so this is load-bearing exactly as
   * `GA_MEASUREMENT_ID_PATTERN` is (the AGL-138 concern).
   */
  readonly accountIdPattern?: RegExp
  /** The vendor library URL. Constant — no interpolation reaches it. */
  readonly scriptSrc?: string
  /**
   * The library URL for a vendor whose LOADER carries the account id.
   *
   * Most vendors take their id in the boot snippet and fetch a constant URL,
   * which is what {@link scriptSrc} is. `gtag.js` is the exception: Google's
   * documented install is `gtag/js?id=<account>`, and the id in the query is
   * what tells the loader which container's configuration to fetch. Without
   * it the library still returns 200 and still defines `gtag()`, so nothing
   * anywhere reports an error — it simply registers no container, and every
   * `config` for the account queues against a runtime that will never serve
   * it. Measured on `app.aglyn.com` (AGL-2559): the bare loader left
   * `google_tag_data.tidr.container` holding the GA4 id and an EMPTY string,
   * with no request to `googleadservices` at all.
   *
   * Present, it wins over {@link scriptSrc}. `scriptSrc` stays the vendor's
   * base URL, because it is what {@link sharesLibrary}, {@link scriptMatch}
   * and the CSP origin list are all matched against, and none of those may
   * vary per account.
   *
   * The id reaching a URL is the same load-bearing check as the id reaching an
   * inline script: it is interpolated only after `accountIdPattern` passed.
   */
  readonly scriptSrcFor?: (accountId: string) => string
  /**
   * A substring of a library URL this vendor SHARES with another loader.
   *
   * Set it and the tag mounts its boot snippet but skips its own `<script>`
   * when a matching one is already in the document. Google Ads is the case:
   * `gtag.js` is the same library the GA4 measurement id loads, so a site with
   * both configured would fetch it twice, define `gtag()` twice, and — the
   * part that actually corrupts data — push a second `consent default` that
   * re-denies what the first one granted, mid-pageview.
   *
   * The boot snippet still runs, because a `config` for a SECOND product is
   * exactly how gtag is meant to carry two: one library, two configs, no
   * double count.
   */
  readonly sharesLibrary?: string
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
  accountIdPattern: META_PIXEL_ID_PATTERN,
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
  /*
   * A LOADER now, not sweep-only (AGL-1152).
   *
   * It was sweep-only because Google's ad tags arrived through something else
   * — a GA4 id or a GTM container — so there was nothing of ours to mount and
   * only cookies to clear. That made advertising reachable ONLY through an
   * analytics product: a site that wanted Google Ads and no analytics had no
   * route at all, and the CSP gate that reads `adTags` never opened for it.
   *
   * `gtag.js` with an `AW-` id is Google's own documented install for Ads
   * without Analytics. The same library serves both products; what differs is
   * the id it is configured with, which is why the two patterns are separate
   * and neither field accepts the other's.
   */
  accountIdPattern: GOOGLE_ADS_ID_PATTERN,
  // Keeps the AGL-2486 sweep it had as a sweep-only vendor: `_gcl_*` is
  // written by any Google tag, including ones we never marked.
  alwaysSweep: true,
  scriptSrc: 'https://www.googletagmanager.com/gtag/js',
  // The loader carries the account, because gtag resolves the container from
  // the query rather than from the `config` that follows. See `scriptSrcFor`;
  // reached only when `sharesLibrary` did NOT find a loader to ride.
  scriptSrcFor: (accountId: string) =>
    `https://www.googletagmanager.com/gtag/js?id=${accountId}`,
  // The GA4 measurement id loads this exact library. See `sharesLibrary`.
  sharesLibrary: 'googletagmanager.com/gtag/js',
  scriptMatch: 'googletagmanager.com/gtag/js',
  cookiePrefixes: ADVERTISING_COOKIE_PREFIXES,
  bootSnippet: (accountId: string) =>
    /*
     * DENIED FIRST, then granted — the AGL-1622 order.
     *
     * `gtag('consent', 'default', …)` has to run before the config, or the
     * library's own default applies to the first hit. This snippet is reached
     * only where the gate already said yes, so the grant follows immediately;
     * declaring the default anyway is what makes the first hit carry a state
     * somebody chose rather than Google's.
     *
     * `ad_user_data` and `ad_personalization` are named alongside
     * `ad_storage`: Consent Mode v2 treats them as separate signals, and a
     * grant that sets only storage leaves the other two at the library's
     * default on every EEA request.
     */
    /*
     * NO `consent default` here, deliberately.
     *
     * A default is a page-level declaration and something else may already
     * have made it — the GA4 loader above declares one, and re-declaring it
     * mid-pageview re-DENIES what that grant allowed until the update lands.
     * This snippet is reached only where the gate already said yes, so it
     * states the update and leaves the default to whoever mounts first.
     *
     * `ad_user_data` and `ad_personalization` travel with `ad_storage`:
     * Consent Mode v2 treats them as separate signals, and an update setting
     * only storage leaves the other two at the library's default on every
     * EEA request.
     */
    'window.dataLayer=window.dataLayer||[];' +
    'function gtag(){dataLayer.push(arguments);}' +
    "gtag('consent','update',{ad_storage:'granted'," +
    "ad_user_data:'granted',ad_personalization:'granted'});" +
    "gtag('js', new Date());" +
    `gtag('config', '${accountId}');`,
  setConsent: (scope: Record<string, unknown>, granted: boolean) => {
    try {
      const gtag = scope.gtag
      if (typeof gtag === 'function') {
        ;(gtag as (...args: unknown[]) => void)('consent', 'update', {
          ad_storage: granted ? 'granted' : 'denied',
          ad_user_data: granted ? 'granted' : 'denied',
          ad_personalization: granted ? 'granted' : 'denied',
        })
      }
    } catch {
      // A tag that throws on its own consent call is one we cannot silence
      // that way; the element removal and the cookie sweep still stand.
    }
  },
}

/**
 * LinkedIn Insight Tag.
 *
 * ## Cookies, and why the prefix list is long
 *
 * LinkedIn writes more names than the other two and they do not share a stem:
 * `li_sugr` and `UserMatchHistory` are the retargeting identifiers, `bcookie`
 * and `lidc` are set on the `.linkedin.com` domain by the loader, and
 * `AnalyticsSyncHistory` records the last sync. A prefix list that named only
 * `li_` would leave three of them behind on withdrawal — the AGL-2486 shape,
 * where a sweep looks thorough because it cleared the ones that happen to
 * share a prefix.
 *
 * ⚠️ `bcookie` and `lidc` are written at `.linkedin.com`, a domain a page on
 * our origin cannot delete through `document.cookie`. The sweep removes what
 * it can reach and the element removal stops the tag writing more; the rest is
 * LinkedIn's to hold, and saying so is better than a sweep that quietly
 * half-works.
 */
export const LINKEDIN_INSIGHT_VENDOR: AdvertisingVendor = {
  id: 'linkedin',
  label: 'LinkedIn Insight Tag',
  accountIdPattern: LINKEDIN_PARTNER_ID_PATTERN,
  scriptSrc: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
  scriptMatch: 'snap.licdn.com',
  cookiePrefixes: [
    'li_sugr',
    'UserMatchHistory',
    'AnalyticsSyncHistory',
    'bcookie',
    'lidc',
    'li_gc',
  ],
  bootSnippet: (accountId: string) =>
    // The Insight Tag reads its partner id off a global array the library
    // drains on load, so the id is pushed before the script is appended
    // rather than passed to it.
    `window._linkedin_partner_id='${accountId}';` +
    'window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];' +
    'window._linkedin_data_partner_ids.push(window._linkedin_partner_id);',
  setConsent: (scope: Record<string, unknown>, granted: boolean) => {
    try {
      // The tag has no consent API of its own. What it does have is the
      // partner-id array it drains on load: emptying it stops a late or
      // re-inserted library finding an id to report against. The element
      // removal and the cookie sweep remain the substance.
      if (!granted) scope._linkedin_data_partner_ids = []
    } catch {
      // Same standing as the others: the teardown does not depend on this.
    }
  },
}

/**
 * Every vendor this gate knows how to tear down — which is a SUPERSET of the
 * vendors it knows how to load, now that a sweep-only member exists.
 */
export const ADVERTISING_VENDORS: readonly AdvertisingVendor[] = [
  META_PIXEL_VENDOR,
  GOOGLE_ADS_VENDOR,
  LINKEDIN_INSIGHT_VENDOR,
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
 * See the module comment for the six conditions and why each one is separate.
 *
 * `stored` is the CLIENT-resolved record. Like the GA gate, this is evaluated
 * after hydration only: tenant pages are ISR-cached, so the server HTML must
 * be identical for every visitor and cannot carry a tag one of them granted.
 *
 * `internal` is read the same way and for the same reason. Taking it as a
 * defaulted parameter rather than calling into the browser mid-verdict is what
 * keeps this function testable in both directions — a gate that can only be
 * exercised one way is the shape that ships broken (AGL-2067).
 */
export function resolveAdvertisingTags(
  host: AdvertisingTagHost | null | undefined,
  stored: StoredVisitorConsent | null | undefined,
  env: AnalyticsEnvironment = readAnalyticsEnvironment(),
  internal: boolean = readInternalTrafficOverride(),
): ResolvedAdvertisingTag[] {
  if (isPlatformMarketingHost(host) === false) return []
  if (analyticsMayEmit(env) === false) return []
  if (hostConsentRequired(host) === false) return []
  if (advertisingGrantedByRecord(host, stored) === false) return []
  // Condition 6. Structural, like every other clause here: the tag is not
  // mounted rather than mounted-and-suppressed, because a resident tag fires
  // on its own and a `_gcl_*` cookie is written by the first automatic event.
  //
  // The environment half is not redundant with `analyticsMayEmit` above. That
  // clause passes under the non-production escape hatch, and a build emitting
  // because someone asked it to is ours by definition — so the hatch must not
  // hand a dev or preview build the real `AW-` id and let it build remarketing
  // audiences out of our own engineers, which is the hole condition 2 exists
  // to close. Same reasoning as `INTERNAL_TRAFFIC_FORCED_SNIPPET`.
  if (internal === true) return []
  if (analyticsEnvironmentForcesInternal(env) === true) return []
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
    /*
     * The element check is an OWNERSHIP test (AGL-1498 case (e)).
     *
     * A pixel we did not load is one running on a basis that is not ours to
     * withdraw — a customer's own Custom HTML, on their own site, under their
     * own notice. Killing it, or clearing its cookies, would be us
     * reconfiguring their site against a consent record their tag never ran
     * on. So no marker of ours means hands off, cookies included.
     *
     * `alwaysSweep` is the narrow exception and it is about the COOKIE, not
     * the loader: `_gcl_*` is written by any Google tag — a GTM container, a
     * bare gtag — with no marker of ours ever existing, which is why it
     * survived every withdrawal until AGL-2486. Giving Google a loader must
     * not quietly take that sweep away again.
     *
     * ORDER, which is the whole of AGL-1608: revoke on the tag FIRST, then
     * remove it, then sweep. Sweeping first deletes the cookies and the
     * resident pixel's next automatic event writes them straight back inside
     * the same pageview.
     */
    const elements = vendor.sweepOnly ? [] : markedVendorElements(vendor)
    const ours = elements.length > 0
    if (ours) {
      vendor.setConsent?.(scope, false)
      for (const element of elements) {
        try {
          element.remove()
        } catch {
          // A detached or frozen node: the revoke above still stands.
        }
      }
    }
    const maySweep = ours || vendor.sweepOnly || vendor.alwaysSweep
    const swept = maySweep
      ? clearCookiesWithPrefixes(vendor.cookiePrefixes, hostname)
      : []
    if (ours || swept.length > 0) acted.push(vendor.id)
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
