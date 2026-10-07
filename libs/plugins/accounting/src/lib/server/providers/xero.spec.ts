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

import { buildRefundDoc, buildSaleDoc, buildSummaryDoc, salePostings } from '../../model/accounting-transforms'
import type { AccountingMapping } from '../../model/accounting.types'
import { instantSleep, mockFetch } from '../../testing/mock-fetch'
import { AccountingPacer } from './http'
import { XERO_SCOPES, createXeroProvider } from './xero'

const session = { accessToken: 'access-1', tenantId: 'tenant-1' }
const mapping: AccountingMapping = {
  accounts: { income: 'acc-inc', clearing: 'acc-clr', feeExpense: 'acc-fee', payoutBank: 'acc-bank', taxLiability: 'acc-tax' },
  taxCodes: { taxed: 'OUTPUT', untaxed: 'NONE' },
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'UTC',
}
const extras = { 'code:acc-inc': '200', 'code:acc-fee': '404', 'code:acc-tax': '820' }
const order = {
  orgId: 'org-1',
  hostId: 'host-1',
  orderId: 'o1',
  number: 7,
  currency: 'nzd',
  paidAtMs: Date.UTC(2026, 9, 6),
  channel: 'online',
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  lines: [{ name: 'Mug', quantity: 2, unitAmountCents: 1000 }],
  totals: { itemsCents: 2000, shippingCents: 0, taxCents: 300, discountCents: 0, totalCents: 2300, feeCents: 0 },
  taxInclusive: false,
  taxKey: null,
}

function provider(routes: Parameters<typeof mockFetch>[0], scopes?: string) {
  const mocked = mockFetch(routes)
  const { sleep } = instantSleep()
  const adapter = createXeroProvider(
    { clientId: 'client', clientSecret: 'secret', scopes },
    { fetch: mocked.fetch, sleep, pacer: new AccountingPacer(0, Date.now, sleep) },
  )
  return { adapter, calls: mocked.calls }
}

describe('Xero adapter', () => {
  it('asks for the granular scopes, or the override', async () => {
    const url = new URL(await provider([]).adapter.authorizeUrl({ state: 's', redirectUri: 'https://x/cb', orgId: 'org-1', orgName: null }))
    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize')
    expect(url.searchParams.get('scope')).toBe(XERO_SCOPES.join(' '))
    expect(url.searchParams.get('scope')).toContain('offline_access')
    const legacy = new URL(
      await provider([], 'offline_access accounting.transactions').adapter.authorizeUrl({ state: 's', redirectUri: 'https://x/cb', orgId: 'org-1', orgName: null }),
    )
    expect(legacy.searchParams.get('scope')).toBe('offline_access accounting.transactions')
  })

  it('exchanges a code and lists the organizations the grant reaches', async () => {
    const { adapter } = provider([
      { match: 'identity.xero.com/connect/token', body: { access_token: 'a', refresh_token: 'r', expires_in: 1800 } },
      {
        match: 'api.xero.com/connections',
        body: [
          { id: 'conn-1', tenantId: 't-1', tenantType: 'ORGANISATION', tenantName: 'Demo Company (US)' },
          { id: 'conn-2', tenantId: 't-2', tenantType: 'PRACTICEMANAGER', tenantName: 'Practice' },
        ],
      },
    ])
    const result = await adapter.exchangeCode({ code: 'c', redirectUri: 'https://x/cb' })
    expect(result.tenants).toEqual([{ id: 't-1', name: 'Demo Company (US)', connectionId: 'conn-1' }])
    // Xero's refresh token lasts 60 days from each refresh.
    expect(result.tokens.refreshExpiresAtMs).toBeGreaterThan(Date.now() + 59 * 24 * 3600 * 1000)
  })

  it('posts a sale as an authorised invoice paid in full into clearing, both under idempotency keys', async () => {
    const { adapter, calls } = provider([
      { method: 'GET', match: '/Invoices', body: { Invoices: [] } },
      { method: 'PUT', match: '/Invoices', body: { Invoices: [{ InvoiceID: 'inv-1', AmountDue: 23 }] } },
      { method: 'PUT', match: '/Payments', body: { Payments: [{ PaymentID: 'pay-1' }] } },
    ])
    const doc = buildSaleDoc(order, mapping)
    const ref = await adapter.createSalesReceipt(session, doc, {
      idempotencyKey: 'aglyn-k',
      customerId: 'contact-1',
      extras,
      homeCurrency: 'NZD',
    })
    expect(ref).toEqual({ id: 'inv-1', type: 'Invoice', related: [{ id: 'pay-1', type: 'Payment' }] })
    const invoicePut = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/Invoices'))!
    expect(invoicePut.headers['xero-tenant-id']).toBe('tenant-1')
    expect(invoicePut.headers['idempotency-key']).toBe('aglyn-k:doc')
    const invoice = JSON.parse(invoicePut.body ?? '{}').Invoices[0]
    expect(invoice).toMatchObject({
      Type: 'ACCREC',
      Status: 'AUTHORISED',
      InvoiceNumber: doc.externalId,
      CurrencyCode: 'NZD',
      LineAmountTypes: 'Exclusive',
      Contact: { ContactID: 'contact-1' },
    })
    expect(invoice.LineItems[0]).toMatchObject({ AccountCode: '200', TaxType: 'OUTPUT', TaxAmount: 3, UnitAmount: 10, Quantity: 2 })
    const paymentPut = calls.find((call) => call.url.endsWith('/Payments'))!
    expect(paymentPut.headers['idempotency-key']).toBe('aglyn-k:pay')
    expect(JSON.parse(paymentPut.body ?? '{}').Payments[0]).toMatchObject({
      Invoice: { InvoiceID: 'inv-1' },
      Account: { AccountID: 'acc-clr' },
      Amount: 23,
    })
  })

  it('finishes an invoice a failed attempt left unpaid rather than making a second', async () => {
    const { adapter, calls } = provider([
      { method: 'GET', match: '/Invoices', body: { Invoices: [{ InvoiceID: 'inv-1', AmountDue: 23, Status: 'AUTHORISED' }] } },
      { method: 'PUT', match: '/Payments', body: { Payments: [{ PaymentID: 'pay-1' }] } },
    ])
    await adapter.createSalesReceipt(session, buildSaleDoc(order, mapping), {
      idempotencyKey: 'k',
      customerId: 'c',
      extras,
      homeCurrency: 'NZD',
    })
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.url)).toEqual([
      'https://api.xero.com/api.xro/2.0/Payments',
    ])
    // Not "found" for the engine while it still owes its payment…
    const unpaid = provider([{ match: '/Invoices', body: { Invoices: [{ InvoiceID: 'inv-1', AmountDue: 23 }] } }])
    await expect(unpaid.adapter.findByExternalId(session, 'sale', 'X')).resolves.toBeNull()
    // …and found once it is settled.
    const paid = provider([{ match: '/Invoices', body: { Invoices: [{ InvoiceID: 'inv-1', AmountDue: 0 }] } }])
    await expect(paid.adapter.findByExternalId(session, 'sale', 'X')).resolves.toEqual({ id: 'inv-1', type: 'Invoice' })
  })

  it('posts a refund as a credit note refunded out of clearing', async () => {
    const { adapter, calls } = provider([
      { method: 'GET', match: '/CreditNotes', body: { CreditNotes: [] } },
      { method: 'PUT', match: '/CreditNotes', body: { CreditNotes: [{ CreditNoteID: 'cn-1', RemainingCredit: 11.5 }] } },
      { method: 'PUT', match: '/Payments', body: { Payments: [{ PaymentID: 'pay-2' }] } },
    ])
    const doc = buildRefundDoc({ order, refundId: 're_1', amountCents: 1150, refundedAtMs: 0, feeRefundedCents: 0 }, mapping)
    await adapter.createRefundReceipt(session, doc, { idempotencyKey: 'k', customerId: 'c', extras, homeCurrency: 'NZD' })
    const note = JSON.parse(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/CreditNotes'))!.body ?? '{}')
      .CreditNotes[0]
    expect(note).toMatchObject({ Type: 'ACCRECCREDIT', CreditNoteNumber: doc.externalId, Reference: doc.saleExternalId })
    expect(JSON.parse(calls.find((call) => call.url.endsWith('/Payments'))!.body ?? '{}').Payments[0]).toMatchObject({
      CreditNote: { CreditNoteID: 'cn-1' },
      Amount: 11.5,
    })
  })

  it('posts a daily summary with debits positive and credits negative', async () => {
    const { adapter, calls } = provider([
      { method: 'PUT', match: '/ManualJournals', body: { ManualJournals: [{ ManualJournalID: 'mj-1' }] } },
    ])
    const doc = buildSummaryDoc({ date: '2026-10-06', currency: 'nzd', postings: salePostings(order), orderCount: 1 }, mapping)!
    await adapter.createJournal(session, doc, { idempotencyKey: 'k', customerId: null, extras, homeCurrency: 'NZD' })
    const lines = JSON.parse(calls[0].body ?? '{}').ManualJournals[0].JournalLines as Array<{ LineAmount: number }>
    expect(lines.reduce((total, line) => total + Math.round(line.LineAmount * 100), 0)).toBe(0)
    // Clearing has no code here, so it posts by id.
    expect(lines.some((line) => (line as { AccountID?: string }).AccountID === 'acc-clr')).toBe(true)
  })

  it('reads its validation errors into the message', async () => {
    const { adapter } = provider([
      {
        method: 'PUT',
        match: '/BankTransfers',
        status: 400,
        body: { Elements: [{ ValidationErrors: [{ Message: 'The From Bank Account must be a bank account.' }] }] },
      },
    ])
    await expect(
      adapter.createDeposit(
        session,
        { kind: 'payout', externalId: 'PO-1', date: '2026-10-06', currency: 'NZD', memo: '', amountCents: 100, fromAccountId: 'a', toAccountId: 'b' },
        { idempotencyKey: 'k', customerId: null, extras: {}, homeCurrency: 'NZD' },
      ),
    ).rejects.toMatchObject({ code: 'validation', message: 'The From Bank Account must be a bank account.' })
  })

  it('deletes the connection and revokes the grant on disconnect, tolerating a grant already gone', async () => {
    const { adapter, calls } = provider([
      { method: 'DELETE', match: '/connections/conn-1', status: 404 },
      { method: 'POST', match: '/connect/revocation', status: 200, body: {} },
    ])
    await adapter.revoke({ refreshToken: 'r', accessToken: 'a', connectionId: 'conn-1' })
    expect(calls.map((call) => call.method)).toEqual(['DELETE', 'POST'])
  })
})
