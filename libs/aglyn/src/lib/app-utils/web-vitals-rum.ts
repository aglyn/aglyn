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

import { sanitizeEventParams } from './analytics-events'

/**
 * Real-user Core Web Vitals → GA4 events (AGL-1642).
 *
 * Until this module there was no field performance telemetry of any kind in
 * the repo, and the cost was concrete: AGL-1538 recorded a tenant hydration
 * stall of 30s+ that could never be quantified, and the hydration window is
 * also an ATTRIBUTION hole — a signup CTA clicked before gtag hydrates
 * crosses to the console with no `_gl` linker, deleting the acquisition
 * source. "How long does hydration take for real visitors" was unanswerable.
 *
 * ## Why `web-vitals` → GA4, not Speed Insights or Firebase Performance
 *
 * The GA4 property (`G-YW5PG16YTM`) is already consolidated across every
 * first-party surface, already consent-gated correctly per surface, and
 * already carries the funnel these numbers need to sit beside — slow LCP on
 * the pricing page matters BECAUSE of what it does to `begin_checkout`.
 * Sending CWV there adds zero new subprocessors, zero spend, and one ~2KB
 * lazy chunk; `web-vitals` is Google's own library and is ALREADY in
 * `node_modules` as a dependency of `@firebase/performance`. Vercel Speed
 * Insights would add a vendor surface and a paid tier; Firebase Performance
 * is the weakest web product of the three and puts a second SDK on the
 * tenant's critical path (see AGL-1642 for the full comparison).
 *
 * ## Event shape — GA's own `web_vitals` pattern
 *
 * One event per metric, named by the metric (`LCP`, `CLS`, `INP`, `TTFB`),
 * exactly as web.dev's "send to Google Analytics" snippet shapes them:
 *
 * - `value: delta` — GA sums event `value`, and summing DELTAS is what makes
 *   per-page totals right when a metric reports more than once;
 * - `metric_id` — web-vitals' per-pageview id, the deduplication/grouping key
 *   (needs dimension registration to report on — AGL-1637);
 * - `metric_value` / `metric_delta` — the current value and its change;
 * - `metric_rating` — `good` / `needs-improvement` / `poor`, the one
 *   dimension that makes a report readable without percentile math;
 * - `surface` — same param the link-click listener sends: GA's Hostname
 *   dimension separates domains, `surface` separates product surfaces.
 *
 * ## Consent — the same gate as every other tenant event, plus one nuance
 *
 * Delivery is `window.gtag`, which on a tenant site exists only once a
 * granting consent state has loaded it (AGL-1498). No gtag, no hit.
 *
 * The nuance is TIMING, not posture. TTFB reports the moment the reporter
 * installs, and both gtag mounts load late by design — `afterInteractive` on
 * the tenant, Firebase's runtime injection on the console — so "no gtag YET"
 * is the normal state for the first metrics of every pageview, granting
 * visitors included. Dropping on first miss would silently discard TTFB (and
 * often LCP) on every surface, which reads in GA exactly like fast pages.
 * So a metric that finds no tag is held IN MEMORY and re-offered briefly
 * (~60s at 500ms); if the tag never arrives it is discarded, unsent.
 *
 * That is not the queue `analytics-events.ts` forbids, and the distinction
 * is worth stating: the forbidden queue replays a visitor's pre-consent
 * BEHAVIOUR (pageviews, clicks — the record consent exists to prevent) after
 * a later grant. These are timings of the page's own load, sitting in the
 * browser's performance timeline regardless; and a tag that loads on a late
 * same-pageview grant reports its own `page_view` for this page at that
 * moment — the vitals that then flush describe the exact pageview the tag
 * itself just reported. A visitor who never grants still produces nothing:
 * no tag ever appears, the buffer dies with the page, unsent.
 *
 * ## Why installing early still measures the whole page
 *
 * `web-vitals` reads buffered `PerformanceObserver` entries, so registration
 * order does not truncate the metrics; and CLS/INP/LCP report at
 * interaction/page-hide time anyway. The library itself is loaded with a
 * dynamic `import()` so the tenant's critical path pays nothing for it.
 *
 * The console's `traffic_type: 'internal'` stamp (AGL-1582) rides these hits
 * unchanged: Firebase's `setDefaultEventParameters` issues a global
 * `gtag('set', …)`, which applies to every later event on the page —
 * including these direct `window.gtag` calls (verified against the SDK's
 * `wrapGtag`, not assumed).
 */

/** The four metrics worth a GA event, per web.dev's GA4 guidance. */
const METRIC_HANDLER_NAMES = ['onCLS', 'onINP', 'onLCP', 'onTTFB'] as const

/** How long a metric waits for a tag before being discarded, unsent. */
const TAG_WAIT_INTERVAL_MS = 500
const TAG_WAIT_MAX_TRIES = 120

/** Shape of the web-vitals metric object this module consumes. */
interface ReportedMetric {
  name: string
  id: string
  value: number
  delta: number
  rating?: string
}

export interface WebVitalsReportingOptions {
  /**
   * Which product surface produced the measurement — `site` for a tenant
   * published page, `console` for the console. Same axis as the link-click
   * listener's `surface`.
   */
  surface: string
}

let installed = false
let pending: Array<{ name: string; params: Record<string, unknown> }> = []
let watcher: ReturnType<typeof setInterval> | null = null
let watcherTries = 0

function residentGtag(): ((...args: unknown[]) => void) | null {
  if (typeof window === 'undefined') return null
  const gtag = (window as unknown as { gtag?: unknown }).gtag
  return typeof gtag === 'function'
    ? (gtag as (...args: unknown[]) => void)
    : null
}

function flushPending(gtag: (...args: unknown[]) => void): void {
  const held = pending
  pending = []
  for (const event of held) {
    try {
      gtag('event', event.name, event.params)
    } catch {
      // Analytics never breaks the page.
    }
  }
}

function stopWatcher(): void {
  if (watcher !== null) {
    clearInterval(watcher)
    watcher = null
  }
  watcherTries = 0
}

/**
 * Offer one metric to the tag, or hold it while the tag is still loading.
 * See the module comment for why holding briefly is not the forbidden queue.
 */
function deliverMetricEvent(
  name: string,
  params: Record<string, unknown>,
): void {
  const gtag = residentGtag()
  if (gtag) {
    // Anything held arrived before this one; keep GA's receive order honest.
    if (pending.length) flushPending(gtag)
    stopWatcher()
    try {
      gtag('event', name, params)
    } catch {
      // Analytics never breaks the page.
    }
    return
  }
  pending.push({ name, params })
  if (watcher !== null) return
  watcherTries = 0
  watcher = setInterval(() => {
    watcherTries += 1
    const resident = residentGtag()
    if (resident) {
      flushPending(resident)
      stopWatcher()
      return
    }
    if (watcherTries >= TAG_WAIT_MAX_TRIES) {
      // The tag never came — an ungranted visitor, an ad blocker, or a site
      // with no analytics configured. Dropped, permanently, like every other
      // consentless event.
      pending = []
      stopWatcher()
    }
  }, TAG_WAIT_INTERVAL_MS)
}

function reportMetric(metric: ReportedMetric, surface: string): void {
  // The same sanitizer every payload passes (AGL-1561) — these values are
  // library-generated and carry nothing identifying, but the guarantee should
  // hold because the sanitizer ran, not because this caller was careful.
  const params = sanitizeEventParams({
    // GA sums event `value`; summing DELTAS keeps a twice-reported metric's
    // page total correct. web.dev's canonical GA4 mapping.
    value: metric.delta,
    metric_id: metric.id,
    metric_value: metric.value,
    metric_delta: metric.delta,
    ...(metric.rating ? { metric_rating: metric.rating } : {}),
    surface,
  })
  deliverMetricEvent(metric.name, params)
}

/**
 * Start reporting Core Web Vitals for this page load. Safe to call from
 * render (installs once, touches no render output, never throws) — the same
 * contract as `installLinkClickTracking`, and it is mounted beside it.
 *
 * The library loads via dynamic `import()`: an async chunk off the critical
 * path of the surface whose performance is being measured. If the chunk
 * fails to load there is simply no measurement — never an error.
 */
export function installWebVitalsReporting(
  options: WebVitalsReportingOptions,
): void {
  if (typeof window === 'undefined') return
  if (installed) return
  installed = true
  const surface = options.surface
  import('web-vitals')
    .then((vitals) => {
      for (const handlerName of METRIC_HANDLER_NAMES) {
        const register = (
          vitals as unknown as Record<
            string,
            ((callback: (metric: ReportedMetric) => void) => void) | undefined
          >
        )[handlerName]
        if (typeof register !== 'function') continue
        try {
          register((metric) => reportMetric(metric, surface))
        } catch {
          // One broken observer must not take the others down.
        }
      }
    })
    .catch(() => {
      // No chunk, no measurement — analytics never breaks the page.
    })
}

/** Test seam — forgets the install, the held metrics and the tag watcher. */
export function resetWebVitalsReporting(): void {
  installed = false
  pending = []
  stopWatcher()
}
