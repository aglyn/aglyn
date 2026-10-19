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
 * SITE CARE EXTRA TIME IN STRIPE (AGL-3959).
 *
 * Every assertion is about the REQUEST the code sends — path, method,
 * parameters, the pinned version and the idempotency key — over a recorded
 * fetch. Nothing here reaches Stripe; whether Stripe accepts the parameter
 * set is a test-mode question, asked separately.
 */

import { USAGE_INVOICE_API_VERSION } from './usage-invoice'
import {
  createExtraTimeItem,
  creditExtraTimeItem,
  deleteExtraTimeItem,
  extraTimeItemIsEditable,
  listSiteCareExtraTimeItems,
  readExtraTimeItem,
  siteCareExtraTimeProduct,
  siteCareSubscriptionId,
  subscriptionInvoiceFinalizedSince,
  updateExtraTimeItem,
} from './site-care-stripe'

interface Call {
  url: string
  path: string
  query: URLSearchParams
  method: string
  headers: Record<string, string>
  params: URLSearchParams
}

type Answer = { status?: number; body: unknown }

function recorder(answers: Answer[]) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const request = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string }
    const parsed = new URL(String(url))
    calls.push({
      url: String(url),
      path: parsed.pathname.replace(/^\/v1\//, ''),
      query: parsed.searchParams,
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      params: new URLSearchParams(request.body ?? ''),
    })
    const next = answers[index] ?? answers[answers.length - 1]
    index += 1
    const status = next.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => next.body }
  }) as unknown as typeof fetch
  return { calls, options: { secretKey: 'sk_test_stub', fetchImpl } }
}

describe('configuration', () => {
  it('refuses without a key and calls nothing', async () => {
    const saved = process.env['STRIPE_SECRET_KEY']
    delete process.env['STRIPE_SECRET_KEY']
    const fetchImpl = jest.fn()
    const result = await siteCareSubscriptionId('cus_1', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ ok: false, error: 'Stripe is not configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
    if (saved !== undefined) process.env['STRIPE_SECRET_KEY'] = saved
  })
})

describe('siteCareSubscriptionId', () => {
  it('picks the live subscription', async () => {
    const { calls, options } = recorder([
      { body: { data: [{ id: 'sub_old', status: 'canceled' }, { id: 'sub_live', status: 'active' }] } },
    ])
    expect(await siteCareSubscriptionId('cus_1', options)).toEqual({ ok: true, subscriptionId: 'sub_live' })
    expect(calls[0].path).toBe('subscriptions')
    expect(calls[0].query.get('customer')).toBe('cus_1')
    expect(calls[0].headers['Authorization']).toBe('Bearer sk_test_stub')
    expect(calls[0].headers['Stripe-Version']).toBe(USAGE_INVOICE_API_VERSION)
    expect(calls[0].headers['Idempotency-Key']).toBeUndefined()
  })

  it('refuses a workspace with no customer or no live subscription', async () => {
    const { options } = recorder([{ body: { data: [{ id: 'sub_old', status: 'canceled' }] } }])
    expect(await siteCareSubscriptionId('', options)).toEqual({ ok: false, error: 'The workspace has no Stripe customer.' })
    expect((await siteCareSubscriptionId('cus_1', options)).ok).toBe(false)
  })
})

describe('siteCareExtraTimeProduct', () => {
  it('reads the product off the price and checks its tax code', async () => {
    const { calls, options } = recorder([
      { body: { id: 'price_care', product: { id: 'prod_care', tax_code: 'txcd_10103001' } } },
    ])
    expect(await siteCareExtraTimeProduct({ ...options, priceId: 'price_care' })).toEqual({
      ok: true,
      productId: 'prod_care',
    })
    expect(calls[0].path).toBe('prices/price_care')
    expect(calls[0].query.get('expand[]')).toBe('product')
  })

  it('accepts an expanded tax code object', async () => {
    const { options } = recorder([
      { body: { product: { id: 'prod_care', tax_code: { id: 'txcd_10103001' } } } },
    ])
    expect((await siteCareExtraTimeProduct({ ...options, priceId: 'price_care' })).ok).toBe(true)
  })

  it('refuses a product under any other tax code, before anything is charged', async () => {
    const { options } = recorder([{ body: { product: { id: 'prod_care', tax_code: 'txcd_99999999' } } }])
    const result = await siteCareExtraTimeProduct({ ...options, priceId: 'price_care' })
    expect(result).toEqual({
      ok: false,
      error: 'The Site Care product carries tax code txcd_99999999, not txcd_10103001; nothing was charged.',
    })
  })

  it('refuses when no price is configured', async () => {
    const saved = [process.env['STRIPE_PRICE_SITE_CARE'], process.env['STRIPE_PRICE_SITE_CARE_YEARLY']]
    delete process.env['STRIPE_PRICE_SITE_CARE']
    delete process.env['STRIPE_PRICE_SITE_CARE_YEARLY']
    const { calls, options } = recorder([{ body: {} }])
    expect((await siteCareExtraTimeProduct(options)).ok).toBe(false)
    expect(calls).toHaveLength(0)
    if (saved[0] !== undefined) process.env['STRIPE_PRICE_SITE_CARE'] = saved[0]
    if (saved[1] !== undefined) process.env['STRIPE_PRICE_SITE_CARE_YEARLY'] = saved[1]
  })
})

describe('createExtraTimeItem', () => {
  const INPUT = {
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    productId: 'prod_care',
    hours: 2,
    description: 'Site Care extra time',
    metadata: { siteCareRequestId: 'ticket1', orgId: 'org-1', month: '2026-10' },
    idempotencyKey: 'site-care:ticket1:charge:1',
  }

  it('prices whole hours at $79 on the subscription, under the charge key', async () => {
    const { calls, options } = recorder([{ body: { id: 'ii_1', amount: 15_800 } }])
    expect(await createExtraTimeItem(INPUT, options)).toEqual({ ok: true, invoiceItemId: 'ii_1', amountCents: 15_800 })
    const call = calls[0]
    expect(call.method).toBe('POST')
    expect(call.path).toBe('invoiceitems')
    expect(call.headers['Idempotency-Key']).toBe('site-care:ticket1:charge:1')
    expect(Object.fromEntries(call.params)).toEqual({
      customer: 'cus_1',
      subscription: 'sub_1',
      'price_data[product]': 'prod_care',
      'price_data[currency]': 'usd',
      'price_data[unit_amount]': '7900',
      'price_data[tax_behavior]': 'exclusive',
      quantity: '2',
      description: 'Site Care extra time',
      'metadata[siteCareRequestId]': 'ticket1',
      'metadata[orgId]': 'org-1',
      'metadata[month]': '2026-10',
    })
  })

  it('refuses less than one whole hour without calling Stripe', async () => {
    const { calls, options } = recorder([{ body: {} }])
    expect((await createExtraTimeItem({ ...INPUT, hours: 0 }, options)).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('carries Stripe’s refusal back', async () => {
    const { options } = recorder([{ status: 400, body: { error: { message: 'No such customer' } } }])
    expect(await createExtraTimeItem(INPUT, options)).toEqual({ ok: false, error: 'No such customer' })
  })
})

describe('updateExtraTimeItem', () => {
  it('sends the new quantity and description under the given key', async () => {
    const { calls, options } = recorder([{ body: { amount: 7_900 } }])
    const result = await updateExtraTimeItem(
      { invoiceItemId: 'ii_1', hours: 1, description: 'fixed', idempotencyKey: 'k:fix:row1' },
      options,
    )
    expect(result).toEqual({ ok: true, amountCents: 7_900 })
    expect(calls[0].path).toBe('invoiceitems/ii_1')
    expect(calls[0].headers['Idempotency-Key']).toBe('k:fix:row1')
    expect(Object.fromEntries(calls[0].params)).toEqual({ quantity: '1', description: 'fixed' })
  })
})

describe('readExtraTimeItem', () => {
  it('reads a pending item with no invoice', async () => {
    const { calls, options } = recorder([{ body: { id: 'ii_1', amount: 7_900, quantity: 1, invoice: null } }])
    const read = await readExtraTimeItem('ii_1', options)
    expect(read.ok && read.state.stage).toBe('pending')
    expect(calls).toHaveLength(1)
  })

  it('reads the stage off the invoice it landed on', async () => {
    for (const status of ['draft', 'open', 'paid', 'void', 'uncollectible']) {
      const { options } = recorder([{ body: { id: 'ii_1', invoice: 'in_1' } }, { body: { status } }])
      const read = await readExtraTimeItem('ii_1', options)
      expect(read.ok && read.state).toEqual(expect.objectContaining({ stage: status, invoiceId: 'in_1' }))
    }
  })

  it('reads a missing or deleted item as deleted', async () => {
    const gone = recorder([{ status: 404, body: { error: { message: 'No such invoiceitem' } } }])
    expect((await readExtraTimeItem('ii_1', gone.options)).ok).toBe(true)
    const deleted = recorder([{ body: { id: 'ii_1', deleted: true } }])
    const read = await readExtraTimeItem('ii_1', deleted.options)
    expect(read.ok && read.state.stage).toBe('deleted')
  })

  it('treats only pending and draft as editable', () => {
    expect(extraTimeItemIsEditable('pending')).toBe(true)
    expect(extraTimeItemIsEditable('draft')).toBe(true)
    for (const stage of ['open', 'paid', 'void', 'uncollectible', 'deleted'] as const) {
      expect(extraTimeItemIsEditable(stage)).toBe(false)
    }
  })
})

describe('deleteExtraTimeItem', () => {
  it('deletes, and counts an already-gone item as deleted', async () => {
    const { calls, options } = recorder([{ body: { deleted: true } }])
    expect(await deleteExtraTimeItem('ii_1', options)).toEqual({ ok: true, deleted: true })
    expect(calls[0].method).toBe('DELETE')
    const gone = recorder([{ status: 404, body: {} }])
    expect((await deleteExtraTimeItem('ii_1', gone.options)).ok).toBe(true)
    const refused = recorder([{ status: 400, body: { error: { message: 'Invoice finalized' } } }])
    expect(await deleteExtraTimeItem('ii_1', refused.options)).toEqual({ ok: false, error: 'Invoice finalized' })
  })
})

describe('creditExtraTimeItem', () => {
  const INPUT = {
    invoiceId: 'in_1',
    invoiceItemId: 'ii_1',
    refund: false,
    memo: 'Site Care: wrong page',
    metadata: { siteCareRequestId: 'ticket1' },
    idempotencyKey: 'site-care:ticket1:charge:1:credit',
  }
  const LINES = { body: { data: [{ id: 'il_other', invoice_item: 'ii_9' }, { id: 'il_1', invoice_item: 'ii_1', quantity: 2 }] } }

  it('credits the item’s own line on an open invoice', async () => {
    const { calls, options } = recorder([LINES, { body: { id: 'cn_1', total: 17_064, refund: null } }])
    expect(await creditExtraTimeItem(INPUT, options)).toEqual({
      ok: true,
      creditNoteId: 'cn_1',
      refundId: null,
      amountCents: 17_064,
    })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET invoices/in_1/lines', 'POST credit_notes'])
    expect(calls[1].headers['Idempotency-Key']).toBe('site-care:ticket1:charge:1:credit')
    expect(Object.fromEntries(calls[1].params)).toEqual(
      expect.objectContaining({
        invoice: 'in_1',
        'lines[0][type]': 'invoice_line_item',
        'lines[0][invoice_line_item]': 'il_1',
        'lines[0][quantity]': '2',
        reason: 'order_change',
      }),
    )
    expect(calls[1].params.get('refund_amount')).toBeNull()
  })

  it('refunds the previewed total, tax included, on a paid invoice', async () => {
    const { calls, options } = recorder([
      LINES,
      { body: { total: 17_064 } },
      { body: { id: 'cn_1', total: 17_064, refund: { id: 're_1' } } },
    ])
    const result = await creditExtraTimeItem({ ...INPUT, refund: true }, options)
    expect(result).toEqual({ ok: true, creditNoteId: 'cn_1', refundId: 're_1', amountCents: 17_064 })
    expect(calls[1].path).toBe('credit_notes/preview')
    expect(calls[2].params.get('refund_amount')).toBe('17064')
  })

  it('refuses when the line is not on the invoice', async () => {
    const { calls, options } = recorder([{ body: { data: [] } }])
    expect(await creditExtraTimeItem(INPUT, options)).toEqual({
      ok: false,
      error: 'The extra-time line is not on that invoice.',
    })
    expect(calls).toHaveLength(1)
  })
})

describe('subscriptionInvoiceFinalizedSince', () => {
  it('locks the minutes once any invoice since the close left draft', async () => {
    const draftOnly = recorder([{ body: { data: [{ status: 'draft' }] } }])
    expect(
      await subscriptionInvoiceFinalizedSince({ subscriptionId: 'sub_1', sinceMs: 1_700_000_000_500 }, draftOnly.options),
    ).toEqual({ ok: true, finalized: false })
    expect(draftOnly.calls[0].query.get('created[gte]')).toBe('1700000000')
    const finalized = recorder([{ body: { data: [{ status: 'draft' }, { status: 'open' }] } }])
    expect(
      await subscriptionInvoiceFinalizedSince({ subscriptionId: 'sub_1', sinceMs: 0 }, finalized.options),
    ).toEqual({ ok: true, finalized: true })
  })
})

describe('listSiteCareExtraTimeItems', () => {
  it('keeps only Site Care items and follows pages', async () => {
    const { calls, options } = recorder([
      {
        body: {
          has_more: true,
          data: [
            { id: 'ii_1', amount: 7_900, quantity: 1, description: 'a', metadata: { siteCareRequestId: 't1', month: '2026-10' } },
            { id: 'ii_other', amount: 100, metadata: {} },
          ],
        },
      },
      { body: { has_more: false, data: [{ id: 'ii_2', amount: 15_800, quantity: 2, description: 'b', metadata: { siteCareRequestId: 't2' } }] } },
    ])
    const listed = await listSiteCareExtraTimeItems({ customerId: 'cus_1', sinceMs: 0 }, options)
    expect(listed).toEqual({
      ok: true,
      items: [
        { id: 'ii_1', amountCents: 7_900, quantity: 1, description: 'a', requestId: 't1', month: '2026-10' },
        { id: 'ii_2', amountCents: 15_800, quantity: 2, description: 'b', requestId: 't2', month: '' },
      ],
    })
    expect(calls[1].query.get('starting_after')).toBe('ii_other')
  })
})
