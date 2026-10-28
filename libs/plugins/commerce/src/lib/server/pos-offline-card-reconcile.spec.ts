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

import { memoryFirestore, memoryFirestoreModule, type MemoryFirestore } from '../testing/pos-ops-memory-firestore'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import { posOfflineSaleTotals, type PosOfflineSale } from '../model/commerce-pos-offline'
import { COMMERCE_OPERATOR_ALERTS } from '../constants/operator-alerts'
import type { PosOfflineCardIntent } from './pos-terminal'
import { handlePosOfflineSync, type PosOfflineSyncDeps } from './pos-offline-sync'
import {
  POS_OFFLINE_CARD_UNSYNCED_ALERT_MS,
  posOfflineCardBillingWebhookHandler,
  reconcilePosOfflineCardEvent,
  scanUnsyncedOfflineCards,
} from './pos-offline-card-reconcile'

/** The store the default report and the registered handler read through `firebaseAdmin`. */
let mockStore: MemoryFirestore | null = null
const mockAlerts: Array<{ type: string; options: any }> = []
const mockManagerNotices: Array<{ hostId: string; payload: any }> = []

jest.mock('firebase-admin/firestore', () =>
  jest.requireActual('../testing/pos-ops-memory-firestore').memoryFirestoreModule,
)
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => mockStore?.firestore }) },
  hostDisplayName: (host: any, hostId: string) => String(host?.displayName ?? '') || hostId,
  raiseOperatorAlert: async (type: any, options: any) => {
    mockAlerts.push({ type: typeof type === 'string' ? type : type.type, options })
    return { outcome: 'sent', type }
  },
  notifyHostManagers: async (hostId: string, payload: any) => {
    mockManagerNotices.push({ hostId, payload })
  },
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))
jest.mock('@aglyn/aglyn/plugin-manager/record-captured-contact', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./order-notifications', () => ({ notifyOrderBuyer: jest.fn() }))
jest.mock('./order-events', () => ({ raiseOrderEvent: jest.fn() }))
jest.mock('./low-stock', () => ({ alertLowStockCrossing: jest.fn() }))
jest.mock('./reserve-stock', () => ({ decrementVariantStock: jest.fn() }))
jest.mock('./pos-sale', () => ({ notifyPosSaleCompleted: jest.fn() }))
jest.mock('./pos-terminal', () => ({}))

void memoryFirestoreModule

/**
 * A card taken offline on the app reader (AGL-4039) can reach Stripe before
 * its sale reaches the server; every event on such an intent is kept on the
 * site by the sale key, the sync marks it synced, and an intent that holds
 * money while its sale never syncs is told to the operator and the site.
 */

const KEY = 'off8f2f9807c22c4fe3b1ed9042c497949d'
const NOW = 1_800_000_000_000
const RECORD = `hosts/shop/terminal/config/offlineCardCharges/${KEY}`
const unlocked = { isLocked: async () => false }

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

beforeEach(() => {
  mockStore = null
  mockAlerts.length = 0
  mockManagerNotices.length = 0
})

describe('reconcilePosOfflineCardEvent', () => {
  it('keeps the charge by its sale key, and starts the clock on one that holds money with no sale', async () => {
    const memory = memoryFirestore()
    expect(
      await reconcilePosOfflineCardEvent(event('payment_intent.amount_capturable_updated'), memory.firestore, () => 5),
    ).toEqual({ hostId: 'shop' })
    expect(memory.read(RECORD)).toEqual({
      hostId: 'shop',
      saleKey: KEY,
      paymentIntentId: 'pi_3Q0abcdEFGH12345',
      status: 'requires_capture',
      amountCents: 2479,
      registerId: 'front',
      livemode: false,
      synced: false,
      lastEvent: 'payment_intent.amount_capturable_updated',
      updatedAtMs: 5,
      alertDueAtMs: 5 + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS,
    })
    // A later event keeps the first clock rather than restarting it.
    await reconcilePosOfflineCardEvent(event('payment_intent.succeeded', { status: 'succeeded' }), memory.firestore, () => 9)
    expect(memory.read(RECORD)).toMatchObject({ status: 'succeeded', alertDueAtMs: 5 + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    // Once the sale has synced, an event says so and stops the clock.
    memory.seed(`hosts/shop/posOfflineSales/${KEY}`, { saleKey: KEY })
    await reconcilePosOfflineCardEvent(event('payment_intent.succeeded', { status: 'succeeded' }), memory.firestore)
    expect(memory.read(RECORD)).toMatchObject({ status: 'succeeded', synced: true })
    expect(memory.read(RECORD)!['alertDueAtMs']).toBeUndefined()
  })

  it('never turns synced back, and never turns a finished intent back into an authorized one', async () => {
    const memory = memoryFirestore()
    memory.seed(RECORD, { saleKey: KEY, status: 'succeeded', synced: true })
    // Stripe does not promise order: the authorization arrives last.
    await reconcilePosOfflineCardEvent(event('payment_intent.amount_capturable_updated'), memory.firestore)
    expect(memory.read(RECORD)).toMatchObject({ status: 'succeeded', synced: true })
    expect(memory.read(RECORD)!['alertDueAtMs']).toBeUndefined()
  })

  it('starts no clock on an intent that holds no money', async () => {
    const memory = memoryFirestore()
    await reconcilePosOfflineCardEvent(
      event('payment_intent.payment_failed', { status: 'requires_payment_method' }),
      memory.firestore,
    )
    expect(memory.read(RECORD)!['alertDueAtMs']).toBeUndefined()
  })

  it('leaves every other event alone', async () => {
    const memory = memoryFirestore()
    const online = event('payment_intent.succeeded', { metadata: { kind: 'pos', hostId: 'shop' } })
    expect(await reconcilePosOfflineCardEvent(online, memory.firestore)).toBeNull()
    expect(await reconcilePosOfflineCardEvent({ type: 'charge.refunded', object: {} }, memory.firestore)).toBeNull()
    const forged = event('payment_intent.succeeded', { metadata: { kind: 'pos-offline', hostId: '../x', saleKey: KEY } })
    expect(await reconcilePosOfflineCardEvent(forged, memory.firestore)).toBeNull()
    expect(memory.docs.size).toBe(0)
  })
})

describe('posOfflineCardBillingWebhookHandler', () => {
  it('claims an offline card intent for its site, and only one', async () => {
    mockStore = memoryFirestore()
    expect(await posOfflineCardBillingWebhookHandler({ type: 'charge.refunded', object: {} } as any)).toBeUndefined()
    expect(
      await posOfflineCardBillingWebhookHandler(event('payment_intent.amount_capturable_updated') as any),
    ).toEqual({ claimed: true, hostId: 'shop' })
    expect(mockStore.read(RECORD)).toMatchObject({ synced: false })
  })
})

describe('the unsynced offline card sweep', () => {
  it('tells nobody before the alert is due, then the operator and the site once', async () => {
    mockStore = memoryFirestore()
    await reconcilePosOfflineCardEvent(event('payment_intent.amount_capturable_updated'), mockStore.firestore, () => NOW)
    mockStore.seed('hosts/shop', { displayName: 'Corner Shop' })
    const early = await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS - 1 })
    expect(early).toEqual({ due: 0, alerted: 0, cleared: 0, skippedLocked: 0 })
    const due = await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    expect(due).toEqual({ due: 1, alerted: 1, cleared: 0, skippedLocked: 0 })
    expect(mockAlerts).toEqual([
      {
        type: 'commerce.posOfflineCardUnsynced',
        options: {
          dedupeKey: `shop:${KEY}`,
          hostId: 'shop',
          context: {
            amount: '$24.79',
            paymentIntentId: 'pi_3Q0abcdEFGH12345',
            status: 'requires_capture',
            site: 'Corner Shop (shop)',
            registerId: 'front',
            age: '6 hours',
          },
        },
      },
    ])
    expect(mockManagerNotices).toEqual([
      expect.objectContaining({
        hostId: 'shop',
        payload: expect.objectContaining({ type: 'content.order', link: '/shop/products' }),
      }),
    ])
    expect(mockManagerNotices[0].payload.body).toMatch(/never charged/)
    expect(mockStore.read(RECORD)).toMatchObject({ alertedAtMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    // Told once: the next beats find nothing due, and a late event does not restart the clock.
    await reconcilePosOfflineCardEvent(event('payment_intent.succeeded', { status: 'succeeded' }), mockStore.firestore)
    expect(await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + 10 * POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })).toMatchObject({
      due: 0,
      alerted: 0,
    })
    expect(mockAlerts).toHaveLength(1)
  })

  it('clears an authorization that lapsed, telling nobody', async () => {
    mockStore = memoryFirestore()
    await reconcilePosOfflineCardEvent(event('payment_intent.amount_capturable_updated'), mockStore.firestore, () => NOW)
    mockStore.docs.set(RECORD, { ...mockStore.read(RECORD)!, status: 'canceled' })
    const scan = await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    expect(scan).toMatchObject({ due: 1, alerted: 0, cleared: 1 })
    expect(mockAlerts).toHaveLength(0)
    expect(mockStore.read(RECORD)!['alertDueAtMs']).toBeUndefined()
  })

  it('skips a locked site without dropping it, and tells it after the lift', async () => {
    mockStore = memoryFirestore()
    await reconcilePosOfflineCardEvent(event('payment_intent.amount_capturable_updated'), mockStore.firestore, () => NOW)
    const at = NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS
    const locked = await scanUnsyncedOfflineCards({ isLocked: async () => true }, { nowMs: at })
    expect(locked).toMatchObject({ due: 1, alerted: 0, skippedLocked: 1 })
    expect(mockAlerts).toHaveLength(0)
    expect(mockStore.read(RECORD)!['alertDueAtMs']).toBe(at)
    expect(await scanUnsyncedOfflineCards(unlocked, { nowMs: at })).toMatchObject({ alerted: 1 })
  })
})

describe('end to end: the webhook, the device’s sync and the sweep (Stripe mocked)', () => {
  let h: PosOpsHarness
  let deps: PosOfflineSyncDeps
  let intent: PosOfflineCardIntent
  let queued: PosOfflineSale
  let stripeCaptures: number

  beforeEach(() => {
    h = posOpsHarness()
    h.clock.now = NOW
    mockStore = h.memory
    stripeCaptures = 0
    h.memory.seed('hosts/shop/settings/store', {
      tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', pct: 8 }] },
    })
    h.memory.seed('hosts/shop', {
      memberRoles: { owner: 'admin', cashier: 'editor', cashier2: 'editor', viewer: 'viewer' },
      displayName: 'Corner Shop',
    })
    h.memory.seed('hosts/shop/registers/front', { name: 'Front', openShiftId: 'shift-1' })
    h.memory.seed('hosts/shop/registers/front/shifts/shift-1', { status: 'open', registerId: 'front' })
    h.memory.seed('hosts/shop/products/p-tee', { name: 'Tee', type: 'physical', variants: [{ id: 'default', priceUsd: 25 }] })
    h.memory.seed('hosts/shop/counters/orders', { next: 1001 })
    const lines = [{ productId: 'p-tee', name: 'Tee', quantity: 1, unitAmountCents: 2500 }]
    const totals = posOfflineSaleTotals({ lines, discountPct: 0, tax: { pct: 8, pricesIncludeTax: false } })
    queued = {
      v: 1,
      saleKey: KEY,
      hostId: 'shop',
      orgId: 'org-1',
      signedInUid: 'cashier',
      registerId: 'front',
      shiftId: 'shift-1',
      soldAtMs: NOW - 60_000,
      lines,
      discountPct: 0,
      totals,
      cashTenderedCents: 0,
      changeCents: 0,
      tender: 'card',
      card: { forward: 'forwarded', paymentIntentId: 'pi_3Q0abcdEFGH12345', brand: 'visa', last4: '4242' },
    }
    intent = {
      id: 'pi_3Q0abcdEFGH12345',
      status: 'requires_capture',
      amount: totals.totalCents,
      currency: 'usd',
      metadata: { kind: 'pos-offline', saleKey: KEY, hostId: 'shop', orgId: 'org-1', registerId: 'front' },
      destination: 'acct_merchant',
      applicationFeeCents: 0,
      livemode: false,
    }
    deps = {
      ...h.deps,
      feePct: () => 2,
      registerWithinCap: () => true,
      decrementStock: async () => ({ applied: 0, requested: -1, before: null, after: null, failed: false }),
      afterSale: async () => undefined,
      card: {
        terminal: async () => ({ available: true, locationId: 'tml_1' }),
        merchantAccount: async () => 'acct_merchant',
        enableOffline: async () => true,
        retrieve: async () => ({ ok: true, intent }),
        capture: async (_id, fee) => {
          stripeCaptures += 1
          intent = { ...intent, status: 'succeeded', applicationFeeCents: fee }
          return { ok: true, intent }
        },
        wrongAccount: async () => undefined,
      },
    }
  })

  const stripeSays = (type: string, at: number) =>
    reconcilePosOfflineCardEvent(
      event(type, { status: intent.status, amount: intent.amount }),
      h.memory.firestore,
      () => at,
    )

  const deviceSyncs = async () => {
    const outcome = await handlePosOfflineSync(deps, h.request('cashier', { hostId: 'shop', sales: [queued] }))
    return (outcome.body['results'] as any[])[0]
  }

  it('a sale that syncs right after its card is forwarded is never reported, whichever arrives first', async () => {
    await stripeSays('payment_intent.amount_capturable_updated', NOW)
    expect(h.memory.read(RECORD)).toMatchObject({ synced: false, alertDueAtMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    expect((await deviceSyncs()).status).toBe('recorded')
    expect(stripeCaptures).toBe(1)
    // The capture's own event lands after the sync.
    await stripeSays('payment_intent.succeeded', NOW + 1_000)
    expect(h.memory.read(RECORD)).toMatchObject({ status: 'succeeded', synced: true, orderId: KEY })
    expect(h.memory.read(RECORD)!['alertDueAtMs']).toBeUndefined()
    const scan = await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + 2 * POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    expect(scan).toEqual({ due: 0, alerted: 0, cleared: 0, skippedLocked: 0 })
    expect(mockAlerts).toHaveLength(0)
    expect(h.memory.read(`hosts/shop/orders/${KEY}`)).toMatchObject({ status: 'paid', paymentIntentId: intent.id })
  })

  it('a sale that never syncs is told once, while the authorization still has time; syncing after clears nothing it should not', async () => {
    await stripeSays('payment_intent.amount_capturable_updated', NOW)
    const scan = await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    expect(scan).toMatchObject({ due: 1, alerted: 1 })
    expect(mockAlerts.map((alert) => alert.type)).toEqual(['commerce.posOfflineCardUnsynced'])
    expect(stripeCaptures).toBe(0)
    // The store opens the register as asked: the sale syncs, the card is captured, the record says so.
    expect((await deviceSyncs()).status).toBe('recorded')
    expect(stripeCaptures).toBe(1)
    expect(h.memory.read(RECORD)).toMatchObject({ synced: true })
  })

  it('a sale that synced while the event was in flight is cleared by the sweep, not reported', async () => {
    await stripeSays('payment_intent.amount_capturable_updated', NOW)
    // The sync record exists but the intent record was written before it (an older build's sync).
    h.memory.seed(`hosts/shop/posOfflineSales/${KEY}`, { saleKey: KEY })
    const scan = await scanUnsyncedOfflineCards(unlocked, { nowMs: NOW + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS })
    expect(scan).toMatchObject({ due: 1, alerted: 0, cleared: 1 })
    expect(h.memory.read(RECORD)).toMatchObject({ synced: true })
    expect(mockAlerts).toHaveLength(0)
  })
})

describe('the operator alerts', () => {
  it('are registered with the commerce catalog', () => {
    const types = COMMERCE_OPERATOR_ALERTS.map((alert) => alert.type)
    expect(types).toEqual(
      expect.arrayContaining(['commerce.posOfflineCardUnsynced', 'commerce.posOfflineCardWrongAccount']),
    )
  })
})
