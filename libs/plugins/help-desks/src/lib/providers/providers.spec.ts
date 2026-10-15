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

import type { HelpDeskOrder } from '../model/orders'
import { mockFetch } from '../testing/memory-store'
import { createGladlyProvider, gladlyId } from './gladly'
import { createGorgiasProvider } from './gorgias'
import { accountApiBase, ProviderError, providerRequest } from './http'
import { createKustomerProvider } from './kustomer'
import type { HelpDeskCredential, HelpDeskTicket } from './provider'
import { createReamazeProvider } from './reamaze'
import { createRichpanelProvider } from './richpanel'
import { createHelpDeskProvider } from './registry'

const order: HelpDeskOrder = {
  id: 'ord-1',
  number: '#1042',
  createdAtMs: Date.UTC(2026, 9, 7, 12),
  currency: 'USD',
  totalCents: 4200,
  refundedCents: 0,
  status: 'paid',
  items: [
    { productId: 'p1', name: 'Mug', sku: 'MUG', quantity: 2, unitCents: 1500 },
    { productId: null, name: 'Tee', sku: null, quantity: 1, unitCents: 1200 },
  ],
  url: 'https://app.test/acme/hosts/shop/products/orders?order=ord-1',
}

const older: HelpDeskOrder = { ...order, id: 'ord-0', number: '#1001', createdAtMs: Date.UTC(2026, 8, 1), status: 'fulfilled' }

const ticket: HelpDeskTicket = {
  id: 'sub-1',
  email: 'pat@example.com',
  name: 'Pat Lee',
  subject: 'Contact: a message from Pat Lee',
  body: 'Where is my order?\n\nPhone: +15551234567',
  submittedAtMs: Date.UTC(2026, 9, 8),
}

const customer = { email: 'pat@example.com', name: 'Pat Lee', phone: '+15551234567' }

const credential = (overrides: Partial<HelpDeskCredential> = {}): HelpDeskCredential => ({
  account: 'acme',
  login: 'agent@example.com',
  token: 'secret-token',
  appClientId: null,
  supportEmail: null,
  ...overrides,
})

const basic = (login: string, token: string) => `Basic ${Buffer.from(`${login}:${token}`).toString('base64')}`

describe('the account host', () => {
  it('puts the account in front of the vendor host, and refuses anything that is not a subdomain', () => {
    expect(accountApiBase('https://gorgias.com/api', 'acme', 'Gorgias')).toBe('https://acme.gorgias.com/api')
    expect(() => accountApiBase('https://gorgias.com/api', 'evil.com/x', 'Gorgias')).toThrow(ProviderError)
    expect(() => accountApiBase('https://gorgias.com/api', null, 'Gorgias')).toThrow(ProviderError)
  })

  it('turns a refused credential into an auth error the engine reconnects on', async () => {
    const { http } = mockFetch(() => ({ status: 401, body: { message: 'bad key' } }))
    const error = await providerRequest(http, { provider: 'X', method: 'GET', url: 'https://x.test/' }).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.kind).toBe('auth')
  })
})

describe('Gorgias', () => {
  it('verifies against the account endpoint with Basic auth on the account subdomain', async () => {
    const { http, calls } = mockFetch(() => ({ body: { domain: 'acme' } }))
    const verified = await createGorgiasProvider(http).verify(credential())
    expect(verified).toEqual({ accountName: 'acme', targets: [] })
    expect(calls[0].url).toBe('https://acme.gorgias.com/api/account')
    expect(calls[0].headers['Authorization']).toBe(basic('agent@example.com', 'secret-token'))
  })

  it('adds a customer it cannot find, with an email channel', async () => {
    const { http, calls } = mockFetch((url, init) => {
      if (init.method === 'GET') return { body: { data: [] } }
      return { status: 201, body: { id: 77 } }
    })
    const ref = await createGorgiasProvider(http).upsertCustomer(credential(), customer, null)
    expect(ref).toEqual({ remoteId: '77' })
    expect(calls[0].url).toBe('https://acme.gorgias.com/api/customers?email=pat%40example.com&limit=1')
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://acme.gorgias.com/api/customers',
      body: {
        email: 'pat@example.com',
        name: 'Pat Lee',
        channels: [
          { type: 'email', address: 'pat@example.com', preferred: true },
          { type: 'phone', address: '+15551234567', preferred: false },
        ],
      },
    })
  })

  it('finds a known customer again when Gorgias says the remembered one is gone', async () => {
    const { http, calls } = mockFetch((url, init) => {
      if (init.method === 'PUT' && url.endsWith('/customers/5')) return { status: 404, body: { message: 'gone' } }
      if (init.method === 'GET') return { body: [{ id: 9 }] }
      return { body: {} }
    })
    const ref = await createGorgiasProvider(http).upsertCustomer(credential(), customer, '5')
    expect(ref).toEqual({ remoteId: '9' })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT https://acme.gorgias.com/api/customers/5',
      'GET https://acme.gorgias.com/api/customers?email=pat%40example.com&limit=1',
      'PUT https://acme.gorgias.com/api/customers/9',
    ])
  })

  it('writes the recent orders whole as the customer data', async () => {
    const { http, calls } = mockFetch(() => ({ status: 202 }))
    await createGorgiasProvider(http).pushOrder(credential(), {
      customer,
      remoteId: '9',
      order,
      recent: [order, older],
      targetId: null,
      source: 'Aglyn',
    })
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://acme.gorgias.com/api/customers/9/data')
    expect(calls[0].body.data).toMatchObject({
      source: 'Aglyn',
      last_order: '#1042 · Oct 7, 2026 · $42.00 · Paid',
      last_order_url: order.url,
    })
    expect(calls[0].body.data.orders).toHaveLength(2)
    expect(calls[0].body.data.orders[0]).toMatchObject({ number: '#1042', total: '$42.00', items: '2 × Mug, 1 × Tee', url: order.url })
    expect(typeof calls[0].body.version).toBe('string')
  })

  it('opens a ticket from the customer on the API channel', async () => {
    const { http, calls } = mockFetch(() => ({ status: 201, body: { id: 1 } }))
    await createGorgiasProvider(http).createTicket(credential(), { ticket, remoteId: '9', targetId: null, source: 'Aglyn', nowMs: 0 })
    expect(calls[0].url).toBe('https://acme.gorgias.com/api/tickets')
    expect(calls[0].body).toMatchObject({
      customer: { id: 9 },
      channel: 'api',
      via: 'api',
      external_id: 'sub-1',
      messages: [{ channel: 'api', via: 'api', from_agent: false, sender: { email: 'pat@example.com', name: 'Pat Lee' }, body_text: ticket.body }],
    })
  })
})

describe('Re:amaze', () => {
  it('verifies by listing the channels, which are the ones a message can start a conversation in', async () => {
    const { http, calls } = mockFetch(() => ({
      body: { total_count: 2, channels: [{ name: 'Support', slug: 'support', brand: { name: 'Acme' } }, { name: 'Chat', slug: 'chat' }] },
    }))
    const verified = await createReamazeProvider(http).verify(credential())
    expect(verified).toEqual({ accountName: 'Acme', targets: [{ id: 'support', name: 'Support' }, { id: 'chat', name: 'Chat' }] })
    expect(calls[0].url).toBe('https://acme.reamaze.io/api/v1/channels')
    expect(calls[0].headers['Accept']).toBe('application/json')
  })

  it('updates a contact by address, and adds one Re:amaze does not hold', async () => {
    const { http, calls } = mockFetch((url, init) => (init.method === 'PUT' ? { status: 404, body: { error: 'not found' } } : { body: {} }))
    const ref = await createReamazeProvider(http).upsertCustomer(credential(), customer, null)
    expect(ref).toEqual({ remoteId: 'pat@example.com' })
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://acme.reamaze.io/api/v1/contacts/pat%40example.com', body: { contact: { name: 'Pat Lee' } } })
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://acme.reamaze.io/api/v1/contacts',
      body: { contact: { email: 'pat@example.com', name: 'Pat Lee', mobile: '+15551234567' } },
    })
  })

  it('files the orders as one-level customer data attributes', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    await createReamazeProvider(http).pushOrder(credential(), { customer, remoteId: 'pat@example.com', order, recent: [order, older], targetId: null, source: 'Aglyn' })
    const data = calls[0].body.contact.data
    expect(Object.values(data).every((value) => typeof value === 'string')).toBe(true)
    expect(data).toMatchObject({
      'Orders from': 'Aglyn',
      'Last order': '#1042 · Oct 7, 2026 · $42.00 · Paid',
      'Last order link': order.url,
    })
    expect(data['Recent orders'].split('\n')).toHaveLength(2)
  })

  it('starts a conversation in the chosen channel from the sender', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    await createReamazeProvider(http).createTicket(credential(), { ticket, remoteId: 'pat@example.com', targetId: 'support', source: 'Aglyn', nowMs: 0 })
    expect(calls[0].url).toBe('https://acme.reamaze.io/api/v1/conversations')
    expect(calls[0].body).toEqual({
      conversation: {
        subject: ticket.subject,
        category: 'support',
        message: { body: ticket.body },
        user: { email: 'pat@example.com', name: 'Pat Lee' },
      },
    })
    await expect(
      createReamazeProvider(http).createTicket(credential(), { ticket, remoteId: 'x', targetId: null, source: 'Aglyn', nowMs: 0 }),
    ).rejects.toThrow('channel')
  })
})

describe('Kustomer', () => {
  const kustomer = () => credential({ account: null, login: null })

  it('verifies by listing the Klasses, which are the custom objects orders can go into', async () => {
    const { http, calls } = mockFetch(() => ({
      body: { data: [{ attributes: { name: 'aglynOrder', displayName: 'Store order' } }, { attributes: { name: 'purchase', displayname: 'Purchase' } }] },
    }))
    const verified = await createKustomerProvider(http).verify(kustomer())
    expect(verified.targets).toEqual([{ id: 'aglynOrder', name: 'Store order' }, { id: 'purchase', name: 'Purchase' }])
    expect(calls[0].url).toBe('https://api.kustomerapp.com/v1/klasses?pageSize=100')
    expect(calls[0].headers['Authorization']).toBe('Bearer secret-token')
  })

  it('finds a customer by email and adds one Kustomer does not hold', async () => {
    const { http, calls } = mockFetch((url, init) =>
      init.method === 'GET' ? { status: 404, body: { errors: [{ code: 'not_found', message: 'Resource not found.' }] } } : { status: 201, body: { data: { id: 'c-1' } } },
    )
    const ref = await createKustomerProvider(http).upsertCustomer(kustomer(), customer, null)
    expect(ref).toEqual({ remoteId: 'c-1' })
    expect(calls[0].url).toBe('https://api.kustomerapp.com/v1/customers/email=pat%40example.com')
    expect(calls[1].body).toEqual({
      name: 'Pat Lee',
      emails: [{ type: 'home', email: 'pat@example.com' }],
      phones: [{ type: 'mobile', phone: '+15551234567' }],
    })
  })

  it('adds an order as a custom object on the customer, and updates the same object later', async () => {
    let exists = false
    const { http, calls } = mockFetch((url, init) => {
      if (init.method === 'GET') return exists ? { body: { data: { id: 'k-1' } } } : { status: 404, body: { errors: [] } }
      return { status: 201, body: { data: { id: 'k-1' } } }
    })
    const provider = createKustomerProvider(http)
    await provider.pushOrder(kustomer(), { customer, remoteId: 'c-1', order, recent: [order], targetId: 'aglynOrder', source: 'Aglyn' })
    exists = true
    await provider.pushOrder(kustomer(), { customer, remoteId: 'c-1', order: { ...order, status: 'fulfilled' }, recent: [order], targetId: 'aglynOrder', source: 'Aglyn' })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.kustomerapp.com/v1/klasses/aglynOrder/externalId=ord-1',
      'POST https://api.kustomerapp.com/v1/customers/c-1/klasses/aglynOrder',
      'GET https://api.kustomerapp.com/v1/klasses/aglynOrder/externalId=ord-1',
      'PUT https://api.kustomerapp.com/v1/klasses/aglynOrder/k-1',
    ])
    expect(calls[1].body).toMatchObject({ externalId: 'ord-1', title: 'Order #1042', data: { status: 'Paid', total: '$42.00', url: order.url } })
    expect(calls[3].body.data.status).toBe('Fulfilled')
  })

  it('records a contact form message as an inbound email, which opens a conversation', async () => {
    const { http, calls } = mockFetch(() => ({ status: 201, body: { data: { id: 'm-1' } } }))
    await createKustomerProvider(http).createTicket(kustomer(), { ticket, remoteId: 'c-1', targetId: null, source: 'Aglyn', nowMs: 0 })
    expect(calls[0].url).toBe('https://api.kustomerapp.com/v1/customers/c-1/messages')
    expect(calls[0].body).toEqual({
      channel: 'email',
      app: 'aglyn',
      direction: 'in',
      status: 'received',
      subject: ticket.subject,
      preview: ticket.body,
      externalId: 'sub-1',
    })
  })
})

describe('Gladly', () => {
  it('verifies against the organization and lists the enabled inboxes', async () => {
    const { http, calls } = mockFetch((url) =>
      url.endsWith('/organization')
        ? { body: { name: 'Acme Co' } }
        : { body: [{ id: 'in-1', name: 'Email' }, { id: 'in-2', name: 'Old', disabled: true }] },
    )
    const verified = await createGladlyProvider(http).verify(credential())
    expect(verified).toEqual({ accountName: 'Acme Co', targets: [{ id: 'in-1', name: 'Email' }] })
    expect(calls[0].url).toBe('https://acme.gladly.com/api/v1/organization')
    expect(calls[1].url).toBe('https://acme.gladly.com/api/v1/inboxes')
  })

  it('adds a customer with an id of its own making, and a 409 on it is the same profile', async () => {
    const { http, calls } = mockFetch((url, init) =>
      init.method === 'GET' ? { body: [] } : { status: 409, body: { errors: [{ attr: 'id', code: 'taken' }] } },
    )
    const ref = await createGladlyProvider(http).upsertCustomer(credential(), customer, null)
    expect(ref.remoteId).toBe(gladlyId('agl', 'customer:pat@example.com'))
    expect(ref.remoteId.length).toBeLessThan(50)
    expect(calls[0].url).toBe('https://acme.gladly.com/api/v1/customer-profiles?email=pat%40example.com')
    expect(calls[1].body).toEqual({
      id: ref.remoteId,
      name: 'Pat Lee',
      emails: [{ original: 'pat@example.com', primary: true }],
      phones: [{ original: '+15551234567', primary: true }],
    })
  })

  it('puts each state of an order on the timeline once, as a customer activity', async () => {
    let sent = 0
    const { http, calls } = mockFetch(() => (sent++ === 0 ? { body: {} } : { status: 409, body: { errors: [{ code: 'taken' }] } }))
    const provider = createGladlyProvider(http)
    const input = { customer, remoteId: 'g-1', order, recent: [order], targetId: null, source: 'Aglyn' }
    await provider.pushOrder(credential(), input)
    await provider.pushOrder(credential(), input)
    expect(calls[0].url).toBe('https://acme.gladly.com/api/v1/customers/g-1/conversation-items')
    expect(calls[0].body.id).toBe(calls[1].body.id)
    expect(calls[0].body.content).toMatchObject({
      type: 'CUSTOMER_ACTIVITY',
      activityType: 'EMAIL',
      title: 'Order #1042 · Paid',
      sourceName: 'Aglyn',
      link: { url: order.url, text: 'View order' },
    })
  })

  it('opens a contact form message as a task in the chosen inbox, due a day later', async () => {
    const { http, calls } = mockFetch(() => ({ status: 201 }))
    const nowMs = Date.UTC(2026, 9, 8, 9)
    await createGladlyProvider(http).createTicket(credential(), { ticket, remoteId: 'g-1', targetId: 'in-1', source: 'Aglyn', nowMs })
    expect(calls[0].url).toBe('https://acme.gladly.com/api/v1/tasks')
    expect(calls[0].body).toMatchObject({
      customer: { emailAddress: 'pat@example.com' },
      assignee: { inboxId: 'in-1' },
      dueAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(calls[0].body.body).toContain('Where is my order?<br>')
  })
})

describe('Richpanel', () => {
  const richpanel = () => credential({ account: null, login: null, appClientId: 'store-1', supportEmail: 'help@example.com' })

  it('accepts a key Richpanel answers anything but a refusal for', async () => {
    const { http, calls } = mockFetch(() => ({ status: 400, body: {} }))
    await expect(createRichpanelProvider(http).verify(richpanel())).resolves.toEqual({ accountName: null, targets: [] })
    expect(calls[0].url).toBe('https://api.richpanel.com/v1/customers/email/connection-check%40example.com')
    expect(calls[0].headers['x-richpanel-key']).toBe('secret-token')
    const refused = mockFetch(() => ({ status: 403, body: {} }))
    await expect(createRichpanelProvider(refused.http).verify(richpanel())).rejects.toMatchObject({ kind: 'auth' })
  })

  it('creates or updates the customer by email, with the store id', async () => {
    const { http, calls } = mockFetch(() => ({ body: { customer: { id: 'x' } } }))
    await createRichpanelProvider(http).upsertCustomer(richpanel(), customer, null)
    expect(calls[0].body).toEqual({
      customer: { appClientId: 'store-1', email: 'pat@example.com', name: 'Pat Lee', phone: '+15551234567' },
    })
  })

  it('sends an order to the store’s order API', async () => {
    const { http, calls } = mockFetch(() => ({ body: 'done' }))
    await createRichpanelProvider(http).pushOrder(richpanel(), { customer, remoteId: 'pat@example.com', order, recent: [order], targetId: null, source: 'Aglyn' })
    expect(calls[0].url).toBe('https://api.richpanel.com/v1/order/store-1')
    expect(calls[0].body.orders[0]).toMatchObject({
      event: 'order',
      properties: {
        orderId: '#1042',
        amount: 42,
        currency: 'USD',
        status: 'paid',
        items: [
          { id: 'p1', name: 'Mug', sku: 'MUG', price: 15, quantity: 2 },
          { id: 'ord-1-2', name: 'Tee', sku: '', price: 12, quantity: 1 },
        ],
      },
      user_properties: { email: 'pat@example.com', firstName: 'Pat', lastName: 'Lee' },
    })
  })

  it('opens an email ticket from the sender to the support address', async () => {
    const { http, calls } = mockFetch(() => ({ body: { ticket: { id: 't' } } }))
    await createRichpanelProvider(http).createTicket(richpanel(), { ticket, remoteId: 'x', targetId: null, source: 'Aglyn', nowMs: 0 })
    expect(calls[0].url).toBe('https://api.richpanel.com/v1/tickets')
    expect(calls[0].body).toEqual({
      ticket: {
        status: 'OPEN',
        subject: ticket.subject,
        via: { channel: 'email', source: { from: { address: 'pat@example.com' }, to: { address: 'help@example.com' } } },
        comment: { body: ticket.body, sender_type: 'customer' },
      },
    })
  })
})

describe('the registry', () => {
  it('has an adapter for every help desk', () => {
    const { http } = mockFetch(() => ({ body: {} }))
    for (const id of ['gorgias', 'reamaze', 'kustomer', 'gladly', 'richpanel'] as const) {
      expect(createHelpDeskProvider(id, http).id).toBe(id)
    }
  })
})
