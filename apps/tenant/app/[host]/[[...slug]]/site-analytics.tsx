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
import {
  hostConsentRequired,
  isAnalyticsAllowed,
  resolveGaMeasurementId,
  type VisitorConsentHost,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import Script from 'next/script'
import type { ReactElement } from 'react'
import { primeVisitorConsent, useVisitorConsent } from './use-visitor-consent'

/**
 * Pageviews already counted this page load, keyed by host and path. Module
 * scope, so it survives the re-renders and remounts a page does on its own —
 * `/api/analytics/collect` is a metered-billing input and must be told about a
 * pageview once.
 */
const beaconed = new Set<string>()

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
  try {
    navigator.sendBeacon(
      '/api/analytics/collect',
      JSON.stringify({
        hostId,
        path: window.location.pathname,
        // Per-screen attribution (AGL-151).
        screenId: screenId || undefined,
        // External referrer host only; same-site moves are dropped
        // server-side (AGL-138).
        referrer: document.referrer || undefined,
      }),
    )
  } catch {
    // Analytics never breaks the page.
  }
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
  primeVisitorConsent(hostId, host, consentRequired)

  const consent = useVisitorConsent(hostId, host, consentRequired)
  const analyticsAllowed = consentRequired
    ? consent.ready && isAnalyticsAllowed(host, consent.stored)
    : true

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
          events, which is the honest behavior. */}
      {gaMeasurementId && analyticsAllowed ? (
        <>
          <Script
            id="ga-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
          />
          <Script id="ga-init" strategy="afterInteractive">
            {'window.dataLayer=window.dataLayer||[];' +
              'function gtag(){dataLayer.push(arguments);}' +
              "gtag('js', new Date());" +
              `gtag('config', '${gaMeasurementId}');`}
          </Script>
        </>
      ) : null}
      {/* Visitor consent surfaces (AGL-1498): only when the machinery is
          live — the tool is active AND the site uses a gated feature. A
          site with no analytics has nothing to ask, so its visitors see
          nothing at all. What renders depends on the resolved state: the
          prior-consent banner (opt-in posture, undecided), or the
          persistent "Privacy choices" pill — which in the implied posture
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
        />
      ) : null}
    </>
  )
}
