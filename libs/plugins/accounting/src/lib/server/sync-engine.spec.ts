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
import type { AccountingMapping, AccountingProviderId } from '../model/accounting.types'
import { asFirestore, memoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import {
  AccountingReconnectRequiredError,
  connectionRef,
  connectionSession,
  newConnectionRecord,
  openToken,
  readConnection,
  toStoredConnection,
  type AccountingConnectionRecord,
} from './connection-store'
import { instantSleep, mockFetch } from '../testing/mock-fetch'
import { AccountingPacer, AccountingProviderError } from './providers/http'
import type { AccountingProvider } from './providers/provider'
import { createXeroProvider } from './providers/xero'
import {
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

function setup(
  options: {
    provider?: AccountingProvider
    mapping?: AccountingMapping
    accessExpiresAtMs?: number
    providerId?: AccountingProviderId
    tenantName?: string
  } = {},
) {
  const store = memoryFirestore()
  const provider = options.provider ?? fakeProvider()
  const providerId = options.providerId ?? 'quickbooks'
  const connectionPath = `orgs/org-1/accountingConnections/${providerId}`
  let now = NOW
  const record = newConnectionRecord({
    keyring,
    orgId: 'org-1',
    provider: providerId,
    tokens: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessExpiresAtMs: options.accessExpiresAtMs ?? NOW + 3_600_000,
      refreshExpiresAtMs: null,
      scopes: [],
    },
    tenants: [{ id: 'realm-1', name: options.tenantName ?? 'Books' }],
    environment: 'sandbox',
    uid: 'u-1',
    email: 'owner@example.com',
    nowMs: NOW - 86_400_000,
    previous: null,
  })
  record.mapping = options.mapping ?? mapping
  store.seed(connectionPath, toStoredConnection(record, keyring) as never)
  const deps: AccountingEngineDeps = {
    firestore: () => asFirestore(store),
    keyring: () => keyring,
    providerFor: () => provider,
    now: () => now,
    random: () => 0.5,
    sleep: async () => undefined,
  }
  const connection = () => readConnection(store.read(connectionPath), keyring)!
  const item = (id: string) => store.read(`orgs/org-1/accountingSyncItems/${id}`)
  return { store, provider, deps, connection, connectionPath, item, advance: (ms: number) => (now += ms) }
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

  it('posts a paid order that was later cancelled, and the refund that followed against its sale', async () => {
    // A cancel moves no money and is not taken: the sale and fee stay queued,
    // and a refund, if one follows, reverses the posted sale.
    const { deps, connection, item, provider, advance } = setup()
    await enqueueOrderPaid(deps, order())
    const refund = { order: order(), refundId: 're_1', amountCents: 1000, refundedAtMs: NOW, feeRefundedCents: 0 }
    await enqueueOrderRefunded(deps, refund)
    // The refund may wait a pass for its sale; it never needs a person.
    const first = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    advance(5 * 60_000)
    const second = await runSyncPass(deps, connection(), { deadlineMs: NOW + 10 * 60_000 })
    expect(first.posted + second.posted).toBe(3)
    expect(first.needsAttention + second.needsAttention).toBe(0)
    expect(provider.createSalesReceipt).toHaveBeenCalledTimes(1)
    expect(provider.createRefundReceipt).toHaveBeenCalledTimes(1)
    expect(item(saleItemId(order()))).toMatchObject({ status: 'synced' })
    expect(item(feeItemId(order()))).toMatchObject({ status: 'synced' })
    expect(item(refundItemId(refund))).toMatchObject({ status: 'synced' })
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

  describe('when the books gain a currency after they were connected', () => {
    const path = 'orgs/org-1/accountingConnections/quickbooks'
    const singleCurrency = { name: 'Books', homeCurrency: 'USD', multiCurrency: false }
    const multiCurrency = { name: 'Books', homeCurrency: 'USD', multiCurrency: true }
    /** What the page's Retry does to an item that needs attention. */
    const retry = (store: MemoryFirestore, id: string, nowMs: number) => {
      const itemPath = `orgs/org-1/accountingSyncItems/${id}`
      const current = store.read(itemPath) as Record<string, unknown>
      store.seed(itemPath, {
        ...current,
        status: 'pending',
        attempts: 0,
        generation: Number(current['generation'] ?? 0) + 1,
        nextAttemptAtMs: nowMs,
        errorCode: null,
      } as never)
    }

    it('posts a refused foreign-currency item on retry once the ledger reports more than one currency', async () => {
      const companyInfo = jest.fn(async () => singleCurrency)
      const { deps, connection, item, store, provider } = setup({ provider: fakeProvider({ companyInfo }) })
      store.seed(path, { ...(store.read(path) as object), homeCurrency: 'USD', multiCurrency: false } as never)
      const euro = order({ currency: 'eur' })
      await enqueueOrderPaid(deps, euro)
      await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
      expect(item(saleItemId(euro))).toMatchObject({ status: 'needs_attention', errorCode: 'currency' })
      expect(item(feeItemId(euro))).toMatchObject({ status: 'needs_attention', errorCode: 'currency' })
      expect(provider.createSalesReceipt).not.toHaveBeenCalled()

      // The merchant adds the currency in their books, then retries.
      companyInfo.mockResolvedValue(multiCurrency)
      retry(store, saleItemId(euro), NOW)
      retry(store, feeItemId(euro), NOW)
      const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
      expect(report).toMatchObject({ posted: 2, needsAttention: 0 })
      expect(item(saleItemId(euro))).toMatchObject({ status: 'synced' })
      expect(provider.createSalesReceipt).toHaveBeenCalledTimes(1)
      expect(store.read(path)).toMatchObject({ multiCurrency: true })
      // Remembered: the next pass reads nothing.
      expect(companyInfo).toHaveBeenCalledTimes(2)
      await enqueueOrderPaid(deps, order({ orderId: 'order-3', currency: 'eur' }))
      await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
      expect(companyInfo).toHaveBeenCalledTimes(2)
    })

    it('reads the company info at most once a pass, however many foreign items there are', async () => {
      const companyInfo = jest.fn(async () => singleCurrency)
      const { deps, connection, item, store } = setup({ provider: fakeProvider({ companyInfo }) })
      store.seed(path, { ...(store.read(path) as object), homeCurrency: 'USD', multiCurrency: false } as never)
      for (const orderId of ['order-1', 'order-2', 'order-3']) await enqueueOrderPaid(deps, order({ orderId, currency: 'eur' }))
      const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
      // Three sales and their three fees.
      expect(report).toMatchObject({ posted: 0, needsAttention: 6 })
      expect(companyInfo).toHaveBeenCalledTimes(1)
      expect(item(saleItemId(order({ orderId: 'order-3' })))).toMatchObject({ errorCode: 'currency' })
      expect(store.read(path)).toMatchObject({ multiCurrency: false })
    })
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

describe('when the app is removed inside Xero (a 403 AuthenticationUnsuccessful)', () => {
  const DEMO = 'Demo Company (US)'
  const PLAIN = 'Xero no longer lets Aglyn reach Demo Company (US). Reconnect to keep posting.'
  const LOST_BODY = { Type: null, Title: 'Forbidden', Status: 403, Detail: 'AuthenticationUnsuccessful' }

  /** The real Xero adapter over a scripted fetch: every call answers `status` with `body`. */
  function xero(status: number, body: unknown) {
    const mocked = mockFetch([{ match: 'api.xero.com', status, body }])
    const { sleep } = instantSleep()
    const adapter = createXeroProvider(
      { clientId: 'client', clientSecret: 'secret' },
      { fetch: mocked.fetch, sleep, pacer: new AccountingPacer(0, Date.now, sleep) },
    )
    return { adapter, calls: mocked.calls }
  }

  it('marks the connection for reconnecting in plain words, stops the pass, and leaves the items pending', async () => {
    const lost = xero(403, LOST_BODY)
    const { deps, connection, item } = setup({ provider: lost.adapter, providerId: 'xero', tenantName: DEMO })
    await enqueueOrderPaid(deps, order())
    await enqueueOrderPaid(deps, order({ orderId: 'order-2', number: 2 }))
    const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(report).toMatchObject({ posted: 0, needsAttention: 0, retried: 0, stopped: 'reconnect' })
    // One call, then the pass stopped: no item was asked of a person.
    expect(lost.calls).toHaveLength(1)
    expect(connection()).toMatchObject({ status: 'reconnect-required', lastError: PLAIN })
    for (const id of [saleItemId(order()), feeItemId(order()), saleItemId(order({ orderId: 'order-2' }))]) {
      expect(item(id)).toMatchObject({ status: 'pending', attempts: 0 })
    }
    // The item the pass stopped on says why it waits.
    const ids = [saleItemId(order()), feeItemId(order()), saleItemId(order({ orderId: 'order-2' })), feeItemId(order({ orderId: 'order-2' }))]
    expect(ids.filter((id) => item(id)?.['lastError'] === PLAIN)).toHaveLength(1)
    // Later passes post nothing and call nothing until someone reconnects.
    await expect(runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })).resolves.toMatchObject({ stopped: 'reconnect' })
    expect(lost.calls).toHaveLength(1)
  })

  it('posts what waited once the merchant reconnects', async () => {
    let gone = true
    const provider = fakeProvider({
      id: 'xero',
      findByExternalId: jest.fn(async () => {
        if (gone) throw new AccountingProviderError('revoked', 'AuthenticationUnsuccessful', 403)
        return null
      }),
    })
    const { deps, connection, connectionPath, store, item } = setup({ provider, providerId: 'xero', tenantName: DEMO })
    await enqueueOrderPaid(deps, order())
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(connection().status).toBe('reconnect-required')
    // The reconnect binds the same organization again.
    gone = false
    store.seed(connectionPath, { ...(store.read(connectionPath) as object), status: 'connected', lastError: null } as never)
    const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(report).toMatchObject({ posted: 2, needsAttention: 0, stopped: 'done' })
    expect(item(saleItemId(order()))).toMatchObject({ status: 'synced' })
    expect(item(feeItemId(order()))).toMatchObject({ status: 'synced' })
  })

  it('puts back the items the raw 403 sent to needs attention before it was read as a lost connection', async () => {
    const lost = xero(403, LOST_BODY)
    const { deps, connection, item, store } = setup({ provider: lost.adapter, providerId: 'xero', tenantName: DEMO })
    const held = { kind: 'sale', mode: 'per-order', status: 'needs_attention', attempts: 1, generation: 0 }
    store.seed('orgs/org-1/accountingSyncItems/sale_old', {
      ...held,
      lastError: 'AuthenticationUnsuccessful',
      errorCode: 'validation',
    } as never)
    store.seed('orgs/org-1/accountingSyncItems/sale_refused', {
      ...held,
      lastError: 'Account is inactive',
      errorCode: 'validation',
    } as never)
    await enqueueOrderPaid(deps, order())
    await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(item('sale_old')).toMatchObject({ status: 'pending', attempts: 0, errorCode: null, lastError: PLAIN, nextAttemptAtMs: NOW })
    // A document the ledger itself refused still asks a person.
    expect(item('sale_refused')).toMatchObject({ status: 'needs_attention', lastError: 'Account is inactive' })
  })

  it('keeps any other Xero 403 as before: the item asks a person, and the connection stays connected', async () => {
    const refused = xero(403, { Title: 'Forbidden', Status: 403, Detail: 'This organisation has reached the limit of its plan.' })
    const { deps, connection, item } = setup({ provider: refused.adapter, providerId: 'xero', tenantName: DEMO })
    await enqueueOrderPaid(deps, order({ totals: { ...order().totals, feeCents: 0 } }))
    const report = await runSyncPass(deps, connection(), { deadlineMs: NOW + 60_000 })
    expect(report).toMatchObject({ needsAttention: 1, stopped: 'done' })
    expect(item(saleItemId(order()))).toMatchObject({
      status: 'needs_attention',
      errorCode: 'validation',
      lastError: 'This organisation has reached the limit of its plan.',
    })
    expect(connection().status).toBe('connected')
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

  it('hands Xero the fee payee as the day’s contact, and QuickBooks none', async () => {
    const summaryMapping: AccountingMapping = { ...mapping, syncMode: 'daily-summary' }
    for (const id of ['xero', 'quickbooks'] as const) {
      const provider = fakeProvider({ id, upsertCustomer: jest.fn(async () => ({ id: 'c-aglyn' })) })
      const { deps, connection, advance } = setup({ provider, mapping: summaryMapping })
      await enqueueOrderPaid(deps, order())
      advance(24 * 60 * 60 * 1000)
      await gatherSummaries(deps, connection())
      await runSyncPass(deps, connection(), { deadlineMs: Number.MAX_SAFE_INTEGER })
      const [, , context] = (provider.createJournal as jest.Mock).mock.calls[0]
      expect(context.customerId).toBe(id === 'xero' ? 'c-aglyn' : null)
    }
  })
})

export type { AccountingConnectionRecord, MemoryFirestore }
