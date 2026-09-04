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
 * The gate every FIRST-PARTY analytics beacon passes through, and the one
 * function that sends one.
 *
 * ## Why this exists beside the Google Analytics gate rather than inside it
 *
 * `analyticsMayEmit` (AGL-2067) decides whether a build may load a Google tag.
 * It was applied to the GA4 mount, the GTM mount, the advertising tags and
 * Firebase Analytics — every tag that costs nothing — and not to
 * `/api/analytics/collect`, which is the one that bills.
 *
 * That endpoint increments `hosts/{hostId}/analytics/{day}.total`, which rolls
 * up into `orgs/{orgId}/usage/{month}.pageViews` and from there into the
 * Stripe meter, the free plan's bandwidth band (`bandwidthCapShouldEngage`)
 * and the abuse ceiling (`checkBandwidthAbuseCeiling`). Both Next apps map
 * `VERCEL_ENV` into the client bundle and both point at the production
 * Firebase project, so before this gate a `next dev` on `localhost:4500` and
 * every preview deployment of `apps/tenant` wrote real page views into a
 * customer's invoice and against their cap.
 *
 * ## The two halves of the decision
 *
 * 1. **The build.** A production surface, and ONLY a production surface. Note
 *    what this deliberately does not honor: `NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD`.
 *    That hatch exists so someone can exercise the GA taxonomy against
 *    DebugView from a dev build, and it is paired with
 *    `analyticsEnvironmentForcesInternal` precisely so the hits it produces
 *    are all marked ours. A hit marked ours must not be billed to anyone, so
 *    the hatch buys a GA session and never a counter increment.
 *
 *    `analyticsMayEmit(env) && !analyticsEnvironmentForcesInternal(env)`
 *    reduces to `isProductionSurface(env)`, which is not exported. Composing
 *    the two published predicates keeps this gate and the GA gate reading the
 *    same environment through the same code, so a change to what counts as
 *    production cannot move one and leave the other.
 *
 * 2. **The browser.** `readInternalTrafficOverride` — the same per-origin
 *    opt-in (`?aglyn_internal=1`) that stamps `traffic_type: 'internal'` for
 *    GA4. GA stamps and lets a data filter discard; here there is nothing to
 *    filter after the fact, because a counter is a running total and a page
 *    view already added to an invoice cannot be taken back out. So the beacon
 *    is not sent at all.
 *
 * A loopback self-host install (`{subdomain}.localhost:4500` from the compose
 * file) counts nothing, by the same rule that already silences its GA tag. An
 * operator serving from a real name is a production surface and counts
 * normally — theirs is the deployment an unknown `deployEnv` is for.
 *
 * ## Bias
 *
 * Opt-in only, never inferred, and every ambiguous case resolves to NOT
 * internal — a browser with `localStorage` disabled, a sandboxed iframe, a
 * server render. Wrongly flagging a real visitor under-counts a customer's
 * own dashboard as well as their bill, which is the quieter of the two
 * failures but still theirs.
 */

import {
  type AnalyticsEnvironment,
  analyticsEnvironmentForcesInternal,
  analyticsMayEmit,
  readAnalyticsEnvironment,
} from './analytics-environment'
import {
  type InternalTrafficOverrideSource,
  readInternalTrafficOverride,
} from './internal-traffic'

/**
 * The collector. One definition, because four call sites across three
 * packages send to it and a path that drifts by one character is a counter
 * that silently stops.
 */
export const ANALYTICS_BEACON_ENDPOINT = '/api/analytics/collect'

/** The browser and build facts the gate reads, so a spec can supply them. */
export interface AnalyticsBeaconContext {
  /** Defaults to this build's own environment. */
  env?: AnalyticsEnvironment
  /** Defaults to `window.location.search` and `window.localStorage`. */
  override?: InternalTrafficOverrideSource
}

/**
 * Whether a beacon from HERE, in THIS browser, should be counted.
 *
 * ⚠️ Reading the override also APPLIES it: `?aglyn_internal=1` persists on the
 * call that observes it, so the visit carrying the parameter is itself
 * suppressed rather than counted and excluded from the next one. That is the
 * whole reason one round trip through the URL is enough.
 */
export function analyticsBeaconMaySend(
  context: AnalyticsBeaconContext = {},
): boolean {
  const env = context.env ?? readAnalyticsEnvironment()
  if (!analyticsMayEmit(env)) return false
  if (analyticsEnvironmentForcesInternal(env)) return false
  return !readInternalTrafficOverride(context.override)
}

/**
 * Send one beacon, or don't.
 *
 * Returns whether the browser accepted it, so a caller that has its own
 * once-per-pageview bookkeeping can tell "refused" from "queued" — though
 * every caller today treats analytics as fire-and-forget and ignores it.
 *
 * Never throws. `sendBeacon` itself throws on some payloads and in some
 * sandboxes, and analytics does not get to break a customer's page.
 */
export function sendAnalyticsBeacon(
  payload: Record<string, unknown>,
  context: AnalyticsBeaconContext = {},
): boolean {
  if (typeof navigator === 'undefined') return false
  if (!analyticsBeaconMaySend(context)) return false
  try {
    return navigator.sendBeacon(
      ANALYTICS_BEACON_ENDPOINT,
      JSON.stringify(payload),
    )
  } catch {
    return false
  }
}
