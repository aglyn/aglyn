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

// The webhook-health verdict, as a PURE function of already-fetched facts
// (AGL-1906). All network and Firestore access lives in
// `tools/scripts/audit-stripe-webhook-health.mjs`; everything that decides
// green-or-red lives here, so the decision can be driven RED by a unit test
// instead of by waiting for production to break.
//
// That split is the whole point. AGL-1551 found the live destination 400ing
// 100% of deliveries behind a green "Active" badge, and the reason nobody
// noticed is that the only available check could not fail: an empty
// `stripeEvents` collection reads identically whether nothing happened or
// everything was rejected. A verdict you cannot force to fail is not evidence.

/**
 * The events the platform destination must be subscribed to.
 *
 * Single source of truth, shared with `tools/scripts/setup-stripe.mjs`, which
 * uses it to CREATE and reconcile the endpoint. The audit uses it to ASSERT
 * the endpoint still carries them: a subscription silently removed in the
 * dashboard is invisible to every other check we have.
 *
 * A missing entry here is not a syntax error anywhere: the handler compiles,
 * its tests pass against a synthesised event, and it simply never runs in
 * production. `charge.refunded` was missing for exactly that reason (AGL-1798)
 * and the live endpoint carries it only because someone added it by hand.
 *
 * Add an event here in the same commit as the handler that reads it, and say
 * which one in the comment, so the next reader can tell a live subscription
 * from a dead one without opening the dashboard.
 */
export const WEBHOOK_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  // Marketplace purchases (AGL-46).
  'checkout.session.completed',
  // Billing notifications (AGL-259): invoice availability + dunning.
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  // Marketplace refunds (AGL-1546): a FULLY refunded purchase loses its
  // install entitlement. `libs/plugins/marketplace/src/lib/server/billing-webhook.ts`
  // has handled this since AGL-1546 shipped and this list never carried the
  // event, so any endpoint this script created would have revoked nothing.
  'charge.refunded',
  // Card disputes (AGL-1787): `created` flags the order and warns the
  // merchant while the evidence window is open; `closed` is the only one
  // that moves money, and only when `status` is `lost`.
  'charge.dispute.created',
  'charge.dispute.closed',
]

/** The production destination this repo deploys against. */
export const PLATFORM_WEBHOOK_URL = 'https://app.aglyn.com/api/billing/webhook'

/**
 * Verdict levels. `unknown` is deliberately NOT a pass: a check that could not
 * run is the exact shape of the 2026-08-14 mis-tick, where "no contrary
 * evidence" was read as "healthy".
 */
const PASS = 'pass'
const FAIL = 'fail'
const UNKNOWN = 'unknown'

/**
 * Assess the live platform webhook.
 *
 * @param {object} input
 * @param {Array<object>} input.endpoints    Live `webhook_endpoint` objects on the account.
 * @param {string} [input.endpointUrl]       Expected destination URL.
 * @param {Array<{id: string, type: string, created: number}>} input.events
 *        Every Stripe event in the window (all types, not just subscribed ones).
 * @param {Set<string>|Array<string>} input.failedEventIds
 *        Event ids Stripe reports with `delivery_success=false`.
 * @param {Set<string>|Array<string>} [input.processedEventIds]
 *        `stripeEvents` document ids found in Firestore. Omit when the
 *        Firestore arm did not run — the verdict then reports `unknown`,
 *        never `pass`.
 * @param {boolean} input.firestoreChecked
 * @param {number} input.windowStart Unix seconds, inclusive.
 * @param {number} input.windowEnd   Unix seconds, inclusive.
 */
export function assessWebhookHealth({
  endpoints = [],
  endpointUrl = PLATFORM_WEBHOOK_URL,
  events = [],
  failedEventIds = [],
  processedEventIds = [],
  firestoreChecked = false,
  windowStart = 0,
  windowEnd = 0,
} = {}) {
  const failed = new Set(failedEventIds)
  const processed = new Set(processedEventIds)
  const findings = []
  const add = (check, level, message, detail) =>
    findings.push(detail === undefined
      ? { check, level, message }
      : { check, level, message, detail })

  // ---- The destination itself -------------------------------------------
  //
  // Read first, because everything below is interpreted through it: the
  // subscribed set decides which events were ever ATTEMPTED, and an event of
  // an unsubscribed type is delivered nowhere, so it can neither succeed nor
  // fail. Counting those as successes is how an account-wide "0 failures"
  // becomes vacuous.
  const live = endpoints.filter((endpoint) => endpoint?.livemode !== false)
  if (live.length !== 1) {
    add(
      'endpoint.count',
      FAIL,
      `Expected exactly 1 live webhook endpoint, found ${live.length}`,
      live.map((endpoint) => ({ id: endpoint.id, url: endpoint.url })),
    )
  } else {
    add('endpoint.count', PASS, '1 live webhook endpoint on the account', {
      id: live[0].id,
    })
  }

  const endpoint = live[0] ?? null
  if (!endpoint) {
    add('endpoint.status', FAIL, 'No live webhook endpoint to assess')
    add('endpoint.url', FAIL, 'No live webhook endpoint to assess')
    add('endpoint.events', FAIL, 'No live webhook endpoint to assess')
  } else {
    if (endpoint.status === 'enabled') {
      add('endpoint.status', PASS, 'Destination status is enabled')
    } else {
      add(
        'endpoint.status',
        FAIL,
        `Destination status is ${endpoint.status ?? 'unknown'}, expected enabled`,
      )
    }

    if (endpoint.url === endpointUrl) {
      add('endpoint.url', PASS, `Destination points at ${endpointUrl}`)
    } else {
      add(
        'endpoint.url',
        FAIL,
        `Destination points at ${endpoint.url ?? '(none)'}, expected ${endpointUrl}`,
      )
    }

    const enabled = new Set(endpoint.enabled_events ?? [])
    // `*` is Stripe's catch-all subscription and satisfies every entry.
    const missing = enabled.has('*')
      ? []
      : WEBHOOK_EVENTS.filter((event) => !enabled.has(event))
    if (missing.length === 0) {
      add(
        'endpoint.events',
        PASS,
        `All ${WEBHOOK_EVENTS.length} required events subscribed`,
      )
    } else {
      add(
        'endpoint.events',
        FAIL,
        `${missing.length} required event(s) not subscribed`,
        missing,
      )
    }
  }

  // ---- Deliveries in the window -----------------------------------------
  const inWindow = events.filter(
    (event) => event.created >= windowStart && event.created <= windowEnd,
  )
  const subscribedTypes = new Set(endpoint?.enabled_events ?? [])
  const deliverable = subscribedTypes.has('*')
    ? inWindow
    : inWindow.filter((event) => subscribedTypes.has(event.type))

  /** Per event type: how many were deliverable, and how many Stripe failed. */
  const byType = new Map()
  for (const event of deliverable) {
    const row = byType.get(event.type) ?? { attempted: 0, failed: 0, unprocessed: 0 }
    row.attempted += 1
    if (failed.has(event.id)) row.failed += 1
    if (firestoreChecked && !processed.has(event.id)) row.unprocessed += 1
    byType.set(event.type, row)
  }

  // Evidence bar (the AGL-1906 wording): a 0% error rate over an EMPTY window
  // is not evidence of anything. Assert at least one real delivery first.
  if (deliverable.length > 0) {
    add(
      'delivery.evidence',
      PASS,
      `${deliverable.length} deliverable event(s) in the window`,
    )
  } else {
    add(
      'delivery.evidence',
      FAIL,
      'No deliverable event in the window — a 0% error rate over zero deliveries proves nothing',
      { totalEventsInWindow: inWindow.length },
    )
  }

  const failedInWindow = deliverable.filter((event) => failed.has(event.id))
  if (failedInWindow.length === 0) {
    add(
      'delivery.failures',
      PASS,
      `Stripe reports 0 failed deliveries across ${deliverable.length} deliverable event(s)`,
    )
  } else {
    add(
      'delivery.failures',
      FAIL,
      `Stripe reports ${failedInWindow.length} failed deliver(ies)`,
      failedInWindow.map((event) => ({ id: event.id, type: event.type })),
    )
  }

  // ---- Did the handler actually RUN? ------------------------------------
  //
  // The load-bearing arm, and the one that would have caught AGL-1551.
  //
  // `route.ts` claims `stripeEvents/{event.id}` AFTER `verifyStripeSignature`
  // and BEFORE any handler, so the document's existence proves the signature
  // verified and the request reached the handler body. A 400 writes nothing.
  // Stripe's own list supplies the denominator, so "no documents" can no
  // longer be confused with "no traffic" — the ambiguity that made the
  // 2026-08-14 tick wrong.
  //
  // It is also independent of `delivery_success`, which is account-wide and
  // cannot be pinned to one destination.
  if (!firestoreChecked) {
    add(
      'processing.coverage',
      UNKNOWN,
      'Firestore arm did not run — delivery success is UNVERIFIED from our side',
    )
  } else {
    const unprocessed = deliverable.filter((event) => !processed.has(event.id))
    if (deliverable.length === 0) {
      add(
        'processing.coverage',
        UNKNOWN,
        'No deliverable event in the window to cross-check',
      )
    } else if (unprocessed.length === 0) {
      add(
        'processing.coverage',
        PASS,
        `All ${deliverable.length} deliverable event(s) have a stripeEvents document`,
      )
    } else {
      add(
        'processing.coverage',
        FAIL,
        `${unprocessed.length} of ${deliverable.length} deliverable event(s) have NO stripeEvents document — the handler never ran for them`,
        unprocessed.map((event) => ({ id: event.id, type: event.type })),
      )
    }
  }

  const errorRate =
    deliverable.length > 0 ? failedInWindow.length / deliverable.length : null
  const unprocessedCount = firestoreChecked
    ? deliverable.filter((event) => !processed.has(event.id)).length
    : null
  const processingGapRate =
    firestoreChecked && deliverable.length > 0
      ? unprocessedCount / deliverable.length
      : null

  return {
    ok: findings.every((finding) => finding.level === PASS),
    findings,
    summary: {
      windowStart,
      windowEnd,
      totalEvents: inWindow.length,
      deliverableEvents: deliverable.length,
      failedDeliveries: failedInWindow.length,
      errorRate,
      unprocessedEvents: unprocessedCount,
      processingGapRate,
      byType: Object.fromEntries(
        [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  }
}
