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

import { buildSaleDoc, buildPayoutDoc } from '../../model/accounting-transforms'
import type { AccountingMapping } from '../../model/accounting.types'
import { instantSleep, mockFetch } from '../../testing/mock-fetch'
import { AccountingPacer, AccountingProviderError } from './http'
import { QUICKBOOKS_MINOR_VERSION, createQuickBooksProvider, quickBooksLiteral } from './quickbooks'

const config = { clientId: 'client', clientSecret: 'secret', environment: 'sandbox' as const }
const session = { accessToken: 'access-1', tenantId: '9130' }
const mapping: AccountingMapping = {
  accounts: { income: '79', clearing: '35', feeExpense: '60', payoutBank: '36' },
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

function provider(routes: Parameters<typeof mockFetch>[0]) {
  const mocked = mockFetch(routes)
  const { sleep, waits } = instantSleep()
  const adapter = createQuickBooksProvider(config, {
    fetch: mocked.fetch,
    sleep,
    pacer: new AccountingPacer(0, Date.now, sleep),
  })
  return { adapter, calls: mocked.calls, waits }
}

describe('QuickBooks Online adapter', () => {
  it('builds the consent address with the accounting scope and the signed state', async () => {
    const { adapter } = provider([])
    const url = new URL(
      await adapter.authorizeUrl({
        state: 'as1.x.y',
        redirectUri: 'https://app.aglyn.com/api/accounting/oauth/callback',
        orgId: 'org-1',
        orgName: null,
      }),
    )
    expect(url.origin + url.pathname).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting')
    expect(url.searchParams.get('state')).toBe('as1.x.y')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('exchanges a code with Basic credentials and binds the realm', async () => {
    const { adapter, calls } = provider([
      {
        match: 'oauth.platform.intuit.com',
        body: { access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8640000 },
      },
    ])
    const result = await adapter.exchangeCode({ code: 'code-1', redirectUri: 'https://x/cb', realmId: '9130' })
    expect(result.tenants).toEqual([{ id: '9130', name: '' }])
    expect(result.tokens.refreshExpiresAtMs).toBeGreaterThan(Date.now() + 99 * 24 * 3600 * 1000)
    expect(calls[0].headers['authorization']).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`)
    expect(calls[0].body).toContain('grant_type=authorization_code')
    await expect(adapter.exchangeCode({ code: 'c', redirectUri: 'x', realmId: null })).rejects.toThrow(/which company/)
  })

  it('hands back the ROTATED refresh token, and a refused grant as auth', async () => {
    const rotated = provider([
      { match: 'tokens/bearer', body: { access_token: 'a2', refresh_token: 'r2-new', expires_in: 3600 } },
    ])
    await expect(rotated.adapter.refresh('r1')).resolves.toMatchObject({ accessToken: 'a2', refreshToken: 'r2-new' })
    expect(rotated.calls[0].body).toContain('refresh_token=r1')

    const refused = provider([{ match: 'tokens/bearer', status: 400, body: { error: 'invalid_grant' } }])
    await expect(refused.adapter.refresh('r1')).rejects.toMatchObject({ code: 'auth' })
  })

  it('posts a sales receipt pinned to the minor version, with the idempotency key and DocNumber', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/salesreceipt', body: { SalesReceipt: { Id: '145' } } }])
    const doc = buildSaleDoc(order, mapping)
    const ref = await adapter.createSalesReceipt(session, doc, {
      idempotencyKey: 'aglyn-key-1',
      customerId: '58',
      extras: { saleItemId: '20', shippingItemId: '21' },
      homeCurrency: 'USD',
    })
    expect(ref).toEqual({ id: '145', type: 'SalesReceipt' })
    const url = new URL(calls[0].url)
    expect(url.origin).toBe('https://sandbox-quickbooks.api.intuit.com')
    expect(url.pathname).toBe('/v3/company/9130/salesreceipt')
    expect(url.searchParams.get('minorversion')).toBe(String(QUICKBOOKS_MINOR_VERSION))
    expect(url.searchParams.get('requestid')).toBe('aglyn-key-1')
    const body = JSON.parse(calls[0].body ?? '{}')
    expect(body).toMatchObject({
      DocNumber: doc.externalId,
      CustomerRef: { value: '58' },
      DepositToAccountRef: { value: '35' },
      GlobalTaxCalculation: 'TaxExcluded',
      TxnTaxDetail: { TotalTax: 1.6 },
    })
    expect(body.CurrencyRef).toBeUndefined()
    expect(body.Line[0]).toMatchObject({
      Amount: 20,
      SalesItemLineDetail: { ItemRef: { value: '20' }, Qty: 2, UnitPrice: 10, TaxCodeRef: { value: 'TAX' } },
    })
  })

  it('names the currency only when it is not the home currency', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/salesreceipt', body: { SalesReceipt: { Id: '1' } } }])
    await adapter.createSalesReceipt(session, buildSaleDoc({ ...order, currency: 'cad' }, mapping), {
      idempotencyKey: 'k',
      customerId: null,
      extras: { saleItemId: '20', shippingItemId: '21' },
      homeCurrency: 'USD',
    })
    expect(JSON.parse(calls[0].body ?? '{}').CurrencyRef).toEqual({ value: 'CAD' })
  })

  it('finds a document again by its DocNumber', async () => {
    const { adapter, calls } = provider([
      { match: '/query', body: { QueryResponse: { SalesReceipt: [{ Id: '145' }] } } },
    ])
    await expect(adapter.findByExternalId(session, 'sale', 'K3XQ-7')).resolves.toEqual({ id: '145', type: 'SalesReceipt' })
    expect(new URL(calls[0].url).searchParams.get('query')).toBe("select Id from SalesReceipt where DocNumber = 'K3XQ-7'")
    await expect(adapter.findByExternalId(session, 'payout', 'PO-1')).resolves.toBeNull()
  })

  it('posts a payout as a transfer from clearing to the bank', async () => {
    const { adapter, calls } = provider([{ method: 'POST', match: '/transfer', body: { Transfer: { Id: '9' } } }])
    const doc = buildPayoutDoc(
      { orgId: 'org-1', payoutId: 'po_1', amountCents: 12345, currency: 'usd', arrivedAtMs: 0, statementDescriptor: null },
      mapping,
    )
    await adapter.createDeposit(session, doc, { idempotencyKey: 'k', customerId: null, extras: {}, homeCurrency: 'USD' })
    expect(JSON.parse(calls[0].body ?? '{}')).toMatchObject({
      FromAccountRef: { value: '35' },
      ToAccountRef: { value: '36' },
      Amount: 123.45,
    })
  })

  it('waits out a short Retry-After and tries again; a 400 is the document refused', async () => {
    const retried = provider([
      { match: '/query', status: 429, headers: { 'Retry-After': '2' }, times: 1 },
      { match: '/query', body: { QueryResponse: {} } },
    ])
    await expect(retried.adapter.findByExternalId(session, 'sale', 'X')).resolves.toBeNull()
    expect(retried.waits).toContain(2000)

    const refused = provider([
      {
        method: 'POST',
        match: '/salesreceipt',
        status: 400,
        body: { Fault: { Error: [{ Message: 'Business Validation Error', Detail: 'Account is inactive' }] } },
      },
    ])
    const error = await refused.adapter
      .createSalesReceipt(session, buildSaleDoc(order, mapping), {
        idempotencyKey: 'k',
        customerId: null,
        extras: { saleItemId: '20', shippingItemId: '21' },
        homeCurrency: 'USD',
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AccountingProviderError)
    expect(error).toMatchObject({ code: 'validation', message: 'Business Validation Error: Account is inactive' })
  })

  it('makes the sales items once, and repoints one at a changed income account', async () => {
    const { adapter, calls } = provider([
      { match: /query.*Aglyn(%20|\+)sales/, body: { QueryResponse: { Item: [{ Id: '20', SyncToken: '3', IncomeAccountRef: { value: '1' } }] } } },
      { match: /query.*Aglyn(%20|\+)shipping/, body: { QueryResponse: {} } },
      { method: 'POST', match: '/item', body: { Item: { Id: '21' } } },
    ])
    await expect(adapter.prepare(session, { income: '79' }, {})).resolves.toEqual({ saleItemId: '20', shippingItemId: '21' })
    const posts = calls.filter((call) => call.method === 'POST').map((call) => JSON.parse(call.body ?? '{}'))
    expect(posts[0]).toMatchObject({ Id: '20', SyncToken: '3', sparse: true, IncomeAccountRef: { value: '79' } })
    expect(posts[1]).toMatchObject({ Name: 'Aglyn shipping', Type: 'Service', IncomeAccountRef: { value: '79' } })
  })

  it('escapes a query literal', () => {
    expect(quickBooksLiteral("O'Brien")).toBe("'O\\'Brien'")
  })
})
