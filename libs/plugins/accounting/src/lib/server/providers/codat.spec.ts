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

/**
 * Every Codat call the adapter makes, against a scripted fetch (AGL-3636):
 * the address, the API key, the body Codat reads, the push operation it
 * answers and what the adapter makes of it.
 */

import {
  buildFeeDoc,
  buildFeeRefundDoc,
  buildPayoutDoc,
  buildRefundDoc,
  buildSaleDoc,
  buildSummaryDoc,
} from '../../model/accounting-transforms'
import type { AccountingMapping } from '../../model/accounting.types'
import { instantSleep, mockFetch, type MockRoute } from '../../testing/mock-fetch'
import {
  CODAT_ENDPOINTS,
  CODAT_EXTRAS,
  CODAT_ORG_TAG,
  codatIdempotencyKey,
  codatLine,
  createCodatProvider,
} from './codat'
import { AccountingPacer } from './http'

const COMPANY = '8a210b68-6988-11ed-a1eb-0242ac120002'
const OTHER = '9b321c79-7a99-22fe-b2fc-1353bd231113'
const session = { accessToken: COMPANY, tenantId: 'conn-1' }
const API = CODAT_ENDPOINTS.api
const mapping: AccountingMapping = {
  accounts: { income: 'acc-inc', clearing: 'acc-clr', feeExpense: 'acc-fee', payoutBank: 'acc-bank', taxLiability: 'acc-tax' },
  taxCodes: { taxed: 'TX', untaxed: 'NONE' },
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'UTC',
}
const order = {
  orgId: 'org-1',
  hostId: 'host-1',
  orderId: 'o1',
  number: 7,
  currency: 'usd',
  paidAtMs: Date.UTC(2026, 9, 6),
  channel: 'online',
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  lines: [{ name: 'Mug', quantity: 2, unitAmountCents: 1000 }],
  totals: { itemsCents: 2000, shippingCents: 500, taxCents: 180, discountCents: 200, totalCents: 2480, feeCents: 60 },
  taxInclusive: false,
  taxKey: null,
}
const refund = { order, refundId: 're_1', amountCents: 1240, refundedAtMs: Date.UTC(2026, 9, 7), feeRefundedCents: 30 }
const extras = { [CODAT_EXTRAS.customerId]: 'cust-1', [CODAT_EXTRAS.supplierId]: 'sup-1' }
const write = { idempotencyKey: 'aglyn-abc', customerId: '', extras, homeCurrency: 'USD' }

const success = (dataType: string, id = 'rec-1') => ({
  pushOperationKey: 'op-1',
  dataType,
  status: 'Success',
  statusCode: 200,
  data: { id },
})

function provider(routes: MockRoute[]) {
  const mocked = mockFetch(routes)
  const { sleep, waits } = instantSleep()
  const adapter = createCodatProvider({ apiKey: 'key-1' }, { fetch: mocked.fetch, sleep, pacer: new AccountingPacer(0, Date.now, sleep) })
  return { adapter, calls: mocked.calls, waits }
}

const sent = (call: { body: string | null }) => JSON.parse(call.body ?? '{}')

describe('Codat adapter, call by call', () => {
  it('makes a company tagged with the workspace and answers its Link address with the state', async () => {
    const { adapter, calls } = provider([
      { method: 'POST', match: `${API}/companies`, body: { id: COMPANY, redirect: `https://link.codat.io/company/${COMPANY}` } },
    ])
    const url = new URL(await adapter.authorizeUrl({ state: 'as1.x.y', redirectUri: 'https://x/cb', orgId: 'org-1', orgName: 'Acme' }))
    expect(url.origin + url.pathname).toBe(`https://link.codat.io/company/${COMPANY}`)
    expect(url.searchParams.get('state')).toBe('as1.x.y')
    expect(calls[0].headers['authorization']).toBe(`Basic ${Buffer.from('key-1').toString('base64')}`)
    expect(sent(calls[0])).toEqual({ name: 'Acme', description: 'Aglyn workspace org-1', tags: { [CODAT_ORG_TAG]: 'org-1' } })
  })

  it('refuses a Link address that is not Codat Link', async () => {
    const { adapter } = provider([{ method: 'POST', match: '/companies', body: { id: COMPANY, redirect: 'https://evil.example/x' } }])
    await expect(
      adapter.authorizeUrl({ state: 's', redirectUri: 'https://x/cb', orgId: 'org-1', orgName: null }),
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('exchanges the company for its linked accounting connections, only for the workspace it was made for', async () => {
    const company = {
      id: COMPANY,
      tags: { [CODAT_ORG_TAG]: 'org-1' },
      dataConnections: [
        { id: 'conn-1', sourceType: 'Accounting', status: 'Linked', platformName: 'NetSuite' },
        { id: 'conn-2', sourceType: 'Accounting', status: 'PendingAuth', platformName: 'Sage Intacct' },
        { id: 'conn-3', sourceType: 'Banking', status: 'Linked', platformName: 'Plaid' },
      ],
    }
    const { adapter, calls } = provider([
      { method: 'GET', match: `/companies/${COMPANY}`, body: company },
      { method: 'POST', match: `/companies/${COMPANY}/data/all`, body: {} },
    ])
    const exchanged = await adapter.exchangeCode({ code: COMPANY, redirectUri: 'https://x/cb', orgId: 'org-1' })
    expect(exchanged.tenants).toEqual([{ id: 'conn-1', name: 'NetSuite', connectionId: 'conn-1' }])
    expect(exchanged.tokens).toMatchObject({ accessToken: COMPANY, refreshToken: COMPANY, accessExpiresAtMs: Number.MAX_SAFE_INTEGER })
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST'])

    await expect(adapter.exchangeCode({ code: COMPANY, redirectUri: 'https://x/cb', orgId: 'org-2' })).rejects.toMatchObject({
      code: 'validation',
    })
    await expect(adapter.exchangeCode({ code: 'not-a-guid', redirectUri: 'https://x/cb', orgId: 'org-1' })).rejects.toMatchObject({
      code: 'validation',
    })
  })

  it('refreshes by asking whether the software is still linked; a refused API key is never a reconnect', async () => {
    const linked = provider([
      { match: `/companies/${COMPANY}`, body: { dataConnections: [{ id: 'c', sourceType: 'Accounting', status: 'Linked' }] } },
    ])
    await expect(linked.adapter.refresh(COMPANY)).resolves.toMatchObject({ accessToken: COMPANY })

    const unlinked = provider([
      { match: `/companies/${COMPANY}`, body: { dataConnections: [{ id: 'c', sourceType: 'Accounting', status: 'Deauthorized' }] } },
    ])
    await expect(unlinked.adapter.refresh(COMPANY)).rejects.toMatchObject({ code: 'auth' })

    const deleted = provider([{ match: `/companies/${COMPANY}`, status: 404, body: { error: 'Company not found' } }])
    await expect(deleted.adapter.refresh(COMPANY)).rejects.toMatchObject({ code: 'auth' })

    const badKey = provider([{ match: `/companies/${COMPANY}`, status: 401, body: { error: 'Unauthorized' } }])
    await expect(badKey.adapter.refresh(COMPANY)).rejects.toMatchObject({ code: 'transient' })
  })

  it('revokes by deleting the company; one already gone is fine', async () => {
    const { adapter, calls } = provider([{ method: 'DELETE', match: `/companies/${COMPANY}`, status: 204 }])
    await adapter.revoke({ refreshToken: COMPANY })
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `${API}/companies/${COMPANY}` })
    const gone = provider([{ method: 'DELETE', match: `/companies/${OTHER}`, status: 404 }])
    await expect(gone.adapter.revoke({ refreshToken: OTHER })).resolves.toBeUndefined()
  })

  it('names the books by company and software, in their base currency', async () => {
    const { adapter } = provider([
      { match: '/data/info', body: { companyName: 'Acme Inc', baseCurrency: 'usd' } },
      { match: `/companies/${COMPANY}/connections/conn-1`, body: { platformName: 'NetSuite' } },
    ])
    await expect(adapter.companyInfo(session)).resolves.toEqual({
      name: 'Acme Inc (NetSuite)',
      homeCurrency: 'USD',
      multiCurrency: true,
    })
  })

  it('lists live accounts with their classification, page by page', async () => {
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `a${n}-${i}`, name: `A${n}-${i}`, type: 'Expense', status: 'Active' }))
    const { adapter, calls } = provider([
      {
        match: /data\/accounts\?page=1/,
        body: {
          results: [
            { id: '1', nominalCode: '4000', name: 'Sales', type: 'Income', status: 'Active', currency: 'usd' },
            { id: '2', name: 'Stripe clearing', type: 'Asset', isBankAccount: true, status: 'Active' },
            { id: '3', name: 'Old', type: 'Income', status: 'Archived' },
            { id: '4', name: 'Sales tax', type: 'Liability', status: 'Active' },
            { id: '5', name: 'Gone', type: 'Income', status: 'Active', metadata: { isDeleted: true } },
            ...page(1, 1995),
          ],
        },
      },
      { match: /data\/accounts\?page=2/, body: { results: page(2, 3) } },
    ])
    const accounts = await adapter.listAccounts(session)
    expect(calls).toHaveLength(2)
    expect(accounts.slice(0, 3)).toEqual([
      { id: '1', code: '4000', name: 'Sales', type: 'Income', classification: 'income', currency: 'USD' },
      { id: '2', code: null, name: 'Stripe clearing', type: 'Asset', classification: 'bank', currency: null },
      { id: '4', code: null, name: 'Sales tax', type: 'Liability', classification: 'liability', currency: null },
    ])
    expect(accounts).toHaveLength(3 + 1995 + 3)
  })

  it('reads a cache Codat has not filled yet as a wait, not a refusal', async () => {
    const { adapter } = provider([{ match: '/data/accounts', status: 409, body: { error: 'Data not yet synced' } }])
    await expect(adapter.listAccounts(session)).rejects.toMatchObject({ code: 'transient' })
  })

  it('lists tax rates with their effective rate', async () => {
    const { adapter } = provider([
      { match: '/data/taxRates', body: { results: [{ id: 'TX', name: 'State', effectiveTaxRate: 7.25, status: 'Active' }] } },
    ])
    await expect(adapter.listTaxRates(session)).resolves.toEqual([{ id: 'TX', name: 'State', ratePercent: 7.25 }])
  })

  it('prepares one walk-in customer and one fee supplier, finding them before making them', async () => {
    const { adapter, calls } = provider([
      { match: '/data/customers', body: { results: [{ id: 'cust-9', customerName: 'Online customer' }] } },
      { match: '/data/suppliers', body: { results: [] } },
      { method: 'POST', match: '/push/suppliers', body: success('suppliers', 'sup-9') },
    ])
    await expect(adapter.prepare(session, {}, {})).resolves.toEqual({
      [CODAT_EXTRAS.customerId]: 'cust-9',
      [CODAT_EXTRAS.supplierId]: 'sup-9',
    })
    expect(new URL(calls[0].url).searchParams.get('query')).toBe('customerName=Online customer')
    expect(calls[2].url).toBe(`${API}/companies/${COMPANY}/connections/conn-1/push/suppliers?timeoutInMinutes=60`)
    expect(sent(calls[2])).toEqual({ supplierName: 'Aglyn', status: 'Active' })
    const again = provider([])
    await expect(again.adapter.prepare(session, {}, extras)).resolves.toEqual({})
  })

  it('posts a sale as a direct income paid into clearing, with a GUID idempotency key, polling it to success', async () => {
    const { adapter, calls, waits } = provider([
      { method: 'POST', match: '/push/directIncomes', body: { pushOperationKey: 'op-7', status: 'Pending', statusCode: 202 } },
      { method: 'GET', match: `/companies/${COMPANY}/push/op-7`, body: { status: 'Pending', pushOperationKey: 'op-7' }, times: 1 },
      {
        method: 'GET',
        match: `/companies/${COMPANY}/push/op-7`,
        body: { status: 'Success', pushOperationKey: 'op-7', changes: [{ type: 'Created', recordRef: { id: 'di-1' } }] },
      },
    ])
    const doc = buildSaleDoc(order as never, mapping)
    await expect(adapter.createSalesReceipt(session, doc, write)).resolves.toEqual({ id: 'di-1', type: 'directIncomes' })
    expect(waits).toEqual([1000, 2000])
    const post = calls[0]
    expect(post.url).toBe(`${API}/companies/${COMPANY}/connections/conn-1/push/directIncomes?timeoutInMinutes=60`)
    expect(post.headers['idempotency-key']).toBe(codatIdempotencyKey('aglyn-abc'))
    expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const body = sent(post)
    expect(body).toMatchObject({
      reference: doc.externalId,
      contactRef: { id: 'cust-1', dataType: 'customers' },
      issueDate: '2026-10-06T00:00:00',
      currency: 'USD',
      subTotal: 23,
      taxAmount: 1.8,
      totalAmount: 24.8,
      paymentAllocations: [
        {
          payment: { accountRef: { id: 'acc-clr' }, currency: 'USD', totalAmount: 24.8 },
          allocation: { totalAmount: 24.8 },
        },
      ],
    })
    expect(body.note).toContain('ada@example.com')
    // The lines' totals add up to the header, to the cent.
    const lineTotal = body.lineItems.reduce((sum: number, line: { totalAmount: number }) => sum + Math.round(line.totalAmount * 100), 0)
    expect(lineTotal).toBe(2480)
    expect(body.lineItems[0]).toMatchObject({ quantity: 2, unitAmount: 10, subTotal: 20, accountRef: { id: 'acc-inc' }, taxRateRef: { id: 'TX' } })
  })

  it('takes the tax out of a tax-inclusive line, and posts an uneven unit price as one line', () => {
    const inclusive = codatLine(
      { kind: 'item', description: 'Mug', quantity: 3, unitAmountCents: 1000, amountCents: 3000, accountId: 'a', taxCodeId: 'TX', taxCents: 500, sku: null },
      'inclusive',
    )
    expect(inclusive).toMatchObject({ quantity: 1, unitAmount: 25, subTotal: 25, taxAmount: 5, totalAmount: 30, description: '3 × Mug' })
    const untaxed = codatLine(
      { kind: 'item', description: 'Mug', quantity: 2, unitAmountCents: 1000, amountCents: 2000, accountId: 'a', taxCodeId: 'TX', taxCents: 0, sku: null },
      'none',
    )
    expect(untaxed).toEqual({
      description: 'Mug',
      unitAmount: 10,
      quantity: 2,
      subTotal: 20,
      taxAmount: 0,
      totalAmount: 20,
      accountRef: { id: 'a' },
    })
  })

  it('posts a refund as a direct cost out of clearing against income', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/push/directCosts', body: success('directCosts', 'dc-1') }])
    const doc = buildRefundDoc(refund as never, mapping)
    await expect(adapter.createRefundReceipt(session, doc, write)).resolves.toEqual({ id: 'dc-1', type: 'directCosts' })
    expect(sent(calls[0])).toMatchObject({
      reference: doc.externalId,
      contactRef: { id: 'cust-1', dataType: 'customers' },
      totalAmount: 12.4,
      lineItems: [{ accountRef: { id: 'acc-inc' } }],
      paymentAllocations: [{ payment: { accountRef: { id: 'acc-clr' }, totalAmount: 12.4 } }],
    })
  })

  it('posts the fee as a direct cost and a returned fee as a direct income, to the fee supplier', async () => {
    const { adapter, calls } = provider([
      { method: 'POST', match: '/push/directCosts', body: success('directCosts', 'fee-1') },
      { method: 'POST', match: '/push/directIncomes', body: success('directIncomes', 'fr-1') },
    ])
    await adapter.createExpense(session, buildFeeDoc(order as never, mapping)!, write)
    await adapter.createExpense(session, buildFeeRefundDoc(refund as never, mapping)!, write)
    expect(sent(calls[0])).toMatchObject({
      contactRef: { id: 'sup-1', dataType: 'suppliers' },
      totalAmount: 0.6,
      lineItems: [{ accountRef: { id: 'acc-fee' }, totalAmount: 0.6 }],
      paymentAllocations: [{ payment: { accountRef: { id: 'acc-clr' } } }],
    })
    expect(calls[1].url).toContain('/push/directIncomes')
    expect(sent(calls[1])).toMatchObject({ totalAmount: 0.3, lineItems: [{ accountRef: { id: 'acc-fee' } }] })
  })

  it('posts a payout as a transfer whose description carries its id', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/push/transfers', body: success('transfers', 'tr-1') }])
    const doc = buildPayoutDoc({ payoutId: 'po_123', amountCents: 10000, currency: 'usd', arrivedAtMs: Date.UTC(2026, 9, 8) } as never, mapping)
    await adapter.createDeposit(session, doc, write)
    expect(sent(calls[0])).toMatchObject({
      description: expect.stringContaining(`[${doc.externalId}]`),
      date: '2026-10-08T00:00:00',
      from: { accountRef: { id: 'acc-clr' }, currency: 'USD', amount: 100 },
      to: { accountRef: { id: 'acc-bank' }, currency: 'USD', amount: 100 },
    })
  })

  it('posts a daily summary as a journal entry, debits positive and credits negative, balancing to zero', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/push/journalEntries', body: success('journalEntries', 'je-1') }])
    const doc = buildSummaryDoc(
      {
        date: '2026-10-06',
        currency: 'usd',
        orderCount: 1,
        postings: [
          { role: 'clearing', cents: 2480 },
          { role: 'income', cents: -2300 },
          { role: 'taxLiability', cents: -180 },
        ],
      } as never,
      { ...mapping, syncMode: 'daily-summary' },
    )
    await adapter.createJournal(session, doc, write)
    const body = sent(calls[0])
    expect(body.description).toContain(`[${doc.externalId}]`)
    const byAccount = Object.fromEntries(body.journalLines.map((line: { accountRef: { id: string }; netAmount: number }) => [line.accountRef.id, line.netAmount]))
    expect(byAccount['acc-clr']).toBe(24.8)
    expect(byAccount['acc-inc']).toBe(-23)
    const sum = body.journalLines.reduce((total: number, line: { netAmount: number }) => total + Math.round(line.netAmount * 100), 0)
    expect(sum).toBe(0)
  })

  it('reads a failed write as the ledger refusing it, with its reasons', async () => {
    const { adapter } = provider([
      {
        method: 'POST',
        match: '/push/directIncomes',
        body: { status: 'Failed', statusCode: 400, validation: { errors: [{ message: 'Account acc-inc is inactive.' }] } },
      },
    ])
    await expect(adapter.createSalesReceipt(session, buildSaleDoc(order as never, mapping), write)).rejects.toMatchObject({
      code: 'validation',
      message: 'Account acc-inc is inactive.',
    })
  })

  it('reads a timed-out write as needing a person, and one still pending as a retry', async () => {
    const timedOut = provider([{ method: 'POST', match: '/push/transfers', body: { status: 'TimedOut', statusCode: 504 } }])
    const doc = buildPayoutDoc({ payoutId: 'po_1', amountCents: 100, currency: 'usd', arrivedAtMs: Date.UTC(2026, 9, 8) } as never, mapping)
    await expect(timedOut.adapter.createDeposit(session, doc, write)).rejects.toMatchObject({ code: 'validation' })

    const pending = provider([
      { method: 'POST', match: '/push/transfers', body: { status: 'Pending', pushOperationKey: 'op-2' } },
      { method: 'GET', match: '/push/op-2', body: { status: 'Pending', pushOperationKey: 'op-2' } },
    ])
    await expect(pending.adapter.createDeposit(session, doc, write)).rejects.toMatchObject({ code: 'transient', retryable: true })
    expect(pending.waits).toHaveLength(7)
  })

  it('refuses to post before the settings made the walk-in customer', async () => {
    const { adapter, calls } = provider([])
    await expect(
      adapter.createSalesReceipt(session, buildSaleDoc(order as never, mapping), { ...write, extras: {} }),
    ).rejects.toMatchObject({ code: 'validation' })
    expect(calls).toHaveLength(0)
  })

  it('finds a posted document by its reference or its bracketed id; an unread cache finds nothing', async () => {
    const { adapter, calls } = provider([
      { match: '/connections/conn-1/data/directIncomes', body: { results: [{ id: 'di-1', reference: 'K3XQ-7' }] } },
      { match: '/connections/conn-1/data/transfers', body: { results: [] } },
      { match: `/companies/${COMPANY}/data/journalEntries`, status: 404, body: { error: 'Not synced' } },
    ])
    await expect(adapter.findByExternalId(session, 'sale', 'K3XQ-7')).resolves.toEqual({ id: 'di-1', type: 'directIncomes' })
    await expect(adapter.findByExternalId(session, 'payout', 'PO-123')).resolves.toBeNull()
    await expect(adapter.findByExternalId(session, 'summary', 'AGD-20261006-USD')).resolves.toBeNull()
    expect(new URL(calls[0].url).searchParams.get('query')).toBe('reference=K3XQ-7')
    expect(new URL(calls[1].url).searchParams.get('query')).toBe('description~[PO-123]')
  })

  it('derives the same GUID for the same key, and different ones for different keys', () => {
    expect(codatIdempotencyKey('a')).toBe(codatIdempotencyKey('a'))
    expect(codatIdempotencyKey('a')).not.toBe(codatIdempotencyKey('b'))
  })

  it('files nothing per buyer in the books contacts', async () => {
    const { adapter, calls } = provider([])
    await expect(adapter.upsertCustomer(session, { name: 'Ada', email: 'ada@example.com' })).resolves.toEqual({ id: '' })
    expect(calls).toHaveLength(0)
  })
})
