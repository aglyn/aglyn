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

import { createSecretBoxKey } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'node:crypto'
import { asFirestore, memoryFirestore } from '../testing/memory-firestore'
import { mockFetch } from '../testing/mock-fetch'
import { registerPluginService, resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  COMMERCE_ORDER_HISTORY,
  backfillRefund,
  runBackfillStep,
  snapshotFromHistoryEntry,
  startBackfill,
  type CommerceOrderHistoryEntry,
} from './backfill'
import { newConnectionRecord, readConnection } from './connection-store'
import { listPaidPayouts } from './payouts'
import type { AccountingProvider } from './providers/provider'
import { pollPayouts, runAccountingSyncJob, type AccountingJobDeps } from './sync-job'
import { payoutItemId, saleItemId } from './sync-store'

const NOW = Date.UTC(2026, 9, 6, 18)
const key = createSecretBoxKey(randomBytes(32))
const keyring = { current: key, keys: [key] }

function setup(options: { fetch?: typeof fetch; locked?: boolean } = {}) {
  const store = memoryFirestore()
  const record = newConnectionRecord({
    keyring,
    orgId: 'org-1',
    provider: 'quickbooks',
    tokens: { accessToken: 'a', refreshToken: 'r', accessExpiresAtMs: NOW + 3_600_000, refreshExpiresAtMs: null, scopes: [] },
    tenants: [{ id: 'realm-1', name: 'Books' }],
    environment: 'sandbox',
    uid: 'u-1',
    email: null,
    nowMs: NOW - 1000,
    previous: null,
  })
  record.mapping = {
    accounts: { income: 'inc', clearing: 'clr', feeExpense: 'fee', payoutBank: 'bank' },
    taxCodes: {},
    syncMode: 'per-order',
    startDate: null,
    timeZone: 'UTC',
  }
  record.payoutCursorMs = NOW - 7 * 86_400_000
  store.seed('orgs/org-1', { ownerUid: 'owner-1', name: 'Acme' })
  store.seed('profiles/owner-1', { stripeAccountId: 'acct_123' })
  store.seed('orgs/org-1/accountingConnections/quickbooks', record as never)
  const provider = {
    id: 'quickbooks',
    findByExternalId: jest.fn(async () => null),
    upsertCustomer: jest.fn(async () => ({ id: 'c' })),
    createSalesReceipt: jest.fn(async () => ({ id: 's', type: 'SalesReceipt' })),
    createExpense: jest.fn(async () => ({ id: 'e', type: 'Purchase' })),
    createDeposit: jest.fn(async () => ({ id: 't', type: 'Transfer' })),
    refresh: jest.fn(),
  } as unknown as AccountingProvider
  const deps: AccountingJobDeps = {
    firestore: () => asFirestore(store),
    keyring: () => keyring,
    providerFor: () => provider,
    now: () => NOW,
    random: () => 0.5,
    stripeKey: () => 'sk_test_123',
    orgLocked: async () => options.locked === true,
    fetch: options.fetch,
  }
  return { store, deps, provider }
}

const stripePayouts = mockFetch([
  {
    match: 'api.stripe.com/v1/payouts',
    body: {
      has_more: false,
      data: [
        { id: 'po_2', amount: 5000, currency: 'usd', status: 'paid', arrival_date: Math.floor((NOW - 86_400_000) / 1000) },
        { id: 'po_1', amount: 2500, currency: 'usd', status: 'paid', arrival_date: Math.floor((NOW - 2 * 86_400_000) / 1000) },
      ],
    },
  },
])

describe('payouts', () => {
  it('reads paid payouts from the connected account, oldest first', async () => {
    const payouts = await listPaidPayouts({
      stripeKey: 'sk_test_123',
      accountId: 'acct_123',
      orgId: 'org-1',
      sinceMs: NOW - 7 * 86_400_000,
      fetch: stripePayouts.fetch,
    })
    expect(payouts.map((payout) => payout.payoutId)).toEqual(['po_1', 'po_2'])
    const call = stripePayouts.calls[0]
    expect(call.headers['stripe-account']).toBe('acct_123')
    expect(new URL(call.url).searchParams.get('status')).toBe('paid')
  })

  it('queues each payout once and moves the cursor past it', async () => {
    const { deps, store } = setup({ fetch: stripePayouts.fetch })
    const connection = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    expect(await pollPayouts(deps, connection)).toBe(2)
    expect(store.read(`orgs/org-1/accountingSyncItems/${payoutItemId({ payoutId: 'po_1' })}`)).toMatchObject({
      kind: 'payout',
      status: 'pending',
      amountCents: 2500,
    })
    const after = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    expect(after.payoutCursorMs).toBe(Math.floor((NOW - 86_400_000) / 1000) * 1000)
    expect(await pollPayouts(deps, after)).toBe(0)
  })

  it('asks a person about a payout from a Stripe account two connected workspaces share', async () => {
    const { deps, store } = setup({ fetch: stripePayouts.fetch })
    store.seed('orgs/org-2', { ownerUid: 'owner-1', name: 'Acme East' })
    store.seed('orgs/org-2/accountingConnections/xero', { provider: 'xero', orgId: 'org-2' })
    const connection = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    await pollPayouts(deps, connection)
    expect(store.read(`orgs/org-1/accountingSyncItems/${payoutItemId({ payoutId: 'po_2' })}`)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'shared-stripe-account',
    })
  })
})

describe('the tick', () => {
  it('posts due items and passes over a workspace under lockdown', async () => {
    const locked = setup({ locked: true, fetch: stripePayouts.fetch })
    await expect(runAccountingSyncJob(locked.deps, { nowMs: NOW, deadlineMs: NOW + 60_000 })).resolves.toMatchObject({
      connections: 1,
      skippedLocked: 1,
      posted: 0,
    })
    const open = setup({ fetch: stripePayouts.fetch })
    const report = await runAccountingSyncJob(open.deps, { nowMs: NOW, deadlineMs: NOW + 60_000 })
    expect(report).toMatchObject({ connections: 1, payoutsQueued: 2, posted: 2 })
    expect(open.provider.createDeposit).toHaveBeenCalledTimes(2)
  })
})

describe('backfill', () => {
  /** An entry of commerce's order history, as its reader hands it out. */
  const entry = (id: string, overrides: Partial<CommerceOrderHistoryEntry> = {}): CommerceOrderHistoryEntry => ({
    id,
    createdAtMs: NOW - 10 * 86_400_000,
    paidAtMs: NOW - 10 * 86_400_000,
    lastRefundAtMs: NOW - 9 * 86_400_000,
    taxInclusive: false,
    taxRateId: null,
    order: {
      id,
      number: 12,
      status: 'refunded',
      currency: 'usd',
      lineItems: [{ name: 'Mug', quantity: 1, unitAmountCents: 1000 }],
      totals: { itemsCents: 1000, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 1000, feeCents: 30 },
      refundedCents: 400,
    },
    ...overrides,
  })

  afterEach(() => resetPluginServicesForTests())

  /** Commerce's reader over `entries`, as commerce registers it. */
  function registerHistory(entries: CommerceOrderHistoryEntry[]) {
    const listOrders = jest.fn(async (request: { hostId: string; fromMs: number; untilMs: number; limit: number }) =>
      entries
        .filter((row) => request.hostId === 'host-1' && row.createdAtMs >= request.fromMs && row.createdAtMs < request.untilMs)
        .slice(0, request.limit),
    )
    registerPluginService(COMMERCE_ORDER_HISTORY, { listOrders }, { pluginId: 'commerce' })
    return listOrders
  }

  it('reads a history entry as a snapshot, skipping one never paid', () => {
    expect(snapshotFromHistoryEntry('org-1', 'host-1', entry('o-1'))).toMatchObject({ number: 12, currency: 'usd', orderId: 'o-1' })
    expect(snapshotFromHistoryEntry('org-1', 'host-1', entry('o-2', { paidAtMs: null }))).toBeNull()
    expect(snapshotFromHistoryEntry('org-1', 'host-1', entry('o-3', { taxInclusive: true, taxRateId: 'txr_1' }))).toMatchObject({
      taxInclusive: true,
      taxKey: 'txr_1',
    })
    const snapshot = snapshotFromHistoryEntry('org-1', 'host-1', entry('o-1'))!
    expect(backfillRefund(snapshot, entry('o-1'), NOW)).toMatchObject({
      amountCents: 400,
      refundedAtMs: NOW - 9 * 86_400_000,
      coversUntilMs: NOW,
    })
  })

  it('queues the sales before the connection from the start date, a page at a time, through commerce’s reader', async () => {
    const { deps, store } = setup()
    store.seed('hosts/host-1', { orgId: 'org-1' })
    const listOrders = registerHistory([
      entry('o-1'),
      entry('o-2', { paidAtMs: null }),
      entry('o-3', { createdAtMs: NOW + 1, paidAtMs: NOW + 1 }),
    ])
    const connection = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    await startBackfill(asFirestore(store), connection, NOW - 30 * 86_400_000)
    const withBackfill = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    const queued = await runBackfillStep(deps, withBackfill as never)
    // The sale, its fee and its refund; the unpaid order and the one after the connection are not.
    expect(queued).toBe(3)
    expect(listOrders).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-1', fromMs: NOW - 30 * 86_400_000 }))
    expect(store.read(`orgs/org-1/accountingSyncItems/${saleItemId({ hostId: 'host-1', orderId: 'o-1' })}`)).toBeDefined()
    expect(store.read(`orgs/org-1/accountingSyncItems/${saleItemId({ hostId: 'host-1', orderId: 'o-3' })}`)).toBeUndefined()
    expect(store.read('orgs/org-1/accountingConnections/quickbooks')!['backfill']).toMatchObject({ done: true, queued: 3 })
  })

  it('waits where it stands while commerce’s reader is not registered', async () => {
    const { deps, store } = setup()
    store.seed('hosts/host-1', { orgId: 'org-1' })
    const connection = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    await startBackfill(asFirestore(store), connection, NOW - 30 * 86_400_000)
    const withBackfill = readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
    await expect(runBackfillStep(deps, withBackfill as never)).resolves.toBe(0)
    expect(store.read('orgs/org-1/accountingConnections/quickbooks')!['backfill']).toMatchObject({ done: false, hostIndex: 0 })
  })
})
