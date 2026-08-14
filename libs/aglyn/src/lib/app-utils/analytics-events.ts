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
 * The one GA4 event taxonomy, shared by the marketing site (tenant runtime)
 * and the console (AGL-1561). See `docs/ANALYTICS.md` for the event map and
 * which GTM-plan §6 metric each event serves.
 *
 * ## Why this module exists
 *
 * Before it, every GA event in the repo was an ad-hoc
 * `;(window as any).gtag?.('event', 'name', {...})` — five of them across the
 * marketing and commerce plugins, plus bare string literals passed to Firebase
 * `logEvent` in the console. Nothing checked the names, nothing checked the
 * params, and a typo produced a silently-missing metric rather than an error.
 * That is the failure mode analytics is worst at surfacing: the number simply
 * reads zero, and zero is indistinguishable from "nobody did it".
 *
 * So the names and their params are a TYPE here ({@link AnalyticsEventParams}),
 * and `trackEvent` is generic over it: a misspelled event name or a missing
 * required param is a compile error.
 *
 * ## Reserved names
 *
 * Where GA4 has a recommended event we use its exact name and its exact param
 * spelling — `sign_up`, `login`, `generate_lead`, `begin_checkout`,
 * `purchase`, `select_content` — so the built-in reports, the funnel
 * explorations and the "key events" toggles work without custom definitions.
 * Custom snake_case names appear only where GA4 has no standard: the four
 * activation events, which are Aglyn-specific product milestones.
 *
 * ## Consent (AGL-1498) — the gate is that gtag never loads
 *
 * On tenant sites, including aglyn.com itself, `site-analytics.tsx` renders the
 * gtag `<Script>` pair ONLY when the recorded consent state grants analytics.
 * There is therefore no `window.gtag` at all for a visitor who has not granted,
 * and {@link trackEvent} drops the event on the floor.
 *
 * It drops it — it does not QUEUE it. That distinction is the whole point and
 * `analytics-events.spec.ts` asserts it: an event fired before consent is gone
 * for good, and does not reappear when a later grant loads gtag. A queue would
 * quietly convert "we did not track you" into "we tracked you and waited", and
 * a replayed hit carries the pre-consent timestamp and page into GA, which is
 * exactly the thing the consent gate exists to prevent. Deliberately no retry,
 * no buffer, no flush-on-grant.
 *
 * ## No PII, enforced rather than promised
 *
 * Every payload passes through {@link sanitizeEventParams} before it reaches a
 * transport: an exact-key denylist drops the identity-bearing params someone
 * will eventually add by reflex (`email`, `org_name`, `first_name`, ...), any
 * value that looks like an email address drops its key entirely, URLs are
 * reduced to origin + pathname so query strings can never smuggle a token or
 * an address, and strings are length-capped. The console separately sets a
 * `user_id` — that is an opaque Firebase uid and is the one identifier GA is
 * allowed to hold.
 *
 * Sanitizing here rather than at each call site is the point: a new call site
 * cannot forget.
 */

/**
 * Read the browser's GA `client_id` — the identifier that ties a hit to a GA
 * user and session.
 *
 * Needed because `purchase` is sent SERVER-side, from the Stripe webhook,
 * where the authoritative money is (see `ga4-measurement-protocol.ts`). The
 * Measurement Protocol requires a `client_id` and a server cannot know one,
 * so it is captured here when checkout starts and carried on the Stripe
 * object's metadata. Without it the revenue still lands, but attached to a
 * synthetic user with no acquisition session — which is exactly the campaign
 * attribution the whole exercise is for.
 *
 * Resolves to null rather than hanging when gtag is absent (no consent, an ad
 * blocker, analytics not configured) or slow to answer. The 500ms cap matters:
 * this sits directly in front of a checkout redirect, and analytics must never
 * be able to delay a payment.
 */
export function readGaClientId(
  measurementId: string | undefined | null,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !measurementId) return resolve(null)
    const gtag = (window as unknown as { gtag?: unknown }).gtag
    if (typeof gtag !== 'function') return resolve(null)
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    // Never let a missing callback strand the checkout.
    setTimeout(() => finish(null), 500)
    try {
      ;(gtag as (...args: unknown[]) => void)(
        'get',
        measurementId,
        'client_id',
        (id: unknown) => finish(typeof id === 'string' && id ? id : null),
      )
    } catch {
      finish(null)
    }
  })
}

/** Which door an account was created through (AGL-1497 enumerates all four). */
export type SignUpMethod =
  | 'password'
  | 'google_popup'
  | 'google_redirect'
  | 'google_signin'

/** How a returning user authenticated. */
export type LoginMethod =
  | 'password'
  | 'google_popup'
  | 'google_redirect'
  | 'sso'
  | 'passkey'

/**
 * A GA4 `items` entry. Only the fields we actually populate — GA accepts more,
 * but an unpopulated field is a column of nulls in every report.
 */
export interface AnalyticsItem {
  /** Opaque identifier — a price id, plan key or marketplace listing id. */
  item_id: string
  /** Human-readable product name. NEVER a customer or org name. */
  item_name: string
  /** Distinguishes the revenue lines: `subscription` vs `marketplace`. */
  item_category?: string
  price?: number
  quantity?: number
}

/**
 * The taxonomy. Adding an event means adding a line here first — which is what
 * makes `docs/ANALYTICS.md` checkable against the code rather than aspirational.
 */
export interface AnalyticsEventParams {
  // --- Acquisition (GTM §6: signups, cost/lead by channel) -----------------
  /** GA4 recommended. Real account creation only, never a sign-in. */
  sign_up: { method: SignUpMethod }
  /** GA4 recommended. Returning user only. */
  login: { method: LoginMethod }
  /**
   * GA4 recommended. Fired on a SUCCESSFUL form submission — never on click,
   * never on a validation failure. `form_name` is the author-given form name,
   * which is site content and not personal data.
   */
  generate_lead: { form_name: string; form_location?: string }
  /** GA4 recommended. A CTA click, with the section that produced it. */
  select_content: { content_type: string; content_id: string }

  // --- Activation (GTM §6: % publish a site, % connect Stripe) -------------
  /** Custom: no GA4 equivalent. A new organization exists. */
  org_created: { plan?: string }
  /** Custom: no GA4 equivalent. A new site/host exists. */
  host_created: Record<string, never>
  /**
   * Custom: no GA4 equivalent, and the GTM plan's headline activation metric.
   * A site actually went live.
   */
  site_published: { first_publish?: boolean }
  /** Custom: no GA4 equivalent. Stripe Connect onboarding completed. */
  stripe_connected: Record<string, never>

  // --- Revenue (GTM §6: paid conversions, ARPA, annual mix) ---------------
  /** GA4 recommended. A plan checkout started. */
  begin_checkout: {
    currency: string
    value: number
    items: AnalyticsItem[]
    /** `monthly` | `annual` — feeds the §6 annual-mix metric. */
    billing_interval?: string
  }
  /**
   * GA4 recommended. A payment actually succeeded. `transaction_id` is the
   * Stripe object id and is what makes the event idempotent in GA: GA4
   * de-duplicates purchases by transaction id, so a webhook retry cannot
   * inflate revenue.
   */
  purchase: {
    transaction_id: string
    currency: string
    value: number
    items: AnalyticsItem[]
    billing_interval?: string
  }

  // --- Engagement ---------------------------------------------------------
  /** GA4 recommended-ish. Outbound click to docs, GitHub, etc. */
  click: { link_domain: string; link_id?: string }
}

export type AnalyticsEventName = keyof AnalyticsEventParams

/**
 * Where a sanitized event goes. The console registers a Firebase
 * `logEvent` transport; the tenant runtime and the plugin bundles have none
 * and fall through to `window.gtag`, which only exists once consent has been
 * granted.
 */
export type AnalyticsTransport = (
  name: AnalyticsEventName,
  params: Record<string, unknown>,
) => void

let configuredTransport: AnalyticsTransport | null = null

/**
 * Register the transport for this surface. The console calls this once, with
 * Firebase's `logEvent`, because the console's GA is Firebase-initialised and
 * its `user_id`/user-property state lives on the Firebase Analytics instance —
 * poking `window.gtag` directly there would emit hits that miss it.
 *
 * The tenant runtime deliberately does NOT call this: the plugin bundles run
 * in their own realm and do not share this module instance with the host app,
 * so a module-scope singleton would be invisible to exactly the call sites
 * that need it (the form and newsletter elements). `window.gtag` is the only
 * thing genuinely shared across that boundary, and it is also the consent
 * gate, which makes the fallback the correct primary path there rather than a
 * degraded one.
 */
export function configureAnalyticsTransport(
  transport: AnalyticsTransport | null,
): void {
  configuredTransport = transport
}

/** Test seam — drops the registered transport. */
export function resetAnalyticsTransport(): void {
  configuredTransport = null
}

/**
 * Param keys that must never reach GA, matched EXACTLY. Substring matching
 * would be wrong in both directions: it would drop the legitimate
 * `form_name` / `item_name` / `link_domain`, and it would still miss a
 * creatively-named new one. The value scan below is the backstop for those.
 */
const DENIED_PARAM_KEYS: ReadonlySet<string> = new Set([
  'email',
  'email_address',
  'user_email',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'user_name',
  'username',
  'customer_name',
  'org_name',
  'organization_name',
  'company',
  'company_name',
  'phone',
  'phone_number',
  'address',
  'street',
  'postal_code',
  'zip',
  'ip',
  'ip_address',
])

/** Deliberately loose — this is a "does it smell like an address" test. */
const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/

/** GA4 truncates param values at 100 chars anyway; do it ourselves, visibly. */
const MAX_PARAM_LENGTH = 100

function scrubValue(value: string): string | null {
  let candidate = value
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate)
      // Origin + pathname only: a query string is where a session token, a
      // signup email or a Stripe id ends up, and none of them belong in GA.
      candidate = `${url.origin}${url.pathname}`
    } catch {
      return null
    }
  }
  // AFTER the URL reduction, not before. A page URL routinely carries an
  // address in its query (`?email=…` on a prefilled signup link), and testing
  // the raw string would throw the whole URL away for PII that the reduction
  // was about to remove — losing the legitimate page dimension to protect
  // something already protected. Testing the REDUCED value still catches an
  // address embedded in the path itself, which the reduction keeps.
  if (EMAIL_SHAPED.test(candidate)) return null
  return candidate.slice(0, MAX_PARAM_LENGTH)
}

/**
 * Strip anything identity-bearing from an event payload. Exported so
 * `analytics-events.spec.ts` can assert the guarantee directly rather than
 * only through `trackEvent`.
 */
export function sanitizeEventParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  if (!params) return safe
  for (const [key, value] of Object.entries(params)) {
    if (DENIED_PARAM_KEYS.has(key.toLowerCase())) continue
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const scrubbed = scrubValue(value)
      if (scrubbed === null || scrubbed === '') continue
      safe[key] = scrubbed
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
      continue
    }
    if (Array.isArray(value)) {
      // `items` — sanitize each entry with the same rules.
      safe[key] = value.map((entry) =>
        entry && typeof entry === 'object'
          ? sanitizeEventParams(entry as Record<string, unknown>)
          : entry,
      )
      continue
    }
    if (typeof value === 'object') {
      safe[key] = sanitizeEventParams(value as Record<string, unknown>)
    }
    // Anything else (function, symbol) is dropped.
  }
  return safe
}

/**
 * Fire a GA4 event.
 *
 * Never throws and never queues. If the surface has no transport and no
 * `window.gtag` — which on a tenant site means the visitor has not granted
 * analytics consent — the event is DROPPED, permanently. See the module
 * comment for why a queue would be the wrong answer.
 */
export function trackEvent<K extends AnalyticsEventName>(
  name: K,
  params: AnalyticsEventParams[K],
): void {
  const safe = sanitizeEventParams(params as Record<string, unknown>)
  try {
    if (configuredTransport) {
      configuredTransport(name, safe)
      return
    }
    if (typeof window === 'undefined') return
    const gtag = (window as unknown as { gtag?: unknown }).gtag
    if (typeof gtag !== 'function') return
    ;(gtag as (...args: unknown[]) => void)('event', name, safe)
  } catch {
    // Analytics never breaks the page — the same posture as the error beacon
    // and the pageview beacon.
  }
}
