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

/**
 * Every QuickBooks Online call the adapter makes, against a scripted fetch
 * (AGL-3614): the address, the method, the body Intuit reads and what the
 * adapter makes of the answer. `quickbooks.spec.ts` holds the consent, the
 * token exchange, the sales receipt, the transfer and the retry policy.
 */

import { buildFeeDoc, buildFeeRefundDoc, buildRefundDoc, buildSummaryDoc, salePostings } from '../../model/accounting-transforms'
import type { AccountingMapping } from '../../model/accounting.types'
import { instantSleep, mockFetch } from '../../testing/mock-fetch'
import { AccountingPacer } from './http'
import { QUICKBOOKS_ENDPOINTS, createQuickBooksProvider } from './quickbooks'

const session = { accessToken: 'access-1', tenantId: '9130' }
const mapping: AccountingMapping = {
  accounts: { income: '79', clearing: '35', feeExpense: '60', payoutBank: '36', taxLiability: '88' },
  taxCodes: { taxed: 'TAX', untaxed: 'NON' },
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
  totals: { itemsCents: 2000, shippingCents: 0, taxCents: 160, discountCents: 0, totalCents: 2160, feeCents: 60 },
  taxInclusive: false,
  taxKey: null,
}
const refund = { order, refundId: 're_1', amountCents: 1080, refundedAtMs: Date.UTC(2026, 9, 7), feeRefundedCents: 30 }
const context = { idempotencyKey: 'aglyn-key', customerId: '58', extras: { saleItemId: '20', shippingItemId: '21' }, homeCurrency: 'USD' }

function provider(routes: Parameters<typeof mockFetch>[0]) {
  const mocked = mockFetch(routes)
  const { sleep } = instantSleep()
  const adapter = createQuickBooksProvider(
    { clientId: 'client', clientSecret: 'secret', environment: 'sandbox' },
    { fetch: mocked.fetch, sleep, pacer: new AccountingPacer(0, Date.now, sleep) },
  )
  return { adapter, calls: mocked.calls }
}

const sent = (call: { body: string | null }) => JSON.parse(call.body ?? '{}')

describe('QuickBooks Online adapter, call by call', () => {
  it('revokes the refresh token with Basic credentials, and treats a token Intuit no longer knows as revoked', async () => {
    const ok = provider([{ method: 'POST', match: QUICKBOOKS_ENDPOINTS.revoke, body: {} }])
    await ok.adapter.revoke({ refreshToken: 'r-1' })
    expect(ok.calls[0].url).toBe(QUICKBOOKS_ENDPOINTS.revoke)
    expect(ok.calls[0].headers['authorization']).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`)
    expect(sent(ok.calls[0])).toEqual({ token: 'r-1' })

    const gone = provider([{ method: 'POST', match: QUICKBOOKS_ENDPOINTS.revoke, status: 400, body: { error: 'invalid_token' } }])
    await expect(gone.adapter.revoke({ refreshToken: 'r-1' })).resolves.toBeUndefined()

    const down = provider([{ method: 'POST', match: QUICKBOOKS_ENDPOINTS.revoke, status: 503, body: {} }])
    await expect(down.adapter.revoke({ refreshToken: 'r-1' })).rejects.toMatchObject({ retryable: true })
  })

  it('reads the company name, its home currency and whether it keeps more than one', async () => {
    const { adapter, calls } = provider([
      { match: '/companyinfo/9130', body: { CompanyInfo: { CompanyName: 'Ada’s Mugs' } } },
      {
        match: '/preferences',
        body: { Preferences: { CurrencyPrefs: { HomeCurrency: { value: 'cad' }, MultiCurrencyEnabled: true } } },
      },
    ])
    await expect(adapter.companyInfo(session)).resolves.toEqual({ name: 'Ada’s Mugs', homeCurrency: 'CAD', multiCurrency: true })
    for (const call of calls) {
      expect(call.method).toBe('GET')
      expect(call.headers['authorization']).toBe('Bearer access-1')
    }
  })

  it('lists the active chart of accounts, classified for the mapping pickers', async () => {
    const { adapter, calls } = provider([
      {
        match: '/query',
        body: {
          QueryResponse: {
            Account: [
              { Id: '35', Name: 'Aglyn clearing', AccountType: 'Bank', Classification: 'Asset' },
              { Id: '79', FullyQualifiedName: 'Sales:Online', AcctNum: '4000', AccountType: 'Income', Classification: 'Revenue', CurrencyRef: { value: 'USD' } },
              { Id: '60', Name: 'Fees', AccountType: 'Expense', Classification: 'Expense' },
              { Id: '88', Name: 'Sales tax', AccountType: 'Other Current Liability', Classification: 'Liability' },
              { Name: 'No id' },
            ],
          },
        },
      },
    ])
    const accounts = await adapter.listAccounts(session)
    expect(new URL(calls[0].url).searchParams.get('query')).toBe('select * from Account where Active = true MAXRESULTS 1000')
    expect(accounts.map((account) => [account.id, account.classification])).toEqual([
      ['35', 'bank'],
      ['79', 'income'],
      ['60', 'expense'],
      ['88', 'liability'],
    ])
    expect(accounts[1]).toMatchObject({ code: '4000', name: 'Sales:Online', currency: 'USD' })
  })

  it('lists the active tax codes', async () => {
    const { adapter, calls } = provider([
      { match: '/query', body: { QueryResponse: { TaxCode: [{ Id: 'TAX', Name: 'Taxable' }, { Id: 'NON' }] } } },
    ])
    await expect(adapter.listTaxRates(session)).resolves.toEqual([
      { id: 'TAX', name: 'Taxable', ratePercent: null },
      { id: 'NON', name: 'NON', ratePercent: null },
    ])
    expect(new URL(calls[0].url).searchParams.get('query')).toContain('from TaxCode where Active = true')
  })

  it('finds a customer by display name, or makes one', async () => {
    const found = provider([{ match: '/query', body: { QueryResponse: { Customer: [{ Id: '58' }] } } }])
    await expect(found.adapter.upsertCustomer(session, { name: 'Ada', email: 'ada@example.com' })).resolves.toEqual({ id: '58' })
    expect(new URL(found.calls[0].url).searchParams.get('query')).toBe(
      "select Id from Customer where DisplayName = 'ada@example.com'",
    )
    expect(found.calls).toHaveLength(1)

    const made = provider([
      { match: '/query', body: { QueryResponse: {} } },
      { method: 'POST', match: '/customer', body: { Customer: { Id: '59' } } },
    ])
    await expect(made.adapter.upsertCustomer(session, { name: 'Ada', email: 'ada@example.com' })).resolves.toEqual({ id: '59' })
    expect(sent(made.calls[1])).toEqual({
      DisplayName: 'ada@example.com',
      CompanyName: 'Ada',
      PrimaryEmailAddr: { Address: 'ada@example.com' },
    })
  })

  it('takes the customer another write made in between, when the name is already taken', async () => {
    const { adapter } = provider([
      { match: '/query', body: { QueryResponse: {} }, times: 1 },
      {
        method: 'POST',
        match: '/customer',
        status: 400,
        body: { Fault: { Error: [{ Message: 'Duplicate Name Exists Error' }] } },
      },
      { match: '/query', body: { QueryResponse: { Customer: [{ Id: '60' }] } } },
    ])
    await expect(adapter.upsertCustomer(session, { name: 'Ada', email: null })).resolves.toEqual({ id: '60' })
  })

  it('posts a refund as a refund receipt paid out of clearing, under the idempotency key', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/refundreceipt', body: { RefundReceipt: { Id: '146' } } }])
    const doc = buildRefundDoc(refund, mapping)
    await expect(adapter.createRefundReceipt(session, doc, context)).resolves.toEqual({ id: '146', type: 'RefundReceipt' })
    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/v3/company/9130/refundreceipt')
    expect(url.searchParams.get('requestid')).toBe('aglyn-key')
    expect(sent(calls[0])).toMatchObject({
      DocNumber: doc.externalId,
      DepositToAccountRef: { value: '35' },
      CustomerRef: { value: '58' },
      TxnTaxDetail: { TotalTax: 0.8 },
    })
  })

  it('posts a fee as a purchase out of clearing, and a returned fee as a credit', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/purchase', body: { Purchase: { Id: '7' } } }])
    await adapter.createExpense(session, buildFeeDoc(order, mapping)!, context)
    await adapter.createExpense(session, buildFeeRefundDoc(refund, mapping)!, context)
    expect(sent(calls[0])).toMatchObject({
      PaymentType: 'Cash',
      AccountRef: { value: '35' },
      Credit: false,
      Line: [{ Amount: 0.6, AccountBasedExpenseLineDetail: { AccountRef: { value: '60' } } }],
    })
    expect(sent(calls[1])).toMatchObject({ Credit: true, Line: [{ Amount: 0.3 }] })
    expect(sent(calls[0]).CurrencyRef).toBeUndefined()
  })

  it('posts a fee in a foreign currency with its currency named', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/purchase', body: { Purchase: { Id: '7' } } }])
    await adapter.createExpense(session, buildFeeDoc({ ...order, currency: 'eur' }, mapping)!, context)
    expect(sent(calls[0]).CurrencyRef).toEqual({ value: 'EUR' })
  })

  it('posts a daily summary as a balanced journal entry', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/journalentry', body: { JournalEntry: { Id: '300' } } }])
    const doc = buildSummaryDoc({ date: '2026-10-06', currency: 'usd', postings: salePostings(order), orderCount: 1 }, mapping)!
    await expect(adapter.createJournal(session, doc, context)).resolves.toEqual({ id: '300', type: 'JournalEntry' })
    const lines = sent(calls[0]).Line as Array<{ Amount: number; JournalEntryLineDetail: { PostingType: string } }>
    const signed = lines.map((line) => Math.round(line.Amount * 100) * (line.JournalEntryLineDetail.PostingType === 'Debit' ? 1 : -1))
    expect(signed.reduce((total, cents) => total + cents, 0)).toBe(0)
    expect(sent(calls[0]).DocNumber).toBe(doc.externalId)
  })

  it('looks a fee up as a purchase, and a summary as a journal entry', async () => {
    const { adapter, calls } = provider([{ match: '/query', body: { QueryResponse: {} } }])
    await expect(adapter.findByExternalId(session, 'fee', 'F-1')).resolves.toBeNull()
    await expect(adapter.findByExternalId(session, 'summary', 'S-1')).resolves.toBeNull()
    expect(calls.map((call) => new URL(call.url).searchParams.get('query'))).toEqual([
      "select Id from Purchase where DocNumber = 'F-1'",
      "select Id from JournalEntry where DocNumber = 'S-1'",
    ])
  })
})
