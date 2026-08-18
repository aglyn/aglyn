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
 * That sweep missed five (AGL-1591, closed): the commerce plugin's
 * `view_item` / `add_to_cart` / `begin_checkout` and the marketing runtime's
 * `aglyn_overlay` / `aglyn_experiment`. `window.gtag` is now called in exactly
 * two places in the repo — {@link deliver} below, and `readGaClientId` above,
 * which reads rather than sends.
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
 *
 * ## Authored events (AGL-1587)
 *
 * One call site cannot use the taxonomy at all: the `trackGaEvent` action step,
 * whose event name and params are typed by a SITE AUTHOR in the interaction
 * builder. A closed union cannot contain a name nobody has written yet, so
 * {@link trackAuthoredEvent} is the escape hatch — and it is deliberately the
 * only one, so that untrusted input still passes {@link sanitizeEventParams}
 * rather than reaching `window.gtag` raw.
 *
 * The test for which door an event uses is WHO NAMED IT, not whether GA4
 * recommends the name. `aglyn_overlay` and `aglyn_experiment` are outside GA4's
 * recommended set and were candidates for the hatch (AGL-1591); they are in the
 * union instead, because a developer wrote their names and their keys, so they
 * can have compile-time checking — and because the hatch guarantees the
 * opposite of what they need. {@link resolveAuthoredEventName} refuses any name
 * in the union precisely so that "not in {@link ANALYTICS_EVENT_NAMES}" means
 * "authored"; put our own events through the hatch and that stops being true,
 * authored hits stop being separable from ours in reports, and an authored
 * `aglyn_experiment` step starts voting in the experiment that decides which
 * variant ships.
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
  /**
   * GA4 recommended. A CTA click, with the section that produced it.
   *
   * Fired by `analytics-link-clicks.ts` (AGL-1562) from a delegated listener,
   * not per call site: an authored page has no code to add a handler to.
   */
  select_content: {
    content_type: string
    content_id: string
    /** Which product surface — see `click.surface`. */
    surface?: string
  }

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
    /**
     * GA4's shipping charged on the transaction, in currency units. Optional
     * because only a tenant STOREFRONT purchase ships anything — a plan or a
     * marketplace purchase has no shipping to report and omits it.
     *
     * There is deliberately no sibling `tax` (AGL-1639, AGL-1641). The
     * asymmetry is the point and is not an inconsistency to tidy away:
     * `shipping` is a COMPONENT of the `value` beside it, so reporting it
     * describes that value; `tax` is not, because `value` is already ex-tax,
     * so reporting it would assert a relationship that does not hold and
     * invite the subtraction that removes tax a second time.
     */
    shipping?: number
  }

  // --- Commerce (tenant storefronts, AGL-1591) -----------------------------
  /**
   * GA4 recommended. A product detail page was viewed on a tenant storefront.
   *
   * Only `items`, and only `item_id`/`item_name` within it: those are the two
   * fields the storefront actually has at this point, and an unpopulated
   * `price`/`item_category` would be a column of nulls in the merchant's
   * reports. The item id is the PRODUCT id — the same id `add_to_cart` and
   * `begin_checkout` use — which is what lets GA join the three into one
   * per-product funnel.
   */
  view_item: { items: AnalyticsItem[] }
  /** GA4 recommended. A storefront product was added to the cart. */
  add_to_cart: { items: AnalyticsItem[] }

  // --- Engagement ---------------------------------------------------------
  /**
   * Custom: no GA4 equivalent. An announcement bar or popup was shown,
   * dismissed or clicked on a tenant site (AGL-200/271).
   *
   * In the taxonomy rather than {@link trackAuthoredEvent} even though it is
   * not a GA4 recommended name: the name and every key here are written by US,
   * which is exactly what the closed union is for. See the note on
   * {@link trackAuthoredEvent} for why the two must not be mixed.
   */
  aglyn_overlay: { overlay_action: string; overlay_id?: string }
  /**
   * Custom: no GA4 equivalent. An experiment exposure or conversion
   * (AGL-253). `experiment_action` is `exposure` | `conversion`.
   *
   * Being in the union also makes the name RESERVED against authored events,
   * which matters more here than anywhere else in this file: these are the
   * counts that decide which variant wins, and a hand-authored
   * `aglyn_experiment` step would silently vote in that election.
   */
  aglyn_experiment: {
    experiment_id: string
    variant_id: string
    experiment_action: string
  }
  /**
   * GA4 recommended-ish. Outbound click to docs, GitHub, etc. Fired by
   * `analytics-link-clicks.ts` (AGL-1562) rather than at a call site.
   */
  click: {
    link_domain: string
    link_id?: string
    /**
     * Which product surface produced the click — `site` for a tenant
     * published site, `docs` for the documentation app (AGL-1579). GA's
     * built-in Hostname dimension already separates the DOMAINS; this
     * separates surfaces that could share one, and keeps the shared click
     * listener from having to know anything about either.
     */
    surface?: string
  }
  /**
   * Custom: no GA4 equivalent. One Aglyn Assist message sent (AGL-1860).
   * `tier` is the capability tier served (`free` | `entitled`);
   * `grounded` says whether docs retrieval found sections to cite —
   * ungrounded questions at volume are the docs-gap signal the data loop
   * mines. No question text: params carry no user content.
   */
  assistant_message_sent: { tier: string; grounded: boolean }
  /**
   * Custom: no GA4 equivalent. Explicit thumbs on an Assist answer
   * (AGL-1860). `feedback` is `up` | `down`.
   */
  assistant_feedback: { feedback: string }
  /**
   * Custom: no GA4 equivalent. Aglyn Assist offered to open a page for the
   * user (AGL-1988, level 2). `action` is the registry action id — a closed
   * set, so it carries no user content.
   *
   * The pair below is the only read on whether the confirm gate is a real
   * choice or a speed bump people click through. A shown-to-confirmed ratio
   * near 1 means the card is not being read, and the copy has to change
   * BEFORE the ladder goes anywhere near a write.
   */
  assistant_proposal_shown: { action: string }
  /** Custom: no GA4 equivalent. The user confirmed and was navigated. */
  assistant_proposal_confirmed: { action: string }

  // --- Retention (AGL-1859/AGL-1863: the leave path, measurable) -----------
  /**
   * Custom: no GA4 equivalent. The churn survey was answered — step 1 of the
   * cancellation/deletion funnel, and the DENOMINATOR every step below is a
   * rate against. Fired for both leave paths.
   *
   * `reason` is the closed `ChurnSurveyReason` set, never the free-text
   * detail: the detail is customer-written prose, it belongs in Firestore
   * where the data loop reads it, and shipping it to GA would put user
   * content in analytics params. `surface` separates a subscription cancel
   * from an account delete — counting only one understates churn by exactly
   * the orgs that chose the other.
   */
  churn_survey_submitted: { reason: string; surface: string; plan?: string }
  /**
   * Custom: no GA4 equivalent. The customer took the smaller tier instead of
   * leaving — a SAVE, at reduced ARPA. `from_plan`/`to_plan` are what makes
   * that tradeoff measurable rather than a win recorded without its cost.
   */
  downsell_accepted: { from_plan: string; to_plan: string; surface: string }
  /**
   * Custom: no GA4 equivalent. The time-boxed winback discount was accepted.
   *
   * `percent_off` and `duration_months` are reported because the discount is
   * bounded and the bound is the entire point (AGL-1620/AGL-1863): a retained
   * org and the margin it was retained at are one fact, and a save recorded
   * without its price reads as free.
   */
  winback_discount_accepted: {
    percent_off: number
    duration_months: number
    plan?: string
    surface: string
  }
  /**
   * Custom: no GA4 equivalent. They left anyway — the funnel's terminal step,
   * and the numerator for churn.
   *
   * `funnel_completed` is false when the cancel arrived without a funnelId
   * (support ops, Stripe dashboard). It mirrors the `funnelSkipped` marker
   * the routes write, so the GA funnel and the Firestore record agree instead
   * of quietly disagreeing about how many departures were ever surveyed.
   */
  cancellation_completed: {
    surface: string
    plan?: string
    funnel_completed: boolean
  }
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
  deliver(name, sanitizeEventParams(params as Record<string, unknown>))
}

/**
 * Build the ONE `begin_checkout` payload, for every surface that starts a
 * checkout (AGL-1591).
 *
 * ## Why a constructor and not just the type
 *
 * Two surfaces fire this name: the console, when a plan checkout starts, and a
 * tenant storefront, when a cart checks out. Until AGL-1591 the storefront
 * fired it raw and carried `value`/`currency` only, so ONE event name arrived
 * in two shapes — and a `begin_checkout` breakdown showed two populations that
 * could not be compared, with the storefront half missing the `items` the GA4
 * ecommerce funnel is built on. Routing both through {@link trackEvent} makes
 * the compiler settle the KEYS.
 *
 * It does not settle the NUMBER, which is the other way two call sites of one
 * event diverge, and the more dangerous one because nothing about it looks
 * wrong: the console's annual plans are priced per-month-billed-yearly, so its
 * `value` is twelve of them, and that only stayed right because a comment said
 * so. Here `value` DERIVES from the items unless a caller states a different
 * one — a cart states its subtotal, which is authoritative after discounts —
 * so "what the customer is about to be charged" has one definition rather than
 * one per surface.
 *
 * Server-safe: pure, no DOM, so the Measurement Protocol sender can compose
 * the matching `purchase` items from the same shapes.
 */
export function buildBeginCheckoutParams(input: {
  items: AnalyticsItem[]
  /**
   * The amount actually being charged. Defaults to the sum of the items'
   * `price * quantity`, which is right whenever nothing has adjusted it.
   */
  value?: number
  /** ISO 4217. Defaults to `USD`, the only currency either surface bills in. */
  currency?: string
  /** `monthly` | `annual`. Subscriptions only — a storefront cart has none. */
  billingInterval?: string
}): AnalyticsEventParams['begin_checkout'] {
  const items = input.items ?? []
  const summed = items.reduce(
    (total, item) => total + (item.price ?? 0) * (item.quantity ?? 1),
    0,
  )
  return {
    currency: input.currency ?? 'USD',
    // Money, so two decimals: a float sum of cents-derived prices produces
    // `59.99999999999999`, and GA would report that verbatim.
    value: Math.round((input.value ?? summed) * 100) / 100,
    items,
    ...(input.billingInterval ? { billing_interval: input.billingInterval } : {}),
  }
}

/**
 * Decide `site_published`'s `first_publish` from the host's routing map as it
 * stood BEFORE the route being published was registered (AGL-1588).
 *
 * ## What "first" means, and why it is defined once
 *
 * Three call sites report `site_published` — `publishScreenRoute`, the
 * besigner's one-click publish, and the scheduled publish executor, the last
 * of which is server-side and sends over the Measurement Protocol. A
 * breakdown is only worth registering if all three mean the same thing by it,
 * and "first" has several plausible readings. This is the one they share:
 *
 * **The host had no live route at all before this one.** Not "first for the
 * org" — that needs a cross-host query the server path cannot make, and the
 * scheduled sender's client id is derived from the HOST anyway, so an org is
 * not a thing it can see. Not "first for this screen" either, which would be
 * true of every second page a site adds and would make the dimension a
 * synonym for the event.
 *
 * So the metric it separates is the GTM §6 activation one: `first_publish:
 * true` counts sites that came alive, where the event alone counts publishes.
 *
 * ## The one dishonesty, and why it does not matter
 *
 * Unpublishing every route and publishing again reports `true` a second time.
 * Detecting that needs publish history the routing map does not keep. It is
 * harmless for the metric it exists for, because activation is read as the
 * share of USERS who ever sent `first_publish: true`, and a user counted twice
 * is still one user.
 *
 * Callers pass what they already hold — the live-subscribed map in the
 * console, a read snapshot on the server — and never a map read back AFTER
 * the write, which is never empty.
 */
export function isFirstPublishedRoute(
  routing: Record<string, unknown> | null | undefined,
): boolean {
  return Object.keys(routing ?? {}).length === 0
}

/**
 * The one delivery path, shared by {@link trackEvent} and
 * {@link trackAuthoredEvent}. Takes an ALREADY-sanitized payload — every
 * caller sanitizes first, which is what keeps "a new call site cannot forget"
 * true of the authored path too.
 */
function deliver(name: string, safe: Record<string, unknown>): void {
  try {
    if (configuredTransport) {
      // The transport's name parameter is the taxonomy union, which an
      // authored name is by definition outside. Nominal only: the console is
      // the sole surface that registers one and it has no authored events
      // (the interaction runtime is tenant-side), and Firebase `logEvent`
      // takes an arbitrary string regardless.
      configuredTransport(name as AnalyticsEventName, safe)
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

/**
 * The taxonomy's names at RUN time. A `Record<AnalyticsEventName, true>` rather
 * than a hand-kept array so the compiler enforces both directions: adding an
 * event to {@link AnalyticsEventParams} without adding it here is a missing-key
 * error, and a name here that is not in the taxonomy is an excess-property one.
 *
 * It exists for {@link trackAuthoredEvent}, which has to refuse these names —
 * a drifting copy would silently re-open the collision it is here to close.
 */
const TAXONOMY_EVENT_NAMES: Record<AnalyticsEventName, true> = {
  sign_up: true,
  login: true,
  generate_lead: true,
  select_content: true,
  org_created: true,
  host_created: true,
  site_published: true,
  stripe_connected: true,
  begin_checkout: true,
  purchase: true,
  view_item: true,
  add_to_cart: true,
  aglyn_overlay: true,
  aglyn_experiment: true,
  click: true,
  assistant_message_sent: true,
  assistant_feedback: true,
  assistant_proposal_shown: true,
  assistant_proposal_confirmed: true,
  churn_survey_submitted: true,
  downsell_accepted: true,
  winback_discount_accepted: true,
  cancellation_completed: true,
}

/** The taxonomy, enumerable. */
export const ANALYTICS_EVENT_NAMES = Object.keys(
  TAXONOMY_EVENT_NAMES,
) as AnalyticsEventName[]

/**
 * GA4's own reserved event names — GA drops a hit that uses one, so sending it
 * is not pollution but silence, which is the worse failure of the two because
 * nothing anywhere says so.
 */
const GA4_RESERVED_EVENT_NAMES: ReadonlySet<string> = new Set([
  'ad_activeview',
  'ad_click',
  'ad_exposure',
  'ad_impression',
  'ad_query',
  'ad_reward',
  'adunit_exposure',
  'app_background',
  'app_clear_data',
  'app_exception',
  'app_install',
  'app_remove',
  'app_store_refund',
  'app_store_subscription_cancel',
  'app_store_subscription_convert',
  'app_store_subscription_renew',
  'app_update',
  'app_upgrade',
  'dynamic_link_app_open',
  'dynamic_link_app_update',
  'dynamic_link_first_open',
  'error',
  'first_open',
  'first_visit',
  'in_app_purchase',
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'os_update',
  'screen_view',
  'session_start',
  'user_engagement',
])

/** GA4 reserves these prefixes outright, whatever follows them. */
const GA4_RESERVED_PREFIXES = ['firebase_', 'google_', 'ga_'] as const

/** GA4's hard limit on an event name. Over it, GA drops the event. */
const MAX_EVENT_NAME_LENGTH = 40

/**
 * The outcome of putting an authored name through GA4's rules, so the
 * interaction builder can say WHY it refused a name and the runtime can drop
 * the event for the same reason.
 */
export interface ResolvedAuthoredEventName {
  /** The name to send, or null when the event must not be sent at all. */
  name: string | null
  /**
   * `reserved` — collides with the taxonomy or with GA4's own names.
   * `unusable` — nothing survives normalization (empty, or no leading letter).
   */
  reason?: 'reserved' | 'unusable'
}

/**
 * Put an authored event name through GA4's naming rules and our own.
 *
 * Normalization is forgiving on purpose: `"CTA Click!"` becomes `cta_click`
 * and still reports, where GA would have dropped it. Names already sitting in
 * published sites were never validated, so refusing them outright would delete
 * working metrics from a paying customer's property to fix a formatting nit.
 *
 * Collisions, in contrast, are refused rather than rewritten. On a tenant site
 * the authored events and OUR events (`generate_lead` from the form element,
 * `select_content`/`click` from the link listener) land in the same property,
 * so an authored `purchase` does not merely add noise — it mixes hand-authored
 * hits into a real revenue number. Refusing is also what keeps authored events
 * separable in reports: an event that is not one of {@link ANALYTICS_EVENT_NAMES}
 * is, by construction, authored.
 *
 * Deliberately NOT prefixed (`site_*`) to achieve that separation. A prefix
 * would rename events already flowing into customers' properties and break
 * every report and key-event conversion configured on the old name — a
 * migration cost paid by people who did nothing wrong.
 */
export function resolveAuthoredEventName(
  raw: string | undefined | null,
): ResolvedAuthoredEventName {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase()
    // Anything GA4 does not allow in a name becomes an underscore...
    .replace(/[^a-z0-9_]+/g, '_')
    // ...and a name must START with a letter, so drop what precedes one.
    .replace(/^[^a-z]+/, '')
    .replace(/_{2,}/g, '_')
    .slice(0, MAX_EVENT_NAME_LENGTH)
    // Truncation can leave a trailing underscore; so can the substitution.
    .replace(/_+$/, '')
  if (!normalized) return { name: null, reason: 'unusable' }
  if (
    TAXONOMY_EVENT_NAMES[normalized as AnalyticsEventName] ||
    GA4_RESERVED_EVENT_NAMES.has(normalized) ||
    GA4_RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return { name: null, reason: 'reserved' }
  }
  return { name: normalized }
}

/** One warning per distinct name per page load — an `everyTime` automation
 * would otherwise fill the console with the same line. */
const warnedAuthoredNames = new Set<string>()

/**
 * Fire an event whose name and params were written by a SITE AUTHOR, not by a
 * developer — today only the `trackGaEvent` action step (AGL-1587).
 *
 * Same consent gate, same sanitizer, same drop-never-queue posture as
 * {@link trackEvent}; the only difference is that the name is checked at run
 * time instead of by the compiler, because there is no compiler between the
 * interaction builder and here.
 *
 * A refused event is dropped and warned about in the console rather than
 * surfaced in the page. Nothing here can reach the author — the code is
 * running for a VISITOR of their site, and turning the author's configuration
 * mistake into something a visitor sees would be a worse bug than the missing
 * metric. The author-facing half lives in `validateHostAction`, which refuses
 * to save a name this function would refuse to send, so a silent drop should
 * only ever happen to a step authored before AGL-1587.
 */
export function trackAuthoredEvent(
  name: string | undefined | null,
  params?: Record<string, unknown> | null,
): void {
  const resolved = resolveAuthoredEventName(name)
  if (!resolved.name) {
    const key = String(name ?? '')
    if (!warnedAuthoredNames.has(key)) {
      warnedAuthoredNames.add(key)
      try {
        console.warn(
          `[aglyn] analytics: the event "${key}" was not sent — ` +
            (resolved.reason === 'reserved'
              ? 'that name is reserved. Rename the step in the interaction builder.'
              : 'an event name must start with a letter.'),
        )
      } catch {
        // A console that throws is still not worth breaking the page for.
      }
    }
    return
  }
  deliver(resolved.name, sanitizeEventParams(params ?? undefined))
}

/** Test seam — forgets which authored names have already been warned about. */
export function resetAuthoredEventWarnings(): void {
  warnedAuthoredNames.clear()
}
