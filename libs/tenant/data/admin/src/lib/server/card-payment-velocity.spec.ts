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
 * Card-testing velocity on a visitor's payment door (AGL-3363).
 *
 * Driven through the real durable counter (`consumeRateLimit`) over a
 * Firestore stand-in, so a refusal here is a counter that actually crossed
 * its cap. The false-positive guards matter as much as the refusals: a
 * shopper who opens checkout a few times, and a busy shop whose many
 * shoppers each open it once, must never be refused.
 */

import { CARD_PAYMENT_VELOCITY } from '@aglyn/aglyn/app-utils/card-payment-velocity'
import {
  cardPaymentAlarmReviewId,
  cardPaymentVelocityRefusal,
  resetCardPaymentAlarmsForTests,
} from './card-payment-velocity'
import { resetRateLimitDegradationForTests } from './rate-limit-store'

function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        set: async (value: Record<string, unknown>) => {
          const prior = docs.get(`${name}/${id}`) ?? {}
          const next: Record<string, unknown> = { ...prior }
          for (const [field, raw] of Object.entries(value)) {
            const operand = (raw as { operand?: unknown })?.operand
            next[field] =
              typeof operand === 'number' ? (Number(prior[field]) || 0) + operand : raw
          }
          docs.set(`${name}/${id}`, next)
        },
        get: async () => ({
          exists: docs.has(`${name}/${id}`),
          get: (field: string) => docs.get(`${name}/${id}`)?.[field],
        }),
      }),
    }),
  }
}

const NOW = 1_700_000_000_000

function from(ip: string) {
  return { headers: { get: (name: string) => (name === 'x-forwarded-for' ? ip : null) } }
}

beforeEach(() => {
  resetRateLimitDegradationForTests()
  resetCardPaymentAlarmsForTests()
})

async function open(
  firestore: ReturnType<typeof fakeFirestore>,
  input: {
    hostId: string
    ip: string
    young?: boolean
    notify?: jest.Mock
    notifyManagers?: jest.Mock
  },
) {
  return cardPaymentVelocityRefusal({
    path: 'commerce/checkout',
    hostId: input.hostId,
    orgId: 'org-1',
    young: input.young,
    request: from(input.ip),
    nowMs: NOW,
    firestore,
    notify: input.notify ?? jest.fn(async () => undefined),
    notifyManagers: input.notifyManagers ?? jest.fn(async () => undefined),
  })
}

describe('cardPaymentVelocityRefusal', () => {
  it('lets a shopper open checkout several times (false-positive guard)', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await open(firestore, { hostId: 'shop', ip: '203.0.113.7' })).toBeNull()
    }
  })

  it('refuses one address past the per-visitor window, with Retry-After', async () => {
    const firestore = fakeFirestore()
    const { limit } = CARD_PAYMENT_VELOCITY.perVisitor
    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect(await open(firestore, { hostId: 'shop', ip: '198.51.100.9' })).toBeNull()
    }
    const refused = await open(firestore, { hostId: 'shop', ip: '198.51.100.9' })
    expect(refused?.status).toBe(429)
    expect(Number(refused?.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Another shopper on the same site is untouched.
    expect(await open(firestore, { hostId: 'shop', ip: '198.51.100.10' })).toBeNull()
  })

  it('holds a young workspace to the tighter per-visitor window', async () => {
    const firestore = fakeFirestore()
    const { limit } = CARD_PAYMENT_VELOCITY.perVisitorYoung
    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect(
        await open(firestore, { hostId: 'new-shop', ip: '192.0.2.4', young: true }),
      ).toBeNull()
    }
    const refused = await open(firestore, { hostId: 'new-shop', ip: '192.0.2.4', young: true })
    expect(refused?.status).toBe(429)
  })

  it('refuses one address rotating across many shops', async () => {
    const firestore = fakeFirestore()
    const { limit } = CARD_PAYMENT_VELOCITY.perAddress
    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect(
        await open(firestore, { hostId: `shop-${attempt}`, ip: '203.0.113.99' }),
      ).toBeNull()
    }
    const refused = await open(firestore, { hostId: 'shop-next', ip: '203.0.113.99' })
    expect(refused?.status).toBe(429)
  })

  it('never refuses a busy site, and files ONE staff row when it crosses the site window', async () => {
    const firestore = fakeFirestore()
    const notify = jest.fn(async () => undefined)
    const notifyManagers = jest.fn(async () => undefined)
    const { limit } = CARD_PAYMENT_VELOCITY.perSite
    // Every shopper a distinct address, each opening checkout once.
    for (let shopper = 0; shopper < limit + 20; shopper += 1) {
      const ip = `10.${Math.floor(shopper / 250)}.${shopper % 250}.1`
      expect(await open(firestore, { hostId: 'busy', ip, notify, notifyManagers })).toBeNull()
    }
    const rowId = cardPaymentAlarmReviewId('busy', new Date(NOW).toISOString().slice(0, 10))
    const row = firestore.docs.get(`abuseReports/${rowId}`)
    expect(row).toBeDefined()
    expect(row?.['source']).toBe('payment-velocity')
    expect(row?.['severity']).toBe('urgent')
    expect(row?.['hostId']).toBe('busy')
    expect(row?.['orgId']).toBe('org-1')
    expect(notify).toHaveBeenCalledTimes(1)
    // The merchant is told too, once, and never the rule or its numbers.
    expect(notifyManagers).toHaveBeenCalledTimes(1)
    const [hostId, payload] = notifyManagers.mock.calls[0] as unknown as [
      string,
      { title: string; body: string },
    ]
    expect(hostId).toBe('busy')
    const told = `${payload.title} ${payload.body}`.replace(/PV-[0-9A-F]+/, '')
    expect(told).not.toMatch(/\d/)
  })

  it('files nothing for a site under its window', async () => {
    const firestore = fakeFirestore()
    const notify = jest.fn(async () => undefined)
    for (let shopper = 0; shopper < 20; shopper += 1) {
      await open(firestore, { hostId: 'calm', ip: `10.1.${shopper}.1`, notify })
    }
    expect([...firestore.docs.keys()].some((key) => key.startsWith('abuseReports/'))).toBe(
      false,
    )
    expect(notify).not.toHaveBeenCalled()
  })
})
