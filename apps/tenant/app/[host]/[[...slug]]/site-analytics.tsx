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

'use client'

import ConsentBannerUi from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { installLinkClickTracking } from '@aglyn/aglyn/app-utils/analytics-link-clicks'
import {
  installCampaignForwarding,
  setCampaignForwardingConsent,
} from '@aglyn/aglyn/app-utils/campaign-forwarding'
import { setCampaignTouchConsent } from '@aglyn/aglyn/app-utils/campaign-touch'
import { installWebVitalsReporting } from '@aglyn/aglyn/app-utils/web-vitals-rum'
import {
  INTERNAL_TRAFFIC_FORCED_SNIPPET,
  INTERNAL_TRAFFIC_GTAG_SNIPPET,
} from '@aglyn/aglyn/app-utils/internal-traffic'
import {
  analyticsEnvironmentForcesInternal,
  analyticsMayEmit,
} from '@aglyn/aglyn/app-utils/analytics-environment'
import {
  analyticsBeaconMaySend,
  sendAnalyticsBeacon,
} from '@aglyn/aglyn/app-utils/analytics-beacon'
import {
  advertisingGrantedByRecord,
  GA_CLICK_ID_PASSTHROUGH_SNIPPET,
  GA_CONSENT_DEFAULT_SNIPPET,
  GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET,
  hostAsksAboutAdvertising,
  hostConsentRequired,
  isAnalyticsAllowed,
  resolveGaMeasurementId,
  resolveGtmContainerId,
  type VisitorConsentHost,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import AdvertisingTags from './advertising-tags'
// The platform's own GA4 property (AGL-1857). `aglyn.com` is a tenant site
// pointed at this id, and it is the ONE host whose pageviews should carry
// `content_group: 'marketing'` — the GA4 axis that separates marketing from
// `console` and `docs` without reaching for the Hostname dimension. A
// customer's site configures their own id, which is why the discriminator is
// the id itself: same-property IS the definition of "this is our surface".
// Hoisted to `platform-marketing-host.ts` so the advertising gate
// shares this definition rather than retyping the literal beside it.
import { PLATFORM_GA_MEASUREMENT_ID } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import Script from 'next/script'
import type { ReactElement } from 'react'
import { primeVisitorConsent, useVisitorConsent } from './use-visitor-consent'
import { claimDailyVisit } from './visit-claim'

/**
 * Pageviews this page load has already DECIDED, keyed by host and path.
 * Module scope, so it survives the re-renders and remounts a page does on its
 * own — `/api/analytics/collect` is a metered-billing input and must be told
 * about a pageview once.
 *
 * A pageview the beacon gate refused is recorded here too. The gate reads
 * `localStorage` and the answer cannot change within one pageview, so
 * re-deciding on every render would buy nothing and cost a storage read each
 * time.
 */
const beaconed = new Set<string>()

/**
 * Where the console lives, for the AGL-1731 campaign hop. Configured rather
 * than written, because a self-host install points this somewhere else
 * entirely — and because it is the allowlist: it is the ONLY origin whose
 * links get a campaign put on them, so a third-party link can never be handed
 * our marketing labels.
 */
const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'

/**
 * Send the pageview beacon (AGL-82), NOT from an effect (AGL-1550).
 *
 * An effect only runs if React commits, and a page that renders but never
 * commits is exactly the failure this component exists to survive: in AGL-1541
 * the site-plugin gate stayed suspended, so nothing below the root ever
 * committed and every rAF-starved visitor went uncounted — 90 s on `/pricing`
 * with zero beacon activity. React will not commit a tree while a sibling is
 * suspended, and the only boundary that would isolate one is the page-wide
 * Suspense AGL-1541 had to delete. So the call is made during render, the way
 * `ErrorBeacon` (AGL-1538) installs at module scope for the same reason: the
 * thing that reports the failure cannot be scheduled by the thing that failed.
 *
 * Safe to do here because it is idempotent (the `beaconed` guard), takes no
 * part in the render output, and is client-only — the server must render
 * identically for every visitor or ISR would cache one of them.
 */
function sendPageviewBeacon(hostId: string | undefined, screenId?: string) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (!hostId) return
  const key = `${hostId}\x00${window.location.pathname}`
  if (beaconed.has(key)) return
  beaconed.add(key)
  // The environment and internal-traffic gate, AFTER the once-per-pageview
  // guard so it is evaluated once, and BEFORE `claimDailyVisit` so an
  // uncounted pageview does not spend the tab's visit claim for the day.
  if (!analyticsBeaconMaySend()) return
  try {
    // Campaign attribution (AGL-1844): the three utm labels, straight off
    // the query string. Marketer-chosen labels on the URL the visitor is
    // already on — no cookie, no identifier; the collector clamps and caps
    // their cardinality server-side.
    const params = new URLSearchParams(window.location.search)
    sendAnalyticsBeacon({
      hostId,
      path: window.location.pathname,
      // Per-screen attribution (AGL-151).
      screenId: screenId || undefined,
      // External referrer host only; same-site moves are dropped
      // server-side (AGL-138).
      referrer: document.referrer || undefined,
      utmSource: params.get('utm_source') || undefined,
      utmMedium: params.get('utm_medium') || undefined,
      utmCampaign: params.get('utm_campaign') || undefined,
      // Visitor approximation (AGL-1844): true on the first pageview
      // this tab sends today. A day string in sessionStorage is the
      // entire mechanism — see `visit-claim.ts` for the honesty
      // contract. Claimed only when a beacon is actually sent (the
      // `beaconed` and gate guards above), so the claim and the pageview
      // travel together.
      newVisit:
        claimDailyVisit(new Date().toISOString().slice(0, 10)) || undefined,
    })
  } catch {
    // Analytics never breaks the page.
  }
}

/**
 * Screens this page load has already armed a dwell timer for. Module
 * scope, for the same reason as `beaconed`: a page remounts on its own,
 * and two timers for one screen would report the visit twice.
 */
const dwelling = new Set<string>()

/**
 * Report how long the visitor stayed on this screen (AGL-2182).
 *
 * `/product/analytics`'s per-screen mockup shows `Avg. time 2m 04s / on
 * this screen`, and nothing in the pipeline recorded duration of any kind.
 *
 * ## Why `pagehide` and not `beforeunload` or `visibilitychange`
 *
 * `beforeunload` disqualifies the page from the bfcache in every modern
 * browser and does not fire at all on mobile Safari — the platform where
 * most reading happens. `visibilitychange` fires on every tab switch, so
 * it would report a dozen fragments per visit and count each as a sample.
 * `pagehide` fires on both a real unload and a bfcache freeze, once.
 *
 * ## Why this is fire-and-forget, and why it degrades to nothing
 *
 * `sendBeacon` is queued by the browser and outlives the document; there
 * is no response to read and none is wanted. If it never fires — a killed
 * tab, a blocked beacon — the screen simply has fewer samples, and the
 * console renders no average rather than a wrong one. The failure mode is
 * silence, not a false number.
 *
 * Installed during render like the pageview beacon, and for the same
 * reason (AGL-1550): an effect only runs if React commits, and a page that
 * renders but never commits is the exact failure this file exists to
 * survive.
 */
function armDwellBeacon(hostId: string | undefined, screenId?: string) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (!hostId || !screenId) return
  const key = `${hostId}\x00${screenId}`
  if (dwelling.has(key)) return
  dwelling.add(key)
  // Same gate as the pageview, and checked before the listener is installed
  // rather than inside `report`: a dwell sample belongs to a pageview, so a
  // pageview that was not counted must not leave a timer armed for one.
  if (!analyticsBeaconMaySend()) return
  const startedAt = Date.now()
  let reported = false
  const report = () => {
    if (reported) return
    reported = true
    sendAnalyticsBeacon({
      hostId,
      screenId,
      // The collector clamps and floors this; the client's clock is
      // the visitor's, so nothing here is trusted as measured.
      dwellMs: Date.now() - startedAt,
    })
  }
  window.addEventListener('pagehide', report)
}

/**
 * Every measurement and consent surface a published tenant page owns: the
 * first-party pageview beacon (AGL-82/138/151), the Google Analytics gtag
 * mounts (AGL-138/661) and the visitor-consent machinery that gates them
 * (AGL-1498).
 *
 * ## Why this is its own component (AGL-1550)
 *
 * All three used to live inside `CatchAllClient`, i.e. BELOW
 * `use(sitePluginLoader.ensure(...))` — the site-plugin gate (AGL-417).
 * Nothing here needs a plugin, a canvas node or a MobX observable; they were
 * only there because that is where the page happened to be written. The
 * coupling was invisible until it cost something: AGL-1541 wedged the gate
 * (a page-wide Suspense boundary whose reveal and hydration retry both rode
 * `requestAnimationFrame`, which never fires in a hidden, occluded or
 * prerendered tab) and took BOTH analytics systems and the consent surface
 * down with it — silently, for every rAF-starved visitor, until a GA
 * verification pass went looking. `/pricing` measured zero beacon activity at
 * 90 s.
 *
 * That specific mechanism is fixed. This component is the reason it cannot
 * come back in a new form: mounted as a SIBLING of `CatchAllClient` from
 * `page.tsx`, a plugin chunk that is slow, wedged or outright rejected can no
 * longer decide whether a pageview is counted. `ErrorBeacon` (AGL-1538) is
 * the same move one level up — it sits outside every page boundary in the
 * root layout precisely so it still reports when a page stays suspended.
 *
 * The import list is the invariant, and `site-analytics-independence.spec.ts`
 * asserts it: no plugin loader, no `@aglyn/aglyn` barrel (which pulls the
 * plugin manager and the canvas in behind it), nothing that can suspend.
 * Re-nesting this under the gate has to break a spec, not just a habit.
 *
 * ## What has NOT changed
 *
 * - **Consent still gates GA at the source (AGL-1498).** `analyticsAllowed`
 *   is the render condition on the `<Script>` elements, so without a
 *   granting recorded state the gtag script never LOADS — it is not loaded
 *   and then suppressed. Hoisting moved where the gate is evaluated, never
 *   when: an ungranted visitor gets no script from a sibling exactly as they
 *   got none from a descendant.
 * - **The posture is host-configured and read per host.** `resolveConsentPosture`
 *   needs the host's `consent.mode` (geo-conditional vs opt-in-everywhere),
 *   so the host document travels here as a prop — the same object `page.tsx`
 *   already hands `CatchAllClient`, so Flight serializes it once and this
 *   costs no payload.
 * - **ISR (AGL-1498).** Evaluation stays client-side: `consent.ready` starts
 *   false, so the cached HTML never varies by region or consent state and the
 *   visitor's own state attaches after hydration.
 * - **Surfaces.** Published only. The console preview mounts `ConsentBannerUi`
 *   itself under its region simulator (`document-preview.component.tsx`), and
 *   the editor canvas renders neither — neither goes through this route, so
 *   the editor still gains no banner and fires no analytics.
 */
export interface SiteAnalyticsProps {
  /**
   * The resolved tenant host. Carries the GA measurement id, the consent
   * posture configuration and `$id`, which is what the beacon and the
   * per-host consent record are keyed on.
   */
  host?: (VisitorConsentHost & { $id?: string }) | null
  /** Per-screen attribution for the beacon (AGL-151). */
  screenId?: string
}

export default function SiteAnalytics({
  host,
  screenId,
}: SiteAnalyticsProps): ReactElement {
  const hostId = host?.$id
  // Strict format check — the id lands inside an inline script (AGL-138).
  // The shared resolver applies GA_MEASUREMENT_ID_PATTERN.
  const gaMeasurementId = resolveGaMeasurementId(host)
  // Same strict format check, same reason (AGL-138/AGL-2486): the container id
  // lands inside an inline script.
  const gtmContainerId = resolveGtmContainerId(host)
  // Visitor consent (AGL-1498). Evaluated CLIENT-SIDE only — these pages are
  // ISR-cached, so the HTML must never vary by region or consent state; the
  // server and first client render agree on "nothing yet", and the visitor's
  // resolved state (explicit choice, GPC, implied default, or a pending
  // prior-consent ask) attaches after hydration. The gate itself is
  // posture-independent: only a GRANTING recorded state loads the script.
  const consentRequired = hostConsentRequired(host)

  // Both side effects fire DURING RENDER, before anything can suspend — see
  // `sendPageviewBeacon` above for why an effect is the wrong scheduler for
  // work whose whole job is to survive a page that never commits. Each is
  // guarded to run once per pageview and neither touches the render output.
  //
  // The pageview beacon is exempt from the consent gate on its own merits: it
  // sets no cookie and stores no visitor identifier, so there is nothing to
  // consent to. The consent kick is the opposite — it is the machinery that
  // decides the gate below, started early so `/api/consent/region` goes out
  // even on a wedged page.
  sendPageviewBeacon(hostId, screenId)
  armDwellBeacon(hostId, screenId)
  primeVisitorConsent(hostId, host, consentRequired)
  // CTA and outbound link clicks (AGL-1562). Installed here, during render,
  // for the same reason as the two calls above — and installed at all here
  // rather than in the marketing runtime because that runtime lives BELOW the
  // plugin gate, which is the coupling this component exists to end. A
  // delegated listener is what reaches the links React never sees: rich-text
  // and Custom HTML anchors are written as raw DOM.
  //
  // NOT consent-gated here, and that is the gate working rather than missing:
  // `trackEvent` reaches `window.gtag`, and without a granting consent state
  // the scripts above never render, so gtag does not exist and every
  // classified click is dropped. `surface` labels this as a tenant published
  // site — and `site` is the ONLY value this param has ever carried. The docs
  // app does NOT install this listener and is not going to until the
  // `aglyn-docs` Vercel project can see `libs/` at all
  // (`sourceFilesOutsideRootDirectory: false` — docs/ANALYTICS.md decision 7),
  // so do not read a missing `docs` row as docs having no clicks: GA4 enhanced
  // measurement reports docs outbound clicks unclassified and unsurfaced.
  installLinkClickTracking({ surface: 'site' })
  // Real-user Core Web Vitals (AGL-1642), same shape as the click listener:
  // installed during render, once per page load, delivery through
  // `window.gtag` so the consent gate above stays structural — a visitor
  // whose tag never loads produces nothing. The module holds early metrics
  // briefly because BOTH tag mounts load late by design (`afterInteractive`
  // here); see `web-vitals-rum.ts` for why that hold is not the forbidden
  // pre-consent queue. The library itself arrives as a lazy chunk, so the
  // surface being measured pays nothing on its critical path.
  installWebVitalsReporting({ surface: 'site' })

  const consent = useVisitorConsent(hostId, host, consentRequired)
  const analyticsAllowed = consentRequired
    ? consent.ready && isAnalyticsAllowed(host, consent.stored)
    : true
  // Advertising storage (AGL-1649). Off unless the host turned the question
  // on AND this visitor explicitly answered yes to that category; every
  // other path — no record yet, a visitor merely defaulted into analytics by
  // the implied default, a decline, an opt-out, GPC, or a record written
  // before the category existed — leaves the three advertising signals
  // denied, exactly as AGL-1622 set them. Resolved client-side like the rest
  // of the gate, so the ISR-cached HTML carries neither snippet.
  const advertisingAllowed =
    consentRequired && advertisingGrantedByRecord(host, consent.stored)

  // Carry the campaign across the domain hop (AGL-1731). The capture on
  // `app.aglyn.com` shipped correct and was fed nothing: no code anywhere put
  // a `utm_*` parameter on a console-bound link, so every signup arrived
  // indistinguishable and every ad would have been unmeasurable.
  //
  // Installed during render for the same AGL-1550 reason as the two calls
  // above. Installed UNCONDITIONALLY, and gated separately, because the two
  // tiers have different consent answers: reading the campaign off the live
  // URL at click time writes nothing to the visitor's device and so needs no
  // grant, while remembering the FIRST touch across a walk to `/pricing` is
  // `analytics_storage` and waits for one.
  //
  // The gate is the boolean the tag itself uses, handed down rather than
  // recomputed, so there is one consent gate and it cannot drift from itself.
  // `null` is passed deliberately while `consent.ready` is false: unresolved
  // is not denied, and `analyticsAllowed` above flattens the two into one
  // `false` because that is all the tag needs to know. This does need to know.
  const analyticsStorageAllowed = consentRequired
    ? consent.ready
      ? isAnalyticsAllowed(host, consent.stored)
      : null
    : true
  setCampaignForwardingConsent(analyticsStorageAllowed)
  installCampaignForwarding({ consoleOrigin: CONSOLE_ORIGIN })

  // Carry the campaign to the moment the visitor identifies themselves. The
  // UTM labels on the beacon above are a page-view label and go no further,
  // so on their own they cannot say which campaign produced a form, a lead, a
  // contact or a booking. `campaign-touch.ts` remembers the arrival for the
  // attribution window and the conversion doors attach it.
  //
  // The SAME resolved boolean the tag and the console hop are gated on, handed
  // down rather than recomputed: remembering a touch across the walk from the
  // landing page to the form is `analytics_storage`, and there is one gate for
  // it on this page. `null` while unresolved is passed through deliberately —
  // unresolved is not denied, and the module does nothing in that window.
  //
  // A visitor who converts on the page they landed on needs none of this: the
  // labels are still on the address bar and the door reads them there, with
  // nothing written to the device and nothing to consent to.
  setCampaignTouchConsent(analyticsStorageAllowed)

  return (
    <>
      {/* Google Analytics (AGL-138/661): tenant-configured measurement id.
          This used to live inside an inert `next/head` <Head> block — so
          every site that configured GA collected nothing. `next/script`
          renders for real, and Next stamps it with the CSP nonce from the
          request header that middleware sets, so it keeps working when
          AGL-523 flips the policy from report-only to enforcing.

          THE CONSENT GATE (AGL-1498): `analyticsAllowed` is enforcement at
          the source — without an explicit stored yes the gtag script never
          loads, rather than loading and being suppressed. The banner below
          is UI over this condition, not the condition. This deliberately
          also silences the `window.gtag?.()` mirrors in the marketing
          runtime (overlay/experiment events) until consent: no gtag, no
          events, which is the honest behavior.

          What the gate CANNOT do is unload a tag (AGL-1608). Dropping these
          elements on a mid-pageview withdrawal does not unload `gtag.js`, so
          `storeVisitorConsent` silences the resident tag as well as sweeping
          the cookies — otherwise GA4 enhanced measurement re-creates `_ga`
          for the rest of the pageview. That runs on the tag that is ALREADY
          loaded; the render condition here is unchanged.

          THE CONSENT-MODE DEFAULT (AGL-1622) is declared INSIDE this block,
          which is the whole of its safety argument. the decision of
          2026-08-14 approves load-then-restrict for the UNITED STATES, where
          the implied-consent posture already permits the load; EU and UK are
          unchanged, because loading an analytics tag before consent is the
          specific act prior-consent law prohibits. Emitting the default here
          rather than in the document head keeps that true by construction:
          `analyticsAllowed` still decides whether ANY of this exists, so a
          gated visitor gets no default, no config and no request to
          googletagmanager.com. It is additive to the gate, never a
          replacement — `consent-mode-default.spec.tsx` goes red if a change
          ever hoists it out of this condition.

          Order is load-bearing twice over. The inline block precedes the
          library, and inside it the `default` precedes `config`, so no hit is
          ever sent before the tag has been told what it may store. Google's
          canonical snippet shape, and the reason `ga-init` sits first here.

          NOT declared when the host runs their own CMP (`consent.disabled`):
          their solution owns the default, and a second one racing it would
          overwrite their visitor's answer with ours.

          THE INTERNAL-TRAFFIC STAMP (AGL-2064) sits between the shim and
          `gtag('js')` for two independent reasons, and both have to hold.

          It is a CONSTANT string, evaluated in the browser. These pages are
          ISR-cached — one document is served to every visitor — so a
          server-side branch on "is this us" would bake one browser's answer
          into the cache for everyone, and a first-client-render branch would
          break hydration. Emitting identical bytes and letting the browser
          decide at runtime is the only shape that is both correct and
          cacheable. `readInternalTrafficOverride` is the same decision in
          TypeScript for the console, which is client-only and needs no such
          care.

          It runs BEFORE `gtag('config', …)`, and that ordering is the point.
          The hits that leak on this surface are the ones no call site writes
          — `session_start`, `first_visit`, `user_engagement`, and the
          automatic `page_view` — and a `gtag('set', …)` applies to every hit
          processed after it in queue order. After the config call it would
          miss the session's first pageview, which for a marketing visit is
          usually the entire session.

          ONLY on our own measurement id. A customer's site configures its own,
          and their property gets no opinion of ours stamped on it: wrongly
          flagging a real visitor erases them from every report and a GA4 data
          filter is not retroactive, so the id equality is the guard that keeps
          the expensive direction unreachable.

          `analyticsMayEmit()` on the render condition (AGL-2067) is the OTHER
          half, and it is the half that needs nobody's click: a stamp only
          separates our traffic once the GA4 data filter exists, while a tag
          that was never mounted sends nothing today. `next dev` and Vercel
          preview builds resolve `aglyn.com`'s host document and its platform
          measurement id exactly as production does, so without this they
          reported as real visits. When the escape hatch deliberately re-enables
          a non-production build, the stamp becomes UNCONDITIONAL rather than
          opt-in — a build that emits because someone asked it to is ours by
          definition, and the hatch must not reopen the hole it stands beside.
      */}
      {gaMeasurementId && analyticsAllowed && analyticsMayEmit() ? (
        <>
          <Script id="ga-init" strategy="afterInteractive">
            {'window.dataLayer=window.dataLayer||[];' +
              'function gtag(){dataLayer.push(arguments);}' +
              (consentRequired
                ? advertisingAllowed
                  ? GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET
                  : GA_CONSENT_DEFAULT_SNIPPET
                : '') +
              // Internal-traffic stamp (AGL-2064), OUR property only. See the
              // block comment below the JSX for why this is a constant string
              // evaluated in the browser and why its position in the snippet
              // is the whole of its correctness.
              (gaMeasurementId === PLATFORM_GA_MEASUREMENT_ID
                ? analyticsEnvironmentForcesInternal()
                  ? INTERNAL_TRAFFIC_FORCED_SNIPPET
                  : INTERNAL_TRAFFIC_GTAG_SNIPPET
                : '') +
              // Ad click ids cross to the console by URL, not cookie
              // (AGL-2548): the default above denies `ad_storage`, so this is
              // the only way the `gclid` an ad click lands with reaches the
              // surface where the conversion fires. OUR property only, and a
              // `set`, so it sits before `config` like the stamp above.
              (gaMeasurementId === PLATFORM_GA_MEASUREMENT_ID
                ? GA_CLICK_ID_PASSTHROUGH_SNIPPET
                : '') +
              "gtag('js', new Date());" +
              // `content_group: 'marketing'` on OUR property only (AGL-1857):
              // the one-click marketing/docs/console split in GA4 standard
              // reports. A customer's id passes through untouched.
              (gaMeasurementId === PLATFORM_GA_MEASUREMENT_ID
                ? `gtag('config', '${gaMeasurementId}', {'content_group':'marketing'});`
                : `gtag('config', '${gaMeasurementId}');`)}
          </Script>
          <Script
            id="ga-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
          />
        </>
      ) : null}
      {/* GOOGLE TAG MANAGER (AGL-2486), under the same gate as the pair
          above and never a looser one.

          A container is not a tag — it is a LOADER, and what it loads is
          decided in Google's UI by whoever owns it, not here. That is exactly
          why it cannot have a weaker gate than GA: this codebase's position is
          that analytics may run on implied consent outside the EU/EEA/UK while
          ADVERTISING is opt-in everywhere, and a container is the likeliest
          thing on a page to carry an advertising tag. So it loads only from a
          granting analytics state, and `consentGatedCategories` counts a
          container as a gated feature so a container-only site still gets the
          banner rather than none.

          CONSENT MODE V2 comes first, in the same script, before `gtm.js` is
          requested. Order is the whole of its correctness: defaults set after
          the container has loaded are defaults its tags have already run past.
          `ad_storage`/`ad_user_data`/`ad_personalization` stay denied unless
          the visitor granted advertising, which is what makes a container
          holding ad tags safe to load at all.

          NO `<noscript>` IFRAME, deliberately, and it is the one piece of
          Google's standard snippet omitted. That iframe fires the container
          with no JavaScript — so no consent defaults, no gate, nothing to
          suppress it — and these pages are ISR-cached, so it would sit in
          shared HTML identical for every visitor and every region. It is a
          consent bypass with a fallback's reputation. A visitor with
          JavaScript off gets no container, which is the correct answer.
      */}
      {gtmContainerId && analyticsAllowed && analyticsMayEmit() ? (
        <>
          <Script id="gtm-init" strategy="afterInteractive">
            {'window.dataLayer=window.dataLayer||[];' +
              'function gtag(){dataLayer.push(arguments);}' +
              (consentRequired
                ? advertisingAllowed
                  ? GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET
                  : GA_CONSENT_DEFAULT_SNIPPET
                : '') +
              "dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});"}
          </Script>
          <Script
            id="gtm-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtm.js?id=${gtmContainerId}`}
          />
        </>
      ) : null}
      {/* Consent-gated ADVERTISING tags — Aglyn's own marketing
          site only, and nowhere else.

          The same structural enforcement as the GA pair above, extended to a
          channel that is not Google's. Until this existed the `advertising`
          category could only ever be expressed as four strings handed to
          `gtag`, so a non-Google tag could not be consent-gated at all.

          Mounted UNCONDITIONALLY and gated inside, which is not the shape of
          the block above it and is deliberate: the component also owns the
          withdrawal path, and a visitor who turns advertising off from "Your
          Privacy Choices" has to stop being tracked in THAT pageview. By then
          the vendor library has executed, and React dropping a `<Script>` does
          not unload it (the AGL-1608 lesson) — so the teardown runs from the
          consent-changed event, which needs a listener that is still mounted
          when the answer is no.

          On a customer's site this renders nothing AND installs nothing: the
          host is not ours, so there is no listener and no script. That
          boundary is the DPA §3.2 promise — Aglyn does not "sell"/"share"
          Customer Personal Data — expressed in code rather than in a review
          checklist. The console needs no clause of its own: it does not render
          this route at all.

          NOTHING IS CONFIGURED TO LOAD TODAY. No host document carries an
          `analytics.adTags` entry, so every visitor on every site takes the
          empty branch. Deploying the Meta Pixel means writing a pixel id onto
          the `aglyn-marketing` host — a data change, reviewed on its own. */}
      <AdvertisingTags
        host={host}
        stored={consent.stored}
        ready={consent.ready}
      />
      {/* Visitor consent surfaces (AGL-1498): only when the machinery is
          live — the tool is active AND the site uses a gated feature. A
          site with no analytics has nothing to ask, so its visitors see
          nothing at all. What renders depends on the resolved state: the
          prior-consent banner (opt-in posture, undecided), or the
          persistent "Your Privacy Choices" pill — which in the implied posture
          is the ONE opt-out surface, on every page, template-independent.
          `consent.ready` keeps all of it out of the server HTML (ISR) and
          the first client render. Published surface only here; the console
          preview mounts the same component under its region simulator, and
          the editor canvas renders none of it. */}
      {consentRequired && consent.ready && hostId ? (
        <ConsentBannerUi
          hostId={hostId}
          stored={consent.stored}
          posture={consent.posture}
          country={consent.country}
          advertising={hostAsksAboutAdvertising(host)}
        />
      ) : null}
    </>
  )
}
