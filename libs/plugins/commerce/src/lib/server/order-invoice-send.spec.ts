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
 *
 * @jest-environment node
 */

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { invoiceMailer, type InvoiceMailerDeps } from './invoice-email'
import { handleOrderInvoiceSend, type OrderInvoiceSendDeps } from './order-invoice-send'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {}, getOrgForHost: jest.fn() }))

/**
 * `POST /api/commerce/order-invoice-send` (AGL-4099), through the real handler
 * and the real invoice mailer over an in-memory Firestore and a recorded
 * send: who may send, every refusal, what goes out, and what is recorded.
 */

const docs = new Map<string, Record<string, any>>()

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    get: (field: string) => field.split('.').reduce<any>((value, key) => value?.[key], data),
  }
}

/** A merge as Firestore's: nested maps merge key by key, everything else is replaced. */
function merge(into: Record<string, any>, value: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...into }
  for (const [key, next] of Object.entries(value)) {
    const plain = next && typeof next === 'object' && !Array.isArray(next)
    out[key] = plain && into[key] && typeof into[key] === 'object' && !Array.isArray(into[key]) ? merge(into[key], next) : next
  }
  return out
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const plain = JSON.parse(JSON.stringify(value))
      docs.set(path, options?.merge ? merge(docs.get(path) ?? {}, plain) : plain)
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return { doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async <T,>(fn: (transaction: any) => Promise<T>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => void ref.set(value, options),
    }),
}

const ORG = { id: 'org-1', plan: 'business', billingStatus: 'active', ownerUid: 'owner-1', slug: 'acme' }

const sent: Array<Parameters<InvoiceMailerDeps['send']>[0]> = []
const pdfs: Array<Parameters<InvoiceMailerDeps['invoicePdf']>[0]> = []
let sendAnswer: Awaited<ReturnType<InvoiceMailerDeps['send']>> = { sent: true, id: 'provider-1' }
let suppressionAnswer: Awaited<ReturnType<InvoiceMailerDeps['suppression']>> = null
let mailConfigured = true
let tokenError: unknown = null
let nowMs = 50_000

const mailerDeps: InvoiceMailerDeps = {
  configured: () => mailConfigured,
  sendingIdentity: async () =>
    ({ from: 'Acme Signs <hello@mail.acme.test>', source: 'site', domain: 'mail.acme.test', summary: '', refusal: null }) as never,
  render: async (_hostId, key, tokens) => ({ subject: tokens['invoice.subject'], html: `<p>${key}: ${tokens['invoice.heading']}</p>`, text: tokens['invoice.heading'] }),
  invoicePdf: async (input) => {
    pdfs.push(input)
    return { bytes: new Uint8Array([37, 80, 68, 70]), filename: `acme-invoice-${String(input.order.number)}.pdf` }
  },
  send: async (options) => {
    sent.push(options)
    return sendAnswer
  },
  meter: async () => undefined,
  suppression: async () => suppressionAnswer,
}

const deps: OrderInvoiceSendDeps = {
  verifyIdToken: async (token) => {
    if (tokenError) throw tokenError
    return { uid: token, email: `${token}@example.com` }
  },
  firestore: () => firestore,
  orgForHost: async () => ({ id: 'org-1', org: ORG }),
  payLinkUrl: (host, hostId, orderId, version) =>
    host['subdomain'] ? `https://${String(host['subdomain'])}.aglyn.app/pay-quote?q=${orderId}&t=${version}.sig-${hostId}` : null,
  mailer: async () => invoiceMailer(mailerDeps),
  now: () => nowMs,
}

function request(uid: string, body: Record<string, unknown>, key = 'attempt-1'): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body: { hostId: 'site1', ...body },
    headers: { authorization: `Bearer ${uid}`, ...(key ? { 'idempotency-key': key } : {}) },
    cookies: {},
    socket: {},
  }
}

const send = (uid: string, body: Record<string, unknown> = {}, key?: string) =>
  handleOrderInvoiceSend(deps, request(uid, { orderId: 'd-1', message: 'Thanks for the order.', ...body }, key))

const DRAFT = {
  number: 2001,
  status: 'pending',
  channel: 'draft',
  lineItems: [{ productId: 'banner', name: 'Banner', productType: 'service', quantity: 1, unitAmountCents: 50_000 }],
  totals: { itemsCents: 50_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 50_000 },
  taxMode: 'none',
  customerEmail: 'jordan@example.com',
  createdAtMs: 1_000,
  timeline: [{ atMs: 1_000, event: 'draft' }],
  draftShipping: { countries: [], options: [] },
}

const QUOTE_THREAD = { messageId: '<quote.1@mail.acme.test>', references: ['<quote.1@mail.acme.test>'], subject: 'Quote #1042 from Acme Signs' }

const QUOTE = {
  number: 1042,
  status: 'paid',
  channel: 'quote',
  lineItems: [{ productId: '', name: 'Install', productType: 'service', quantity: 1, unitAmountCents: 30_000 }],
  totals: { itemsCents: 30_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 30_000 },
  customerEmail: 'pat@example.com',
  createdAtMs: 8_000,
  timeline: [{ atMs: 8_000, event: 'paid' }],
  quote: {
    stage: 'sent',
    revision: 1,
    customer: { name: 'Pat Lee', email: 'pat@example.com' },
    tax: { kind: 'none', reason: 'not-collected' },
    emailThread: QUOTE_THREAD,
    sends: [{ revision: 1, to: 'pat@example.com', subject: 'Quote #1042 from Acme Signs', atMs: 2_000, by: 'editor@example.com', messageId: '<quote.1@mail.acme.test>', providerId: 'p0', linkVersion: 1 }],
    paidAtMs: 8_000,
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
    createdBy: 'a',
    updatedBy: 'a',
  },
}

const stored = (id = 'd-1') => docs.get(`hosts/site1/orders/${id}`) as Record<string, any>

beforeEach(() => {
  docs.clear()
  sent.length = 0
  pdfs.length = 0
  sendAnswer = { sent: true, id: 'provider-1' }
  suppressionAnswer = null
  mailConfigured = true
  tokenError = null
  nowMs = 50_000
  docs.set('hosts/site1', {
    subdomain: 'acme',
    displayName: 'Acme Signs',
    business: { supportEmail: 'help@acme.test' },
    memberRoles: { admin: 'admin', editor: 'editor', author: 'author', viewer: 'viewer', sender: 'author', denied: 'editor' },
    memberPermissions: { sender: { 'commerce.quotes.send': true }, denied: { 'commerce.quotes.send': false } },
  })
  docs.set('hosts/site1/settings/store', { currency: 'USD' })
  docs.set('hosts/site1/orders/d-1', JSON.parse(JSON.stringify(DRAFT)))
  docs.set('hosts/site1/orders/q-1', JSON.parse(JSON.stringify(QUOTE)))
})

describe('who may send an invoice', () => {
  it.each([
    ['admin', 200],
    ['editor', 200],
    ['sender', 200],
    ['author', 403],
    ['viewer', 403],
    ['denied', 403],
    ['stranger', 403],
  ])('%s → %i, by "Send quotes and invoices to customers" alone', async (uid, status) => {
    const outcome = await send(uid)
    expect(outcome.status).toBe(status)
    if (status === 403) {
      expect(outcome.body['error']).toContain('Send quotes and invoices to customers')
      expect(sent).toHaveLength(0)
    }
  })

  it('answers 401 for a refused token, and lets any other failure through', async () => {
    tokenError = Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
    expect((await send('admin')).status).toBe(401)
    tokenError = new Error('the auth service is down')
    await expect(send('admin')).rejects.toThrow('the auth service is down')
    expect((await handleOrderInvoiceSend(deps, { ...request('admin', { orderId: 'd-1' }), headers: {} })).status).toBe(401)
  })
})

describe('sending an unpaid draft order’s invoice', () => {
  it('emails it with the lasting pay link, attaches the PDF, and records the send', async () => {
    const outcome = await send('editor')
    expect(outcome).toEqual({ status: 200, body: { sent: true, to: 'jordan@example.com', atMs: 50_000, paid: false, linkVersion: 1 } })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'jordan@example.com',
      subject: 'Invoice #2001 from Acme Signs',
      replyTo: 'help@acme.test',
      html: '<p>order-invoice: Invoice #2001 from Acme Signs</p>',
      attachments: [{ filename: 'acme-invoice-2001.pdf', contentType: 'application/pdf' }],
    })
    expect(pdfs[0].payUrl).toBe('https://acme.aglyn.app/pay-quote?q=d-1&t=1.sig-site1')
    const order = stored()
    expect(order['invoiceSends']).toEqual([
      expect.objectContaining({ to: 'jordan@example.com', by: 'editor@example.com', paid: false, linkVersion: 1, totalCents: 50_000, providerId: 'provider-1' }),
    ])
    // The order's own conversation, started by this invoice under its root.
    const messageId = String(sent[0].headers?.['Message-ID'])
    expect(sent[0].headers?.['References']).toBe(`<thread.${messageId.slice(1)}`)
    expect(order['emailThread']).toEqual({
      messageId,
      references: [`<thread.${messageId.slice(1)}`, messageId],
      subject: 'Invoice #2001 from Acme Signs',
    })
    expect(order['timeline'].at(-1)).toEqual({ atMs: 50_000, event: 'invoice-sent', detail: 'Invoice emailed to the customer by editor@example.com' })
    // Nothing else of the draft moved.
    expect(order['status']).toBe('pending')
    expect(order['createdAtMs']).toBe(1_000)
  })

  it('continues the order’s conversation with the next invoice', async () => {
    await send('editor')
    nowMs = 60_000
    await send('editor', {}, 'attempt-2')
    expect(sent[1].headers).toMatchObject({ 'In-Reply-To': sent[0].headers?.['Message-ID'] })
    expect(stored()['invoiceSends']).toHaveLength(2)
  })

  it('answers a retried press from the first, so the customer gets one email', async () => {
    const first = await send('editor')
    const again = await send('editor')
    expect(again).toEqual(first)
    expect(sent).toHaveLength(1)
  })

  it('needs an attempt key', async () => {
    expect((await send('editor', {}, '')).status).toBe(400)
  })
})

describe('sending a quote’s invoice', () => {
  it('replies into the quote’s conversation, as the record of a paid quote, with no link', async () => {
    const outcome = await send('editor', { orderId: 'q-1', message: '' })
    expect(outcome.body).toMatchObject({ sent: true, paid: true, linkVersion: null, to: 'pat@example.com' })
    expect(sent[0].headers).toMatchObject({ 'In-Reply-To': '<quote.1@mail.acme.test>', References: '<quote.1@mail.acme.test>' })
    expect(sent[0].subject).toBe('Quote #1042 from Acme Signs')
    expect(pdfs[0].payUrl).toBeNull()
    const quote = stored('q-1')
    expect(quote['quote']['emailThread']['references']).toEqual(['<quote.1@mail.acme.test>', sent[0].headers?.['Message-ID']])
    expect(quote['quote']['sends']).toHaveLength(1)
    expect(quote['emailThread']).toBeUndefined()
    expect(quote['invoiceSends']).toEqual([expect.objectContaining({ paid: true, linkVersion: null })])
  })

  it('carries an unpaid quote’s own link, at the quote’s version', async () => {
    docs.set('hosts/site1/orders/q-1', { ...JSON.parse(JSON.stringify(QUOTE)), status: 'pending', quote: { ...QUOTE.quote, linkVersion: 3, paidAtMs: undefined } })
    const outcome = await send('editor', { orderId: 'q-1' })
    expect(outcome.body).toMatchObject({ paid: false, linkVersion: 3 })
    expect(pdfs[0].payUrl).toBe('https://acme.aglyn.app/pay-quote?q=q-1&t=3.sig-site1')
  })
})

describe('refusals, in plain words', () => {
  const refusal = async (body: Record<string, unknown> = {}) => {
    const outcome = await send('editor', body)
    expect(sent).toHaveLength(0)
    return { status: outcome.status, error: String(outcome.body['error'] ?? '') }
  }

  it('no customer email, or a bad one', async () => {
    docs.set('hosts/site1/orders/d-1', { ...DRAFT, customerEmail: null })
    expect(await refusal()).toEqual({ status: 400, error: 'This order has no email for the customer. Type where to send the invoice.' })
    expect(await refusal({ to: 'nope' })).toEqual({ status: 400, error: 'Enter a valid email address to send the invoice to.' })
  })

  it('an address that bounced or complained', async () => {
    suppressionAnswer = 'suppressed-platform'
    expect(await refusal()).toEqual({
      status: 409,
      error: 'jordan@example.com bounced or reported an email as spam, so it can’t be emailed. Send the invoice another way.',
    })
  })

  it('a canceled or refunded order', async () => {
    docs.set('hosts/site1/orders/d-1', { ...DRAFT, status: 'cancelled' })
    expect((await refusal()).error).toBe('This order was canceled or refunded, so it has no invoice to send.')
    docs.set('hosts/site1/orders/d-1', { ...DRAFT, status: 'refunded' })
    expect((await refusal()).status).toBe(409)
  })

  it('a paid order with nothing on it', async () => {
    docs.set('hosts/site1/orders/d-1', { ...DRAFT, status: 'paid', lineItems: [], totals: { ...DRAFT.totals, itemsCents: 0, totalCents: 0 } })
    expect(await refusal()).toEqual({ status: 409, error: 'This order has no items and no total, so there is nothing to put on an invoice.' })
  })

  it('an unpaid order its link cannot take payment for', async () => {
    docs.set('hosts/site1/orders/d-1', { ...DRAFT, channel: 'pos' })
    expect((await refusal()).error).toContain('can’t be paid online from an invoice')
    docs.set('hosts/site1/orders/d-1', { ...DRAFT, lineItems: [{ ...DRAFT.lineItems[0], productType: 'physical' }], draftShipping: undefined })
    expect((await refusal()).error).toContain('made before invoices could charge its shipping')
  })

  it('an unknown order, a site with no address, and email not set up', async () => {
    expect((await refusal({ orderId: 'missing' })).status).toBe(404)
    mailConfigured = false
    expect((await refusal()).status).toBe(503)
    mailConfigured = true
    docs.set('hosts/site1', { ...docs.get('hosts/site1'), subdomain: undefined })
    expect(await refusal()).toEqual({ status: 409, error: 'This site has no web address yet, so its invoices have no pay link. Publish the site first.' })
  })

  it('a send the provider refused, which records nothing and frees the attempt', async () => {
    sendAnswer = { sent: false, reason: 'undeliverable' } as never
    const outcome = await send('editor')
    expect(outcome).toEqual({ status: 409, body: { error: 'This address can’t receive email, so the invoice wasn’t sent.' } })
    expect(stored()['invoiceSends']).toBeUndefined()
    sendAnswer = { sent: true, id: 'provider-2' }
    expect((await send('editor')).status).toBe(200)
  })
})
