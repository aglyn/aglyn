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
 * Stripe's fraud signals reach the merchant on the BOOKING they are about
 * (AGL-3360).
 *
 * A paid booking is a destination charge to the merchant's connected
 * account, and until now none of an issuer's early fraud warning, a Radar
 * review or a chargeback reached the bookings plugin: the merchant heard
 * from Stripe alone, and a booking chargeback reached only staff, as an
 * "unattributed" dispute. Each now stamps the shared `paymentRisk` field on
 * the booking and tells the site's managers once; nothing is refunded.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bookingsBillingWebhookHandler } from './billing-webhook'

const docs = new Map<string, Record<string, any>>()
let lookupFailure: { code: number } | null = null

function makeDocRef(path: string): any {
  const segments = path.split('/')
  return {
    id: segments[segments.length - 1],
    path,
    parent: {
      parent: segments.length > 2 ? { id: segments[segments.length - 3] } : null,
    },
    get: async () => makeSnapshot(path),
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
      docs.set(path, { ...docs.get(path), ...value })
    },
  }
}

function makeSnapshot(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: makeDocRef(path),
  }
}

function collectionGroup(name: string): any {
  const query = (filters: Array<[string, unknown]>, max?: number): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query([...filters, [field, value]], max),
    limit: (count: number) => query(filters, count),
    get: async () => {
      if (lookupFailure) throw Object.assign(new Error('index'), lookupFailure)
      const matched = [...docs.keys()]
        .filter((key) => key.split('/').slice(-2, -1)[0] === name)
        .filter((key) => filters.every(([field, value]) => docs.get(key)?.[field] === value))
        .map(makeSnapshot)
      const docsOut = max == null ? matched : matched.slice(0, max)
      return { docs: docsOut, empty: docsOut.length === 0 }
    },
  })
  return query([])
}

const fakeFirestore = {
  collectionGroup,
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      update: (ref: any, value: any) => {
        void ref.update(value)
      },
    }),
}

const managerNotices: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldValue: { serverTimestamp: () => '<now>' } },
  },
  notifyHostManagers: async (hostId: string, payload: any) => {
    managerNotices.push({ hostId, ...payload })
  },
}))
jest.mock('@aglyn/tenant-runtime', () => ({ captureHostContact: async () => undefined }))
jest.mock('@aglyn/shared-util-email', () => ({ sendEmail: async () => undefined }))
jest.mock('next/server', () => ({ after: (work: () => unknown) => work() }))
jest.mock('./booking-crm', () => ({ fileBookingOnCrm: async () => undefined }))

const BOOKING = 'hosts/host-1/bookings/booking-1'
const booking = () => docs.get(BOOKING) ?? {}

const deliver = (type: string, object: Record<string, unknown>) =>
  bookingsBillingWebhookHandler({ type, object, event: { id: `evt_${type}` } } as any)

const fetchMock = jest.fn(async () => {
  throw new Error('no Stripe call is allowed here')
})

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  managerNotices.length = 0
  lookupFailure = null
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  docs.set(BOOKING, {
    serviceName: 'Deep tissue massage',
    status: 'confirmed',
    paymentIntentId: 'pi_booking_1',
    paidAmountCents: 9000,
  })
})

afterEach(() => jest.restoreAllMocks())

describe('fraud signals on a paid booking (AGL-3360)', () => {
  it('an early fraud warning stamps the booking and tells the site’s managers', async () => {
    await expect(
      deliver('radar.early_fraud_warning.created', {
        id: 'issfr_b1',
        charge: 'ch_b1',
        payment_intent: 'pi_booking_1',
        fraud_type: 'made_with_stolen_card',
      }),
    ).resolves.toEqual({ claimed: true, hostId: 'host-1' })
    expect(booking().paymentRisk).toMatchObject({
      latestKind: 'early-fraud-warning',
      signals: [expect.objectContaining({ stripeObjectId: 'issfr_b1' })],
    })
    expect(managerNotices).toEqual([
      expect.objectContaining({
        hostId: 'host-1',
        type: 'content.booking',
        link: '/host-1/bookings',
      }),
    ])
    expect(managerNotices[0].body).toContain('Booking Deep tissue massage')
    expect(managerNotices[0].body).toContain('has not refunded or canceled')
    // Nothing moved.
    expect(booking()).toMatchObject({ status: 'confirmed', paidAmountCents: 9000 })
    expect(booking()).not.toHaveProperty('refundedCents')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a dispute is stamped and told once, then its outcome is recorded', async () => {
    const dispute = {
      id: 'du_b1',
      charge: 'ch_b1',
      payment_intent: 'pi_booking_1',
      amount: 9000,
      reason: 'fraudulent',
    }
    await deliver('charge.dispute.created', dispute)
    await deliver('charge.dispute.created', dispute)
    expect(managerNotices).toHaveLength(1)
    expect(managerNotices[0]).toMatchObject({ title: 'A payment was disputed' })

    await expect(
      deliver('charge.dispute.closed', { ...dispute, status: 'won' }),
    ).resolves.toEqual({ claimed: true, hostId: 'host-1' })
    expect(booking().paymentRisk.signals[0]).toMatchObject({
      stripeObjectId: 'du_b1',
      outcome: 'won',
    })
  })

  it('a LOST booking dispute is recorded but left unclaimed, so staff still hear of it', async () => {
    const dispute = { id: 'du_b2', payment_intent: 'pi_booking_1', amount: 9000 }
    await deliver('charge.dispute.created', dispute)
    await expect(
      deliver('charge.dispute.closed', { ...dispute, status: 'lost' }),
    ).resolves.toBeUndefined()
    expect(booking().paymentRisk.signals[0]).toMatchObject({ outcome: 'lost' })
  })

  it('a signal on a payment that is no booking’s is left alone', async () => {
    await expect(
      deliver('review.opened', { id: 'prv_x', payment_intent: 'pi_other' }),
    ).resolves.toBeUndefined()
    expect(booking()).not.toHaveProperty('paymentRisk')
    expect(managerNotices).toEqual([])
  })

  it('a missing index is logged, not thrown into an endless redelivery', async () => {
    lookupFailure = { code: 9 }
    await expect(
      deliver('radar.early_fraud_warning.created', {
        id: 'issfr_b9',
        payment_intent: 'pi_booking_1',
      }),
    ).resolves.toBeUndefined()
  })

  it('the lookup is served by a declared COLLECTION_GROUP index', () => {
    const indexes = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
        'utf8',
      ),
    ) as {
      fieldOverrides: Array<{
        collectionGroup: string
        fieldPath: string
        indexes: Array<{ queryScope: string; order?: string }>
      }>
    }
    const override = indexes.fieldOverrides.find(
      (entry) =>
        entry.collectionGroup === 'bookings' && entry.fieldPath === 'paymentIntentId',
    )
    expect(override?.indexes).toContainEqual({
      queryScope: 'COLLECTION_GROUP',
      order: 'ASCENDING',
    })
  })
})
