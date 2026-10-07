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

import { createAvalaraProvider } from './avalara'
import { TaxProviderError, type ProviderFetch } from './http'
import { createTaxJarProvider, TAXJAR_API_VERSION } from './taxjar'
import type { TaxCommitRequest, TaxDocument, TaxProviderCredentials } from './types'

/**
 * Every vendor call, against a recorded fake (AGL-3631): what each adapter
 * sends — URL, method, auth, body in decimal units — and how it reads each
 * answer back to integer cents, including the refusals and retries that make
 * recording idempotent.
 */

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

function recorder(answer: (call: Call) => { status: number; body?: unknown } | Error) {
  const calls: Call[] = []
  const fetchImpl: ProviderFetch = async (url, init = {}) => {
    const call: Call = {
      url: String(url),
      method: String(init.method ?? 'GET'),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const reply = answer(call)
    if (reply instanceof Error) throw reply
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status,
    })
  }
  return { calls, fetchImpl }
}

const SHIP_FROM = { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' }
const SHIP_TO = { line1: '9 Elm St', city: 'Dallas', region: 'TX', postalCode: '75201', country: 'US' }

const DOCUMENT: TaxDocument = {
  code: 'order-1',
  date: '2026-10-07',
  currency: 'USD',
  customerCode: 'ada@example.com',
  shipFrom: SHIP_FROM,
  shipTo: SHIP_TO,
  lines: [
    { id: '0', quantity: 2, amountCents: 5_000, discountCents: 500, taxCode: 'PC040100', itemCode: 'SKU-1' },
    { id: '1', quantity: 1, amountCents: 1_999, discountCents: 0, exempt: true },
  ],
  shippingCents: 700,
}

const SALE: TaxCommitRequest = { ...DOCUMENT, collectedTaxCents: 412 }

const AVALARA: TaxProviderCredentials = {
  provider: 'avalara',
  environment: 'sandbox',
  accountId: '2000123456',
  companyCode: 'SHOP',
  secret: 'license-key',
}

const TAXJAR: TaxProviderCredentials = { provider: 'taxjar', environment: 'production', secret: 'tj-token' }

describe('Avalara AvaTax adapter', () => {
  it('quotes a SalesOrder in decimal units and reads the tax back by line, shipping apart', async () => {
    const { calls, fetchImpl } = recorder(() => ({
      status: 201,
      body: {
        totalTax: 4.17,
        lines: [
          { lineNumber: '0', tax: 3.71 },
          { lineNumber: '1', tax: 0 },
          { lineNumber: 'shipping', tax: 0.46 },
        ],
      },
    }))
    const answer = await createAvalaraProvider(fetchImpl).quote(AVALARA, DOCUMENT)
    expect(answer).toEqual({
      taxCents: 417,
      lines: [
        { id: '0', taxCents: 371 },
        { id: '1', taxCents: 0 },
      ],
      shippingTaxCents: 46,
    })
    const [call] = calls
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://sandbox-rest.avatax.com/api/v2/transactions/create')
    expect(call.headers.Authorization).toBe(
      `Basic ${Buffer.from('2000123456:license-key').toString('base64')}`,
    )
    expect(call.body).toMatchObject({
      type: 'SalesOrder',
      commit: false,
      companyCode: 'SHOP',
      currencyCode: 'USD',
      customerCode: 'ada@example.com',
      addresses: { shipFrom: { region: 'TX', postalCode: '78701' }, shipTo: { city: 'Dallas' } },
    })
    expect(call.body.lines).toEqual([
      expect.objectContaining({ number: '0', quantity: 2, amount: 45, taxCode: 'PC040100', itemCode: 'SKU-1' }),
      expect.objectContaining({ number: '1', amount: 19.99, taxCode: 'NT' }),
      expect.objectContaining({ number: 'shipping', amount: 7, taxCode: 'FR020100' }),
    ])
  })

  it('sends an exemption as an entity use code with the certificate number', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 200, body: { totalTax: 0, lines: [] } }))
    await createAvalaraProvider(fetchImpl).quote(AVALARA, {
      ...DOCUMENT,
      exemption: { type: 'wholesale', certificateNumber: 'RESALE-77' },
    })
    expect(calls[0].body).toMatchObject({ entityUseCode: 'G', exemptionNo: 'RESALE-77' })
  })

  it('records a paid sale with createoradjust, committed, at the tax actually collected', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 201, body: {} }))
    await createAvalaraProvider(fetchImpl).commit(AVALARA, SALE)
    expect(calls[0].url).toBe('https://sandbox-rest.avatax.com/api/v2/transactions/createoradjust')
    expect(calls[0].body.createTransactionModel).toMatchObject({
      type: 'SalesInvoice',
      code: 'order-1',
      commit: true,
      taxOverride: { type: 'TaxAmount', taxAmount: 4.12 },
    })
  })

  it('files a partial refund once: a refund already on file is not filed again', async () => {
    const created = recorder((call) =>
      call.method === 'GET' ? { status: 404, body: { error: { code: 'EntityNotFoundError' } } } : { status: 200, body: {} },
    )
    await createAvalaraProvider(created.fetchImpl).refund(AVALARA, {
      orderCode: 'order-1',
      refundCode: 'order-1-R-abc',
      date: '2026-10-08',
      full: false,
      fraction: 0.25,
      sale: SALE,
    })
    expect(created.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /api/v2/companies/SHOP/transactions/order-1-R-abc',
      'POST /api/v2/companies/SHOP/transactions/order-1/refund',
    ])
    expect(created.calls[1].body).toMatchObject({
      refundTransactionCode: 'order-1-R-abc',
      refundType: 'Percentage',
      refundPercentage: 25,
    })

    const replay = recorder(() => ({ status: 200, body: { code: 'order-1-R-abc' } }))
    await createAvalaraProvider(replay.fetchImpl).refund(AVALARA, {
      orderCode: 'order-1',
      refundCode: 'order-1-R-abc',
      date: '2026-10-08',
      full: true,
      fraction: 1,
      sale: SALE,
    })
    expect(replay.calls).toHaveLength(1)
  })

  it('voids a sale, treats one AvaTax no longer has as void, and refunds one locked in a filed return', async () => {
    const gone = recorder(() => ({ status: 404, body: {} }))
    await createAvalaraProvider(gone.fetchImpl).void(AVALARA, SALE)
    expect(gone.calls[0].body).toEqual({ code: 'DocVoided' })

    const locked = recorder((call) => {
      if (call.url.endsWith('/void')) return { status: 400, body: { error: { code: 'DocumentLockedError' } } }
      if (call.method === 'GET') return { status: 404, body: {} }
      return { status: 200, body: {} }
    })
    await createAvalaraProvider(locked.fetchImpl).void(AVALARA, SALE)
    expect(locked.calls.at(-1)?.body).toMatchObject({ refundType: 'Full', refundTransactionCode: 'order-1-VOID' })
  })

  it('tests a connection: authenticated, and the company exists', async () => {
    const ok = recorder((call) =>
      call.url.includes('/utilities/ping')
        ? { status: 200, body: { authenticated: true } }
        : { status: 200, body: { value: [{ name: 'Candle Shop', companyCode: 'SHOP' }] } },
    )
    await expect(createAvalaraProvider(ok.fetchImpl).testConnection(AVALARA)).resolves.toEqual({
      detail: 'Connected to Candle Shop (SHOP)',
    })
    expect(decodeURIComponent(ok.calls[1].url)).toContain("$filter=companyCode eq 'SHOP'")

    const refused = recorder(() => ({ status: 200, body: { authenticated: false } }))
    await expect(createAvalaraProvider(refused.fetchImpl).testConnection(AVALARA)).rejects.toMatchObject({
      status: 401,
    })

    const noCompany = recorder((call) =>
      call.url.includes('/utilities/ping')
        ? { status: 200, body: { authenticated: true } }
        : { status: 200, body: { value: [] } },
    )
    await expect(createAvalaraProvider(noCompany.fetchImpl).testConnection(AVALARA)).rejects.toThrow(
      'no company with the code SHOP',
    )
  })

  it('reads an address check, and an unknown address is not valid', async () => {
    const { fetchImpl } = recorder(() => ({
      status: 200,
      body: {
        validatedAddresses: [
          { line1: '1 MAIN ST', city: 'AUSTIN', region: 'TX', postalCode: '78701-0001', country: 'US', addressType: 'StreetOrResidentialAddress' },
        ],
        messages: [],
      },
    }))
    await expect(createAvalaraProvider(fetchImpl).validateAddress(AVALARA, SHIP_FROM)).resolves.toEqual({
      valid: true,
      normalized: { line1: '1 MAIN ST', city: 'AUSTIN', region: 'TX', postalCode: '78701-0001', country: 'US' },
      messages: [],
    })
    const unknown = recorder(() => ({
      status: 200,
      body: {
        validatedAddresses: [{ country: 'US', addressType: 'UnknownAddressType' }],
        messages: [{ summary: 'The address is not deliverable.', severity: 'Error' }],
      },
    }))
    const answer = await createAvalaraProvider(unknown.fetchImpl).validateAddress(AVALARA, SHIP_FROM)
    expect(answer.valid).toBe(false)
    expect(answer.messages).toEqual(['The address is not deliverable.'])
  })

  it('turns a refusal into a TaxProviderError with the vendor’s words, never the key', async () => {
    const { fetchImpl } = recorder(() => ({
      status: 400,
      body: { error: { code: 'InvalidAddress', message: 'Address is incomplete', details: [{ message: 'Postal code missing' }] } },
    }))
    const error = await createAvalaraProvider(fetchImpl).quote(AVALARA, DOCUMENT).catch((cause) => cause)
    expect(error).toBeInstanceOf(TaxProviderError)
    expect(error.message).toBe('Avalara: Postal code missing')
    expect(error.code).toBe('InvalidAddress')
    expect(error.transient).toBe(false)
    expect(error.message).not.toContain('license-key')
  })
})

describe('TaxJar adapter', () => {
  it('quotes with the token as a bearer and the pinned API version, reading cents back', async () => {
    const { calls, fetchImpl } = recorder(() => ({
      status: 200,
      body: {
        tax: {
          amount_to_collect: 3.75,
          breakdown: {
            line_items: [{ id: '0', tax_collectable: 3.71 }],
            shipping: { tax_collectable: 0.04 },
          },
        },
      },
    }))
    const answer = await createTaxJarProvider(fetchImpl).quote(TAXJAR, DOCUMENT)
    expect(answer).toEqual({
      taxCents: 375,
      lines: [
        { id: '0', taxCents: 371 },
        { id: '1', taxCents: 0 },
      ],
      shippingTaxCents: 4,
    })
    const [call] = calls
    expect(call.url).toBe('https://api.taxjar.com/v2/taxes')
    expect(call.headers.Authorization).toBe('Bearer tj-token')
    expect(call.headers['x-api-version']).toBe(TAXJAR_API_VERSION)
    expect(call.body).toMatchObject({
      from_zip: '78701',
      from_state: 'TX',
      to_city: 'Dallas',
      amount: 64.99,
      shipping: 7,
    })
    expect(call.body.line_items).toEqual([
      expect.objectContaining({ id: '0', quantity: 2, unit_price: 25, discount: 5, product_tax_code: 'PC040100', product_identifier: 'SKU-1' }),
      expect.objectContaining({ id: '1', product_tax_code: '99999' }),
    ])
  })

  it('records a sale, and on a 422 updates the one TaxJar already holds', async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === 'POST' ? { status: 422, body: { error: 'Unprocessable Entity' } } : { status: 200, body: {} },
    )
    await createTaxJarProvider(fetchImpl).commit(TAXJAR, SALE)
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /v2/transactions/orders',
      'PUT /v2/transactions/orders/order-1',
    ])
    expect(calls[0].body).toMatchObject({ transaction_id: 'order-1', sales_tax: 4.12, amount: 71.99, shipping: 7 })
    // The collected tax spread over the taxable lines only, summing exactly.
    expect(calls[0].body.line_items.map((line: any) => line.sales_tax)).toEqual([4.12, 0])
  })

  it('files a refund with NEGATIVE amounts, once', async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === 'GET' ? { status: 404, body: {} } : { status: 201, body: {} },
    )
    await createTaxJarProvider(fetchImpl).refund(TAXJAR, {
      orderCode: 'order-1',
      refundCode: 'order-1-R-abc',
      date: '2026-10-08',
      full: false,
      fraction: 0.5,
      sale: SALE,
    })
    expect(calls[1].body).toMatchObject({
      transaction_id: 'order-1-R-abc',
      transaction_reference_id: 'order-1',
      amount: -36,
      shipping: -3.5,
      sales_tax: -2.06,
    })
    const replay = recorder(() => ({ status: 200, body: {} }))
    await createTaxJarProvider(replay.fetchImpl).refund(TAXJAR, {
      orderCode: 'order-1',
      refundCode: 'order-1-R-abc',
      date: '2026-10-08',
      full: true,
      fraction: 1,
      sale: SALE,
    })
    expect(replay.calls).toHaveLength(1)
  })

  it('voids by deleting the order transaction; one already gone is void', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 404, body: {} }))
    await createTaxJarProvider(fetchImpl).void(TAXJAR, SALE)
    expect(calls[0].method).toBe('DELETE')
  })

  it('names the nexus states on a test, and an address check its plan lacks', async () => {
    const nexus = recorder(() => ({ status: 200, body: { regions: [{ region_code: 'TX' }, { region_code: 'CA' }] } }))
    await expect(createTaxJarProvider(nexus.fetchImpl).testConnection(TAXJAR)).resolves.toEqual({
      detail: 'Connected, with nexus in TX, CA',
    })
    const forbidden = recorder(() => ({ status: 403, body: {} }))
    await expect(createTaxJarProvider(forbidden.fetchImpl).validateAddress(TAXJAR, SHIP_FROM)).rejects.toThrow(
      'not included in this TaxJar plan',
    )
    const missing = recorder(() => ({ status: 404, body: {} }))
    await expect(createTaxJarProvider(missing.fetchImpl).validateAddress(TAXJAR, SHIP_FROM)).resolves.toMatchObject({
      valid: false,
    })
  })

  it('refuses with a 401 that is not worth retrying, and a 503 that is', async () => {
    const unauthorized = recorder(() => ({ status: 401, body: { error: 'Unauthorized', detail: 'Not authorized for route' } }))
    const error = await createTaxJarProvider(unauthorized.fetchImpl).quote(TAXJAR, DOCUMENT).catch((cause) => cause)
    expect(error.message).toBe('TaxJar: Not authorized for route')
    expect(error.transient).toBe(false)
    const down = recorder(() => ({ status: 503, body: {} }))
    const outage = await createTaxJarProvider(down.fetchImpl).quote(TAXJAR, DOCUMENT).catch((cause) => cause)
    expect(outage.transient).toBe(true)
  })
})

describe('the shared transport', () => {
  it('turns a network failure into a transient TaxProviderError', async () => {
    const { fetchImpl } = recorder(() => new TypeError('fetch failed'))
    const error = await createTaxJarProvider(fetchImpl).quote(TAXJAR, DOCUMENT).catch((cause) => cause)
    expect(error).toBeInstanceOf(TaxProviderError)
    expect(error).toMatchObject({ status: 0, code: 'network' })
    expect(error.transient).toBe(true)
  })

  it('turns an abort into a timeout', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { fetchImpl } = recorder(() => abort)
    const error = await createAvalaraProvider(fetchImpl).quote(AVALARA, DOCUMENT).catch((cause) => cause)
    expect(error).toMatchObject({ status: 0, code: 'timeout' })
  })
})
