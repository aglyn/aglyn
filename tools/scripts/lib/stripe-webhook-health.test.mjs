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

// Every check in `stripe-webhook-health.mjs`, driven RED on purpose.
//
// AGL-1906 exists because a green reading was accepted from a check that had
// no way to come back red. So the bar for this file is not "the happy path
// returns ok" — it is that each individual finding has a demonstrated failing
// input, and that the historical AGL-1551 shape (deliveries attempted, zero
// handled) is one of them.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EVENT_RETENTION_DAYS,
  PLATFORM_WEBHOOK_URL,
  RETRY_LAG_SECONDS,
  WEBHOOK_EVENTS,
  CONNECT_WEBHOOK_EVENTS,
  assessWebhookHealth,
  resolveWindow,
} from './stripe-webhook-health.mjs'

const WINDOW_START = 1_786_000_000
const WINDOW_END = 1_787_000_000
const AT = WINDOW_START + 1000

const endpoint = (overrides = {}) => ({
  id: 'we_test',
  livemode: true,
  status: 'enabled',
  url: PLATFORM_WEBHOOK_URL,
  enabled_events: [...WEBHOOK_EVENTS],
  ...overrides,
})

const event = (id, type, created = AT) => ({ id, type, created })

/**
 * A `stripeEvents` document, with the delivery lag that separates a
 * first-attempt success from a retry. The default of 2s is what the live
 * account's healthy deliveries actually measured (1.0–3.7s on 2026-08-18).
 */
const processedAfter = (id, lagSeconds = 2) => ({
  id,
  receivedAt: AT + lagSeconds,
})

/**
 * The Connect destination (AGL-2122), stamped the way `setup-stripe.mjs`
 * stamps it. Stripe's endpoint object states nothing about `connect: true`
 * (measured against the live account 2026-08-18 — see the module), so the
 * stamp IS the discriminator and the fixture has to carry it.
 */
const connectEndpoint = (overrides = {}) => ({
  id: 'we_connect_test',
  livemode: true,
  status: 'enabled',
  url: PLATFORM_WEBHOOK_URL,
  metadata: { aglyn_scope: 'connect' },
  enabled_events: [...CONNECT_WEBHOOK_EVENTS],
  ...overrides,
})

/** A fully healthy account: one delivery, delivered first try, handled. */
const healthy = (overrides = {}) => ({
  endpoints: [endpoint(), connectEndpoint()],
  events: [event('evt_ok', 'invoice.paid')],
  failedEventIds: [],
  processedEvents: [processedAfter('evt_ok')],
  firestoreChecked: true,
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  ...overrides,
})

const levelOf = (result, check) =>
  result.findings.find((finding) => finding.check === check)?.level

test('the happy path is green, and every check actually ran', () => {
  const result = assessWebhookHealth(healthy())
  assert.equal(result.ok, true)
  assert.equal(result.summary.errorRate, 0)
  assert.equal(result.summary.deliverableEvents, 1)
  assert.equal(result.summary.unprocessedEvents, 0)
  for (const check of [
    'endpoint.count',
    'endpoint.status',
    'endpoint.url',
    'endpoint.events',
    'connect.endpoint',
    'connect.events',
    'delivery.evidence',
    'delivery.failures',
    'delivery.retries',
    'processing.coverage',
  ]) {
    assert.equal(levelOf(result, check), 'pass', `${check} did not run green`)
  }
})

test('AGL-1551 replayed: deliveries attempted, none handled → RED', () => {
  // The real shape. Three attempts of one subscribed-type event, all 400
  // `Invalid signature`, so `route.ts` returned before the idempotency claim
  // and `stripeEvents` stayed empty. Stripe's account-wide `delivery_success`
  // is NOT relied on here — it is passed as clean on purpose, so the failure
  // has to come from the Firestore cross-check alone.
  const result = assessWebhookHealth(
    healthy({
      events: [event('evt_1U49Xt', 'customer.subscription.updated')],
      failedEventIds: [],
      processedEvents: [],
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'processing.coverage'), 'fail')
  assert.equal(levelOf(result, 'delivery.failures'), 'pass')
  assert.equal(result.summary.unprocessedEvents, 1)
  assert.equal(result.summary.processingGapRate, 1)
})

// ---------------------------------------------------------------------------
// delivery.retries — the arm that reconciles this audit with the Dashboard.
//
// On 2026-08-18 this audit reported 0.00% for `we_1TuaNvDYHP4psn7hmNkYMbEU`
// while the Stripe Dashboard reported 30% (Total 10 / Failed 3) for the same
// destination over an overlapping window. Both were right. This audit's
// denominator is EVENTS scored on their final delivery state; the Dashboard's
// is delivery ATTEMPTS. `delivery_success=false` is terminal-only, so the
// three failed attempts — all of them the AGL-1551 event, 400ing before the
// signing secret was repaired — were invisible to every arm the audit had.
//
// These tests pin the real numbers, so the reconciliation cannot be forgotten
// and re-derived as a regression the next time someone reads two dashboards.

test('the 2026-08-14 shape: an event that only landed on a retry goes RED', () => {
  // `evt_1U49XtDYHP4psn7hA9VHPnZz`, verbatim from the live account.
  // Stripe created it 2026-08-14T01:04:29Z; AGL-1551 records three 400
  // `Invalid signature` attempts; the `stripeEvents` stamp is
  // 2026-08-14T05:42:14Z — 16,665s later, two minutes before AGL-1551 was
  // closed. Stripe's own `delivery_success` calls this event a success,
  // because in the end it was one, so `failedEventIds` is passed EMPTY on
  // purpose: the red has to come from the lag alone.
  const created = Math.floor(Date.parse('2026-08-14T01:04:29Z') / 1000)
  const landed = Math.floor(Date.parse('2026-08-14T05:42:14Z') / 1000)
  assert.equal(landed - created, 16_665, 'the real lag, restated')
  const result = assessWebhookHealth(
    healthy({
      events: [
        { id: 'evt_1U49Xt', type: 'customer.subscription.updated', created },
      ],
      failedEventIds: [],
      processedEvents: [{ id: 'evt_1U49Xt', receivedAt: landed }],
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'delivery.retries'), 'fail')
  // The two arms that reported this destination healthy still do. That is the
  // point: neither was lying, and neither could see this.
  assert.equal(levelOf(result, 'delivery.failures'), 'pass')
  assert.equal(levelOf(result, 'processing.coverage'), 'pass')
  assert.equal(result.summary.errorRate, 0)
  assert.equal(result.summary.retriedEvents, 1)
  assert.equal(result.summary.maxDeliveryLagSeconds, 16_665)
  const finding = result.findings.find((f) => f.check === 'delivery.retries')
  assert.deepEqual(finding.detail, [
    {
      id: 'evt_1U49Xt',
      type: 'customer.subscription.updated',
      lagSeconds: 16_665,
      created: '2026-08-14T01:04:29.000Z',
      receivedAt: '2026-08-14T05:42:14.000Z',
    },
  ])
})

test('the retry threshold has a real boundary, both sides of it', () => {
  const under = assessWebhookHealth(
    healthy({ processedEvents: [processedAfter('evt_ok', RETRY_LAG_SECONDS)] }),
  )
  assert.equal(levelOf(under, 'delivery.retries'), 'pass')
  assert.equal(under.ok, true)

  const over = assessWebhookHealth(
    healthy({ processedEvents: [processedAfter('evt_ok', RETRY_LAG_SECONDS + 1)] }),
  )
  assert.equal(levelOf(over, 'delivery.retries'), 'fail')
  assert.equal(over.ok, false)
})

test('ids without receivedAt stamps read unknown, never pass', () => {
  // The pre-fix caller shape: `.exists` only, no stamp. It must not be able to
  // report a clean bill of health on a question it did not ask — that is the
  // AGL-1906 defect itself, one level down.
  const result = assessWebhookHealth({
    ...healthy(),
    processedEvents: undefined,
    processedEventIds: ['evt_ok'],
  })
  assert.equal(levelOf(result, 'delivery.retries'), 'unknown')
  assert.equal(levelOf(result, 'processing.coverage'), 'pass')
  assert.equal(result.ok, false)
  assert.equal(result.summary.retriedEvents, null)
})

test('a document carrying no receivedAt reads unknown, not pass', () => {
  const result = assessWebhookHealth(
    healthy({ processedEvents: [{ id: 'evt_ok', receivedAt: null }] }),
  )
  assert.equal(levelOf(result, 'delivery.retries'), 'unknown')
  assert.equal(result.ok, false)
})

test('a retried delivery is not double-reported as a processing gap', () => {
  // It has a document, so `processing.coverage` is satisfied; the failure
  // belongs to `delivery.retries` and only there.
  const result = assessWebhookHealth(
    healthy({ processedEvents: [processedAfter('evt_ok', 4000)] }),
  )
  assert.equal(levelOf(result, 'delivery.retries'), 'fail')
  assert.equal(levelOf(result, 'processing.coverage'), 'pass')
  assert.equal(result.summary.unprocessedEvents, 0)
})

test('the error rate carries its own denominator, spelled out', () => {
  // AGL-1906 reported "0.00% error rate" and it was read as the Dashboard's.
  // The basis travels with the number so the two cannot be conflated again.
  const result = assessWebhookHealth(healthy())
  assert.equal(result.summary.errorRate, 0)
  assert.equal(result.summary.errorRateBasis.denominatorValue, 1)
  assert.equal(result.summary.errorRateBasis.numeratorValue, 0)
  assert.equal(result.summary.errorRateBasis.countsRetriedAttempts, false)
  assert.match(result.summary.errorRateBasis.denominator, /subscribed type/)
  assert.match(result.summary.errorRateBasis.notComparableTo, /ATTEMPTS/)
})

test('an empty window cannot pass — 0% over zero deliveries is not evidence', () => {
  const result = assessWebhookHealth(
    healthy({ events: [], processedEvents: [] }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'delivery.evidence'), 'fail')
  // And the error rate is null, not a flattering zero.
  assert.equal(result.summary.errorRate, null)
})

test('an unsubscribed event type is not counted as a delivery', () => {
  // `product.updated` reaches no destination, so it can neither succeed nor
  // fail. Counting it would manufacture evidence out of dashboard edits.
  const result = assessWebhookHealth(
    healthy({ events: [event('evt_prod', 'product.updated')], processedEvents: [] }),
  )
  assert.equal(result.summary.totalEvents, 1)
  assert.equal(result.summary.deliverableEvents, 0)
  assert.equal(levelOf(result, 'delivery.evidence'), 'fail')
})

test('Stripe-reported delivery failures go RED', () => {
  const result = assessWebhookHealth(
    healthy({ failedEventIds: ['evt_ok'] }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'delivery.failures'), 'fail')
  assert.equal(result.summary.errorRate, 1)
})

test('a skipped Firestore arm reads unknown, never pass', () => {
  const result = assessWebhookHealth(
    healthy({ firestoreChecked: false, processedEvents: [] }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'processing.coverage'), 'unknown')
  assert.equal(result.summary.unprocessedEvents, null)
})

test('a disabled destination goes RED', () => {
  const result = assessWebhookHealth(
    healthy({ endpoints: [endpoint({ status: 'disabled' })] }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'endpoint.status'), 'fail')
})

test('a destination pointing somewhere else goes RED', () => {
  const result = assessWebhookHealth(
    healthy({ endpoints: [endpoint({ url: 'https://staging.example.com/hook' })] }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'endpoint.url'), 'fail')
})

test('an unsubscribed required event goes RED (the AGL-1798 shape)', () => {
  const result = assessWebhookHealth(
    healthy({
      endpoints: [
        endpoint({
          enabled_events: WEBHOOK_EVENTS.filter((e) => e !== 'charge.refunded'),
        }),
      ],
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'endpoint.events'), 'fail')
  const finding = result.findings.find((f) => f.check === 'endpoint.events')
  assert.deepEqual(finding.detail, ['charge.refunded'])
})

test('a second live endpoint goes RED — account-wide signals stop being attributable', () => {
  const result = assessWebhookHealth(
    healthy({ endpoints: [endpoint(), endpoint({ id: 'we_other' })] }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'endpoint.count'), 'fail')
})

test('no live endpoint at all goes RED on every endpoint check', () => {
  const result = assessWebhookHealth(healthy({ endpoints: [] }))
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'endpoint.count'), 'fail')
  assert.equal(levelOf(result, 'endpoint.status'), 'fail')
  assert.equal(levelOf(result, 'endpoint.url'), 'fail')
  assert.equal(levelOf(result, 'endpoint.events'), 'fail')
})

test('events outside the window are excluded from both numerator and denominator', () => {
  const result = assessWebhookHealth(
    healthy({
      events: [
        event('evt_ok', 'invoice.paid'),
        event('evt_old', 'invoice.paid', WINDOW_START - 1),
        event('evt_new', 'invoice.paid', WINDOW_END + 1),
      ],
      failedEventIds: ['evt_old', 'evt_new'],
    }),
  )
  assert.equal(result.ok, true)
  assert.equal(result.summary.deliverableEvents, 1)
  assert.equal(result.summary.errorRate, 0)
})

test('the per-type decomposition separates attempts, failures and processing gaps', () => {
  const result = assessWebhookHealth(
    healthy({
      events: [
        event('a1', 'invoice.paid'),
        event('a2', 'invoice.paid'),
        event('b1', 'charge.refunded'),
      ],
      failedEventIds: ['a2'],
      processedEvents: [processedAfter('a1')],
    }),
  )
  assert.deepEqual(result.summary.byType, {
    'charge.refunded': { attempted: 1, failed: 0, unprocessed: 1 },
    'invoice.paid': { attempted: 2, failed: 1, unprocessed: 1 },
  })
  assert.equal(result.summary.errorRate, 1 / 3)
  assert.equal(result.summary.processingGapRate, 2 / 3)
})

test('a catch-all `*` subscription satisfies the required set', () => {
  const result = assessWebhookHealth(
    healthy({
      endpoints: [endpoint({ enabled_events: ['*'] }), connectEndpoint()],
    }),
  )
  assert.equal(levelOf(result, 'endpoint.events'), 'pass')
  assert.equal(result.ok, true)
})

test('the required event list carries the ten the platform destination needs', () => {
  // A guard on the list itself: AGL-1798 was a MISSING entry, so a silent
  // shrink here would quietly narrow every assertion above.
  assert.equal(WEBHOOK_EVENTS.length, 10)
  assert.equal(new Set(WEBHOOK_EVENTS).size, 10)
  for (const required of [
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.closed',
    'invoice.payment_failed',
    'checkout.session.completed',
  ]) {
    assert.ok(WEBHOOK_EVENTS.includes(required), `${required} missing`)
  }
})

// ---------------------------------------------------------------------------
// The Connect destination (AGL-2122).
//
// Every check below is given the input that makes it fail, because the whole
// reason this gap survived is that no check could ever report it: the audit
// demanded exactly ONE destination account-wide, so the state where the
// Connect destination is missing was indistinguishable from the state where
// everything is correct — and was in fact the LIVE state on 2026-08-18.

test('no Connect destination → RED, and it says what stops working', () => {
  const result = assessWebhookHealth(healthy({ endpoints: [endpoint()] }))
  assert.equal(levelOf(result, 'connect.endpoint'), 'fail')
  assert.equal(levelOf(result, 'connect.events'), 'fail')
  assert.equal(result.ok, false)
  const finding = result.findings.find((f) => f.check === 'connect.endpoint')
  // Naming the consequence, not just the absence — this is the exact live
  // state, and "1 destination, all events subscribed" read as healthy.
  assert.match(finding.message, /stripeChargesEnabled/)
})

test('the platform destination alone still passes ITS own checks', () => {
  // The two failures must stay separable: a missing Connect destination is
  // not evidence that platform billing is broken, and reporting it as such
  // would train the reader to ignore the red.
  const result = assessWebhookHealth(healthy({ endpoints: [endpoint()] }))
  assert.equal(levelOf(result, 'endpoint.count'), 'pass')
  assert.equal(levelOf(result, 'endpoint.events'), 'pass')
})

test('an UNSTAMPED Connect destination reads as a second account one → RED', () => {
  // The failure mode of the stamp itself. Adding the destination in the
  // dashboard without the metadata key leaves the audit unable to see it, and
  // it must fail loudly rather than be silently ignored.
  const result = assessWebhookHealth(
    healthy({
      endpoints: [
        endpoint(),
        connectEndpoint({ metadata: {} }),
      ],
    }),
  )
  assert.equal(levelOf(result, 'endpoint.count'), 'fail')
  assert.equal(levelOf(result, 'connect.endpoint'), 'fail')
})

test('a Connect destination missing account.updated → RED', () => {
  const result = assessWebhookHealth(
    healthy({
      endpoints: [endpoint(), connectEndpoint({ enabled_events: [] })],
    }),
  )
  assert.equal(levelOf(result, 'connect.endpoint'), 'pass')
  assert.equal(levelOf(result, 'connect.events'), 'fail')
  assert.equal(result.ok, false)
})

test('a DISABLED Connect destination → RED even with the event subscribed', () => {
  const result = assessWebhookHealth(
    healthy({
      endpoints: [endpoint(), connectEndpoint({ status: 'disabled' })],
    }),
  )
  assert.equal(levelOf(result, 'connect.events'), 'fail')
})

test('account.updated must NOT be in the platform list', () => {
  // Putting it there is the plausible wrong fix: it subscribes the PLATFORM's
  // own account, `syncConnectAccountStatus` matches no profile, and every
  // check goes green over an unchanged fail-open.
  assert.ok(!WEBHOOK_EVENTS.includes('account.updated'))
  assert.ok(CONNECT_WEBHOOK_EVENTS.includes('account.updated'))
})

// ---------------------------------------------------------------------------
// resolveWindow — the window must never be reported wider than its data.
//
// The first version of this audit printed "2026-07-18 → now" for `--days 365`
// while `GET /v1/events` had only returned data back to 2026-07-19: Stripe
// keeps 30 days and drops the rest with no error and no marker. A header
// overstating its own evidence is the defect AGL-1906 is about, so it gets
// the same treatment as everything else here — a test that fails without it.

const DAY = 86_400

test('a window wider than Stripe retention is clamped, and says so', () => {
  const now = 1_800_000_000
  const { start, clamps } = resolveWindow({
    requestedStart: now - 365 * DAY,
    end: now,
    endpointCreated: now - 400 * DAY,
    now,
  })
  assert.equal(start, now - EVENT_RETENTION_DAYS * DAY)
  assert.deepEqual(clamps, ['stripe-event-retention'])
})

test('a window inside retention is left alone and reports no clamp', () => {
  const now = 1_800_000_000
  const { start, clamps } = resolveWindow({
    requestedStart: now - 7 * DAY,
    end: now,
    endpointCreated: now - 400 * DAY,
    now,
  })
  assert.equal(start, now - 7 * DAY)
  assert.deepEqual(clamps, [])
})

test('a destination newer than the retention floor clamps to its creation', () => {
  const now = 1_800_000_000
  const { start, clamps } = resolveWindow({
    requestedStart: now - 365 * DAY,
    end: now,
    endpointCreated: now - 3 * DAY,
    now,
  })
  assert.equal(start, now - 3 * DAY)
  assert.deepEqual(clamps, ['endpoint-creation'])
})

test('both floors can apply, and both are named', () => {
  // Destination created 90 days ago: older than retention, newer than the ask.
  const now = 1_800_000_000
  const { start, clamps } = resolveWindow({
    requestedStart: now - 365 * DAY,
    end: now,
    endpointCreated: now - 90 * DAY,
    now,
  })
  assert.equal(start, now - EVENT_RETENTION_DAYS * DAY)
  assert.deepEqual(clamps, ['endpoint-creation', 'stripe-event-retention'])
})

test('an unknown destination creation date still respects retention', () => {
  const now = 1_800_000_000
  const { start, clamps } = resolveWindow({
    requestedStart: now - 365 * DAY,
    end: now,
    endpointCreated: null,
    now,
  })
  assert.equal(start, now - EVENT_RETENTION_DAYS * DAY)
  assert.deepEqual(clamps, ['stripe-event-retention'])
})

// ---------------------------------------------------------------------------
// Mode matching. A test-mode key lists only `livemode: false` endpoints, so a
// hard-coded live filter reported "no destination" and the audit could not be
// pointed at the test endpoint at all — which is where a real gap was hiding
// (three money-reversal events unsubscribed).

test('a test-mode key assesses the test-mode endpoint', () => {
  const result = assessWebhookHealth(
    healthy({
      endpoints: [
        endpoint({ livemode: false }),
        connectEndpoint({ livemode: false }),
      ],
      expectLivemode: false,
    }),
  )
  assert.equal(levelOf(result, 'endpoint.count'), 'pass')
  assert.equal(result.ok, true)
})

test('a live-mode key ignores test-mode endpoints, and vice versa', () => {
  const both = [endpoint({ id: 'we_live' }), endpoint({ id: 'we_test', livemode: false })]
  const asLive = assessWebhookHealth(healthy({ endpoints: both, expectLivemode: true }))
  const asTest = assessWebhookHealth(healthy({ endpoints: both, expectLivemode: false }))
  assert.equal(levelOf(asLive, 'endpoint.count'), 'pass')
  assert.equal(levelOf(asTest, 'endpoint.count'), 'pass')
  assert.equal(
    asLive.findings.find((f) => f.check === 'endpoint.count').detail.id,
    'we_live',
  )
  assert.equal(
    asTest.findings.find((f) => f.check === 'endpoint.count').detail.id,
    'we_test',
  )
})

test('a live-mode key finding only test endpoints goes RED', () => {
  const result = assessWebhookHealth(
    healthy({ endpoints: [endpoint({ livemode: false })], expectLivemode: true }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'endpoint.count'), 'fail')
})
