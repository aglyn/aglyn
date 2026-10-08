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

'use strict'

/**
 * What each operation sends to Aglyn's REST API and makes of the answer
 * (AGL-3643), against the paths and shapes the API documents.
 */

const app = require('../index')
const { DEFAULT_API_URL, decimalAmount } = require('../lib/api')
const { fakeZ, ExpiredAuthError, ThrottledError, ZapierError } = require('./fake-z')

const ORDER = {
  id: 'o1',
  object: 'order',
  number: 1042,
  status: 'paid',
  currency: 'usd',
  totals: { totalCents: 2290 },
  refundedCents: 0,
}

const bundleWith = (inputData = {}, extra = {}) => ({ authData: { apiKey: 'aglyn_sk_test' }, inputData, meta: {}, ...extra })

afterEach(() => {
  delete process.env.AGLYN_API_URL
})

describe('requests (AGL-3643)', () => {
  it('reach Aglyn’s API with the key as a bearer token, or the operator’s own console', async () => {
    const { z, calls } = fakeZ({ 'GET /api/v1/me': () => ({ data: { object: 'api_key', org: 'org1', name: 'Zapier', scopes: [] } }) })
    const me = await app.authentication.test(z, bundleWith())
    expect(calls[0].url).toBe(`${DEFAULT_API_URL}/v1/me`)
    expect(calls[0].headers.Authorization).toBe('Bearer aglyn_sk_test')
    expect(app.authentication.connectionLabel(z, { inputData: me })).toBe('Zapier (org1)')
    expect(app.authentication.connectionLabel(z, { inputData: { org: 'org1', name: null } })).toBe('org1')

    process.env.AGLYN_API_URL = 'https://console.example.com/api/'
    const own = fakeZ({ 'GET /api/v1/me': () => ({ data: { object: 'api_key', org: 'org1' } }) })
    await app.authentication.test(own.z, bundleWith())
    expect(own.calls[0].url).toBe('https://console.example.com/api/v1/me')
  })

  it('turn a revoked key into a reconnect, a rate limit into a wait, and anything else into Aglyn’s sentence', async () => {
    const revoked = fakeZ({ 'GET /api/v1/me': () => ({ status: 401, data: { error: { type: 'unauthorized', message: 'Invalid or missing API key' } } }) })
    await expect(app.authentication.test(revoked.z, bundleWith())).rejects.toBeInstanceOf(ExpiredAuthError)

    const limited = fakeZ({ 'GET /api/v1/me': () => ({ status: 429, headers: { 'retry-after': '17' }, data: { error: { message: 'Slow down' } } }) })
    await expect(app.authentication.test(limited.z, bundleWith())).rejects.toMatchObject({ name: 'ThrottledError', delay: 17 })
    expect(ThrottledError).toBeDefined()

    const refused = fakeZ({
      'GET /api/v1/me': () => ({ status: 403, data: { error: { type: 'insufficient_scope', message: 'Missing the "orders:read" scope', code: 'orders:read' } } }),
    })
    await expect(app.authentication.test(refused.z, bundleWith())).rejects.toMatchObject({
      message: 'Missing the "orders:read" scope',
      code: 'orders:read',
      status: 403,
    })
  })

  it('give money as decimals in the currency’s own unit', () => {
    expect(decimalAmount(2290, 'usd')).toBe('22.90')
    expect(decimalAmount(2290, 'JPY')).toBe('2290')
    expect(decimalAmount(null, 'usd')).toBeNull()
  })
})

describe('instant triggers (AGL-3643)', () => {
  it('subscribe the Zap’s URL to the trigger’s events on the chosen site, and unsubscribe it', async () => {
    const { z, calls } = fakeZ({
      'POST /api/v1/sites/s%201/hooks': (call) => ({ status: 201, data: { id: 'hook_1', object: 'hook', siteId: 's 1', events: call.body.events } }),
      'DELETE /api/v1/sites/s%201/hooks/hook_1': () => ({ data: { id: 'hook_1', object: 'hook', deleted: true } }),
    })
    const trigger = app.triggers.new_paid_order.operation
    const subscribed = await trigger.performSubscribe(z, bundleWith({ siteId: 's 1' }, { targetUrl: 'https://hooks.zapier.com/hooks/standard/1/a/' }))
    expect(calls[0].body).toEqual({ targetUrl: 'https://hooks.zapier.com/hooks/standard/1/a/', events: ['order.paid'] })
    expect(subscribed.id).toBe('hook_1')
    const removed = await trigger.performUnsubscribe(z, bundleWith({ siteId: 's 1' }, { subscribeData: subscribed }))
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/api/v1/sites/s%201/hooks/hook_1' })
    expect(removed).toMatchObject({ deleted: true })
  })

  it('let an update trigger take only the changes chosen, or all of them', async () => {
    const { z, calls } = fakeZ({ 'POST /api/v1/sites/s1/hooks': (call) => ({ status: 201, data: { id: 'h', events: call.body.events } }) })
    const trigger = app.triggers.updated_order.operation
    await trigger.performSubscribe(z, bundleWith({ siteId: 's1', events: ['order.refunded', 'order.exploded'] }, { targetUrl: 'https://hooks.zapier.com/x' }))
    await trigger.performSubscribe(z, bundleWith({ siteId: 's1' }, { targetUrl: 'https://hooks.zapier.com/y' }))
    expect(calls[0].body.events).toEqual(['order.refunded'])
    expect(calls[1].body.events).toEqual(['order.fulfilled', 'order.delivered', 'order.refunded', 'order.cancelled'])
    expect(trigger.inputFields[1]).toMatchObject({ key: 'events', list: true })
  })

  it('treat a hook already gone as unsubscribed, and say why anything else failed', async () => {
    const gone = fakeZ({})
    const trigger = app.triggers.new_booking.operation
    await expect(trigger.performUnsubscribe(gone.z, bundleWith({ siteId: 's1' }, { subscribeData: { id: 'h', siteId: 's1' } }))).resolves.toMatchObject({ deleted: true })
    const refused = fakeZ({
      'DELETE /api/v1/sites/s1/hooks/h': () => ({ status: 403, data: { error: { message: 'Missing the "bookings:read" scope', code: 'bookings:read' } } }),
    })
    await expect(trigger.performUnsubscribe(refused.z, bundleWith({ siteId: 's1' }, { subscribeData: { id: 'h', siteId: 's1' } }))).rejects.toBeInstanceOf(ZapierError)
  })

  it('turn a posted order event into the order, with decimal money and what happened', async () => {
    const { z } = fakeZ({})
    const rows = await app.triggers.updated_order.operation.perform(
      z,
      bundleWith(
        { siteId: 's1' },
        {
          cleanedRequest: {
            id: 'evt_1',
            type: 'order.fulfilled',
            createdAt: '2026-10-07T12:00:00.000Z',
            siteId: 's1',
            data: { order: { ...ORDER, status: 'fulfilled' }, fulfillment: { id: 'f1', carrier: 'UPS' } },
          },
        },
      ),
    )
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'o1',
        status: 'fulfilled',
        totalAmount: '22.90',
        refundedAmount: '0.00',
        event: 'order.fulfilled',
        eventId: 'evt_1',
        fulfillment: { id: 'f1', carrier: 'UPS' },
        refund: null,
      }),
    ])
  })

  it('ignore a post for an event the trigger does not take', async () => {
    const { z } = fakeZ({})
    const rows = await app.triggers.new_paid_order.operation.perform(
      z,
      bundleWith({ siteId: 's1' }, { cleanedRequest: { id: 'evt', type: 'order.refunded', data: { order: ORDER } } }),
    )
    expect(rows).toEqual([])
  })

  it('read the sample from the API in the shape the hook sends', async () => {
    const { z, calls } = fakeZ({
      'GET /api/v1/sites/s1/orders': () => ({ data: { object: 'list', data: [ORDER], has_more: false, next_cursor: null } }),
      'GET /api/v1/sites/s1/bookings': () => ({
        data: { object: 'list', data: [{ id: 'b1', object: 'booking', status: 'canceled', currency: 'usd', paidCents: 5000, refundedCents: 5000 }] },
      }),
    })
    const orders = await app.triggers.new_paid_order.operation.performList(z, bundleWith({ siteId: 's1' }))
    expect(calls[0].params).toEqual({ limit: 3, status: 'paid' })
    expect(orders[0]).toMatchObject({ id: 'o1', totalAmount: '22.90', event: 'order.paid' })
    const bookings = await app.triggers.updated_booking.operation.performList(z, bundleWith({ siteId: 's1' }))
    expect(bookings[0]).toMatchObject({ id: 'b1', paidAmount: '50.00', refundedAmount: '50.00', event: 'booking.canceled' })
  })

  it('read a new contact back whole, and fall back to what arrived for one since deleted', async () => {
    const posted = {
      id: 'evt_c',
      type: 'contact.created',
      data: { contact: { id: 'c1', email: 'a@example.com', name: 'Avery', source: 'form' } },
    }
    const live = fakeZ({ 'GET /api/v1/contacts/c1': () => ({ data: { id: 'c1', object: 'contact', email: 'a@example.com', tags: ['vip'] } }) })
    const [row] = await app.triggers.new_contact.operation.perform(live.z, bundleWith({ siteId: 's1' }, { cleanedRequest: posted }))
    expect(row).toMatchObject({ id: 'c1', object: 'contact', tags: ['vip'], event: 'contact.created', eventId: 'evt_c' })

    const deleted = fakeZ({})
    const [thin] = await app.triggers.new_contact.operation.perform(deleted.z, bundleWith({ siteId: 's1' }, { cleanedRequest: posted }))
    expect(thin).toMatchObject({ id: 'c1', object: 'contact', name: 'Avery', event: 'contact.created' })

    const revoked = fakeZ({ 'GET /api/v1/contacts/c1': () => ({ status: 401, data: { error: { message: 'Invalid or missing API key' } } }) })
    await expect(
      app.triggers.new_contact.operation.perform(revoked.z, bundleWith({ siteId: 's1' }, { cleanedRequest: posted })),
    ).rejects.toBeInstanceOf(ExpiredAuthError)
  })

  it('keep a form trigger to the form chosen, live and in the sample', async () => {
    const posted = (formId) => ({
      id: 'evt_f',
      type: 'form.submitted',
      data: { submission: { id: 'sub_1', object: 'form_submission', form_id: formId, form: 'Contact', fields: { email: 'a@example.com' } } },
    })
    const { z, calls } = fakeZ({ 'GET /api/v1/sites/s1/form-submissions': () => ({ data: { object: 'list', data: [] } }) })
    const operation = app.triggers.new_form_submission.operation
    expect(await operation.perform(z, bundleWith({ siteId: 's1', formId: 'frm_1' }, { cleanedRequest: posted('frm_2') }))).toEqual([])
    const [row] = await operation.perform(z, bundleWith({ siteId: 's1', formId: 'frm_1' }, { cleanedRequest: posted('frm_1') }))
    expect(row).toMatchObject({ id: 'sub_1', form_id: 'frm_1', fields: { email: 'a@example.com' }, event: 'form.submitted' })
    await operation.performList(z, bundleWith({ siteId: 's1', formId: 'frm_1' }))
    expect(calls[0].params).toEqual({ limit: 3, formId: 'frm_1' })
  })

  it('page the site dropdown with the list’s own cursor', async () => {
    const { z, calls } = fakeZ({
      'GET /api/v1/sites': (call) =>
        call.params.cursor
          ? { data: { object: 'list', data: [{ id: 's2', subdomain: 'two' }], next_cursor: null } }
          : { data: { object: 'list', data: [{ id: 's1', displayName: 'Bakery' }], next_cursor: 'c2' } },
    })
    const first = await app.triggers.site.operation.perform(z, bundleWith({}, { meta: { page: 0 } }))
    const second = await app.triggers.site.operation.perform(z, bundleWith({}, { meta: { page: 1 } }))
    expect(first).toEqual([expect.objectContaining({ id: 's1', name: 'Bakery' })])
    expect(second).toEqual([expect.objectContaining({ id: 's2', name: 'two' })])
    expect(calls[1].params).toEqual({ limit: 100, cursor: 'c2' })
  })
})

describe('actions and searches (AGL-3643)', () => {
  it('create a contact with only what was filled in, a profile field carrying its site', async () => {
    const { z, calls } = fakeZ({ 'POST /api/v1/contacts': (call) => ({ status: 201, data: { id: 'c1', object: 'contact', ...call.body } }) })
    await app.creates.create_contact.operation.perform(
      z,
      bundleWith({ email: ' a@example.com ', name: 'Avery', tags: ['vip', ''], phone: '+15125550123', siteId: 's1', marketingConsent: 'true' }),
    )
    expect(calls[0].body).toEqual({
      email: 'a@example.com',
      name: 'Avery',
      tags: ['vip'],
      phone: '+15125550123',
      marketingConsent: true,
      consentSiteId: 's1',
    })
    await app.creates.create_contact.operation.perform(z, bundleWith({ email: 'b@example.com' }))
    expect(calls[1].body).toEqual({ email: 'b@example.com' })
  })

  it('refuse a profile field with no site before calling Aglyn, and pass on a duplicate', async () => {
    const { z, calls } = fakeZ({
      'POST /api/v1/contacts': () => ({
        status: 409,
        data: { error: { type: 'conflict', code: 'contact_exists', message: 'A contact with this email already exists (k7). Update it instead.' } },
      }),
    })
    await expect(app.creates.create_contact.operation.perform(z, bundleWith({ email: 'a@example.com', lifecycleStage: 'lead' }))).rejects.toThrow(/Choose a site/)
    expect(calls).toHaveLength(0)
    await expect(app.creates.create_contact.operation.perform(z, bundleWith({ email: 'a@example.com' }))).rejects.toMatchObject({
      code: 'contact_exists',
      status: 409,
    })
  })

  it('update a contact with only the fields given, and refuse an empty update', async () => {
    const { z, calls } = fakeZ({ 'PATCH /api/v1/contacts/c1': (call) => ({ data: { id: 'c1', ...call.body } }) })
    await app.creates.update_contact.operation.perform(z, bundleWith({ contactId: 'c1', notes: 'Called back', lifecycleStage: 'customer', siteId: 's1' }))
    expect(calls[0].body).toEqual({ notes: 'Called back', lifecycleStage: 'customer', consentSiteId: 's1' })
    await expect(app.creates.update_contact.operation.perform(z, bundleWith({ contactId: 'c1' }))).rejects.toThrow(/at least one field/)
    expect(calls).toHaveLength(1)
  })

  it('mark an order shipped with its tracking, telling the buyer unless asked not to', async () => {
    const { z, calls } = fakeZ({ 'PATCH /api/v1/sites/s1/orders/o1': (call) => ({ data: { ...ORDER, status: call.body.status } }) })
    const order = await app.creates.fulfill_order.operation.perform(
      z,
      bundleWith({ siteId: 's1', orderId: 'o1', status: 'fulfilled', carrier: 'UPS', trackingNumber: ' 1Z9 ', trackingUrl: '', notify: 'false' }),
    )
    expect(calls[0].body).toEqual({ status: 'fulfilled', carrier: 'UPS', trackingNumber: '1Z9', notify: false })
    expect(order).toMatchObject({ id: 'o1', status: 'fulfilled', totalAmount: '22.90' })
    await app.creates.fulfill_order.operation.perform(z, bundleWith({ siteId: 's1', orderId: 'o1', status: 'delivered' }))
    expect(calls[1].body).toEqual({ status: 'delivered' })
  })

  it('find a contact by email and an order by id, and find nothing as nothing', async () => {
    const { z, calls } = fakeZ({
      'GET /api/v1/contacts': (call) => ({ data: { object: 'list', data: call.params.email === 'a@example.com' ? [{ id: 'c1' }] : [] } }),
      'GET /api/v1/sites/s1/orders/o1': () => ({ data: ORDER }),
    })
    expect(await app.searches.find_contact.operation.perform(z, bundleWith({ email: 'a@example.com' }))).toEqual([{ id: 'c1' }])
    expect(calls[0].params).toEqual({ email: 'a@example.com' })
    expect(await app.searches.find_contact.operation.perform(z, bundleWith({ email: 'z@example.com' }))).toEqual([])
    expect(await app.searches.find_order.operation.perform(z, bundleWith({ siteId: 's1', orderId: 'o1' }))).toEqual([
      expect.objectContaining({ id: 'o1', totalAmount: '22.90' }),
    ])
    expect(await app.searches.find_order.operation.perform(z, bundleWith({ siteId: 's1', orderId: 'nope' }))).toEqual([])
  })
})
