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
 * Every Xero call the adapter makes, against a scripted fetch (AGL-3614):
 * the address, the tenant header, the body Xero reads and what the adapter
 * makes of the answer. `xero.spec.ts` holds the consent, the code exchange,
 * invoices, credit notes, the journal and disconnect.
 */

import { buildFeeDoc, buildFeeRefundDoc } from '../../model/accounting-transforms'
import type { AccountingMapping } from '../../model/accounting.types'
import { instantSleep, mockFetch } from '../../testing/mock-fetch'
import { AccountingPacer } from './http'
import { XERO_ENDPOINTS, createXeroProvider } from './xero'

const session = { accessToken: 'access-1', tenantId: 'tenant-1' }
const mapping: AccountingMapping = {
  accounts: { income: 'acc-inc', clearing: 'acc-clr', feeExpense: 'acc-fee', payoutBank: 'acc-bank' },
  taxCodes: { taxed: 'OUTPUT', untaxed: 'NONE' },
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'UTC',
}
const order = {
  orgId: 'org-1',
  hostId: 'host-1',
  orderId: 'o1',
  number: 7,
  currency: 'gbp',
  paidAtMs: Date.UTC(2026, 9, 6),
  channel: 'online',
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  lines: [{ name: 'Mug', quantity: 2, unitAmountCents: 1000 }],
  totals: { itemsCents: 2000, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 2000, feeCents: 60 },
  taxInclusive: false,
  taxKey: null,
}
const refund = { order, refundId: 're_1', amountCents: 1000, refundedAtMs: Date.UTC(2026, 9, 7), feeRefundedCents: 30 }

function provider(routes: Parameters<typeof mockFetch>[0]) {
  const mocked = mockFetch(routes)
  const { sleep } = instantSleep()
  const adapter = createXeroProvider(
    { clientId: 'client', clientSecret: 'secret' },
    { fetch: mocked.fetch, sleep, pacer: new AccountingPacer(0, Date.now, sleep) },
  )
  return { adapter, calls: mocked.calls }
}

const sent = (call: { body: string | null }) => JSON.parse(call.body ?? '{}')

describe('Xero adapter, call by call', () => {
  it('refreshes with Basic credentials and hands back the rotated token; a refused grant is auth', async () => {
    const rotated = provider([
      { method: 'POST', match: XERO_ENDPOINTS.token, body: { access_token: 'a2', refresh_token: 'r2', expires_in: 1800 } },
    ])
    await expect(rotated.adapter.refresh('r1')).resolves.toMatchObject({ accessToken: 'a2', refreshToken: 'r2' })
    expect(rotated.calls[0].headers['authorization']).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`)
    expect(rotated.calls[0].body).toContain('grant_type=refresh_token')
    expect(rotated.calls[0].body).toContain('refresh_token=r1')

    const refused = provider([{ method: 'POST', match: XERO_ENDPOINTS.token, status: 400, body: { error: 'invalid_grant' } }])
    await expect(refused.adapter.refresh('r1')).rejects.toMatchObject({ code: 'auth' })
  })

  it('reads the organization name and base currency, with the tenant header on every call', async () => {
    const { adapter, calls } = provider([
      { match: '/Organisation', body: { Organisations: [{ Name: 'Ada Ltd', BaseCurrency: 'gbp' }] } },
      { match: '/Currencies', body: { Currencies: [{ Code: 'GBP' }, { Code: 'EUR' }] } },
    ])
    await expect(adapter.companyInfo(session)).resolves.toEqual({ name: 'Ada Ltd', homeCurrency: 'GBP', multiCurrency: true })
    for (const call of calls) {
      expect(call.headers['xero-tenant-id']).toBe('tenant-1')
      expect(call.headers['authorization']).toBe('Bearer access-1')
    }
  })

  it('lists the active accounts, classified, with their codes', async () => {
    const { adapter, calls } = provider([
      {
        match: '/Accounts',
        body: {
          Accounts: [
            { AccountID: 'acc-clr', Name: 'Aglyn clearing', Type: 'BANK', Code: '' },
            { AccountID: 'acc-inc', Name: 'Sales', Type: 'REVENUE', Code: '200', CurrencyCode: 'GBP' },
            { AccountID: 'acc-fee', Name: 'Fees', Type: 'EXPENSE', Code: '404' },
            { Name: 'No id' },
          ],
        },
      },
    ])
    const accounts = await adapter.listAccounts(session)
    expect(new URL(calls[0].url).searchParams.get('where')).toBe('Status=="ACTIVE"')
    expect(accounts.map((account) => [account.id, account.code])).toEqual([
      ['acc-clr', null],
      ['acc-inc', '200'],
      ['acc-fee', '404'],
    ])
    expect(accounts[0].classification).toBe('bank')
    expect(accounts[1]).toMatchObject({ classification: 'income', currency: 'GBP' })
  })

  it('lists the active tax rates with their effective rate', async () => {
    const { adapter } = provider([
      {
        match: '/TaxRates',
        body: { TaxRates: [{ TaxType: 'OUTPUT2', Name: '20% (VAT on Income)', EffectiveRate: '20' }, { TaxType: 'NONE', Name: 'No VAT' }] },
      },
    ])
    await expect(adapter.listTaxRates(session)).resolves.toEqual([
      { id: 'OUTPUT2', name: '20% (VAT on Income)', ratePercent: 20 },
      { id: 'NONE', name: 'No VAT', ratePercent: null },
    ])
  })

  it('remembers the code of each mapped account, and reads nothing when none is mapped', async () => {
    const { adapter } = provider([
      {
        match: '/Accounts',
        body: { Accounts: [{ AccountID: 'acc-inc', Code: '200' }, { AccountID: 'acc-fee', Code: '404' }, { AccountID: 'other', Code: '1' }] },
      },
    ])
    await expect(adapter.prepare(session, { income: 'acc-inc', feeExpense: 'acc-fee' }, {})).resolves.toEqual({
      'code:acc-inc': '200',
      'code:acc-fee': '404',
    })
    const idle = provider([])
    await expect(idle.adapter.prepare(session, {}, {})).resolves.toEqual({})
    expect(idle.calls).toHaveLength(0)
  })

  it('finds a contact by address, or makes one under a key derived from it', async () => {
    const found = provider([{ match: '/Contacts', body: { Contacts: [{ ContactID: 'c-1', Status: 'ACTIVE' }] } }])
    await expect(found.adapter.upsertCustomer(session, { name: 'Ada', email: 'ada@example.com' })).resolves.toEqual({ id: 'c-1' })
    expect(new URL(found.calls[0].url).searchParams.get('where')).toBe('EmailAddress=="ada@example.com"')

    const made = provider([
      { method: 'GET', match: '/Contacts', body: { Contacts: [] } },
      { method: 'PUT', match: '/Contacts', body: { Contacts: [{ ContactID: 'c-2' }] } },
    ])
    await expect(made.adapter.upsertCustomer(session, { name: 'Ada', email: 'Ada@Example.com' })).resolves.toEqual({ id: 'c-2' })
    const put = made.calls.find((call) => call.method === 'PUT')!
    expect(sent(put)).toEqual({ Contacts: [{ Name: 'Ada', EmailAddress: 'Ada@Example.com' }] })
    expect(put.headers['idempotency-key']).toBe('contact:ada@example.com')
  })

  it('posts a fee as a SPEND out of clearing and a returned fee as a RECEIVE, by account code', async () => {
    const { adapter, calls } = provider([
      { method: 'PUT', match: '/BankTransactions', body: { BankTransactions: [{ BankTransactionID: 'bt-1' }] } },
    ])
    const context = { idempotencyKey: 'k-fee', customerId: 'c-aglyn', extras: { 'code:acc-fee': '404' }, homeCurrency: 'GBP' }
    await expect(adapter.createExpense(session, buildFeeDoc(order, mapping)!, context)).resolves.toEqual({
      id: 'bt-1',
      type: 'BankTransaction',
    })
    await adapter.createExpense(session, buildFeeRefundDoc(refund, mapping)!, context)
    const [fee, returned] = calls.map((call) => sent(call).BankTransactions[0])
    expect(fee).toMatchObject({
      Type: 'SPEND',
      Contact: { ContactID: 'c-aglyn' },
      BankAccount: { AccountID: 'acc-clr' },
      CurrencyCode: 'GBP',
      LineItems: [{ UnitAmount: 0.6, AccountCode: '404' }],
    })
    expect(returned).toMatchObject({ Type: 'RECEIVE', LineItems: [{ UnitAmount: 0.3 }] })
    expect(calls[0].headers['idempotency-key']).toBe('k-fee')
  })

  it('refuses a fee with no contact before calling Xero', async () => {
    const { adapter, calls } = provider([])
    await expect(
      adapter.createExpense(session, buildFeeDoc(order, mapping)!, { idempotencyKey: 'k', customerId: null, extras: {}, homeCurrency: 'GBP' }),
    ).rejects.toMatchObject({ code: 'validation' })
    expect(calls).toHaveLength(0)
  })

  it('looks fees and payouts up by reference, a refund only once it is settled, and a journal not at all', async () => {
    const { adapter, calls } = provider([
      { match: '/BankTransactions', body: { BankTransactions: [{ BankTransactionID: 'bt-1' }] } },
      { match: '/BankTransfers', body: { BankTransfers: [{ BankTransferID: 'tr-1', Status: 'DELETED' }] } },
      { match: '/CreditNotes', body: { CreditNotes: [{ CreditNoteID: 'cn-1', RemainingCredit: 5 }] } },
    ])
    await expect(adapter.findByExternalId(session, 'fee', 'F-1')).resolves.toEqual({ id: 'bt-1', type: 'BankTransaction' })
    // A deleted transfer is not the payout.
    await expect(adapter.findByExternalId(session, 'payout', 'PO-1')).resolves.toBeNull()
    // A credit note still holding credit is finished by the create.
    await expect(adapter.findByExternalId(session, 'refund', 'R-1')).resolves.toBeNull()
    await expect(adapter.findByExternalId(session, 'summary', 'S-1')).resolves.toBeNull()
    expect(calls.map((call) => new URL(call.url).searchParams.get('where'))).toEqual([
      'Reference=="F-1"',
      'Reference=="PO-1"',
      'CreditNoteNumber=="R-1"',
    ])
  })
})
