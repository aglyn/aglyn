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
  USAGE_INVOICE_MIN_CHARGE_CENTS,
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

/**
 * The four calls of a charge that works, in order: the invoice, the line
 * attached to it, the finalize that prices it, and the pay that collects it.
 *
 * The finalize carries a `total` and the pay an `amount_paid`, because since
 * AGL-3023 both are read: an invoice that finalizes at zero never reaches
 * `pay`, and one that reports `paid` having collected nothing is not a
 * payment. A fixture without those figures would pass a charge that took no
 * money, which is the defect this suite exists to hold shut.
 */
const PAID = [
  { body: { id: 'in_1', status: 'draft' } },
  { body: { id: 'ii_1', invoice: 'in_1' } },
  { body: { id: 'in_1', status: 'open', total: 2_700 } },
  { body: { id: 'in_1', status: 'paid', amount_paid: 2_700 } },
]

describe('charging a usage invoice', () => {
  it('creates the invoice FIRST and attaches the line to it by id', async () => {
    /*
     * THE DEFECT AGL-3023 WAS (AGL-3011 shipped with it, dormant).
     *
     * `POST /v1/invoices` documents `pending_invoice_items_behavior` as
     * "Defaults to `exclude` if the parameter is omitted". An invoice
     * created AFTER a pending item, without that parameter, therefore
     * sweeps up nothing: the invoice is empty, finalizes at zero, and a
     * zero-total invoice is already paid the moment it finalizes. The first
     * test-clock drill charged $0 six times over and proved nothing.
     *
     * The order below is the fix, and `invoice` on the item is what makes it
     * a fix rather than a coincidence: `pending_invoice_items_behavior:
     * 'include'` would also produce a non-zero invoice, by sweeping up EVERY
     * pending item on that customer — a proration, another plugin's line —
     * onto an invoice this module then reports as an AI overage charge for
     * an amount it made up.
     */
    const { calls, fetchImpl } = recorder(PAID)
    await chargeOrgUsageInvoice(REQUEST, { secretKey: 'sk_test_x', fetchImpl })
    expect(calls[0].url).toContain('/v1/invoices')
    expect(calls[0].params.get('pending_invoice_items_behavior')).toBe('exclude')
    expect(calls[1].url).toContain('/v1/invoiceitems')
    expect(calls[1].params.get('invoice')).toBe('in_1')
  })

  it('bills the product, so the line carries a tax code', async () => {
    // An amount with no product behind it is an untaxed line on a taxed
    // invoice: automatic tax computes from the PRODUCT's code.
    const { calls, fetchImpl } = recorder(PAID)
    await chargeOrgUsageInvoice(REQUEST, { secretKey: 'sk_test_x', fetchImpl })
    const item = calls[1]
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
    const invoice = calls[0]
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
      // Both the invoice and its line, so the webhook can route the outcome
      // back and the reconcile search can match the claim either way.
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

  it('reports a paid invoice with what Stripe actually collected', async () => {
    const { fetchImpl } = recorder(PAID)
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result).toEqual({
      ok: true,
      invoiceId: 'in_1',
      status: 'paid',
      // $25 of overage plus automatic tax. Reported, because the caller
      // credits the workspace from THIS and never from what it asked for.
      totalCents: 2_700,
      amountPaidCents: 2_700,
      requiresAction: false,
      error: null,
    })
  })

  it('refuses to pay an invoice that finalized at zero, and says why', async () => {
    // The exact shape of AGL-3023 as Stripe answered it. Paying a zero-total
    // invoice returns "Invoice is already paid", which reads like a declined
    // card and is nothing of the sort — so the total is checked BEFORE the
    // pay, and the failure names the real cause.
    const { calls, fetchImpl } = recorder([
      { body: { id: 'in_1', status: 'draft' } },
      { body: { id: 'ii_1', invoice: 'in_1' } },
      { body: { id: 'in_1', status: 'paid', total: 0 } },
    ])
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    expect(result.invoiceId).toBe('in_1')
    expect(result.totalCents).toBe(0)
    expect(result.amountPaidCents).toBe(0)
    expect(result.error).toContain('did not reach it')
    // Three calls, not four: `pay` was never attempted.
    expect(calls).toHaveLength(3)
    expect(calls.some((call) => call.url.includes('/pay'))).toBe(false)
  })

  it('refuses an invoice that reports paid having collected nothing', async () => {
    // The fail-OPEN half. A caller that credited the claim here would clear
    // a balance nobody paid, and the gate's unpaid bound — the whole point
    // of AGL-3011 — would be satisfied by bookkeeping instead of by money.
    const { fetchImpl } = recorder([
      { body: { id: 'in_1', status: 'draft' } },
      { body: { id: 'ii_1', invoice: 'in_1' } },
      { body: { id: 'in_1', status: 'open', total: 2_500 } },
      { body: { id: 'in_1', status: 'paid', amount_paid: 0 } },
    ])
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    expect(result.amountPaidCents).toBe(0)
    expect(result.error).toContain('collected 0 cents of 2500')
  })

  it('keeps the invoice id when the card declines', async () => {
    // A declined card is a real invoice the customer can still pay. Losing
    // its id would leave the caller with a claim and nothing to wait on.
    const { fetchImpl } = recorder([
      { body: { id: 'in_1', status: 'draft' } },
      { body: { id: 'ii_1', invoice: 'in_1' } },
      { body: { id: 'in_1', status: 'open', total: 2_500 } },
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
      { body: { id: 'in_1', status: 'draft' } },
      { body: { id: 'ii_1', invoice: 'in_1' } },
      { body: { id: 'in_1', status: 'open', total: 2_500 } },
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

  it('refuses an amount under Stripe’s minimum rather than raising it', async () => {
    /*
     * MEASURED ON A TEST CLOCK (AGL-3023): a $0.40 invoice finalizes as
     * `paid` having collected nothing, and every later call answers "Invoice
     * is already paid". That is the same "paid without money" shape as the
     * fail-open this module guards against, arriving from Stripe's side
     * instead of ours — so the invoice is never raised in the first place.
     *
     * The AI overage close-out already holds its own floor at exactly this
     * figure. This is the floor under that floor, for every future caller.
     */
    const { calls, fetchImpl } = recorder(PAID)
    const result = await chargeOrgUsageInvoice(
      { ...REQUEST, amountCents: 40 },
      { secretKey: 'sk_test_x', fetchImpl },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('collected nothing')
    expect(calls).toHaveLength(0)
    // Exactly at the minimum is allowed: the close-out's own floor sits
    // here, and automatic tax only ever adds to it.
    const atTheLine = recorder(PAID)
    await chargeOrgUsageInvoice(
      { ...REQUEST, amountCents: USAGE_INVOICE_MIN_CHARGE_CENTS },
      { secretKey: 'sk_test_x', fetchImpl: atTheLine.fetchImpl },
    )
    expect(atTheLine.calls.length).toBeGreaterThan(0)
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
    // A refused LINE leaves the draft invoice it was addressed to, so the id
    // survives for the reconcile sweep to find and the caller to record.
    const { calls, fetchImpl } = recorder([
      { body: { id: 'in_1', status: 'draft' } },
      { ok: false, body: { error: { message: 'No such product' } } },
    ])
    const result = await chargeOrgUsageInvoice(REQUEST, {
      secretKey: 'sk_test_x',
      fetchImpl,
    })
    expect(result.invoiceId).toBe('in_1')
    expect(result.status).toBe('draft')
    expect(result.error).toContain('No such product')
    expect(calls).toHaveLength(2)
  })
})

describe('finding a usage invoice by its claim', () => {
  it('searches on the caller’s metadata key', async () => {
    const { calls, fetchImpl } = recorder([
      { body: { data: [{ id: 'in_1', status: 'open', amount_paid: 0 }] } },
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
    expect(found).toEqual({
      invoiceId: 'in_1',
      status: 'open',
      amountPaidCents: 0,
      error: null,
    })
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
    ).toEqual({ invoiceId: null, status: null, amountPaidCents: 0, error: null })
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
