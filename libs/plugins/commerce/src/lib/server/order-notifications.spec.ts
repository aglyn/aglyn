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

import {
  registerPluginSmsMessaging,
  type PluginSmsSendRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  registerPluginOrderEmailCopies,
  type PluginOrderEmailCopyRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-order-email-copies'
import {
  composeOrderBuyerMessage,
  notifyOrderBuyer,
  onlineReceiptExtras,
  sendOrderReceipt,
} from './order-notifications'
import { verifyOrderStatusToken } from './order-status-token'

/**
 * Every buyer message goes through one door, once (AGL-3610).
 *
 * The double is an in-memory Firestore that applies `update()` field paths
 * the way Firestore does — `buyerNotifications.<marker>` writes INTO the map
 * rather than beside it — because the idempotency claim is exactly such a
 * write, and a double that stored the dotted key literally would let every
 * "sent once" case pass against a claim that never blocked anything.
 * Transactions are serialized and their writes buffered.
 */

const docs = new Map<string, Record<string, any>>()
const DELETE = Symbol('delete')

function applyUpdate(existing: Record<string, any>, value: Record<string, any>) {
  const next = JSON.parse(JSON.stringify(existing))
  for (const [path, field] of Object.entries(value)) {
    const parts = path.split('.')
    let target = next
    for (const part of parts.slice(0, -1)) {
      target[part] = target[part] && typeof target[part] === 'object' ? target[part] : {}
      target = target[part]
    }
    const last = parts[parts.length - 1]
    if (field === DELETE) delete target[last]
    else target[last] = field
  }
  return next
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => {
      const data = docs.get(path)
      return {
        exists: data !== undefined,
        data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
        get: (field: string) => data?.[field],
      }
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (!existing) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyUpdate(existing, value))
    },
    set: async (value: Record<string, any>) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`) }
}

let queue: Promise<unknown> = Promise.resolve()
const firestore: any = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: <T>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const writes: Array<[any, any]> = []
      const result = await fn({
        get: (ref: any) => ref.get(),
        update: (ref: any, value: any) => writes.push([ref, value]),
      })
      for (const [ref, value] of writes) await ref.update(value)
      return result
    })
    queue = run.catch(() => undefined)
    return run
  },
}

const mockSendEmail = jest.fn(async (_options: any): Promise<any> => undefined)
const mockRender = jest.fn(async (..._args: any[]) => null as any)
const mockMeter = jest.fn(async (_hostId: string) => undefined)
let emailConfigured = true

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => emailConfigured,
  sendEmail: (options: any) => mockSendEmail(options),
  renderTextEmailHtml: (text: string) => `<html><body><p>${text}</p></body></html>`,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: { FieldValue: { delete: () => DELETE } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  hostSendingIdentity: async () => undefined,
  meterHostEmail: (hostId: string) => mockMeter(hostId),
  renderHostEmailWithTokens: (...args: any[]) => mockRender(...args),
}))

const HOST = 'host-1'
const ORDER = 'order-1'
const REF = { hostId: HOST, orderId: ORDER }
const ORDER_PATH = `hosts/${HOST}/orders/${ORDER}`

function seed(order: Record<string, any> = {}, store: Record<string, any> = {}) {
  docs.set(`hosts/${HOST}`, {
    subdomain: 'northwind',
    displayName: 'Northwind Coffee',
  })
  docs.set(`hosts/${HOST}/settings/store`, { currency: 'USD', ...store })
  docs.set(ORDER_PATH, {
    number: 1042,
    status: 'paid',
    channel: 'online',
    customerEmail: 'buyer@example.com',
    totals: { totalCents: 3400, itemsCents: 3400, shippingCents: 0, taxCents: 0, discountCents: 0, feeCents: 0 },
    lineItems: [
      { productId: 'p1', name: 'House Blend', quantity: 2, unitAmountCents: 1200, productType: 'physical' },
      { productId: 'p2', name: 'Mug', quantity: 1, unitAmountCents: 1000, productType: 'physical' },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    ...order,
  })
}

beforeEach(() => {
  docs.clear()
  mockSendEmail.mockClear()
  mockRender.mockClear()
  mockMeter.mockClear()
  emailConfigured = true
  process.env.TOKEN_SIGNING_SECRET = 'test-secret'
  unregisterPluginServices('sms-test')
  unregisterPluginServices('copies-test')
})

const shipment = (id: string, lineItemIds: number[], extra: Record<string, any> = {}) => ({
  id,
  lineItemIds,
  atMs: Date.now(),
  ...extra,
})

describe('notifyOrderBuyer (AGL-3610)', () => {
  it('sends the shipped email once per shipment, with carrier, tracking link and what is left', async () => {
    seed({
      fulfillments: [shipment('f1', [0], { carrier: 'UPS', trackingNumber: '1Z999' })],
    })
    const first = await notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' })
    const again = await notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' })
    expect(first).toEqual({ outcome: 'handled', channels: [{ channel: 'email', outcome: 'sent' }] })
    expect(again).toEqual({ outcome: 'handled', channels: [{ channel: 'email', outcome: 'already' }] })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [, , key, tokens] = mockRender.mock.calls[0]
    expect(key).toBe('order-shipped')
    expect(tokens['order.number']).toBe('#1042')
    expect(tokens['shipment.summary']).toBe('2× House Blend')
    expect(tokens['shipment.tracking']).toBe(
      'Tracking: UPS 1Z999 — https://www.ups.com/track?tracknum=1Z999',
    )
    expect(tokens['shipment.remaining']).toBe('1 more item will ship separately.')
    expect(tokens['order.statusUrl']).toMatch(
      /^https:\/\/northwind\.[^/]+\/order-status\?o=order-1&t=[0-9a-f]{32}$/,
    )
    const token = new URL(tokens['order.statusUrl']).searchParams.get('t') ?? ''
    expect(verifyOrderStatusToken(HOST, ORDER, token)).toBe(true)
    const stored = docs.get(ORDER_PATH)!
    expect(stored.buyerNotifications['shipped__f1__email']).toMatchObject({ state: 'sent', channel: 'email' })
    expect(stored.timeline.at(-1)).toMatchObject({
      event: 'buyer-notified',
      detail: 'Shipping confirmation sent by email',
    })
    expect(mockMeter).toHaveBeenCalledWith(HOST)
  })

  it('treats a second shipment as a new message, and defaults to the latest shipment', async () => {
    seed({
      fulfillments: [
        { ...shipment('f1', [0]), atMs: 1 },
        { ...shipment('f2', [1], { carrier: 'Local courier', trackingNumber: 'LC-1' }), atMs: 2 },
      ],
    })
    await notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' })
    await notifyOrderBuyer(REF, 'shipped')
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    const tokens = mockRender.mock.calls[1][3]
    expect(tokens['shipment.summary']).toBe('1× Mug')
    // Unknown carrier: the number, and no invented link.
    expect(tokens['shipment.tracking']).toBe('Tracking: Local courier LC-1')
    expect(tokens['shipment.remaining']).toBe('')
  })

  it('races to exactly one send', async () => {
    seed({ fulfillments: [shipment('f1', [0, 1])] })
    await Promise.all([
      notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' }),
      notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' }),
      notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' }),
    ])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('releases the claim when the send fails, so a retry can send', async () => {
    seed({ fulfillments: [shipment('f1', [0])] })
    mockSendEmail.mockRejectedValueOnce(new Error('smtp down'))
    const failed = await notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' })
    expect(failed).toEqual({
      outcome: 'handled',
      channels: [{ channel: 'email', outcome: 'failed', error: 'smtp down' }],
    })
    expect(docs.get(ORDER_PATH)!.buyerNotifications ?? {}).toEqual({})
    await notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' })
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('honors the store switches, which are on unless explicitly off', async () => {
    seed({}, { buyerNotifications: { delivered: false } })
    expect(await notifyOrderBuyer(REF, 'delivered')).toEqual({ outcome: 'disabled' })
    expect(await notifyOrderBuyer(REF, 'cancelled')).toMatchObject({ outcome: 'handled' })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('does not announce a shipment for a counter sale or a digital-only order', async () => {
    seed({ channel: 'pos', fulfillments: [shipment('f1', [0, 1])] })
    expect(await notifyOrderBuyer(REF, 'shipped')).toEqual({ outcome: 'not_applicable' })
    expect(await notifyOrderBuyer(REF, 'delivered')).toEqual({ outcome: 'not_applicable' })
    seed({
      lineItems: [{ productId: 'd', name: 'Ebook', quantity: 1, unitAmountCents: 500, productType: 'digital' }],
      fulfillments: [shipment('f1', [0])],
    })
    expect(await notifyOrderBuyer(REF, 'shipped')).toEqual({ outcome: 'not_applicable' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('sends one refund email per refund, with the amount and the named lines', async () => {
    seed()
    await notifyOrderBuyer(REF, 'refunded', {
      refundId: 're_1',
      refundCents: 1200,
      refundLineIndexes: [1],
    })
    await notifyOrderBuyer(REF, 'refunded', { refundId: 're_1', refundCents: 1200 })
    await notifyOrderBuyer(REF, 'refunded', {
      refundId: 're_2',
      refundCents: 2200,
      fullyRefunded: true,
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    expect(mockRender.mock.calls[0][3]).toMatchObject({
      'refund.amount': '$12.00',
      'refund.summary': '1× Mug',
      'refund.note': 'The rest of your order is unchanged.',
    })
    expect(mockRender.mock.calls[1][3]).toMatchObject({
      'refund.amount': '$22.00',
      'refund.summary': '',
      'refund.note': 'Your order has been refunded in full.',
    })
  })

  it('says nothing about a refund that moved nothing', async () => {
    seed()
    expect(
      await notifyOrderBuyer(REF, 'refunded', { refundId: 're_0', refundCents: 0 }),
    ).toEqual({ outcome: 'not_applicable' })
  })

  it('mails a register receipt to the address the cashier was given', async () => {
    seed({ channel: 'pos', customerEmail: null })
    const outcome = await notifyOrderBuyer(REF, 'receipt', { email: 'guest@example.com' })
    expect(outcome).toMatchObject({ outcome: 'handled' })
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: 'guest@example.com',
      owedFor: 'order',
      audience: 'tenant',
      context: 'order-receipt',
    })
    expect(mockRender.mock.calls[0][3]).toMatchObject({
      'order.summary': '2× House Blend — $24.00\n1× Mug — $10.00',
      'order.total': '$34.00',
    })
  })

  it('has nobody to tell without an address or a configured mail rail', async () => {
    seed({ customerEmail: null })
    expect(await notifyOrderBuyer(REF, 'receipt')).toEqual({ outcome: 'no_recipient' })
    seed()
    emailConfigured = false
    expect(await notifyOrderBuyer(REF, 'receipt')).toEqual({ outcome: 'no_recipient' })
    expect(await notifyOrderBuyer({ hostId: HOST, orderId: 'missing' }, 'receipt')).toEqual({
      outcome: 'no_such_order',
    })
  })

  it('also texts a buyer whose phone the order carries, when a provider is configured', async () => {
    const sent: PluginSmsSendRequest[] = []
    registerPluginSmsMessaging(
      {
        isConfigured: () => true,
        send: async (request) => {
          sent.push(request)
          return { status: 'sent', id: 'SM1', to: '+15555550100', segments: 1 }
        },
      },
      { pluginId: 'sms-test' },
    )
    seed({ customerPhone: '(555) 555-0100' })
    const outcome = await notifyOrderBuyer(REF, 'cancelled')
    expect(outcome).toEqual({
      outcome: 'handled',
      channels: [
        { channel: 'email', outcome: 'sent' },
        { channel: 'sms', outcome: 'sent' },
      ],
    })
    expect(sent[0]).toMatchObject({ to: '(555) 555-0100', purpose: 'transactional', hostId: HOST })
    expect(sent[0].body).toMatch(/^Northwind Coffee: order #1042 was canceled\. https:/)
    // Texts off: email only.
    seed({ customerPhone: '(555) 555-0100' }, { buyerNotifications: { texts: false } })
    await notifyOrderBuyer(REF, 'delivered')
    expect(sent).toHaveLength(1)
  })

  it('asks for quiet hours in the store zone on later moments, never on a receipt', async () => {
    const sent: PluginSmsSendRequest[] = []
    registerPluginSmsMessaging(
      {
        isConfigured: () => true,
        send: async (request) => {
          sent.push(request)
          return {
            status: 'sent',
            id: 'SM1',
            to: '+15555550100',
            segments: 1,
            ...(request.quietHours ? { scheduledForMs: 1_000 } : {}),
          }
        },
      },
      { pluginId: 'sms-test' },
    )
    seed({ customerEmail: null, customerPhone: '+15555550100' })
    docs.set(`hosts/${HOST}`, {
      subdomain: 'northwind',
      displayName: 'Northwind Coffee',
      timeZone: 'America/Denver',
    })
    await notifyOrderBuyer(REF, 'receipt')
    await notifyOrderBuyer(REF, 'delivered')
    expect(sent[0].quietHours).toBeUndefined()
    expect(sent[1].quietHours).toEqual({ timeZone: 'America/Denver' })
    const timeline = docs.get(ORDER_PATH)?.['timeline'] as Array<{ detail?: string }>
    expect(timeline.map((entry) => entry.detail)).toContain(
      'Delivery confirmation sent (held for the morning) by text',
    )
  })

  it('records a suppressed text as a failure and leaves it retryable', async () => {
    registerPluginSmsMessaging(
      { isConfigured: () => true, send: async () => ({ status: 'suppressed' }) },
      { pluginId: 'sms-test' },
    )
    seed({ customerEmail: null, customerPhone: '+15555550100' })
    const outcome = await notifyOrderBuyer(REF, 'delivered')
    expect(outcome).toEqual({
      outcome: 'handled',
      channels: [{ channel: 'sms', outcome: 'failed', error: 'suppressed' }],
    })
  })
})

describe('plugins copied on a buyer email (AGL-3699)', () => {
  function copyOn(moment: string, settled: boolean[], asked: PluginOrderEmailCopyRequest[] = []) {
    registerPluginOrderEmailCopies(
      async (request) => {
        asked.push(request)
        if (request.moment !== moment) return null
        return {
          bcc: ['northwind.example+a1@invite.trustpilot.com'],
          dataBlocks: [{ type: 'application/json+trustpilot', json: { referenceId: '1042' } }],
          settle: async (sent) => {
            settled.push(sent)
          },
        }
      },
      { pluginId: 'copies-test' },
    )
  }

  it('blind-copies the email a plugin asks for, with its data block in the HTML part, and says it left', async () => {
    seed({ status: 'delivered' })
    const settled: boolean[] = []
    const asked: PluginOrderEmailCopyRequest[] = []
    copyOn('delivered', settled, asked)
    mockSendEmail.mockResolvedValueOnce({ sent: true, id: 'm_1' })
    await notifyOrderBuyer(REF, 'delivered')
    const options = mockSendEmail.mock.calls[0][0]
    expect(options.bcc).toEqual(['northwind.example+a1@invite.trustpilot.com'])
    expect(options.to).toBe('buyer@example.com')
    // No designed email: the synthesized HTML part carries the block.
    expect(options.html).toBe(
      '<html><body><p>' +
        options.text +
        '</p><script type="application/json+trustpilot">{"referenceId":"1042"}</script></body></html>',
    )
    expect(settled).toEqual([true])
    expect(asked[0]).toMatchObject({
      hostId: HOST,
      recordId: ORDER,
      emailKey: 'order-delivered',
      moment: 'delivered',
      recipient: 'buyer@example.com',
    })
    // The order as the public API shapes it, rehearsal flag and all.
    expect(asked[0].order).toMatchObject({ id: ORDER, number: 1042, status: 'delivered', livemode: true })
  })

  it('puts the block inside a designed email, and tells the plugin when the email did not leave', async () => {
    seed({ status: 'delivered' })
    const settled: boolean[] = []
    copyOn('delivered', settled)
    mockRender.mockResolvedValueOnce({ subject: 'Delivered', text: 'Here', html: '<html><body><h1>Here</h1></body></html>' })
    mockSendEmail.mockResolvedValueOnce({ sent: false, reason: 'rejected' })
    await notifyOrderBuyer(REF, 'delivered')
    expect(mockSendEmail.mock.calls[0][0].html).toBe(
      '<html><body><h1>Here</h1><script type="application/json+trustpilot">{"referenceId":"1042"}</script></body></html>',
    )
    expect(settled).toEqual([false])
  })

  it('adds nothing on a moment no plugin asked for, and never on a merchant-asked resend', async () => {
    seed({ fulfillments: [shipment('f1', [0, 1])] })
    const settled: boolean[] = []
    const asked: PluginOrderEmailCopyRequest[] = []
    copyOn('delivered', settled, asked)
    await notifyOrderBuyer(REF, 'shipped', { fulfillmentId: 'f1' })
    expect(mockSendEmail.mock.calls[0][0]).not.toHaveProperty('bcc')
    expect(mockSendEmail.mock.calls[0][0]).not.toHaveProperty('html')
    asked.length = 0
    await sendOrderReceipt(REF, { channel: 'email', to: 'buyer@example.com' })
    expect(asked).toHaveLength(0)
    expect(mockSendEmail.mock.calls[1][0]).not.toHaveProperty('bcc')
    expect(settled).toEqual([])
  })
})

describe('composeOrderBuyerMessage (AGL-3610)', () => {
  const order: any = {
    number: 7,
    status: 'cancelled',
    channel: 'draft',
    lineItems: [{ productId: 'p', name: 'Tee', quantity: 1, unitAmountCents: 500 }],
  }
  const base = {
    order,
    orderId: 'o',
    businessName: 'Shop',
    currency: 'USD',
    statusUrl: 'https://shop.example/order-status?o=o&t=x',
  }

  it('promises no refund on a cancellation, and says nothing of payment when none was made', () => {
    const unpaid = composeOrderBuyerMessage({ ...base, event: 'cancelled' })
    expect(unpaid?.tokens['cancel.note']).toBe('')
    const paid = composeOrderBuyerMessage({
      ...base,
      event: 'cancelled',
      order: { ...order, timeline: [{ atMs: 1, event: 'paid' }] },
    })
    expect(paid?.tokens['cancel.note']).toBe(
      'Questions about a payment? Reply to this email or contact Shop.',
    )
    expect(paid?.text).not.toMatch(/will be refunded/)
  })

  it('formats in the store currency', () => {
    const receipt = composeOrderBuyerMessage({ ...base, event: 'receipt', currency: 'EUR' })
    expect(receipt?.tokens['order.summary']).toBe('1× Tee — €5.00')
  })
})

describe('composeOrderBuyerMessage for pickup and local delivery (AGL-3624)', () => {
  const lines = [{ productId: 'p', name: 'Bread', quantity: 2, unitAmountCents: 500, productType: 'physical' }]
  const base = {
    orderId: 'o',
    businessName: 'Bakery',
    currency: 'USD',
    statusUrl: 'https://shop.example/order-status?o=o&t=x',
  }
  const pickupOrder: any = {
    number: 12,
    status: 'paid',
    channel: 'online',
    fulfillmentMethod: 'pickup',
    lineItems: lines,
    pickup: {
      locationId: 'main',
      locationName: 'Main Street',
      address: '1 Main St',
      hours: 'Mo-Fr 09:00-17:00',
      instructions: 'Side door',
      status: 'ready',
    },
  }

  it('says where to collect, the hours and the instructions when it is ready', () => {
    const message = composeOrderBuyerMessage({ ...base, order: pickupOrder, event: 'ready_for_pickup' })
    expect(message?.emailKey).toBe('order-ready-for-pickup')
    expect(message?.occurrence).toBe('order')
    expect(message?.tokens).toMatchObject({
      'pickup.location': 'Main Street, 1 Main St',
      'pickup.hours': 'Pickup hours:\nMo-Fr 09:00-17:00',
      'pickup.instructions': 'Side door',
      'order.summary': '2× Bread',
    })
    expect(message?.subject).toBe('Your order #12 is ready for pickup')
    expect(message?.sms).toBe(
      'Bakery: order #12 is ready for pickup at Main Street. https://shop.example/order-status?o=o&t=x',
    )
  })

  it('confirms a pickup, and says nothing of pickup for a shipped order', () => {
    expect(composeOrderBuyerMessage({ ...base, order: pickupOrder, event: 'picked_up' })?.emailKey).toBe(
      'order-picked-up',
    )
    expect(
      composeOrderBuyerMessage({ ...base, order: { ...pickupOrder, fulfillmentMethod: 'shipping' }, event: 'ready_for_pickup' }),
    ).toBeNull()
  })

  it('tells the buyer the driver is out, once per run, with the window', () => {
    const order: any = {
      number: 13,
      status: 'paid',
      fulfillmentMethod: 'local_delivery',
      lineItems: lines,
      localDelivery: { status: 'out_for_delivery', windowLabel: 'Tue, Oct 13, 9:00 AM – 12:00 PM', outForDeliveryAtMs: 77 },
    }
    const message = composeOrderBuyerMessage({ ...base, order, event: 'out_for_delivery' })
    expect(message?.emailKey).toBe('order-out-for-delivery')
    expect(message?.occurrence).toBe('77')
    expect(message?.tokens['delivery.window']).toBe('Tue, Oct 13, 9:00 AM – 12:00 PM')
  })

  it('never calls a handover a shipment', () => {
    const order: any = {
      ...pickupOrder,
      fulfillments: [{ id: 'f1', lineItemIds: [0], handover: 'pickup', atMs: 1 }],
    }
    expect(composeOrderBuyerMessage({ ...base, order, event: 'shipped', options: { fulfillmentId: 'f1' } })).toBeNull()
  })
})

describe('sendOrderReceipt (AGL-3610)', () => {
  it('re-sends on request, ignoring the automatic switch and the sent marker', async () => {
    seed({}, { buyerNotifications: { receipt: false } })
    expect(await sendOrderReceipt(REF, { channel: 'email', to: 'other@example.com' })).toEqual({
      outcome: 'sent',
      channel: 'email',
    })
    expect(await sendOrderReceipt(REF, { channel: 'email', to: 'other@example.com' })).toEqual({
      outcome: 'sent',
      channel: 'email',
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    expect(docs.get(ORDER_PATH)!.timeline.at(-1).detail).toBe('Receipt re-sent by email')
  })

  it('refuses a bad address, an unconfigured text rail and a missing order', async () => {
    seed()
    expect(await sendOrderReceipt(REF, { channel: 'email', to: 'nope' })).toEqual({
      outcome: 'invalid_recipient',
    })
    expect(await sendOrderReceipt(REF, { channel: 'sms', to: '+15555550100' })).toEqual({
      outcome: 'not_configured',
    })
    expect(
      await sendOrderReceipt({ hostId: HOST, orderId: 'missing' }, { channel: 'email', to: 'a@b.co' }),
    ).toEqual({ outcome: 'no_such_order' })
  })
})

describe('onlineReceiptExtras (AGL-3610)', () => {
  it('hands the online receipt its switch and its status link', async () => {
    seed()
    const extras = await onlineReceiptExtras(HOST, ORDER, firestore)
    expect(extras.enabled).toBe(true)
    expect(extras.tokens['order.number']).toBe('#1042')
    expect(extras.tokens['order.statusUrl']).toContain('/order-status?o=order-1&t=')
    seed({}, { buyerNotifications: { receipt: false } })
    expect((await onlineReceiptExtras(HOST, ORDER, firestore)).enabled).toBe(false)
  })
})
