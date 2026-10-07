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

import { createSecretBoxKey, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'node:crypto'
import type { AccountingOrderSnapshot } from '../model/accounting-sources'
import type { AccountingMapping } from '../model/accounting.types'
import { asFirestore, memoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import {
  AccountingReconnectRequiredError,
  connectionRef,
  connectionSession,
  newConnectionRecord,
  openToken,
  readConnection,
  type AccountingConnectionRecord,
} from './connection-store'
import { AccountingProviderError } from './providers/http'
import type { AccountingProvider } from './providers/provider'
import {
  enqueueOrderCancelled,
  enqueueOrderPaid,
  enqueueOrderRefunded,
  foreignCurrencyRefusal,
  gatherSummaries,
  idempotencyKey,
  runSyncPass,
  type AccountingEngineDeps,
} from './sync-engine'
import { SYNC_MAX_ATTEMPTS, backoffMs, feeItemId, refundItemId, saleItemId } from './sync-store'

const NOW = Date.UTC(2026, 9, 6, 18)
const key = createSecretBoxKey(randomBytes(32))
const keyring: SecretBoxKeyring = { current: key, keys: [key] }

const mapping: AccountingMapping = {
  accounts: { income: 'inc', clearing: 'clr', feeExpense: 'fee', payoutBank: 'bank', taxLiability: 'tax' },
  taxCodes: {},
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'UTC',
}

const order = (overrides: Partial<AccountingOrderSnapshot> = {}): AccountingOrderSnapshot => ({
  orgId: 'org-1',
  hostId: 'host-1',
  orderId: 'order-1',
  number: 1,
  currency: 'usd',
  paidAtMs: NOW - 60_000,
  channel: 'online',
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  lines: [{ name: 'Mug', quantity: 1, unitAmountCents: 1000 }],
  totals: { itemsCents: 1000, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 1000, feeCents: 30 },
  taxInclusive: false,
  taxKey: null,
  ...overrides,
})

/** A provider whose every method is a mock; creates answer an id per kind. */
function fakeProvider(overrides: Partial<AccountingProvider> = {}) {
  let next = 0
  const created = (type: string) => jest.fn(async () => ({ id: `${type}-${++next}`, type }))
  const provider: AccountingProvider = {
    id: 'quickbooks',
    picksTenantAfterExchange: false,
    authorizeUrl: jest.fn(() => 'https://consent'),
    exchangeCode: jest.fn(),
    refresh: jest.fn(async () => ({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessExpiresAtMs: NOW + 3_600_000,
      refreshExpiresAtMs: null,
      scopes: [],
    })),
    revoke: jest.fn(),
    companyInfo: jest.fn(),
    listAccounts: jest.fn(),
    listTaxRates: jest.fn(),
    prepare: jest.fn(async () => ({})),
    upsertCustomer: jest.fn(async () => ({ id: 'cust-1' })),
    createSalesReceipt: created('SalesReceipt'),
    createRefundReceipt: created('RefundReceipt'),
    createExpense: created('Purchase'),
    createDeposit: created('Transfer'),
    createJournal: created('JournalEntry'),
    findByExternalId: jest.fn(async () => null),
    ...overrides,
  }
  return provider
}

function setup(options: { provider?: AccountingProvider; mapping?: AccountingMapping; accessExpiresAtMs?: number } = {}) {
  const store = memoryFirestore()
  const provider = options.provider ?? fakeProvider()
  let now = NOW
  const record = newConnectionRecord({
    keyring,
    orgId: 'org-1',
    provider: 'quickbooks',
    tokens: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessExpiresAtMs: options.accessExpiresAtMs ?? NOW + 3_600_000,
      refreshExpiresAtMs: null,
      scopes: [],
    },
    tenants: [{ id: 'realm-1', name: 'Books' }],
    environment: 'sandbox',
    uid: 'u-1',
    email: 'owner@example.com',
    nowMs: NOW - 86_400_000,
    previous: null,
  })
  record.mapping = options.mapping ?? mapping
  store.seed('orgs/org-1/accountingConnections/quickbooks', record as never)
  const deps: AccountingEngineDeps = {
    firestore: () => asFirestore(store),
    keyring: () => keyring,
    providerFor: () => provider,
    now: () => now,
    random: () => 0.5,
    sleep: async () => undefined,
  }
  const connection = () => readConnection(store.read('orgs/org-1/accountingConnections/quickbooks'))!
  const item = (id: string) => store.read(`orgs/org-1/accountingSyncItems/${id}`)
  return { store, provider, deps, connection, item, advance: (ms: number) => (now += ms) }
}

describe('queueing', () => {
  it('queues a paid order once, however often the event is delivered', async () => {
    const { deps, store } = setup()
    expect(await enqueueOrderPaid(deps, order())).toBe(2)
    expect(await enqueueOrderPaid(deps, order())).toBe(0)
    const ids = [...store.documents.keys()].filter((path) => path.includes('accountingSyncItems'))
    expect(ids.map((path) => path.split('/').pop())).toEqual([saleItemId(order()), feeItemId(order())])
  })

  it('queues nothing for a workspace with no connection, or before the start date', async () => {
    const empty = memoryFirestore()
    await expect(
      enqueueOrderPaid({ ...setup().deps, firestore: () => asFirestore(empty) }, order()),
    ).resolves.toBe(0)
    const dated = setup({ mapping: { ...mapping, startDate: '2026-10-07' } })
    await expect(enqueueOrderPaid(dated.deps, order())).resolves.toBe(0)
  })

  it('skips a sale that has not posted when its order is cancelled', async () => {
    const { deps, item } = setup()
    await enqueueOrderPaid(deps, order())
    await expect(enqueueOrderCancelled(deps, order())).resolves.toBe(true)
    expect(item(saleItemId(order()))).toMatchObject({ status: 'skipped' })
  })
})

describe('posting', () => {
  it('posts a sale and its fee, recording the ledger ids — the external-id map', async () => {
    const { deps, connection, item, provider } = setup()
    await enqueueOrderPaid(deps, order())
    const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(report).toMatchObject({ posted: 2, stopped: 'done' })
    expect(item(saleItemId(order()))).toMatchObject({ status: 'synced', providerDocType: 'SalesReceipt', provider: 'quickbooks' })
    expect(item(feeItemId(order()))).toMatchObject({ status: 'synced', providerDocType: 'Purchase' })
    const context = (provider.createSalesReceipt as jest.Mock).mock.calls[0][2]
    expect(context).toMatchObject({ customerId: 'cust-1', idempotencyKey: idempotencyKey('org-1', { id: saleItemId(order()), generation: 0 }) })
  })

  it('holds an order in a currency single-currency books do not keep, and posts it once they keep more than one', async () => {
    const { deps, connection, item, store, provider } = setup()
    const path = 'orgs/org-1/accountingConnections/quickbooks'
    store.seed(path, { ...(store.read(path) as object), homeCurrency: 'USD', multiCurrency: false } as never)
    await enqueueOrderPaid(deps, order({ currency: 'eur' }))
    await enqueueOrderPaid(deps, order({ orderId: 'order-2' }))
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(item(saleItemId(order()))).toMatchObject({ status: 'needs_attention', errorCode: 'currency' })
    expect(String(item(saleItemId(order()))?.['lastError'])).toMatch(/EUR.*only USD.*Multicurrency/)
    expect(item(saleItemId(order({ orderId: 'order-2' })))).toMatchObject({ status: 'synced' })
    expect(provider.createSalesReceipt).toHaveBeenCalledTimes(1)
  })

  it('names what to turn on for each ledger, and refuses nothing in multi-currency books', () => {
    expect(foreignCurrencyRefusal({ provider: 'xero', homeCurrency: 'GBP', multiCurrency: false }, 'usd')).toMatch(
      /Add USD under Currencies in Xero/,
    )
    expect(foreignCurrencyRefusal({ provider: 'xero', homeCurrency: 'GBP', multiCurrency: true }, 'usd')).toBeNull()
    expect(foreignCurrencyRefusal({ provider: 'quickbooks', homeCurrency: 'usd', multiCurrency: false }, 'USD')).toBeNull()
    expect(foreignCurrencyRefusal({ provider: 'quickbooks', homeCurrency: null, multiCurrency: false }, 'eur')).toBeNull()
  })

  it('records a document the ledger already holds instead of posting a second — an idempotent re-sync', async () => {
    const provider = fakeProvider({ findByExternalId: jest.fn(async () => ({ id: '145', type: 'SalesReceipt' })) })
    const { deps, connection, item } = setup({ provider })
    await enqueueOrderPaid(deps, order({ totals: { ...order().totals, feeCents: 0 } }))
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(provider.createSalesReceipt).not.toHaveBeenCalled()
    expect(item(saleItemId(order()))).toMatchObject({ status: 'synced', providerDocId: '145' })
  })

  it('backs a transient failure off, and asks a person after the last attempt', async () => {
    const provider = fakeProvider({
      createSalesReceipt: jest.fn(async () => {
        throw new AccountingProviderError('transient', 'QuickBooks failed (503).', 503)
      }),
    })
    const { deps, connection, item, advance } = setup({ provider })
    await enqueueOrderPaid(deps, order({ totals: { ...order().totals, feeCents: 0 } }))
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    const first = item(saleItemId(order()))!
    expect(first).toMatchObject({ status: 'pending', attempts: 1, errorCode: 'retrying' })
    expect(first.nextAttemptAtMs - NOW).toBe(backoffMs(1, () => 0.5))
    for (let attempt = 2; attempt <= SYNC_MAX_ATTEMPTS; attempt += 1) {
      advance(13 * 60 * 60 * 1000)
      await runSyncPass(deps, connection(), { deadlineMs: Number.MAX_SAFE_INTEGER })
    }
    expect(item(saleItemId(order()))).toMatchObject({ status: 'needs_attention', errorCode: 'retries-exhausted' })
  })

  it('asks a person at once when the ledger refuses the document itself', async () => {
    const provider = fakeProvider({
      createSalesReceipt: jest.fn(async () => {
        throw new AccountingProviderError('validation', 'Account is inactive', 400)
      }),
    })
    const { deps, connection, item } = setup({ provider })
    await enqueueOrderPaid(deps, order({ totals: { ...order().totals, feeCents: 0 } }))
    const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(report.needsAttention).toBe(1)
    expect(item(saleItemId(order()))).toMatchObject({ status: 'needs_attention', lastError: 'Account is inactive' })
  })

  it('holds a refund until its sale has posted', async () => {
    const provider = fakeProvider({
      createSalesReceipt: jest.fn(async () => {
        throw new AccountingProviderError('transient', 'down', 503)
      }),
    })
    const { deps, connection, item } = setup({ provider })
    const paid = order({ totals: { ...order().totals, feeCents: 0 } })
    await enqueueOrderPaid(deps, paid)
    await enqueueOrderRefunded(deps, { order: paid, refundId: 're_1', amountCents: 500, refundedAtMs: NOW, feeRefundedCents: 0 })
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(provider.createRefundReceipt).not.toHaveBeenCalled()
    expect(item(refundItemId({ order: paid, refundId: 're_1', amountCents: 500, refundedAtMs: NOW, feeRefundedCents: 0 }))).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: 'Waiting for the sale to post.',
    })
  })

  it('refreshes a refused access token once and repeats the call', async () => {
    let calls = 0
    const provider = fakeProvider({
      createSalesReceipt: jest.fn(async () => {
        calls += 1
        if (calls === 1) throw new AccountingProviderError('auth', 'expired', 401)
        return { id: '1', type: 'SalesReceipt' }
      }),
    })
    const { deps, connection, item } = setup({ provider })
    await enqueueOrderPaid(deps, order({ totals: { ...order().totals, feeCents: 0 } }))
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(provider.refresh).toHaveBeenCalledTimes(1)
    expect(item(saleItemId(order()))).toMatchObject({ status: 'synced' })
  })

  it('posts nothing while the mapping is incomplete', async () => {
    const { deps, connection, provider } = setup({ mapping: { ...mapping, accounts: { income: 'inc' } } })
    await enqueueOrderPaid(deps, order())
    await expect(runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })).resolves.toMatchObject({ stopped: 'unmapped' })
    expect(provider.createSalesReceipt).not.toHaveBeenCalled()
  })
})

describe('token rotation', () => {
  it('stores the rotated refresh token the moment a refresh returns it', async () => {
    const { deps, connection, provider, store } = setup({ accessExpiresAtMs: NOW + 1000 })
    const session = await connectionSession({ firestore: deps.firestore(), keyring, provider, now: deps.now }, connection())
    expect(session.accessToken).toBe('access-2')
    expect(provider.refresh).toHaveBeenCalledWith('refresh-1')
    const stored = connection()
    expect(openToken(keyring, stored, 'refresh').token).toBe('refresh-2')
    expect(stored.refreshLeaseUntilMs).toBe(0)
    // Sealed, never in the clear, and bound to its own document.
    expect(JSON.stringify(store.read('orgs/org-1/accountingConnections/quickbooks'))).not.toContain('refresh-2')
    expect(() => openToken(keyring, { ...stored, orgId: 'org-2' }, 'refresh')).toThrow()
  })

  it('marks the connection for reconnecting when the provider refuses the grant', async () => {
    const provider = fakeProvider({
      refresh: jest.fn(async () => {
        throw new AccountingProviderError('auth', 'QuickBooks refused the grant. Reconnect QuickBooks.', 400)
      }),
    })
    const { deps, connection } = setup({ provider, accessExpiresAtMs: NOW + 1000 })
    await expect(
      connectionSession({ firestore: deps.firestore(), keyring, provider, now: deps.now }, connection()),
    ).rejects.toBeInstanceOf(AccountingReconnectRequiredError)
    expect(connection()).toMatchObject({ status: 'reconnect-required', lastError: expect.stringContaining('refused') })
  })

  it('waits for a refresh another process holds the lease on, and uses its token', async () => {
    const { deps, connection, provider, store } = setup({ accessExpiresAtMs: NOW + 1000 })
    const before = connection()
    // Another process took the lease and then finished its refresh.
    await connectionRef(asFirestore(store), 'org-1', 'quickbooks').update({ refreshLeaseUntilMs: NOW + 30_000 })
    const sleep = jest.fn(async () => {
      const { sealTokens } = await import('./connection-store')
      await connectionRef(asFirestore(store), 'org-1', 'quickbooks').update({
        ...sealTokens(keyring, 'org-1', 'quickbooks', {
          accessToken: 'access-other',
          refreshToken: 'refresh-other',
          accessExpiresAtMs: NOW + 3_600_000,
          refreshExpiresAtMs: null,
          scopes: [],
        }),
        accessExpiresAtMs: NOW + 3_600_000,
        refreshedAtMs: NOW,
        refreshLeaseUntilMs: 0,
      })
    })
    const session = await connectionSession({ firestore: deps.firestore(), keyring, provider, now: deps.now, sleep }, before)
    expect(session.accessToken).toBe('access-other')
    expect(provider.refresh).not.toHaveBeenCalled()
  })
})

describe('the daily summary', () => {
  it('gathers a finished day into one journal and marks its sales posted with it', async () => {
    const summaryMapping: AccountingMapping = { ...mapping, syncMode: 'daily-summary' }
    const { deps, connection, item, advance } = setup({ mapping: summaryMapping })
    await enqueueOrderPaid(deps, order())
    await enqueueOrderPaid(deps, order({ orderId: 'order-2', number: 2 }))
    // The day has not ended: nothing gathers, and nothing posts on its own.
    expect(await gatherSummaries(deps, connection())).toBe(0)
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(item(saleItemId(order()))).toMatchObject({ status: 'pending' })
    advance(24 * 60 * 60 * 1000)
    expect(await gatherSummaries(deps, connection())).toBe(1)
    const report = await runSyncPass(deps, connection(), { deadlineMs: Number.MAX_SAFE_INTEGER })
    expect(report.posted).toBe(1)
    expect(item(saleItemId(order()))).toMatchObject({ status: 'synced', providerDocType: 'JournalEntry' })
    expect(item(saleItemId(order({ orderId: 'order-2' })))).toMatchObject({ status: 'synced', providerDocType: 'JournalEntry' })
  })
})

export type { AccountingConnectionRecord, MemoryFirestore }
