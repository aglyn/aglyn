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
 * ONE-OFF USAGE INVOICES (AGL-3011).
 *
 * Every assertion here is about the REQUEST — which parameters, which
 * headers, which key — because that is the half a spec can hold. Whether
 * Stripe accepts the parameter set at the account's pinned version is a
 * question only a test-mode call answers, and that call is a separate,
 * approved step.
 */

import {
  USAGE_INVOICE_API_VERSION,
  chargeOrgUsageInvoice,
  findOrgUsageInvoice,
} from './usage-invoice'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  params: URLSearchParams
}

function recorder(responses: Array<{ ok?: boolean; body: unknown }>) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const request = (init ?? {}) as {
      method?: string
      headers?: Record<string, string>
      body?: string
    }
    calls.push({
      url: String(url),
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      params: new URLSearchParams(request.body ?? ''),
    })
    const next = responses[index] ?? responses[responses.length - 1]
    index += 1
    return {
      ok: next.ok !== false,
      json: async () => next.body,
    }
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const REQUEST = {
  orgId: 'org-1',
  stripeCustomerId: 'cus_1',
  productId: 'prod_overage',
  amountCents: 2_500,
  currency: 'usd',
  description: 'AI credits past your included band — 2026-10 (8,333 credits)',
  metadata: {
    orgId: 'org-1',
    pluginId: 'ai',
    kind: 'ai-overage',
    chargeId: '2026-10-001',
    month: '2026-10',
  },
  idempotencyKey: 'aiov-org-1-2026-10-001',
}

const PAID = [
  { body: { id: 'ii_1' } },
  { body: { id: 'in_1', status: 'draft' } },
  { body: { id: 'in_1', status: 'open' } },
  { body: { id: 'in_1', status: 'paid' } },
]

describe('charging a usage invoice', () => {
  it('bills the product, so the line carries a tax code', async () => {
    // An amount with no product behind it is an untaxed line on a taxed
    // invoice: automatic tax computes from the PRODUCT's code.
    const { calls, fetchImpl } = recorder(PAID)
    await chargeOrgUsageInvoice(REQUEST, { secretKey: 'sk_test_x', fetchImpl })
    const item = calls[0]
    expect(item.url).toContain('/v1/invoiceitems')
    expect(item.params.get('customer')).toBe('cus_1')
    expect(item.params.get('price_data[product]')).toBe('prod_overage')
    expect(item.params.get('price_data[unit_amount]')).toBe('2500')
    expect(item.params.get('price_data[currency]')).toBe('usd')
    // Stated rather than left to the account default: US sales tax is added
    // on top, and an unspecified behavior is refused when automatic tax is on.
    expect(item.params.get('price_data[tax_behavior]')).toBe('exclusive')
    expect(item.params.get('description')).toBe(REQUEST.description)
  })

  it('charges the card automatically, with automatic tax', async () => {
    const { calls, fetchImpl } = recorder(PAID)
    await chargeOrgUsageInvoice(REQUEST, { secretKey: 'sk_test_x', fetchImpl })
    const invoice = calls[1]
    expect(invoice.url).toContain('/v1/invoices')
    expect(invoice.params.get('collection_method')).toBe('charge_automatically')
    expect(invoice.params.get('automatic_tax[enabled]')).toBe('true')
    // Finalize and pay are this call's own steps below, so the answer it
    // returns is the outcome rather than a promise of one.
    expect(invoice.params.get('auto_advance')).toBe('false')
    expect(calls[2].url).toContain('/v1/invoices/in_1/finalize')
    expect(calls[3].url).toContain('/v1/invoices/in_1/pay')
  })

  it('stamps the caller’s metadata on the line AND the invoice', async () => {
    // The invoice's metadata is what routes the webhook's outcome back to
    // the plugin, and what the reconcile search matches on.
    const { calls, fetchImpl } = recorder(PAID)
    await chargeOrgUsageInvoice(REQUEST, { secretKey: 'sk_test_x', fetchImpl })
    for (const call of [calls[0], calls[1]]) {
      expect(call.params.get('metadata[pluginId]')).toBe('ai')
      expect(call.params.get('metadata[kind]')).toBe('ai-overage')
      expect(call.params.get('metadata[chargeId]')).toBe('2026-10-001')
      expect(call.params.get('metadata[month]')).toBe('2026-10')
      expect(call.params.get('metadata[orgId]')).toBe('org-1')
    }
  })

  it('pins the API version and gives every write its own idempotency key', async () => {
    // Stripe's idempotency layer is account-scoped and compares parameters:
    // one key across two endpoints makes the second call fail outright.
    const { calls, fetchImpl } = recorder(PAID)
    await chargeOrgUsageInvoice(REQUEST, { secretKey: 'sk_test_x', fetchImpl })
    const keys = calls.map((call) => call.headers['Idempotency-Key'])
    expect(new Set(keys).size).toBe(calls.length)
    for (const key of keys) expect(key).toContain(REQUEST.idempotencyKey)
    for (const call of calls) {
      expect(call.headers['Stripe-Version']).toBe(USAGE_INVOICE_API_VERSION)
      expect(call.headers.Authorization).toBe('Bearer sk_test_x')
    }
  })

  it('reports a paid invoice', async () => {
    const { fetchImpl } = recorder(PAID)
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result).toEqual({
      ok: true,
      invoiceId: 'in_1',
      status: 'paid',
      requiresAction: false,
      error: null,
    })
  })

  it('keeps the invoice id when the card declines', async () => {
    // A declined card is a real invoice the customer can still pay. Losing
    // its id would leave the caller with a claim and nothing to wait on.
    const { fetchImpl } = recorder([
      { body: { id: 'ii_1' } },
      { body: { id: 'in_1', status: 'draft' } },
      { body: { id: 'in_1', status: 'open' } },
      {
        ok: false,
        body: {
          error: {
            message: 'Your card was declined.',
            payment_intent: { status: 'requires_payment_method' },
          },
        },
      },
    ])
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    expect(result.invoiceId).toBe('in_1')
    expect(result.requiresAction).toBe(false)
    expect(result.error).toContain('declined')
  })

  it('treats a 3-D Secure challenge as a failure, not a wait', async () => {
    // Nobody is at the keyboard for an off-session charge, so
    // `requires_action` is "no" wearing the word "not yet".
    const { fetchImpl } = recorder([
      { body: { id: 'ii_1' } },
      { body: { id: 'in_1', status: 'draft' } },
      { body: { id: 'in_1', status: 'open' } },
      {
        ok: false,
        body: {
          error: {
            message: 'Authentication required.',
            payment_intent: { status: 'requires_action' },
          },
        },
      },
    ])
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    expect(result.requiresAction).toBe(true)
  })

  it('creates nothing without a key, an amount, a customer or a product', async () => {
    const { calls, fetchImpl } = recorder(PAID)
    const options = { secretKey: 'sk_test_x', fetchImpl }
    expect((await chargeOrgUsageInvoice(REQUEST, { fetchImpl, secretKey: '' })).error).toBe(
      'Stripe is not configured',
    )
    expect(
      (await chargeOrgUsageInvoice({ ...REQUEST, amountCents: 0 }, options)).error,
    ).toContain('positive amount')
    expect(
      (await chargeOrgUsageInvoice({ ...REQUEST, stripeCustomerId: '' }, options)).error,
    ).toContain('customer and a product')
    expect(
      (await chargeOrgUsageInvoice({ ...REQUEST, productId: '' }, options)).error,
    ).toContain('customer and a product')
    expect(calls).toHaveLength(0)
  })

  it('stops at the first refusal rather than finalizing a bad invoice', async () => {
    const { calls, fetchImpl } = recorder([
      { ok: false, body: { error: { message: 'No such product' } } },
    ])
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result.invoiceId).toBeNull()
    expect(result.error).toContain('No such product')
    expect(calls).toHaveLength(1)
  })
})

describe('finding a usage invoice by its claim', () => {
  it('searches on the caller’s metadata key', async () => {
    const { calls, fetchImpl } = recorder([
      { body: { data: [{ id: 'in_1', status: 'open' }] } },
    ])
    const found = await findOrgUsageInvoice(
      { metadataKey: 'chargeId', metadataValue: '2026-10-001' },
      { secretKey: 'sk_test_x', fetchImpl },
    )
    expect(calls[0].url).toContain('/v1/invoices/search')
    expect(decodeURIComponent(calls[0].url)).toContain(
      "metadata['chargeId']:'2026-10-001'",
    )
    // A search is a GET, and Stripe documents idempotency keys as having no
    // effect on one.
    expect(calls[0].headers['Idempotency-Key']).toBeUndefined()
    expect(found).toEqual({ invoiceId: 'in_1', status: 'open', error: null })
  })

  it('answers "not found" without an error, because the index lags', async () => {
    // Eventually consistent: an empty answer means NOT FOUND YET. A caller
    // that read it as "never created" would bill the same dollars twice.
    const { fetchImpl } = recorder([{ body: { data: [] } }])
    expect(
      await findOrgUsageInvoice(
        { metadataKey: 'chargeId', metadataValue: '2026-10-001' },
        { secretKey: 'sk_test_x', fetchImpl },
      ),
    ).toEqual({ invoiceId: null, status: null, error: null })
  })

  it('refuses a claim id that would break the query rather than escaping it', async () => {
    const { calls, fetchImpl } = recorder([{ body: { data: [] } }])
    const answer = await findOrgUsageInvoice(
      { metadataKey: 'chargeId', metadataValue: "2026-10' OR '1" },
      { secretKey: 'sk_test_x', fetchImpl },
    )
    expect(answer.error).toBe('Unsearchable claim id')
    expect(calls).toHaveLength(0)
  })
})
