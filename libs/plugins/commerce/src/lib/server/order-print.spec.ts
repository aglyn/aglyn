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

import { memoryFirestore, memoryFirestoreModule } from '../testing/pos-ops-memory-firestore'

jest.mock('firebase-admin/firestore', () => memoryFirestoreModule)
jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { buildOrderInvoiceHtml } from '../utils/order-invoice'
import { buildPackingSlipHtml } from '../utils/order-packing-slip'
import { createOrderPrintHandler } from './order-print'

/*
 * `commerce/order-print` (AGL-3841): the apps print the console's own packing
 * slip and invoice, so the page the route answers must be the page the order
 * dialog writes into its popup, for whom the rules let read the order.
 */

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  editor: { uid: 'u-editor' },
  admin: { uid: 'u-admin' },
  viewer: { uid: 'u-viewer' },
  staff: { uid: 'u-staff', staff: true },
}

const order = {
  number: 1042,
  status: 'paid',
  createdAtMs: Date.UTC(2026, 9, 6, 12),
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  shippingAddress: { name: '<img src=x onerror="alert(1)">', line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  lineItems: [{ productId: 'p1', name: 'Mug', variantLabel: 'Blue', sku: 'MUG-1', quantity: 2, unitAmountCents: 1250 }],
  totals: { itemsCents: 2500, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 2500, feeCents: 0 },
}

function setup() {
  const memory = memoryFirestore(() => 5_000)
  memory.seed('hosts/h1', {
    businessName: 'Juniper Street Co.',
    memberRoles: { 'u-editor': 'editor', 'u-admin': 'admin', 'u-viewer': 'viewer' },
  })
  memory.seed('hosts/h1/settings/store', { currency: 'usd', receiptFooter: 'Thank you!' })
  memory.seed('hosts/h1/orders/o1', order)
  const handler = createOrderPrintHandler({
    firestore: () => memory.firestore as never,
    verifyIdToken: async (token: string) => {
      const decoded = TOKENS[token]
      if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
      return decoded
    },
  })
  return { handler }
}

function call(handler: any, token: string | null, query: Record<string, unknown>, method = 'GET') {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => ((res.statusCode = code), res)
  res.json = (value: unknown) => ((res.body = value), res)
  return Promise.resolve(
    handler({ method, query, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res),
  ).then(() => res)
}

describe('commerce/order-print', () => {
  it('answers the packing slip the order dialog prints', async () => {
    const { handler } = setup()
    const res = await call(handler, 'editor', { hostId: 'h1', orderId: 'o1', kind: 'packing-slip' })
    expect(res.statusCode).toBe(200)
    expect(res.body.title).toBe('Packing slip #1042')
    expect(res.body.html).toBe(buildPackingSlipHtml(order as never, 'o1'))
    expect(res.body.html).not.toContain('<img')
  })

  it('answers the invoice with the site name, currency and footer the Invoice button reads', async () => {
    const { handler } = setup()
    const res = await call(handler, 'admin', { hostId: 'h1', orderId: 'o1', kind: 'invoice' })
    expect(res.statusCode).toBe(200)
    expect(res.body.title).toBe('Invoice #1042')
    expect(res.body.html).toBe(
      buildOrderInvoiceHtml({
        order: order as never,
        orderId: 'o1',
        store: { name: 'Juniper Street Co.', currency: 'usd', footer: 'Thank you!', termsUrl: null },
      }),
    )
    expect(res.body.html).toContain('Juniper Street Co.')
    expect(res.body.html).toContain('Thank you!')
  })

  it('lets staff print, and refuses a viewer, a stranger and no token', async () => {
    const { handler } = setup()
    expect((await call(handler, 'staff', { hostId: 'h1', orderId: 'o1', kind: 'invoice' })).statusCode).toBe(200)
    expect((await call(handler, 'viewer', { hostId: 'h1', orderId: 'o1', kind: 'invoice' })).statusCode).toBe(403)
    expect((await call(handler, 'nobody', { hostId: 'h1', orderId: 'o1', kind: 'invoice' })).statusCode).toBe(401)
    expect((await call(handler, null, { hostId: 'h1', orderId: 'o1', kind: 'invoice' })).statusCode).toBe(401)
  })

  it('refuses a missing order, an unknown kind and a write', async () => {
    const { handler } = setup()
    expect((await call(handler, 'editor', { hostId: 'h1', orderId: 'gone', kind: 'invoice' })).statusCode).toBe(404)
    expect((await call(handler, 'editor', { hostId: 'h2', orderId: 'o1', kind: 'invoice' })).statusCode).toBe(404)
    expect((await call(handler, 'editor', { hostId: 'h1', orderId: 'o1', kind: 'receipt' })).statusCode).toBe(400)
    expect((await call(handler, 'editor', { hostId: 'h1', orderId: '../x', kind: 'invoice' })).statusCode).toBe(400)
    expect((await call(handler, 'editor', { hostId: 'h1', orderId: 'o1', kind: 'invoice' }, 'POST')).statusCode).toBe(405)
  })
})
