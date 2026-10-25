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
 * SITE CARE REQUESTS, END TO END ON DOUBLES (AGL-3959).
 *
 * The money path is the subject: a close past the included hour is refused
 * without the owner's recorded yes; with it, a `creating` charge and its
 * `charge.requested` row commit BEFORE the Stripe call, which goes out under
 * the charge's own idempotency key; a retry reuses that key; a correction's
 * Stripe call is keyed by the id of the history row that records it, so the
 * same correction can never be applied twice under two keys. Firestore is an
 * in-memory double and Stripe a recorded fetch; nothing leaves the process.
 */

import {
  SITE_CARE_APPROVAL_EMAIL_KEY,
  SITE_CARE_CHARGE_REVERSED_EMAIL_KEY,
  SITE_CARE_REQUEST_CORRECTED_EMAIL_KEY,
  SITE_CARE_REQUEST_DONE_EMAIL_KEY,
  SITE_CARE_REQUEST_RECEIVED_EMAIL_KEY,
} from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import {
  addSiteCareGoodwill,
  closeSiteCareRequest,
  correctSiteCareMinutes,
  moveSiteCareRequest,
  openSiteCareRequest,
  readSiteCareMonth,
  readSiteCareRequestPanel,
  recordSiteCareApproval,
  retrySiteCareCharge,
  reverseSiteCareCharge,
  SiteCareError,
  siteCareBlockedMessage,
  siteCareCorrectionKey,
  siteCareMessageDocId,
  siteCareStatementLine,
  startSiteCareTimer,
  type SiteCareDeps,
} from './site-care-requests'

/** Workspaces whose billing carries no Site Care; every other one has it. */
const mockWithoutSiteCare = new Set<string>()
jest.mock('./org-billing', () => ({
  __esModule: true,
  readOrgBilling: async (orgId: string) => ({
    plan: 'starter',
    stripeCustomerId: 'cus_1',
    subscription: { status: 'active' },
    ...(mockWithoutSiteCare.has(orgId) ? {} : { seatAddons: { siteCare: 1 } }),
  }),
}))

const mockNotifyStaff = jest.fn<Promise<void>, [unknown]>(async () => undefined)
jest.mock('./notifications', () => ({
  __esModule: true,
  notifyStaff: (notice: unknown) => mockNotifyStaff(notice),
}))

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

const BASE_ROUTES: Record<string, Route> = {
  'GET subscriptions': () => ({ body: { data: [{ id: 'sub_1', status: 'active' }] } }),
  'GET prices/price_care': () => ({ body: { product: { id: 'prod_care', tax_code: 'txcd_10103001' } } }),
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG = {
  $id: 'org-1',
  name: 'Acme Builders',
  plan: 'starter',
  ownerUid: 'owner-1',
  subscription: { status: 'active' },
  seatAddons: { siteCare: 1 },
}
const OWNER = { uid: 'owner-1', email: 'owner@example.com' }
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

function history(ticketId: string) {
  return store.rows(`supportTickets/${ticketId}/siteCareHistory`)
}

function ticket(ticketId: string) {
  return store.docs.get(`supportTickets/${ticketId}`) as Data
}

async function openOne(subject = 'New hours on the contact page'): Promise<string> {
  const opened = await openSiteCareRequest(
    db(),
    { orgId: 'org-1', org: ORG, hostId: 'host-1', subject, body: 'We now close at 6.', requester: OWNER, source: 'console' },
    deps(),
  )
  return opened.ticketId
}

beforeEach(() => {
  store = new FakeStore()
  store.docs.set('orgs/org-1', { name: 'Acme Builders', ownerUid: 'owner-1' })
  store.docs.set('orgs/org-1/members/owner-1', { email: 'owner@example.com' })
  clock = T0
  emails = []
  autoId = 0
  mockNotifyStaff.mockClear()
  mockWithoutSiteCare.clear()
  process.env['STRIPE_PRICE_SITE_CARE'] = 'price_care'
})

describe('intake', () => {
  it('opens a tagged ticket due in two business days, with its row, notice and receipt', async () => {
    const id = await openOne()
    const doc = ticket(id)
    expect(doc).toEqual(
      expect.objectContaining({
        kind: 'siteCare',
        status: 'open',
        orgId: 'org-1',
        siteCareMonth: '2026-10',
        siteCareOrgMonth: 'org-1_2026-10',
      }),
    )
    // Monday + 2 business days is Wednesday.
    const due = (doc['responseDueAt'] as { toMillis(): number }).toMillis()
    expect(new Date(due).getUTCDay()).toBe(3)
    expect(history(id).map((row) => row.data['kind'])).toEqual(['request.opened', 'email.sent'])
    expect(mockNotifyStaff).toHaveBeenCalledWith(expect.objectContaining({ type: 'support.ticketOpened' }))
    expect(emails.map((email) => email.key)).toEqual([SITE_CARE_REQUEST_RECEIVED_EMAIL_KEY])
    expect(emails[0].to).toBe('owner@example.com')
  })

  it('opens nothing twice for a redelivered message', async () => {
    const input = {
      orgId: 'org-1',
      org: ORG,
      hostId: null,
      subject: 'Swap the photo',
      body: 'The new one is attached.',
      requester: OWNER,
      source: 'email' as const,
      dedupeKey: '<abc@mail>',
    }
    const first = await openSiteCareRequest(db(), input, deps())
    const second = await openSiteCareRequest(db(), input, deps())
    expect(second).toEqual(expect.objectContaining({ ticketId: first.ticketId, duplicate: true }))
    expect(first.ticketId).toBe(siteCareMessageDocId('care', '<abc@mail>'))
    expect(first.ticketId).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('refuses a workspace without Site Care, and an empty request', async () => {
    await expect(
      openSiteCareRequest(
        db(),
        { orgId: 'org-1', org: { plan: 'starter' }, hostId: null, subject: 'x', body: 'y', requester: OWNER, source: 'console' },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      openSiteCareRequest(
        db(),
        { orgId: 'org-1', org: ORG, hostId: null, subject: ' ', body: 'y', requester: OWNER, source: 'console' },
        deps(),
      ),
    ).rejects.toBeInstanceOf(SiteCareError)
  })
})

describe('the timer', () => {
  it('starts once, however often the request is opened', async () => {
    const id = await openOne()
    clock = T0 + 60_000
    await startSiteCareTimer(db(), { ticketId: id, actor: STAFF }, deps())
    clock = T0 + 120_000
    const again = await startSiteCareTimer(db(), { ticketId: id, actor: STAFF }, deps())
    expect(again.timerStartedAtMs).toBe(T0 + 60_000)
    expect(history(id).filter((row) => row.data['kind'] === 'timer.started')).toHaveLength(1)
    // The staff change is audited beside its row.
    expect(store.rows('adminAudit').map((row) => row.data['action'])).toEqual(['siteCare.timer.started'])
  })
})

describe('closing inside the included hour', () => {
  it('bills nothing and calls no Stripe', async () => {
    const id = await openOne()
    const { calls, stripe } = stripeStub(BASE_ROUTES)
    const closed = await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 40 }, deps(stripe))
    expect(closed.request).toEqual(
      expect.objectContaining({ state: 'closed', countedMinutes: 45, includedMinutesUsed: 45, billedHours: 0, charge: null }),
    )
    expect(calls).toHaveLength(0)
    expect(closed.statement.minutesLeft).toBe(15)
    expect(ticket(id)['status']).toBe('closed')
    expect(emails.map((email) => email.key)).toContain(SITE_CARE_REQUEST_DONE_EMAIL_KEY)
  })
})

describe('closing past the included hour', () => {
  it('is refused with no approval on file, and writes nothing', async () => {
    const id = await openOne()
    const rowsBefore = history(id).length
    const { calls, stripe } = stripeStub(BASE_ROUTES)
    const refusal = await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 90 }, deps(stripe)).catch(
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(SiteCareError)
    expect(refusal).toMatchObject({
      status: 409,
      detail: { blocked: { ok: false, reason: 'no-approval', requiredHours: 1, approvedHours: null } },
    })
    expect((refusal as Error).message).toBe(
      siteCareBlockedMessage({ ok: false, reason: 'no-approval', requiredHours: 1, approvedHours: null }),
    )
    expect(history(id)).toHaveLength(rowsBefore)
    expect(ticket(id)['status']).toBe('open')
    expect(calls).toHaveLength(0)
  })

  it('absorbs with no charge when staff choose to', async () => {
    const id = await openOne()
    const { calls, stripe } = stripeStub(BASE_ROUTES)
    const closed = await closeSiteCareRequest(
      db(),
      { ticketId: id, actor: STAFF, minutes: 90, absorb: true },
      deps(stripe),
    )
    expect(closed.request).toEqual(expect.objectContaining({ absorbed: true, billedHours: 0, overMinutes: 30, charge: null }))
    expect(calls).toHaveLength(0)
    expect(store.rows('adminAudit').map((row) => row.data['action'])).toContain('siteCare.request.closedAbsorbed')
  })

  it('bills the approved hours under the charge key, row first', async () => {
    const id = await openOne()
    await recordSiteCareApproval(
      db(),
      { ticketId: id, actor: STAFF, approval: { hours: 2, channel: 'phone', approvedAtMs: T0 - 60_000 } },
      deps(),
    )
    expect(emails.map((email) => email.key)).toContain(SITE_CARE_APPROVAL_EMAIL_KEY)
    let rowsAtCreate: string[] = []
    const { calls, stripe } = stripeStub({
      ...BASE_ROUTES,
      'POST invoiceitems': () => {
        rowsAtCreate = history(id).map((row) => String(row.data['kind']))
        return { body: { id: 'ii_1', amount: 15_800 } }
      },
    })
    const closed = await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 90 }, deps(stripe))
    // 90 minutes is 30 past the hour: one started hour, billed at the two approved.
    expect(closed.request).toEqual(expect.objectContaining({ overMinutes: 30, billedHours: 2 }))
    expect(closed.request.charge).toEqual(
      expect.objectContaining({
        status: 'pending',
        hours: 2,
        amountCents: 15_800,
        invoiceItemId: 'ii_1',
        idempotencyKey: `site-care:${id}:charge:1`,
      }),
    )
    const create = calls.find((call) => call.method === 'POST' && call.path === 'invoiceitems')
    expect(create?.key).toBe(`site-care:${id}:charge:1`)
    expect(create?.params).toEqual(
      expect.objectContaining({ quantity: '2', 'price_data[unit_amount]': '7900', 'metadata[siteCareRequestId]': id }),
    )
    // The intent was on record before Stripe was asked.
    expect(rowsAtCreate).toContain('charge.requested')
    expect(rowsAtCreate).not.toContain('charge.created')
    expect(history(id).map((row) => row.data['kind'])).toEqual(
      expect.arrayContaining(['approval.recorded', 'request.closed', 'charge.requested', 'charge.created']),
    )
  })
})

async function closedWithCharge(createAnswer: Route = () => ({ body: { id: 'ii_1', amount: 15_800 } })) {
  const id = await openOne()
  await recordSiteCareApproval(
    db(),
    { ticketId: id, actor: STAFF, approval: { hours: 2, channel: 'text', approvedAtMs: T0 - 60_000 } },
    deps(),
  )
  const stub = stripeStub({ ...BASE_ROUTES, 'POST invoiceitems': createAnswer })
  await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 90 }, deps(stub.stripe))
  return { id, stub }
}

describe('retrying a charge', () => {
  it('reuses the charge key, so a lost answer never bills twice', async () => {
    const { id, stub } = await closedWithCharge(() => ({ status: 500, body: { error: { message: 'Stripe is down' } } }))
    expect((ticket(id)['siteCare'] as Data)['charge']).toEqual(expect.objectContaining({ status: 'failed', error: 'Stripe is down' }))
    const retry = stripeStub({ ...BASE_ROUTES, 'POST invoiceitems': () => ({ body: { id: 'ii_1', amount: 15_800 } }) })
    const charge = await retrySiteCareCharge(db(), { ticketId: id, actor: STAFF }, deps(retry.stripe))
    expect(charge).toEqual(expect.objectContaining({ status: 'pending', invoiceItemId: 'ii_1' }))
    const keys = [...stub.calls, ...retry.calls].filter((call) => call.path === 'invoiceitems').map((call) => call.key)
    expect(keys).toEqual([`site-care:${id}:charge:1`, `site-care:${id}:charge:1`])
  })

  it('refuses when nothing is waiting', async () => {
    const { id } = await closedWithCharge()
    await expect(retrySiteCareCharge(db(), { ticketId: id, actor: STAFF }, deps())).rejects.toMatchObject({ status: 409 })
  })
})

describe('correcting minutes', () => {
  it('needs a reason', async () => {
    const { id } = await closedWithCharge()
    await expect(
      correctSiteCareMinutes(db(), { ticketId: id, actor: STAFF, minutes: 120, reason: ' ' }, deps()),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('keys the Stripe correction by its own history row, not the clock', async () => {
    const { id } = await closedWithCharge()
    const { calls, stripe } = stripeStub({
      'GET invoiceitems/ii_1': () => ({ body: { id: 'ii_1', invoice: null, amount: 15_800, quantity: 2 } }),
      'POST invoiceitems/ii_1': () => ({ body: { amount: 15_800 } }),
    })
    clock = T0 + 3_600_000
    const corrected = await correctSiteCareMinutes(
      db(),
      { ticketId: id, actor: STAFF, minutes: 120, reason: 'Logged the wrong number' },
      deps(stripe),
    )
    const correctionRow = history(id).find((row) => row.data['kind'] === 'minutes.corrected')
    expect(correctionRow?.data).toEqual(
      expect.objectContaining({
        reason: 'Logged the wrong number',
        before: expect.objectContaining({ minutesLogged: 90 }),
        after: expect.objectContaining({ minutesLogged: 120 }),
      }),
    )
    const update = calls.find((call) => call.method === 'POST')
    expect(update?.key).toBe(siteCareCorrectionKey(`site-care:${id}:charge:1`, String(correctionRow?.id)))
    expect(update?.key).not.toContain(String(clock))
    expect(corrected.request.minutesLogged).toBe(120)
    expect(corrected.request.charge).toEqual(expect.objectContaining({ status: 'pending', hours: 2 }))
    expect(history(id).map((row) => row.data['kind'])).toContain('charge.updated')
    expect(emails.map((email) => email.key)).toContain(SITE_CARE_REQUEST_CORRECTED_EMAIL_KEY)
  })

  it('removes the pending charge when the work fits the hour after all', async () => {
    const { id } = await closedWithCharge()
    const { calls, stripe } = stripeStub({
      'GET invoiceitems/ii_1': () => ({ body: { id: 'ii_1', invoice: 'in_1' } }),
      'GET invoices/in_1': () => ({ body: { status: 'draft' } }),
      'DELETE invoiceitems/ii_1': () => ({ body: { deleted: true } }),
    })
    const corrected = await correctSiteCareMinutes(
      db(),
      { ticketId: id, actor: STAFF, minutes: 45, reason: 'Half was another request' },
      deps(stripe),
    )
    expect(corrected.request.billedHours).toBe(0)
    expect(corrected.request.charge).toEqual(expect.objectContaining({ status: 'voided' }))
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain('DELETE invoiceitems/ii_1')
  })

  it('settles a refused charge as voided when the corrected time owes nothing', async () => {
    const { id } = await closedWithCharge(() => ({ status: 402, body: { error: { message: 'No payment method' } } }))
    const { calls, stripe } = stripeStub({
      ...BASE_ROUTES,
      'GET invoices': () => ({ body: { data: [] } }),
    })
    const corrected = await correctSiteCareMinutes(
      db(),
      { ticketId: id, actor: STAFF, minutes: 45, reason: 'Half was another request' },
      deps(stripe),
    )
    expect(corrected.request.charge).toEqual(expect.objectContaining({ status: 'voided' }))
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('is locked once the invoice finalizes', async () => {
    const { id } = await closedWithCharge()
    const { calls, stripe } = stripeStub({
      'GET invoiceitems/ii_1': () => ({ body: { id: 'ii_1', invoice: 'in_1' } }),
      'GET invoices/in_1': () => ({ body: { status: 'open' } }),
    })
    await expect(
      correctSiteCareMinutes(db(), { ticketId: id, actor: STAFF, minutes: 120, reason: 'Late fix' }, deps(stripe)),
    ).rejects.toMatchObject({ status: 409 })
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    expect(history(id).some((row) => row.data['kind'] === 'minutes.corrected')).toBe(false)
  })

  it('refuses a correction past the approved hours', async () => {
    const { id } = await closedWithCharge()
    const { stripe } = stripeStub({
      'GET invoiceitems/ii_1': () => ({ body: { id: 'ii_1', invoice: null } }),
    })
    await expect(
      correctSiteCareMinutes(db(), { ticketId: id, actor: STAFF, minutes: 200, reason: 'More work' }, deps(stripe)),
    ).rejects.toMatchObject({ status: 409, detail: { blocked: expect.objectContaining({ reason: 'approval-exceeded' }) } })
  })
})

describe('reversing a charge', () => {
  it('credits it on an open invoice, intent row first, under a key of its own', async () => {
    const { id } = await closedWithCharge()
    let rowsAtCredit: string[] = []
    const { calls, stripe } = stripeStub({
      'GET invoiceitems/ii_1': () => ({ body: { id: 'ii_1', invoice: 'in_1' } }),
      'GET invoices/in_1': () => ({ body: { status: 'open' } }),
      'GET invoices/in_1/lines': () => ({ body: { data: [{ id: 'il_1', invoice_item: 'ii_1', quantity: 2 }] } }),
      'POST credit_notes': () => {
        rowsAtCredit = history(id).map((row) => String(row.data['kind']))
        return { body: { id: 'cn_1', total: 17_064, refund: null } }
      },
    })
    const charge = await reverseSiteCareCharge(
      db(),
      { ticketId: id, actor: STAFF, reason: 'Our mistake', absorb: true },
      deps(stripe),
    )
    expect(charge).toEqual(expect.objectContaining({ status: 'credited', creditNoteId: 'cn_1' }))
    expect(rowsAtCredit).toContain('charge.creditRequested')
    expect(calls.find((call) => call.path === 'credit_notes')?.key).toBe(`site-care:${id}:charge:1:credit`)
    expect((ticket(id)['siteCare'] as Data)['absorbed']).toBe(true)
    expect(emails.map((email) => email.key)).toContain(SITE_CARE_CHARGE_REVERSED_EMAIL_KEY)
  })

  it('needs a reason and a live charge', async () => {
    const id = await openOne()
    await expect(reverseSiteCareCharge(db(), { ticketId: id, actor: STAFF, reason: '' }, deps())).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      reverseSiteCareCharge(db(), { ticketId: id, actor: STAFF, reason: 'why' }, deps()),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('goodwill and the month', () => {
  it('adds included minutes with a reason, and the month reads them', async () => {
    await expect(
      addSiteCareGoodwill(db(), { orgId: 'org-1', month: '2026-10', minutes: 30, reason: '', actor: STAFF }, deps()),
    ).rejects.toMatchObject({ status: 400 })
    const added = await addSiteCareGoodwill(
      db(),
      { orgId: 'org-1', month: '2026-10', minutes: 30, reason: 'Slow week on our side', actor: STAFF },
      deps(),
    )
    expect(added).toEqual({ goodwillMinutes: 30 })
    const id = await openOne()
    // 90 minutes fits in the 60 + 30 pool, so no approval is needed.
    const { calls, stripe } = stripeStub(BASE_ROUTES)
    const closed = await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 90 }, deps(stripe))
    expect(closed.request.billedHours).toBe(0)
    expect(calls).toHaveLength(0)
    const view = await readSiteCareMonth(db(), { orgId: 'org-1', month: '2026-10' })
    expect(view.statement).toEqual(
      expect.objectContaining({ poolMinutes: 90, includedMinutesUsed: 90, minutesLeft: 0, requests: 1 }),
    )
    expect(view.monthHistory.map((row) => row.kind)).toEqual(['goodwill.added'])
    expect(siteCareStatementLine(view.requests[0])).toBe('New hours on the contact page: 1 h 30 min, included')
  })
})

// ── A sender in several Site Care workspaces (AGL-4031) ─────────────────────

describe('a sender in several Site Care workspaces', () => {
  const CANDIDATES = [
    { orgId: 'org-1', name: 'Acme Builders', uid: 'owner-1' },
    { orgId: 'org-2', name: 'Acme Rentals', uid: 'owner-1' },
  ]

  beforeEach(() => {
    store.docs.set('orgs/org-2', { name: 'Acme Rentals', ownerUid: 'owner-1' })
    store.docs.set('orgs/org-2/members/owner-1', { email: 'owner@example.com' })
    store.docs.set('orgs/org-3', { name: 'Someone Else', ownerUid: 'owner-3' })
    store.docs.set('orgs/org-3/members/owner-3', { email: 'other@example.com' })
  })

  async function openEmailed(candidates = CANDIDATES, subject = 'Swap the photo'): Promise<string> {
    const opened = await openSiteCareRequest(
      db(),
      { orgId: 'org-1', org: ORG, hostId: null, subject, body: 'The new one is attached.', requester: OWNER, source: 'email', candidates },
      deps(),
    )
    return opened.ticketId
  }

  const intake = (id: string) => store.docs.get(`supportTickets/${id}/siteCareStaff/intake`)

  it('records every candidate at intake, for staff only, and names the others in the staff notice', async () => {
    const id = await openEmailed()
    expect(intake(id)).toEqual(expect.objectContaining({ candidates: CANDIDATES, filedOnOrgId: 'org-1' }))
    // Not on the ticket, which the workspace's members are shown.
    expect(JSON.stringify(ticket(id))).not.toContain('Acme Rentals')
    const notice = mockNotifyStaff.mock.calls[0][0] as { body: string }
    expect(notice.body).toContain('Also a member of: Acme Rentals (org-2). If it belongs')
  })

  it('keeps nothing for a sender in one workspace, or a console request', async () => {
    const id = await openEmailed([CANDIDATES[0]])
    expect(intake(id)).toBeUndefined()
    expect((mockNotifyStaff.mock.calls[0][0] as { body: string }).body).not.toContain('Also a member of')
    const fromConsole = await openOne()
    expect(intake(fromConsole)).toBeUndefined()
    const panel = await readSiteCareRequestPanel(db(), fromConsole, deps())
    expect(panel).toEqual(expect.objectContaining({ otherWorkspaces: [], moveBlockedReason: null }))
  })

  it('shows the other workspaces on the panel, and offers the move while the request is open', async () => {
    const id = await openEmailed()
    const panel = await readSiteCareRequestPanel(db(), id, deps())
    expect(panel.otherWorkspaces).toEqual([CANDIDATES[1]])
    expect(panel.moveBlockedReason).toBeNull()
  })

  it('moves the request, its month and its included hour to the chosen workspace, with its row and audit', async () => {
    // Acme Rentals already used 45 of its included minutes this month.
    const { ticketId: earlier } = await openSiteCareRequest(
      db(),
      { orgId: 'org-2', org: ORG, hostId: null, subject: 'Earlier', body: 'x', requester: OWNER, source: 'console' },
      deps(),
    )
    await closeSiteCareRequest(db(), { ticketId: earlier, actor: STAFF, minutes: 45 }, deps())
    const id = await openEmailed()
    await startSiteCareTimer(db(), { ticketId: id, actor: STAFF }, deps())
    expect((await readSiteCareRequestPanel(db(), id, deps())).monthMinutesLeft).toBe(60)

    clock = T0 + 5 * 60_000
    const moved = await moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-2' }, deps())
    expect(moved).toEqual(expect.objectContaining({ fromOrgId: 'org-1', orgId: 'org-2' }))
    expect(ticket(id)).toEqual(
      expect.objectContaining({ orgId: 'org-2', siteCareMonth: '2026-10', siteCareOrgMonth: 'org-2_2026-10' }),
    )
    // The timer it started keeps running; nothing else of the request changes.
    expect((ticket(id)['siteCare'] as Data)['timerStartedAtMs']).toBe(T0)
    const row = history(id).find((each) => each.data['kind'] === 'request.moved')?.data
    expect(row).toEqual(
      expect.objectContaining({
        atMs: T0 + 5 * 60_000,
        summary: 'Moved to Acme Rentals, the workspace it belongs to.',
        before: { orgId: 'org-1', hostId: null },
        after: { orgId: 'org-2', hostId: null, month: '2026-10' },
      }),
    )
    expect(store.rows('adminAudit').map((each) => each.data)).toContainEqual(
      expect.objectContaining({ action: 'siteCare.request.moved', target: `orgs/org-2/siteCare/${id}` }),
    )
    // Out of the old workspace's month and into the new one's.
    expect((await readSiteCareMonth(db(), { orgId: 'org-1', month: '2026-10' })).requests).toHaveLength(0)
    expect((await readSiteCareMonth(db(), { orgId: 'org-2', month: '2026-10' })).requests.map((r) => r.ticketId)).toEqual(
      expect.arrayContaining([earlier, id]),
    )
    // Its minutes now count against Acme Rentals' hour: 15 of it is left.
    const panel = await readSiteCareRequestPanel(db(), id, deps())
    expect(panel).toEqual(expect.objectContaining({ orgId: 'org-2', monthMinutesLeft: 15, otherWorkspaces: [CANDIDATES[0]] }))
    const closed = await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 30, absorb: true }, deps())
    expect(closed.request).toEqual(expect.objectContaining({ includedMinutesUsed: 15, overMinutes: 15, absorbed: true }))
    expect(closed.statement.includedMinutesUsed).toBe(60)
  })

  it('clears a site the request named, which belongs to the workspace it left', async () => {
    const opened = await openSiteCareRequest(
      db(),
      { orgId: 'org-1', org: ORG, hostId: 'host-1', subject: 'x', body: 'y', requester: OWNER, source: 'email', candidates: CANDIDATES },
      deps(),
    )
    await moveSiteCareRequest(db(), { ticketId: opened.ticketId, actor: STAFF, orgId: 'org-2' }, deps())
    expect((ticket(opened.ticketId)['siteCare'] as Data)['hostId']).toBeNull()
  })

  it('refuses a closed request', async () => {
    const id = await openEmailed()
    await closeSiteCareRequest(db(), { ticketId: id, actor: STAFF, minutes: 10 }, deps())
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-2' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('finished'),
    })
    expect(ticket(id)['orgId']).toBe('org-1')
    expect((await readSiteCareRequestPanel(db(), id, deps())).moveBlockedReason).toContain('finished')
  })

  it('refuses a request with an owner’s approval on it', async () => {
    const id = await openEmailed()
    await recordSiteCareApproval(
      db(),
      { ticketId: id, actor: { uid: 'staff-1', email: 'staff@aglyn.com' }, approval: { hours: 1, channel: 'phone', approvedAtMs: T0 } },
      deps(),
    )
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-2' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('approval'),
    })
    expect(ticket(id)['orgId']).toBe('org-1')
    expect((await readSiteCareRequestPanel(db(), id, deps())).moveBlockedReason).toContain('approval')
  })

  it('refuses a request with a charge on it', async () => {
    const id = await openEmailed()
    const doc = ticket(id)
    store.docs.set(`supportTickets/${id}`, { ...doc, siteCare: { ...(doc['siteCare'] as Data), chargeSeq: 1 } })
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-2' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('charged'),
    })
    expect(ticket(id)['orgId']).toBe('org-1')
  })

  it('refuses a workspace that is not a recorded candidate, the one it is on, and a missing choice', async () => {
    const id = await openEmailed()
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-3' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('not recorded as a member'),
    })
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-1' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('already on that workspace'),
    })
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: '' }, deps())).rejects.toMatchObject({
      status: 400,
    })
    const fromConsole = await openOne()
    await expect(
      moveSiteCareRequest(db(), { ticketId: fromConsole, actor: STAFF, orgId: 'org-2' }, deps()),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not a member of another workspace') })
    expect(ticket(id)['orgId']).toBe('org-1')
    expect(history(id).some((row) => row.data['kind'] === 'request.moved')).toBe(false)
  })

  it('refuses a candidate that lost Site Care, or that the sender has left, since intake', async () => {
    const id = await openEmailed()
    mockWithoutSiteCare.add('org-2')
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-2' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('does not have Site Care'),
    })
    mockWithoutSiteCare.clear()
    store.docs.delete('orgs/org-2/members/owner-1')
    await expect(moveSiteCareRequest(db(), { ticketId: id, actor: STAFF, orgId: 'org-2' }, deps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('no longer a member'),
    })
    expect(ticket(id)['orgId']).toBe('org-1')
  })
})
