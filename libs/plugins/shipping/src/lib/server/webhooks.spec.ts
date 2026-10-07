/**
 * @jest-environment node
 */
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

import { createHmac } from 'node:crypto'
import { easypostTrackingStatus, shippoTrackingStatus } from '../model/tracking-status'
import { verifyEasypostWebhook, verifyShippoWebhook } from './webhooks'

/**
 * A webhook is read only once verified, and every status maps to the
 * carrier-neutral word or to nothing.
 */

const SHIPPO_EVENT = JSON.stringify({
  event: 'track_updated',
  test: false,
  data: {
    carrier: 'usps',
    tracking_number: '9205590164917312751089',
    tracking_status: {
      status: 'TRANSIT',
      substatus: { code: 'out_for_delivery', text: 'Out for delivery' },
      status_details: 'Out for delivery, expected today',
      status_date: '2026-10-06T14:00:00Z',
    },
  },
})

describe('Shippo webhooks', () => {
  const secrets = { token: 'tok_shippo_123', hmacSecret: '' }

  it('refuses everything when no token is configured', () => {
    expect(verifyShippoWebhook({ rawBody: SHIPPO_EVENT, urlToken: 'x', signatureHeader: null, secrets: { token: '', hmacSecret: '' } })).toEqual({
      ok: false,
      status: 404,
      error: 'Not found',
    })
  })

  it('refuses a wrong or missing URL token', () => {
    expect(verifyShippoWebhook({ rawBody: SHIPPO_EVENT, urlToken: 'tok_shippo_124', signatureHeader: null, secrets })).toMatchObject({ ok: false, status: 401 })
    expect(verifyShippoWebhook({ rawBody: SHIPPO_EVENT, urlToken: null, signatureHeader: null, secrets })).toMatchObject({ ok: false, status: 401 })
  })

  it('reads a verified track_updated into our words', () => {
    const verdict = verifyShippoWebhook({ rawBody: SHIPPO_EVENT, urlToken: 'tok_shippo_123', signatureHeader: null, secrets })
    expect(verdict).toEqual({
      ok: true,
      events: [
        {
          kind: 'tracking',
          providerId: 'shippo',
          trackingNumber: '9205590164917312751089',
          status: 'out_for_delivery',
          detail: 'Out for delivery, expected today',
          atMs: Date.parse('2026-10-06T14:00:00Z'),
          test: false,
        },
      ],
    })
  })

  it('also verifies the HMAC header when a secret is set, within five minutes', () => {
    const withHmac = { token: 'tok_shippo_123', hmacSecret: 'hmac_secret' }
    const t = 1_791_000_000
    const v1 = createHmac('sha256', 'hmac_secret').update(`${t}.${SHIPPO_EVENT}`).digest('hex')
    const nowMs = t * 1000 + 60_000
    expect(
      verifyShippoWebhook({ rawBody: SHIPPO_EVENT, urlToken: 'tok_shippo_123', signatureHeader: `t=${t},v1=${v1}`, secrets: withHmac, nowMs }),
    ).toMatchObject({ ok: true })
    expect(
      verifyShippoWebhook({ rawBody: `${SHIPPO_EVENT} `, urlToken: 'tok_shippo_123', signatureHeader: `t=${t},v1=${v1}`, secrets: withHmac, nowMs }),
    ).toMatchObject({ ok: false, error: 'Bad signature' })
    expect(
      verifyShippoWebhook({
        rawBody: SHIPPO_EVENT,
        urlToken: 'tok_shippo_123',
        signatureHeader: `t=${t},v1=${v1}`,
        secrets: withHmac,
        nowMs: nowMs + 10 * 60_000,
      }),
    ).toMatchObject({ ok: false, error: 'Stale signature' })
    expect(
      verifyShippoWebhook({ rawBody: SHIPPO_EVENT, urlToken: 'tok_shippo_123', signatureHeader: null, secrets: withHmac, nowMs }),
    ).toMatchObject({ ok: false, error: 'Missing signature' })
  })

  it('maps every Shippo status, and an unknown one to nothing', () => {
    expect(shippoTrackingStatus('PRE_TRANSIT')).toBe('pre_transit')
    expect(shippoTrackingStatus('TRANSIT')).toBe('in_transit')
    expect(shippoTrackingStatus('TRANSIT', 'out_for_delivery')).toBe('out_for_delivery')
    expect(shippoTrackingStatus('DELIVERED')).toBe('delivered')
    expect(shippoTrackingStatus('RETURNED')).toBe('returned')
    expect(shippoTrackingStatus('FAILURE')).toBe('exception')
    expect(shippoTrackingStatus('UNKNOWN')).toBeNull()
    expect(shippoTrackingStatus(undefined)).toBeNull()
  })
})

describe('EasyPost webhooks', () => {
  const secret = 'ep_secret_ﬁ'
  const event = JSON.stringify({
    object: 'Event',
    description: 'tracker.updated',
    mode: 'production',
    result: {
      object: 'Tracker',
      tracking_code: 'EZ4000000004',
      status: 'delivered',
      carrier: 'USPS',
      updated_at: '2026-10-06T15:00:00Z',
      tracking_details: [{ message: 'Delivered, front door', datetime: '2026-10-06T14:55:00Z' }],
    },
  })
  const sign = (body: string, key = secret) =>
    `hmac-sha256-hex=${createHmac('sha256', key.normalize('NFKD')).update(body).digest('hex')}`

  it('verifies the signature under the NFKD-normalized secret', () => {
    expect(verifyEasypostWebhook({ rawBody: event, signatureHeader: sign(event), secret })).toEqual({
      ok: true,
      events: [
        {
          kind: 'tracking',
          providerId: 'easypost',
          trackingNumber: 'EZ4000000004',
          status: 'delivered',
          detail: 'Delivered, front door',
          atMs: Date.parse('2026-10-06T14:55:00Z'),
          test: false,
        },
      ],
    })
  })

  it('refuses a missing, wrong or unconfigured signature', () => {
    expect(verifyEasypostWebhook({ rawBody: event, signatureHeader: null, secret })).toMatchObject({ ok: false, status: 401 })
    expect(verifyEasypostWebhook({ rawBody: event, signatureHeader: sign(event, 'other'), secret })).toMatchObject({ ok: false, status: 401 })
    expect(verifyEasypostWebhook({ rawBody: event, signatureHeader: sign(event), secret: '' })).toMatchObject({ ok: false, status: 404 })
  })

  it('reads a refund event', () => {
    const refund = JSON.stringify({
      description: 'refund.successful',
      mode: 'test',
      result: { object: 'Refund', tracking_code: 'EZ4000000004', status: 'refunded' },
    })
    expect(verifyEasypostWebhook({ rawBody: refund, signatureHeader: sign(refund), secret })).toEqual({
      ok: true,
      events: [{ kind: 'refund', providerId: 'easypost', trackingNumber: 'EZ4000000004', refunded: true, test: true }],
    })
  })

  it('maps every EasyPost status', () => {
    expect(easypostTrackingStatus('pre_transit')).toBe('pre_transit')
    expect(easypostTrackingStatus('in_transit')).toBe('in_transit')
    expect(easypostTrackingStatus('available_for_pickup')).toBe('in_transit')
    expect(easypostTrackingStatus('out_for_delivery')).toBe('out_for_delivery')
    expect(easypostTrackingStatus('delivered')).toBe('delivered')
    expect(easypostTrackingStatus('return_to_sender')).toBe('returned')
    expect(easypostTrackingStatus('failure')).toBe('exception')
    expect(easypostTrackingStatus('unknown')).toBeNull()
  })
})
