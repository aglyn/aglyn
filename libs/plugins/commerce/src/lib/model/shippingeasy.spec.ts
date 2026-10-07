/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import {
  readShippingEasyCallback,
  shippingEasyCanonicalQuery,
  shippingEasyFormComponent,
  shippingEasyIntent,
  shippingEasyOrderPayload,
  shippingEasySignaturePlaintext,
  splitPersonName,
} from './shippingeasy'

/**
 * ShippingEasy as pure data (AGL-3633): the plaintext its signature is the
 * HMAC of, the order body, which orders go there, and the callback reading.
 */

const ADDRESS = { name: 'Ada Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }
const order = (overrides: Record<string, unknown> = {}) => ({
  number: 1042,
  status: 'paid' as const,
  livemode: true,
  requiresShipping: true,
  shippingAddress: ADDRESS,
  lineItems: [{ productId: 'p1', name: 'Mug', quantity: 2, unitAmountCents: 1250, productType: 'physical' }],
  totals: { itemsCents: 2500, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 2500, feeCents: 0 },
  ...overrides,
})

describe('the signature plaintext', () => {
  it('is the Ruby client’s own example, method upper-cased, query sorted, body last', () => {
    const body = '{"orders":{"name":"Flip flops","cost":"10.00","shipping_cost":"2.00"}}'
    expect(shippingEasySignaturePlaintext({ method: 'post', path: '/api/orders', params: { param2: 'XYZ', param1: 'ABC' }, body })).toBe(
      `POST&/api/orders&param1=ABC&param2=XYZ&${body}`,
    )
  })

  it('leaves an empty body off, keeps an empty query, and never signs api_signature', () => {
    expect(shippingEasySignaturePlaintext({ method: 'GET', path: '/api/orders', params: { api_signature: 'x' } })).toBe('GET&/api/orders&')
  })

  it('form-encodes as Ruby does: a space is +, and !\'()~ are escaped', () => {
    expect(shippingEasyFormComponent("a b!'()~*-._")).toBe('a+b%21%27%28%29%7E*-._')
    expect(shippingEasyCanonicalQuery({ b: '2 3', a: 'x&y' })).toBe('a=x%26y&b=2+3')
  })
})

describe('which orders go to ShippingEasy', () => {
  it('creates a paid or partly shipped order with something to ship', () => {
    expect(shippingEasyIntent(order(), 'o1')).toBe('create')
    expect(shippingEasyIntent(order({ status: 'partially_fulfilled' }), 'o1')).toBe('create')
  })

  it('never a test-mode order, a pending or shipped one, one with nothing to ship or no full address', () => {
    expect(shippingEasyIntent(order({ livemode: false }), 'o1')).toBeNull()
    expect(shippingEasyIntent(order({ livemode: undefined }), 'cs_test_abc')).toBeNull()
    expect(shippingEasyIntent(order({ status: 'pending' }), 'o1')).toBeNull()
    expect(shippingEasyIntent(order({ status: 'fulfilled' }), 'o1')).toBeNull()
    expect(shippingEasyIntent(order({ requiresShipping: false }), 'o1')).toBeNull()
    expect(shippingEasyIntent(order({ shippingAddress: { ...ADDRESS, country: '' } }), 'o1')).toBeNull()
    expect(
      shippingEasyIntent(order({ fulfillments: [{ id: 'f', lines: [{ lineItemId: 0, quantity: 2 }], lineItemIds: [0], atMs: 1 }] }), 'o1'),
    ).toBeNull()
  })

  it('cancels a canceled or refunded order', () => {
    expect(shippingEasyIntent(order({ status: 'cancelled' }), 'o1')).toBe('cancel')
    expect(shippingEasyIntent(order({ status: 'refunded' }), 'o1')).toBe('cancel')
  })
})

describe('the order body', () => {
  it('names only what is known, in dollars, with the line index to name it back', () => {
    const { order: body } = shippingEasyOrderPayload({ docId: 'o1', order: { ...order(), createdAtMs: Date.UTC(2026, 9, 7) } as never })
    expect(body).toMatchObject({
      external_order_identifier: '1042',
      ordered_at: '2026-10-07T00:00:00.000Z',
      total_including_tax: '25.00',
    })
    expect(JSON.stringify(body)).not.toContain('undefined')
    expect(Object.values(body).includes(undefined)).toBe(false)
    const recipient = (body['recipients'] as Array<Record<string, any>>)[0]
    expect(recipient).toMatchObject({ first_name: 'Ada', last_name: 'Buyer', items_total: '2' })
    expect(recipient['address2']).toBeUndefined()
    expect(recipient['line_items']).toEqual([
      { item_name: 'Mug', sku: 'p1', ext_line_item_id: '0', ext_product_id: 'p1', unit_price: '12.50', total_excluding_tax: '25.00', quantity: '2' },
    ])
  })

  it('falls back to the document id for an order with no number', () => {
    const { order: body } = shippingEasyOrderPayload({ docId: 'o1', order: order({ number: undefined }) as never })
    expect(body['external_order_identifier']).toBe('o1')
  })

  it('splits a name on its last word', () => {
    expect(splitPersonName('Mary Ann Smith')).toEqual({ first_name: 'Mary Ann', last_name: 'Smith' })
    expect(splitPersonName('Cher')).toEqual({ first_name: 'Cher' })
    expect(splitPersonName('  ')).toEqual({})
  })
})

describe('the shipment callback', () => {
  it('reads one notice per order, with the items named back by their line', () => {
    const read = readShippingEasyCallback(
      JSON.stringify({
        shipment: {
          id: 58,
          tracking_number: '794675663409',
          carrier_key: 'FEDEX',
          carrier_service_key: 'FEDEX_GROUND',
          workflow_state: 'Label_Printed',
          orders: [
            { external_order_identifier: '1042', recipients: [{ line_items: [{ ext_line_item_id: '0', sku: 'p1', quantity: 2 }, { quantity: 0 }] }] },
            { external_order_identifier: '' },
          ],
        },
      }),
    )
    expect(read).toEqual({
      shipmentId: '58',
      workflowState: 'label_printed',
      notices: [
        {
          orderNumber: '1042',
          orderId: null,
          carrier: 'FEDEX',
          service: 'FEDEX_GROUND',
          trackingNumber: '794675663409',
          items: [{ lineItemId: '0', sku: 'p1', name: null, quantity: 2 }],
        },
      ],
    })
  })

  it('says why a body cannot be read', () => {
    expect(readShippingEasyCallback('<xml/>')).toEqual({ problem: 'The callback is not JSON.' })
    expect(readShippingEasyCallback('{"order":{}}')).toEqual({ problem: 'The callback names no shipment.' })
  })
})
