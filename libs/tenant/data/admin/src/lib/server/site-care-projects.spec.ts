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
 * SITE CARE PROJECTS, END TO END ON DOUBLES (AGL-3970).
 *
 * The money path is the subject: nothing invoices without the owner's
 * recorded yes to the quote as it stands; a `creating` invoice and its
 * `invoice.requested` row commit BEFORE any Stripe call, which goes out as a
 * one-off `send_invoice` invoice with the line priced against the checked
 * Site Care product, under keys derived from the record's own; a retry
 * adopts what an earlier attempt made; the balance of a half-and-half
 * project is raised from the same record at launch; a payment is recorded
 * once however often it is delivered; void, credit and refund leave their
 * intent row first and email the owner. Firestore is an in-memory double and
 * Stripe a recorded fetch; nothing leaves the process.
 */

import {
  SITE_CARE_PROJECT_ACCEPTANCE_EMAIL_KEY,
  SITE_CARE_PROJECT_INVOICE_EMAIL_KEY,
  SITE_CARE_PROJECT_PAID_EMAIL_KEY,
  SITE_CARE_PROJECT_REVERSED_EMAIL_KEY,
} from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import { compareSiteCareProjects, reconcileSiteCareProjects } from './site-care-project-reconcile'
import {
  checkSiteCareProjectPayments,
  createSiteCareProject,
  editSiteCareProject,
  launchSiteCareProject,
  readSiteCareProjects,
  recordSiteCareProjectAcceptance,
  recordSiteCareProjectPayment,
  resendSiteCareProjectInvoice,
  retrySiteCareProjectInvoice,
  reverseSiteCareProjectInvoice,
  sendSiteCareProjectInvoice,
} from './site-care-projects'
import { SiteCareError, type SiteCareDeps } from './site-care-requests'

jest.mock('./org-billing', () => ({
  __esModule: true,
  readOrgBilling: async () => ({ plan: 'starter', stripeCustomerId: 'cus_1', subscription: { status: 'active' } }),
}))

jest.mock('./notifications', () => ({ __esModule: true, notifyStaff: async () => undefined }))

jest.mock('./site-care-emails', () => ({
  __esModule: true,
  sendSiteCareEmail: async () => ({ sent: false, to: null, subject: '', reason: 'unconfigured' }),
}))

// ── An in-memory Firestore, as much of it as the module uses ────────────────

type Data = Record<string, unknown>

let autoId = 0
const nextId = () => `auto${String(++autoId).padStart(16, '0')}`

/** A deep copy of plain data that keeps class instances (a Timestamp) whole. */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
  }
  return value
}

function setPath(target: Data, dotted: string, value: unknown) {
  const keys = dotted.split('.')
  let node = target
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key] as Data
  }
  node[keys[keys.length - 1]] = value
}

function getPath(source: Data | undefined, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((node, key) => (node as Data | undefined)?.[key], source)
}

class FakeStore {
  docs = new Map<string, Data>()

  collection(path: string) {
    return new FakeCollection(this, path)
  }

  doc(path: string) {
    return new FakeDocRef(this, path)
  }

  batch() {
    return new FakeBatch(this)
  }

  /** Every document directly under a collection of this name, anywhere. */
  collectionGroup(name: string) {
    return {
      limit: () => ({
        get: async () => {
          const docs = [...this.docs.entries()]
            .filter(([key]) => {
              const parts = key.split('/')
              return parts.length % 2 === 0 && parts[parts.length - 2] === name
            })
            .map(([key, data]) => new FakeSnapshot(new FakeDocRef(this, key), data))
          return { docs, empty: docs.length === 0, size: docs.length }
        },
      }),
    }
  }

  async runTransaction<T>(fn: (tx: FakeBatch) => Promise<T>): Promise<T> {
    const tx = new FakeBatch(this)
    const result = await fn(tx)
    await tx.commit()
    return result
  }

  /** Rows under a collection path, in insertion order. */
  rows(path: string): Array<{ id: string; data: Data }> {
    return [...this.docs.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map(([key, data]) => ({ id: key.slice(path.length + 1), data }))
  }
}

class FakeSnapshot {
  constructor(
    readonly ref: FakeDocRef,
    private readonly value: Data | undefined,
  ) {}
  get id() {
    return this.ref.id
  }
  get exists() {
    return this.value !== undefined
  }
  data() {
    return this.value ? clone(this.value) : undefined
  }
  get(field: string) {
    return getPath(this.value, field)
  }
}

class FakeDocRef {
  constructor(
    readonly store: FakeStore,
    readonly path: string,
  ) {}
  get id() {
    return this.path.split('/').pop() as string
  }
  collection(name: string) {
    return new FakeCollection(this.store, `${this.path}/${name}`)
  }
  async get() {
    return new FakeSnapshot(this, this.store.docs.get(this.path))
  }
}

type Filter = { field: string; op: string; value: unknown }

class FakeQuery {
  constructor(
    readonly store: FakeStore,
    readonly path: string,
    readonly filters: Filter[] = [],
  ) {}
  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this.store, this.path, [...this.filters, { field, op, value }])
  }
  orderBy() {
    return this
  }
  limit() {
    return this
  }
  async get() {
    const docs = this.store
      .rows(this.path)
      .filter(({ data }) =>
        this.filters.every((f) => {
          const value = getPath(data, f.field)
          if (f.op === '==') return value === f.value
          if (f.op === 'in') return (f.value as unknown[]).includes(value)
          return true
        }),
      )
      .map(({ id, data }) => new FakeSnapshot(new FakeDocRef(this.store, `${this.path}/${id}`), data))
    return { docs, empty: docs.length === 0, size: docs.length }
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string) {
    return new FakeDocRef(this.store, `${this.path}/${id ?? nextId()}`)
  }
}

class FakeBatch {
  private ops: Array<() => void> = []
  constructor(private readonly store: FakeStore) {}
  async get(target: FakeDocRef | FakeQuery) {
    return target.get()
  }
  create(ref: FakeDocRef, data: Data) {
    this.ops.push(() => {
      if (this.store.docs.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`)
      this.store.docs.set(ref.path, clone(data))
    })
    return this
  }
  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }) {
    this.ops.push(() => {
      const base = options?.merge ? (this.store.docs.get(ref.path) ?? {}) : {}
      this.store.docs.set(ref.path, { ...base, ...clone(data) })
    })
    return this
  }
  update(ref: FakeDocRef, patch: Data) {
    this.ops.push(() => {
      const current = this.store.docs.get(ref.path)
      if (!current) throw new Error(`NOT_FOUND ${ref.path}`)
      const next = clone(current)
      for (const [key, value] of Object.entries(patch)) setPath(next, key, clone(value))
      this.store.docs.set(ref.path, next)
    })
    return this
  }
  async commit() {
    for (const op of this.ops) op()
    this.ops = []
  }
}

// FieldValue sentinels are opaque class instances; the double stores a marker.
jest.spyOn(FieldValue, 'serverTimestamp').mockImplementation(() => '__now__' as never)

// ── A recorded Stripe ───────────────────────────────────────────────────────

interface StripeCall {
  method: string
  path: string
  key: string | null
  params: Record<string, string>
}

type Route = (call: StripeCall) => { status?: number; body: unknown }

function stripeStub(routes: Record<string, Route>) {
  const calls: StripeCall[] = []
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const request = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string }
    const parsed = new URL(String(url))
    const call: StripeCall = {
      method: request.method ?? 'GET',
      path: parsed.pathname.replace(/^\/v1\//, ''),
      key: request.headers?.['Idempotency-Key'] ?? null,
      params: Object.fromEntries(new URLSearchParams(request.body ?? '')),
    }
    calls.push(call)
    const route = routes[`${call.method} ${call.path}`]
    if (!route) throw new Error(`Unexpected Stripe call: ${call.method} ${call.path}`)
    const answer = route(call)
    const status = answer.status ?? 200
    return { ok: status < 300, status, json: async () => answer.body }
  }) as unknown as typeof fetch
  return { calls, stripe: { secretKey: 'sk_test_stub', fetchImpl } }
}

const PRODUCT: Route = () => ({ body: { product: { id: 'prod_care', tax_code: 'txcd_10103001' } } })

function finalized(id: string, totalCents: number, subtotalCents: number) {
  return {
    id,
    status: 'open',
    number: `N-${id}`,
    hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
    total: totalCents,
    subtotal: subtotalCents,
    amount_paid: 0,
  }
}

/** A Stripe that makes invoice `in_<n>` for the n-th invoice it is asked for. */
function invoicingStripe(extra: Record<string, Route> = {}) {
  let made = 0
  const subtotals = new Map<string, number>()
  return stripeStub({
    'GET prices/price_care': PRODUCT,
    'GET invoices': () => ({ body: { data: [] } }),
    'POST invoices': () => ({ body: { id: `in_${++made}`, status: 'draft' } }),
    'POST invoiceitems': (call) => {
      subtotals.set(call.params['invoice'], Number(call.params['price_data[unit_amount]']))
      return { body: { id: `ii_${call.params['invoice']}` } }
    },
    'POST invoices/in_1/finalize': () => ({ body: finalized('in_1', Math.round((subtotals.get('in_1') ?? 0) * 1.0825), subtotals.get('in_1') ?? 0) }),
    'POST invoices/in_2/finalize': () => ({ body: finalized('in_2', Math.round((subtotals.get('in_2') ?? 0) * 1.0825), subtotals.get('in_2') ?? 0) }),
    ...extra,
  })
}

const STAFF = { uid: 'staff-1', email: 'staff@aglyn.com' }
/** Monday 2026-10-19, 10:00 in Chicago. */
const T0 = Date.UTC(2026, 9, 19, 15, 0)

let store: FakeStore
let clock: number
let emails: Array<{ key: string; to: string | null; merge: Record<string, string> }>

function deps(stripe?: SiteCareDeps['stripe']): SiteCareDeps {
  return {
    now: () => clock,
    stripe,
    email: async (input) => {
      emails.push({ key: input.key, to: input.to, merge: input.merge })
      return { sent: true, to: input.to, subject: input.fallback.subject }
    },
  }
}

const db = () => store as unknown as FirebaseFirestore.Firestore

function stored(projectId: string) {
  return store.docs.get(`orgs/org-1/siteCareProjects/${projectId}`) as Data & {
    status: string
    invoices: Array<Data & { status: string; seq: number }>
  }
}

function kinds(projectId: string) {
  return store.rows(`orgs/org-1/siteCareProjects/${projectId}/siteCareHistory`).map((row) => row.data['kind'])
}

function audits() {
  return store.rows('adminAudit').map((row) => row.data['action'])
}

async function quote(input: Partial<{ kind: string; estimatedHours: number; priceUsd: number; title: string }> = {}) {
  const created = await createSiteCareProject(
    db(),
    {
      orgId: 'org-1',
      actor: STAFF,
      title: input.title ?? 'Holiday sale page',
      scope: '- A landing page for the sale\n- A sign-up form',
      kind: input.kind ?? 'landingPage',
      estimatedHours: input.estimatedHours ?? 2,
      priceUsd: input.priceUsd,
    },
    deps(),
  )
  return created.projectId
}

async function accept(projectId: string, extra: Record<string, unknown> = {}, stripe?: SiteCareDeps['stripe']) {
  return recordSiteCareProjectAcceptance(
    db(),
    {
      orgId: 'org-1',
      projectId,
      actor: STAFF,
      acceptance: { channel: 'in-person', approvedAtMs: clock - 60_000, ...extra },
    },
    deps(stripe),
  )
}

beforeEach(() => {
  store = new FakeStore()
  store.docs.set('orgs/org-1', { name: 'Ready to Roll', ownerUid: 'owner-1' })
  store.docs.set('orgs/org-1/members/owner-1', { email: 'owner@example.com' })
  clock = T0
  emails = []
  autoId = 0
  process.env['STRIPE_PRICE_SITE_CARE'] = 'price_care'
})

describe('the quote', () => {
  it('records the quote at its computed price, never below the starting price', async () => {
    const id = await quote({ estimatedHours: 1.5 })
    const doc = stored(id)
    expect(doc['status']).toBe('quoted')
    expect(doc['quote']).toEqual(
      expect.objectContaining({ kind: 'landingPage', billedHours: 2, computedUsd: 249, priceUsd: 249, split: 'full' }),
    )
    expect(doc['scope']).toEqual(['A landing page for the sale', 'A sign-up form'])
    expect(kinds(id)).toEqual(['project.quoted'])
    expect(audits()).toEqual(['siteCareProject.quoted'])
  })

  it('refuses a price under the computed one', async () => {
    await expect(quote({ estimatedHours: 2, priceUsd: 100 })).rejects.toThrow(/only be rounded up/)
  })

  it('edits with a reason until the first invoice is sent, and the yes must be given again', async () => {
    const id = await quote()
    await accept(id)
    await expect(
      editSiteCareProject(db(), { orgId: 'org-1', projectId: id, actor: STAFF, reason: '', title: 'x', scope: 'y', kind: 'other', estimatedHours: 1 }, deps()),
    ).rejects.toThrow(/reason/)
    await editSiteCareProject(
      db(),
      { orgId: 'org-1', projectId: id, actor: STAFF, reason: 'Added a gallery', title: 'Holiday sale page', scope: 'Page\nGallery', kind: 'landingPage', estimatedHours: 4, priceUsd: 320 },
      deps(),
    )
    const doc = stored(id)
    expect(doc['quoteVersion']).toBe(2)
    expect(doc['status']).toBe('quoted')
    expect(kinds(id)).toContain('quote.corrected')
    const { stripe } = invoicingStripe()
    await expect(sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))).rejects.toThrow(
      /quote changed after the owner said yes/,
    )
    // A yes to the new quote: a new version, no reason needed.
    const again = await accept(id)
    expect(again).toEqual(expect.objectContaining({ version: 2, quoteVersion: 2, priceUsd: 320, corrected: false }))
    await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))
    await expect(
      editSiteCareProject(
        db(),
        { orgId: 'org-1', projectId: id, actor: STAFF, reason: 'Cheaper', title: 'Holiday sale page', scope: 'Page', kind: 'landingPage', estimatedHours: 4, priceUsd: 400 },
        deps(),
      ),
    ).rejects.toThrow(/the quote is fixed/)
  })
})

describe('the owner’s yes', () => {
  it('is required before anything is invoiced, and nothing calls Stripe without it', async () => {
    const id = await quote()
    const { calls, stripe } = invoicingStripe()
    await expect(sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))).rejects.toBeInstanceOf(
      SiteCareError,
    )
    expect(calls).toEqual([])
  })

  it('records how and when, and emails the owner the scope and price', async () => {
    const id = await quote()
    const record = await accept(id)
    expect(record).toEqual(expect.objectContaining({ channel: 'in-person', hours: 2, quoteVersion: 1, priceUsd: 249, version: 1 }))
    expect(stored(id)['status']).toBe('accepted')
    expect(emails).toEqual([
      expect.objectContaining({
        key: SITE_CARE_PROJECT_ACCEPTANCE_EMAIL_KEY,
        to: 'owner@example.com',
        merge: expect.objectContaining({
          'acceptance.heading': 'You accepted our quote',
          'project.scope': '- A landing page for the sale\n- A sign-up form',
        }),
      }),
    ])
    expect(emails[0].merge['acceptance.sentence']).toMatch(/\$249, paid in full before work starts\. You said yes in person/)
    expect(kinds(id)).toEqual(['project.quoted', 'acceptance.recorded', 'email.sent'])
  })

  it('a correction needs a reason and re-sends the confirmation, marked corrected', async () => {
    const id = await quote()
    await accept(id)
    await expect(accept(id, { channel: 'phone' })).rejects.toThrow(/why/i)
    const corrected = await accept(id, { channel: 'phone', reason: 'It was a phone call' })
    expect(corrected).toEqual(expect.objectContaining({ version: 2, corrected: true, correctionReason: 'It was a phone call' }))
    expect(emails[1].merge['acceptance.heading']).toBe('Corrected: the quote you accepted')
    expect(emails[1].merge['acceptance.correction']).toMatch(/It was a phone call/)
    expect(kinds(id)).toContain('acceptance.corrected')
  })
})

describe('invoicing in full', () => {
  it('writes the intent row first, then one send_invoice invoice with a taxed line, finalized, and emails the pay link', async () => {
    const id = await quote()
    await accept(id)
    let rowsAtFirstCall: unknown[] | null = null
    const harness = invoicingStripe()
    const original = harness.stripe.fetchImpl
    const watched = (async (url: unknown, init: unknown) => {
      rowsAtFirstCall ??= kinds(id)
      return original(url as never, init as never)
    }) as unknown as typeof fetch
    const invoice = await sendSiteCareProjectInvoice(
      db(),
      { orgId: 'org-1', projectId: id, actor: STAFF },
      deps({ ...harness.stripe, fetchImpl: watched }),
    )
    expect(rowsAtFirstCall).toEqual(['project.quoted', 'acceptance.recorded', 'email.sent', 'invoice.requested'])
    expect(invoice).toEqual(
      expect.objectContaining({
        seq: 1,
        kind: 'full',
        status: 'open',
        invoiceId: 'in_1',
        invoiceItemId: 'ii_in_1',
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
        amountCents: 24900,
      }),
    )
    const created = harness.calls.find((call) => call.method === 'POST' && call.path === 'invoices')
    expect(created?.params).toEqual(
      expect.objectContaining({
        customer: 'cus_1',
        collection_method: 'send_invoice',
        days_until_due: '14',
        'automatic_tax[enabled]': 'true',
        pending_invoice_items_behavior: 'exclude',
        'metadata[siteCareProjectId]': id,
        'metadata[invoiceSeq]': '1',
      }),
    )
    expect(created?.params['description']).toMatch(/What this covers:\n- A landing page for the sale/)
    expect(created?.params['subscription']).toBeUndefined()
    const item = harness.calls.find((call) => call.path === 'invoiceitems')
    expect(item?.params).toEqual(
      expect.objectContaining({
        invoice: 'in_1',
        'price_data[product]': 'prod_care',
        'price_data[unit_amount]': '24900',
        'price_data[tax_behavior]': 'exclusive',
        description: 'Holiday sale page: the $249 quote, in full',
      }),
    )
    expect(harness.calls.filter((call) => call.method === 'POST').map((call) => call.key)).toEqual([
      `site-care-project:${id}:invoice:1:invoice`,
      `site-care-project:${id}:invoice:1:item`,
      `site-care-project:${id}:invoice:1:finalize`,
    ])
    expect(stored(id)['status']).toBe('invoiced')
    expect(stored(id)['firstInvoiceSentAtMs']).toBe(T0)
    const email = emails.find((row) => row.key === SITE_CARE_PROJECT_INVOICE_EMAIL_KEY)
    expect(email?.merge).toEqual(
      expect.objectContaining({ 'invoice.payUrl': 'https://invoice.stripe.com/i/in_1', 'invoice.heading': 'Your invoice', 'invoice.number': 'N-in_1' }),
    )
    expect(kinds(id).slice(-3)).toEqual(['invoice.requested', 'invoice.sent', 'email.sent'])
    expect(audits()).toEqual(
      expect.arrayContaining(['siteCareProject.invoice.requested', 'siteCareProject.invoice.sent']),
    )
  })

  it('refuses an invoice when the product does not carry the platform tax code', async () => {
    const id = await quote()
    await accept(id)
    const { calls, stripe } = invoicingStripe({
      'GET prices/price_care': () => ({ body: { product: { id: 'prod_care', tax_code: 'txcd_20030000' } } }),
    })
    const invoice = await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))
    expect(invoice.status).toBe('failed')
    expect(invoice.error).toMatch(/txcd_20030000/)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('a failed finalize is retried under the same keys, finishing the invoice it already made', async () => {
    const id = await quote()
    await accept(id)
    let fail = true
    const harness = invoicingStripe({
      'POST invoices/in_1/finalize': () =>
        fail ? { status: 500, body: { error: { message: 'Stripe is down' } } } : { body: finalized('in_1', 26954, 24900) },
      'GET invoices/in_1': () => ({ body: { id: 'in_1', status: 'draft' } }),
      'GET invoices/in_1/lines': () => ({ body: { data: [{ id: 'il_1', invoice_item: 'ii_in_1' }] } }),
    })
    const first = await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))
    expect(first).toEqual(expect.objectContaining({ status: 'failed', invoiceId: 'in_1', error: 'Stripe is down' }))
    expect(stored(id)['status']).toBe('invoiced')
    // Still editable? No: an invoice exists in Stripe for it.
    fail = false
    const retried = await retrySiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF }, deps(harness.stripe))
    expect(retried).toEqual(expect.objectContaining({ status: 'open', invoiceId: 'in_1', invoiceItemId: 'ii_in_1' }))
    expect(harness.calls.filter((call) => call.method === 'POST' && call.path === 'invoices')).toHaveLength(1)
    expect(harness.calls.filter((call) => call.path === 'invoiceitems')).toHaveLength(1)
    expect(kinds(id)).toEqual(expect.arrayContaining(['invoice.failed', 'invoice.sent']))
  })

  it('a lost answer is adopted by its metadata, never invoiced twice', async () => {
    const id = await quote()
    await accept(id)
    // The first attempt's create answered nothing the record kept.
    const harness = stripeStub({
      'GET prices/price_care': PRODUCT,
      'GET invoices': () => ({ body: { data: [] } }),
      'POST invoices': () => ({ status: 500, body: { error: { message: 'timeout' } } }),
    })
    const first = await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))
    expect(first.status).toBe('failed')
    const adopt = stripeStub({
      'GET prices/price_care': PRODUCT,
      'GET invoices': () => ({
        body: { data: [{ id: 'in_9', status: 'draft', metadata: { siteCareProjectId: id, invoiceSeq: '1' } }] },
      }),
      'GET invoices/in_9/lines': () => ({ body: { data: [] } }),
      'POST invoiceitems': () => ({ body: { id: 'ii_9' } }),
      'POST invoices/in_9/finalize': () => ({ body: finalized('in_9', 26954, 24900) }),
    })
    const retried = await retrySiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF }, deps(adopt.stripe))
    expect(retried).toEqual(expect.objectContaining({ status: 'open', invoiceId: 'in_9' }))
    expect(adopt.calls.some((call) => call.method === 'POST' && call.path === 'invoices')).toBe(false)
  })

  it('emails the pay link again on request, only while unpaid', async () => {
    const id = await quote()
    await accept(id)
    const { stripe } = invoicingStripe()
    await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))
    await resendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF }, deps(stripe))
    expect(emails.filter((row) => row.key === SITE_CARE_PROJECT_INVOICE_EMAIL_KEY)).toHaveLength(2)
    await recordSiteCareProjectPayment(db(), { orgId: 'org-1', invoiceId: 'in_1', metadata: { siteCareProjectId: id }, amountPaidCents: 26954 }, deps())
    await expect(
      resendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF }, deps(stripe)),
    ).rejects.toThrow(/unpaid/)
  })
})

describe('payments', () => {
  it('records a payment once, however often it is delivered, and emails the receipt once', async () => {
    const id = await quote()
    await accept(id)
    const { stripe } = invoicingStripe()
    await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))
    const input = { orgId: 'org-1', invoiceId: 'in_1', metadata: { siteCareProjectId: id }, amountPaidCents: 26954 }
    expect(await recordSiteCareProjectPayment(db(), input, deps())).toBe('recorded')
    expect(await recordSiteCareProjectPayment(db(), input, deps())).toBe('already')
    expect(await recordSiteCareProjectPayment(db(), { ...input, metadata: {} }, deps())).toBe('ignored')
    expect(stored(id)['status']).toBe('paid')
    expect(emails.filter((row) => row.key === SITE_CARE_PROJECT_PAID_EMAIL_KEY)).toEqual([
      expect.objectContaining({ merge: expect.objectContaining({ 'payment.amount': '$269.54' }) }),
    ])
    expect(kinds(id).filter((kind) => kind === 'invoice.paid')).toHaveLength(1)
  })

  it('Check payments records one the webhook missed', async () => {
    const id = await quote()
    await accept(id)
    const harness = invoicingStripe({
      'GET invoices/in_1': () => ({ body: { ...finalized('in_1', 26954, 24900), status: 'paid', amount_paid: 26954 } }),
    })
    await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))
    expect(await checkSiteCareProjectPayments(db(), { orgId: 'org-1', projectId: id }, deps(harness.stripe))).toEqual({ recorded: 1 })
    expect(stored(id)['status']).toBe('paid')
  })
})

describe('half and half', () => {
  it('bills the deposit, then the balance from the same record when it is launched', async () => {
    const id = await quote({ kind: 'redesign', estimatedHours: 6 })
    expect(stored(id)['quote']).toEqual(expect.objectContaining({ priceUsd: 749, split: 'half' }))
    await accept(id)
    const harness = invoicingStripe()
    const deposit = await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))
    expect(deposit).toEqual(expect.objectContaining({ kind: 'deposit', amountCents: 37450, status: 'open' }))
    expect(emails.at(-1)?.merge['invoice.heading']).toBe('Your deposit invoice')
    // Not before the deposit is paid.
    await expect(launchSiteCareProject(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))).rejects.toThrow(
      /deposit is paid/,
    )
    await recordSiteCareProjectPayment(db(), { orgId: 'org-1', invoiceId: 'in_1', metadata: { siteCareProjectId: id }, amountPaidCents: 40542 }, deps())
    expect(stored(id)['status']).toBe('deposit-paid')
    clock += 86_400_000
    const launched = await launchSiteCareProject(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))
    expect(launched.invoice).toEqual(
      expect.objectContaining({ seq: 2, kind: 'final', amountCents: 37450, status: 'open', invoiceId: 'in_2' }),
    )
    expect(launched.project.status).toBe('launched')
    expect(launched.project.launchedAtMs).toBe(clock)
    expect(kinds(id)).toEqual(expect.arrayContaining(['project.launched']))
    const launchedAt = kinds(id).indexOf('project.launched')
    expect(kinds(id)[launchedAt + 1]).toBe('invoice.requested')
    expect(harness.calls.filter((call) => call.path === 'invoiceitems').map((call) => call.params['description'])).toEqual([
      'Holiday sale page: deposit, half of the $749 quote',
      'Holiday sale page: balance at launch, half of the $749 quote',
    ])
    await recordSiteCareProjectPayment(db(), { orgId: 'org-1', invoiceId: 'in_2', metadata: { siteCareProjectId: id }, amountPaidCents: 40542 }, deps())
    expect(stored(id)['status']).toBe('paid')
    await expect(launchSiteCareProject(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))).rejects.toThrow(
      /already/,
    )
  })
})

describe('reversals', () => {
  async function sent(extra: Record<string, Route>) {
    const id = await quote()
    await accept(id)
    const harness = invoicingStripe(extra)
    await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(harness.stripe))
    return { id, harness }
  }

  it('voids an unpaid invoice with a reason, intent row first, and emails the owner', async () => {
    const { id, harness } = await sent({
      'GET invoices/in_1': () => ({ body: finalized('in_1', 26954, 24900) }),
      'POST invoices/in_1/void': () => ({ body: { id: 'in_1', status: 'void' } }),
    })
    await expect(
      reverseSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF, action: 'void', reason: ' ' }, deps(harness.stripe)),
    ).rejects.toThrow(/reason/)
    const voided = await reverseSiteCareProjectInvoice(
      db(),
      { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF, action: 'void', reason: 'Wrong scope on it' },
      deps(harness.stripe),
    )
    expect(voided.status).toBe('voided')
    expect(harness.calls.find((call) => call.path === 'invoices/in_1/void')?.key).toBe(`site-care-project:${id}:invoice:1:void`)
    expect(kinds(id).slice(-3)).toEqual(['invoice.voidRequested', 'invoice.voided', 'email.sent'])
    expect(emails.at(-1)).toEqual(
      expect.objectContaining({ key: SITE_CARE_PROJECT_REVERSED_EMAIL_KEY, merge: expect.objectContaining({ 'reversal.heading': 'Invoice canceled', 'reversal.reason': 'Wrong scope on it' }) }),
    )
    // The quote stays fixed: the invoice reached the owner.
    expect(stored(id)['status']).toBe('accepted')
    expect(stored(id)['firstInvoiceSentAtMs']).toBe(T0)
  })

  it('refunds a paid invoice through a credit note on its own line', async () => {
    const { id, harness } = await sent({
      'GET invoices/in_1': () => ({ body: { ...finalized('in_1', 26954, 24900), status: 'paid' } }),
      'GET invoices/in_1/lines': () => ({ body: { data: [{ id: 'il_1', invoice_item: 'ii_in_1', quantity: 1 }] } }),
      'GET credit_notes/preview': () => ({ body: { total: 26954 } }),
      'POST credit_notes': () => ({ body: { id: 'cn_1', total: 26954, refund: 're_1' } }),
    })
    await recordSiteCareProjectPayment(db(), { orgId: 'org-1', invoiceId: 'in_1', metadata: { siteCareProjectId: id }, amountPaidCents: 26954 }, deps())
    await expect(
      reverseSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF, action: 'void', reason: 'x' }, deps(harness.stripe)),
    ).rejects.toThrow(/Only a sent invoice|paid/)
    const refunded = await reverseSiteCareProjectInvoice(
      db(),
      { orgId: 'org-1', projectId: id, seq: 1, actor: STAFF, action: 'refund', reason: 'Owner canceled' },
      deps(harness.stripe),
    )
    expect(refunded).toEqual(expect.objectContaining({ status: 'refunded', creditNoteId: 'cn_1', refundId: 're_1' }))
    const note = harness.calls.find((call) => call.method === 'POST' && call.path === 'credit_notes')
    expect(note?.params).toEqual(expect.objectContaining({ invoice: 'in_1', 'lines[0][invoice_line_item]': 'il_1', refund_amount: '26954' }))
    expect(note?.key).toBe(`site-care-project:${id}:invoice:1:refund`)
    expect(stored(id)['status']).toBe('refunded')
    expect(emails.at(-1)?.merge['reversal.heading']).toBe('Payment refunded')
  })
})

describe('reading and reconciling', () => {
  it('reads a workspace’s projects with their history', async () => {
    const id = await quote()
    const views = await readSiteCareProjects(db(), 'org-1')
    expect(views.map((view) => view.projectId)).toEqual([id])
    expect(views[0].history.map((row) => row.kind)).toEqual(['project.quoted'])
  })

  it('finds nothing on a project that matches Stripe, and every kind of difference otherwise', async () => {
    const id = await quote()
    await accept(id)
    const { stripe } = invoicingStripe()
    await sendSiteCareProjectInvoice(db(), { orgId: 'org-1', projectId: id, actor: STAFF }, deps(stripe))
    const clean = stripeStub({
      'GET invoices': () => ({ body: { data: [{ ...finalized('in_1', 26954, 24900), metadata: { siteCareProjectId: id } }] } }),
    })
    expect((await reconcileSiteCareProjects(db(), { nowMs: clock, stripe: clean.stripe })).findings).toEqual([])
    const drifted = stripeStub({
      'GET invoices': () => ({
        body: {
          data: [
            { ...finalized('in_1', 26954, 20000), status: 'paid', metadata: { siteCareProjectId: id } },
            { ...finalized('in_7', 100, 100), metadata: { siteCareProjectId: id } },
          ],
        },
      }),
    })
    const report = await reconcileSiteCareProjects(db(), { nowMs: clock, stripe: drifted.stripe })
    expect(report.projects).toBe(1)
    expect(report.findings.map((finding) => finding.code).sort()).toEqual([
      'project-invoice-amount',
      'project-invoice-status',
      'project-invoice-without-row',
    ])
    expect(report.findings.find((finding) => finding.code === 'project-invoice-status')?.detail).toMatch(/Check payments/)
  })

  it('reports an invoice stuck before its answer landed', () => {
    const findings = compareSiteCareProjects({
      orgId: 'org-1',
      projects: [
        {
          id: 'p1',
          // Stored as paid by a hand edit; the record reads invoiced.
          storedStatus: 'paid',
          project: {
            orgId: 'org-1',
            title: 'Page',
            scope: ['Page'],
            quote: { kind: 'landingPage', estimatedHours: 1, billedHours: 1, rateUsd: 79, floorUsd: 249, computedUsd: 249, priceUsd: 249, split: 'full' },
            quoteVersion: 1,
            acceptance: null,
            invoices: [
              {
                seq: 1, kind: 'full', status: 'creating', amountCents: 24900, description: '', idempotencyKey: 'k',
                invoiceId: null, invoiceItemId: null, number: null, hostedInvoiceUrl: null, totalCents: 0, amountPaidCents: 0,
                creditNoteId: null, refundId: null, error: null, createdAtMs: 0, updatedAtMs: 0, paidAtMs: null,
              },
            ],
            invoiceSeq: 1,
            firstInvoiceSentAtMs: null,
            launchedAtMs: null,
            launchedByUid: null,
            status: 'invoiced',
            createdAtMs: 0,
            createdByUid: null,
            createdByEmail: null,
            updatedAtMs: 0,
          },
        },
      ],
      invoices: new Map(),
      listed: [],
    })
    expect(findings.map((finding) => finding.code)).toEqual(['project-status', 'project-invoice-stuck'])
  })
})

// The double keeps FieldValue sentinels opaque.
void FieldValue
