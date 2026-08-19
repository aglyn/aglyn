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

/**
 * The events that only a **Connect** destination can ever deliver (AGL-2122).
 *
 * `account.updated` for a CONNECTED account — a storefront merchant's or a
 * marketplace publisher's Stripe account — is delivered to a destination
 * created with `connect: true`, and to nothing else. Putting it in
 * `WEBHOOK_EVENTS` above would subscribe the PLATFORM's own account instead:
 * `syncConnectAccountStatus` would find no `profiles`/`publisherProfiles`
 * document bound to the platform account id, do nothing, and every check here
 * would go green while the fail-open it exists to close stayed open. That is
 * the worst available outcome — a false green over a known gap — so the two
 * lists are separate and are asserted against separate destinations.
 *
 * The handler this feeds has existed since AGL-1997 and has never run in
 * production: measured against the live account on 2026-08-18,
 * `GET /v1/webhook_endpoints` returned exactly one destination, carrying
 * exactly the ten `WEBHOOK_EVENTS` and no Connect destination at all.
 *
 * What it guards: `stripeChargesEnabled` is the cached flag every commerce
 * money route gates on (checkout, cart checkout, draft orders, reservations,
 * POS). Without this event nothing refreshes it but the merchant reopening the
 * Connect route, so an account Stripe later restricts keeps selling on a stale
 * `true` and the SHOPPER meets the failure at payment time.
 */
export const CONNECT_WEBHOOK_EVENTS = [
  // Connect readiness (AGL-1997) — `libs/tenant/data/admin/src/lib/server/
  // connect-account-status.ts`, via the commerce and marketplace handlers.
  'account.updated',
]

/**
 * How a Connect destination is TOLD APART from an account one.
 *
 * Measured, not assumed: `GET /v1/webhook_endpoints` on the live account
 * (2026-08-18) returns objects whose only keys are `api_version`,
 * `application`, `created`, `description`, `enabled_events`, `id`, `livemode`,
 * `metadata`, `object`, `status`, `url`. **None of them states whether the
 * endpoint was created with `connect: true`** — `application` is null on a
 * plain destination and is about Connect *apps*, not about this.
 *
 * So the type cannot be read back from Stripe, and an audit that inferred it
 * from the subscribed events would be circular: it would conclude "this is the
 * Connect destination" from the very fact it is trying to verify. The
 * destination is therefore STAMPED at creation, by `setup-stripe.mjs` and by
 * hand in the dashboard, and the audit reads the stamp. An unstamped Connect
 * destination reads as an account one and fails `endpoint.count` loudly, which
 * is the right direction to fail in.
 */
export const CONNECT_SCOPE_METADATA_KEY = 'aglyn_scope'
export const CONNECT_SCOPE_METADATA_VALUE = 'connect'

/** Whether an endpoint object carries the Connect stamp above. */
export function isConnectEndpoint(endpoint) {
  return (
    endpoint?.metadata?.[CONNECT_SCOPE_METADATA_KEY] ===
    CONNECT_SCOPE_METADATA_VALUE
  )
}

/** The production destination this repo deploys against. */
export const PLATFORM_WEBHOOK_URL = 'https://app.aglyn.com/api/billing/webhook'

/**
 * How far back `GET /v1/events` can see. Stripe keeps 30 days; older events
 * are simply absent from the list, with no error and no marker.
 *
 * This constant exists because the first version of this audit did not have
 * it, and asking for `--days 365` printed a header claiming a window back to
 * the destination's creation — while the data behind it started 30 days ago.
 * Verified empirically against the live account on 2026-08-18: the oldest
 * retrievable event was 2026-07-19T06:30:07Z, and the 2026-07-18 monthly
 * checkout that certainly did deliver was already gone.
 *
 * A window wider than the data is exactly the failure this whole audit exists
 * to prevent — a green check reading less than it claims — so the window is
 * clamped here rather than trusted from the caller.
 */
export const EVENT_RETENTION_DAYS = 30

/**
 * How long after Stripe creates an event its FIRST delivery attempt may
 * plausibly take to be recorded, in seconds. Anything slower means an earlier
 * attempt failed and a retry is what landed.
 *
 * This constant is the fix for AGL-1906's blind spot, so it is worth being
 * precise about why it can see what `delivery_success` cannot.
 *
 * `delivery_success=false` is a TERMINAL state: it selects events that are
 * still pending or have failed EVERY attempt. An event that 400s three times
 * and then succeeds on the fourth reads back as `delivery_success: true` and
 * is, to that filter, indistinguishable from one that succeeded immediately.
 * That is not a bug in the filter — the test-mode account's 21 events stuck at
 * `pending_webhooks: 1` prove it still reports real failures — it simply
 * answers "did this event ever get through?", not "did every attempt succeed?".
 * The Stripe Dashboard's error rate answers the second question, because its
 * denominator is delivery ATTEMPTS, and that is the whole reconciliation.
 *
 * The recoverable half of the attempt history is in our own data.
 * `route.ts` claims `stripeEvents/{id}` with `receivedAt: new Date()` AFTER
 * signature verification, and DELETES that claim when a handler throws, so the
 * stamp always records the attempt that actually got through. The distance
 * from `event.created` to `receivedAt` is therefore the delivery lag, and a
 * lag of hours is a retry — i.e. proof of failed attempts Stripe's event list
 * will never name.
 *
 * Calibration, from the live account on 2026-08-18: the five deliveries that
 * succeeded first time landed in 1.0–3.7s. The one that did not —
 * `evt_1U49XtDYHP4psn7hA9VHPnZz`, the AGL-1551 event whose three 400s ARE the
 * Dashboard's three failures — landed 16,665s (4h 37m) late. Two minutes sits
 * three orders of magnitude clear of the healthy band and still below Stripe's
 * first automatic retry, so it separates the two without straddling either.
 *
 * A manual dashboard replay cannot make this cry wolf: replaying an event that
 * already succeeded hits the idempotency claim and leaves the original
 * `receivedAt` in place, so only a replay of a genuinely failed delivery moves
 * the stamp — which is exactly the case worth flagging.
 */
export const RETRY_LAG_SECONDS = 120

/**
 * Resolve the window actually backed by data, and say what narrowed it.
 *
 * @param {object} input
 * @param {number} input.requestedStart Unix seconds the caller asked for.
 * @param {number} input.end            Unix seconds, inclusive.
 * @param {number} [input.endpointCreated] Unix seconds the destination was created.
 * @param {number} [input.now]          Unix seconds; defaults to `end`.
 */
export function resolveWindow({
  requestedStart,
  end,
  endpointCreated = null,
  now = null,
} = {}) {
  const reference = now ?? end
  const retentionFloor = reference - EVENT_RETENTION_DAYS * 86_400
  const clamps = []
  let start = requestedStart
  // An event older than the destination was never attempted against it, so
  // holding it against the destination would manufacture a failure.
  if (endpointCreated != null && endpointCreated > start) {
    start = endpointCreated
    clamps.push('endpoint-creation')
  }
  if (retentionFloor > start) {
    start = retentionFloor
    clamps.push('stripe-event-retention')
  }
  return { start, end, clamps, retentionFloor }
}

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
 * @param {Array<{id: string, receivedAt: number|null}>} [input.processedEvents]
 *        The same documents WITH their `receivedAt` stamp, in unix seconds.
 *        Supplying it enables `delivery.retries`, the only arm that can see a
 *        delivery that failed and was later retried into success — the exact
 *        case `delivery_success` reports as clean. Ids here are unioned into
 *        the processed set, so a caller may pass this instead of
 *        `processedEventIds`.
 * @param {boolean} input.firestoreChecked
 * @param {boolean} [input.expectLivemode] Whether the key is a live-mode key.
 * @param {number} input.windowStart Unix seconds, inclusive.
 * @param {number} input.windowEnd   Unix seconds, inclusive.
 */
export function assessWebhookHealth({
  endpoints = [],
  endpointUrl = PLATFORM_WEBHOOK_URL,
  events = [],
  failedEventIds = [],
  processedEventIds = [],
  processedEvents = null,
  firestoreChecked = false,
  expectLivemode = true,
  windowStart = 0,
  windowEnd = 0,
} = {}) {
  const failed = new Set(failedEventIds)
  const processed = new Set(processedEventIds)
  /** event id -> `receivedAt` in unix seconds, for the retry arm below. */
  const receivedAt = new Map()
  for (const entry of processedEvents ?? []) {
    if (!entry?.id) continue
    processed.add(entry.id)
    receivedAt.set(entry.id, entry.receivedAt ?? null)
  }
  /** Whether the caller supplied stamps at all — absent is `unknown`, not pass. */
  const lagAvailable = Array.isArray(processedEvents)
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
  // Match the key's mode rather than assuming live. A test-mode key lists
  // only `livemode: false` endpoints, so a hard-coded live filter found zero
  // and reported "no destination" — which would have made the audit unable to
  // ASK about the test endpoint at all, and the test endpoint turned out to be
  // missing three events (see `--mode test`).
  const sameMode = endpoints.filter(
    (endpoint) => (endpoint?.livemode !== false) === expectLivemode,
  )
  // Partitioned by the AGL-2122 stamp: the two destinations answer different
  // questions and must be assessed against different event lists. Before this,
  // `endpoint.count` demanded exactly ONE destination account-wide, so adding
  // the Connect destination the commerce handler needs would have turned the
  // audit red for doing the right thing.
  const connectEndpoints = sameMode.filter(isConnectEndpoint)
  const live = sameMode.filter((endpoint) => !isConnectEndpoint(endpoint))
  if (live.length !== 1) {
    add(
      'endpoint.count',
      FAIL,
      `Expected exactly 1 ${expectLivemode ? 'live' : 'test'}-mode webhook endpoint, found ${live.length}`,
      live.map((endpoint) => ({ id: endpoint.id, url: endpoint.url })),
    )
  } else {
    add('endpoint.count', PASS, `1 ${expectLivemode ? 'live' : 'test'}-mode webhook endpoint on the account`, {
      id: live[0].id,
    })
  }

  const endpoint = live[0] ?? null
  if (!endpoint) {
    add('endpoint.status', FAIL, 'No matching webhook endpoint to assess')
    add('endpoint.url', FAIL, 'No matching webhook endpoint to assess')
    add('endpoint.events', FAIL, 'No matching webhook endpoint to assess')
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

  // ---- The Connect destination (AGL-2122) --------------------------------
  //
  // Its own check rather than another entry in `endpoint.events`, because the
  // failure it reports is a DIFFERENT failure: the platform destination can be
  // perfectly healthy while every connected merchant's readiness flag quietly
  // rots. Reported as one destination missing, not ten events missing.
  if (connectEndpoints.length !== 1) {
    add(
      'connect.endpoint',
      FAIL,
      connectEndpoints.length === 0
        ? `No Connect destination (metadata ${CONNECT_SCOPE_METADATA_KEY}=${CONNECT_SCOPE_METADATA_VALUE}). ` +
          '`account.updated` for a connected account is delivered to nothing, ' +
          'so `stripeChargesEnabled` never refreshes and a restricted merchant ' +
          'keeps selling until the shopper is declined.'
        : `Expected exactly 1 Connect destination, found ${connectEndpoints.length}`,
      connectEndpoints.map((entry) => ({ id: entry.id, url: entry.url })),
    )
    add('connect.events', FAIL, 'No Connect destination to assess')
  } else {
    const connect = connectEndpoints[0]
    add('connect.endpoint', PASS, 'Connect destination present', {
      id: connect.id,
    })
    const connectEnabled = new Set(connect.enabled_events ?? [])
    const connectMissing = connectEnabled.has('*')
      ? []
      : CONNECT_WEBHOOK_EVENTS.filter((entry) => !connectEnabled.has(entry))
    if (connect.status !== 'enabled') {
      add(
        'connect.events',
        FAIL,
        `Connect destination status is ${connect.status ?? 'unknown'}, expected enabled`,
      )
    } else if (connectMissing.length === 0) {
      add(
        'connect.events',
        PASS,
        `All ${CONNECT_WEBHOOK_EVENTS.length} Connect event(s) subscribed`,
      )
    } else {
      add(
        'connect.events',
        FAIL,
        `${connectMissing.length} Connect event(s) not subscribed`,
        connectMissing,
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

  // `delivery_success` is TERMINAL-state only, and the message says so.
  //
  // The first wording here read "Stripe reports 0 failed deliveries", which is
  // how a reader gets to "the endpoint has a 0% error rate" — a claim this arm
  // cannot support and the Dashboard flatly contradicted at 30%. Both were
  // right: this counts EVENTS never delivered, the Dashboard counts ATTEMPTS.
  // `delivery.retries` below is the arm that covers the difference.
  const failedInWindow = deliverable.filter((event) => failed.has(event.id))
  if (failedInWindow.length === 0) {
    add(
      'delivery.failures',
      PASS,
      `0 of ${deliverable.length} deliverable event(s) failed EVERY delivery attempt` +
        ' (per-attempt failures are delivery.retries, not this check)',
    )
  } else {
    add(
      'delivery.failures',
      FAIL,
      `${failedInWindow.length} event(s) never delivered — pending, or failed every attempt`,
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

  // ---- Did any delivery need a RETRY to get through? --------------------
  //
  // The arm AGL-1906 shipped without, and the reason its "0.00% error rate"
  // read as a contradiction of the Dashboard's 30%.
  //
  // Neither number was wrong. This audit's denominator is EVENTS and it scores
  // an event on its final state; the Dashboard's denominator is delivery
  // ATTEMPTS and it scores every one. An event that 400s three times and then
  // succeeds is 0% here and 75% there, and the three real failures — the ones
  // that mattered, because each was a mirror that did not run when it should
  // have — were visible only in the second reading.
  //
  // `RETRY_LAG_SECONDS` explains how the gap is recovered from our own
  // `receivedAt` stamp. Restricted to events that HAVE a document, because one
  // that has none is already `processing.coverage`'s finding and would
  // otherwise be reported twice under two different names.
  const withDocuments = deliverable.filter((event) => processed.has(event.id))
  const lagOf = (event) => {
    const stamp = receivedAt.get(event.id)
    return typeof stamp === 'number' ? stamp - event.created : null
  }
  const retried = withDocuments
    .map((event) => ({ event, lag: lagOf(event) }))
    .filter((row) => row.lag !== null && row.lag > RETRY_LAG_SECONDS)
  const unstamped = withDocuments.filter((event) => lagOf(event) === null)
  if (!firestoreChecked || !lagAvailable) {
    add(
      'delivery.retries',
      UNKNOWN,
      'No receivedAt stamps available — per-ATTEMPT failures are UNVERIFIED' +
        ' (delivery.failures only sees events that failed every attempt)',
    )
  } else if (withDocuments.length === 0) {
    add(
      'delivery.retries',
      UNKNOWN,
      'No delivered event in the window to measure delivery lag against',
    )
  } else if (unstamped.length > 0) {
    add(
      'delivery.retries',
      UNKNOWN,
      `${unstamped.length} of ${withDocuments.length} stripeEvents document(s) carry no receivedAt — lag not computable`,
      unstamped.map((event) => ({ id: event.id, type: event.type })),
    )
  } else if (retried.length === 0) {
    add(
      'delivery.retries',
      PASS,
      `All ${withDocuments.length} delivered event(s) landed on the first attempt (within ${RETRY_LAG_SECONDS}s)`,
    )
  } else {
    add(
      'delivery.retries',
      FAIL,
      `${retried.length} of ${withDocuments.length} delivered event(s) only landed on a RETRY — earlier attempt(s) failed`,
      retried.map((row) => ({
        id: row.event.id,
        type: row.event.type,
        lagSeconds: Math.round(row.lag),
        created: new Date(row.event.created * 1000).toISOString(),
        receivedAt: new Date(receivedAt.get(row.event.id) * 1000).toISOString(),
      })),
    )
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
      // What `errorRate` is a rate OF, carried beside the number so it cannot
      // be quoted without it. AGL-1906's "0.00% error rate" was read as the
      // Dashboard's error rate; they share a name and share neither their
      // numerator nor their denominator. Whoever reads this next gets both
      // definitions in the same object as the figure.
      errorRateBasis: {
        denominator: 'events of a subscribed type, created in the window',
        denominatorValue: deliverable.length,
        numerator: 'events that are pending or failed EVERY delivery attempt',
        numeratorValue: failedInWindow.length,
        countsRetriedAttempts: false,
        notComparableTo:
          'the Stripe Dashboard error rate, whose denominator is delivery ATTEMPTS' +
          ' (retries included) against this one destination — see delivery.retries',
      },
      retriedEvents: lagAvailable && firestoreChecked ? retried.length : null,
      maxDeliveryLagSeconds:
        lagAvailable && firestoreChecked && withDocuments.length > 0
          ? withDocuments.reduce(
              (max, event) => Math.max(max, lagOf(event) ?? 0),
              0,
            )
          : null,
      unprocessedEvents: unprocessedCount,
      processingGapRate,
      byType: Object.fromEntries(
        [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  }
}
