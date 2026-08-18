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
  PLATFORM_WEBHOOK_URL,
  WEBHOOK_EVENTS,
  assessWebhookHealth,
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

/** A fully healthy account: one delivery, delivered, handled. */
const healthy = (overrides = {}) => ({
  endpoints: [endpoint()],
  events: [event('evt_ok', 'invoice.paid')],
  failedEventIds: [],
  processedEventIds: ['evt_ok'],
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
    'delivery.evidence',
    'delivery.failures',
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
      processedEventIds: [],
    }),
  )
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'processing.coverage'), 'fail')
  assert.equal(levelOf(result, 'delivery.failures'), 'pass')
  assert.equal(result.summary.unprocessedEvents, 1)
  assert.equal(result.summary.processingGapRate, 1)
})

test('an empty window cannot pass — 0% over zero deliveries is not evidence', () => {
  const result = assessWebhookHealth(
    healthy({ events: [], processedEventIds: [] }),
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
    healthy({ events: [event('evt_prod', 'product.updated')], processedEventIds: [] }),
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
    healthy({ firestoreChecked: false, processedEventIds: [] }),
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
      processedEventIds: ['a1'],
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
    healthy({ endpoints: [endpoint({ enabled_events: ['*'] })] }),
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
