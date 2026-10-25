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

import { memoryFirestore } from '../testing/pos-ops-memory-firestore'
import { reconcilePosOfflineCardEvent } from './pos-offline-card-reconcile'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

/**
 * A card taken offline on the app reader (AGL-4039) can reach Stripe before
 * its sale reaches the server; every event on such an intent is kept on the
 * site by the sale key, so a charge whose sale never syncs is not invisible.
 */

const KEY = 'off8f2f9807c22c4fe3b1ed9042c497949d'

const event = (type: string, overrides: Record<string, unknown> = {}) => ({
  type,
  object: {
    id: 'pi_3Q0abcdEFGH12345',
    status: 'requires_capture',
    amount: 2479,
    livemode: false,
    metadata: {
      kind: 'pos-offline',
      saleKey: KEY,
      hostId: 'shop',
      orgId: 'org-1',
      registerId: 'front',
    },
    ...overrides,
  },
})

describe('reconcilePosOfflineCardEvent', () => {
  it('keeps the charge by its sale key, and whether the sale has synced', async () => {
    const memory = memoryFirestore()
    expect(
      await reconcilePosOfflineCardEvent(
        event('payment_intent.amount_capturable_updated'),
        memory.firestore,
        () => 5,
      ),
    ).toEqual({
      hostId: 'shop',
    })
    expect(
      memory.read(`hosts/shop/terminal/config/offlineCardCharges/${KEY}`),
    ).toEqual({
      saleKey: KEY,
      paymentIntentId: 'pi_3Q0abcdEFGH12345',
      status: 'requires_capture',
      amountCents: 2479,
      registerId: 'front',
      livemode: false,
      synced: false,
      lastEvent: 'payment_intent.amount_capturable_updated',
      updatedAtMs: 5,
    })
    memory.seed(`hosts/shop/posOfflineSales/${KEY}`, { saleKey: KEY })
    await reconcilePosOfflineCardEvent(
      event('payment_intent.succeeded', { status: 'succeeded' }),
      memory.firestore,
    )
    expect(
      memory.read(`hosts/shop/terminal/config/offlineCardCharges/${KEY}`),
    ).toMatchObject({ status: 'succeeded', synced: true })
  })

  it('leaves every other event alone', async () => {
    const memory = memoryFirestore()
    const online = event('payment_intent.succeeded', {
      metadata: { kind: 'pos', hostId: 'shop' },
    })
    expect(
      await reconcilePosOfflineCardEvent(online, memory.firestore),
    ).toBeNull()
    expect(
      await reconcilePosOfflineCardEvent(
        { type: 'charge.refunded', object: {} },
        memory.firestore,
      ),
    ).toBeNull()
    const forged = event('payment_intent.succeeded', {
      metadata: { kind: 'pos-offline', hostId: '../x', saleKey: KEY },
    })
    expect(
      await reconcilePosOfflineCardEvent(forged, memory.firestore),
    ).toBeNull()
    expect(memory.docs.size).toBe(0)
  })
})

describe('posOfflineCardBillingWebhookHandler', () => {
  it('claims only an offline card intent', async () => {
    const { posOfflineCardBillingWebhookHandler } =
      await import('./pos-offline-card-reconcile')
    expect(
      await posOfflineCardBillingWebhookHandler({
        type: 'charge.refunded',
        object: {},
      } as any),
    ).toBeUndefined()
  })
})
