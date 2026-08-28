/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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

/**
 * ITEM 3 — WHO MAY ENTER IT, AND THE ZERO THAT MUST NEVER APPEAR.
 *
 * The line the return cannot compute is now stored per period. The value of
 * that is entirely conditional on three properties, and each is asserted:
 *
 *   1. **An unentered period reports nothing, never `0.00`.** A zero arriving
 *      from a storage layer looks derived in a way a blank never does, and
 *      the whole reason the line reads `not computed` is that a zero printed
 *      where no figure was derived is a claim the data cannot support.
 *   2. **Any staff may read; only `super` may write**, enforced in the route
 *      rather than in the card — a component that hides a button is a
 *      suggestion.
 *   3. **A figure entered for one period cannot be read under another.** The
 *      period is the document id, so a leak would take a code path that does
 *      not exist; the assertion is here because the cost of being wrong is
 *      one quarter's figure on another quarter's return.
 *
 * Every value below is SYNTHETIC. No registration identifier, taxpayer
 * number, Webfile number or EIN appears in this file in any form.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
const mockSet = jest.fn(async (..._args: unknown[]) => undefined)
const mockDelete = jest.fn(async (..._args: unknown[]) => undefined)

/**
 * The whole `platformTaxablePurchases` collection, keyed by document id.
 *
 * Keyed rather than a single slot on purpose: a fake with one document could
 * not fail the period-isolation assertion below, and a test double that
 * cannot express the bug is not a control.
 */
let mockStore: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
    body:
      request.method === 'GET'
        ? undefined
        : await request.json().catch(() => undefined),
  }),
  resolveEffectivePlan: () => 'free',
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: mockStore[id] !== undefined,
              data: () => mockStore[id],
            }),
            // The fake STORES, so a route that re-reads its own write to
            // build the audit's `after` observes what it just wrote.
            set: (...args: unknown[]) => {
              mockStore[id] = args[0] as Record<string, unknown>
              return mockSet(name, id, ...args)
            },
            delete: (...args: unknown[]) => {
              delete mockStore[id]
              return mockDelete(name, id, ...args)
            },
          }),
          add: (row: unknown) => mockAuditAdd(name, row),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

import { DELETE, GET, PUT } from '../app/api/admin/tax-purchases/route'

function request(method: string, body?: unknown, query = '') {
  return new Request(`https://app.aglyn.com/api/admin/tax-purchases${query}`, {
    method,
    headers: {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function asStaff(role: string) {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: role,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStore = {}
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('an unentered period is not computed, never zero', () => {
  it('answers null rather than a figure', async () => {
    asStaff('super')
    const response = await GET(request('GET', undefined, '?period=2026-Q4'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.entry).toBeNull()
    // Said twice on purpose. The failure this guards against is not a wrong
    // number, it is a ZERO — so the wire is checked for one directly.
    expect(JSON.stringify(body)).not.toContain('"amountCents":0')
    expect(JSON.stringify(body)).not.toContain('0.00')
  })

  it('refuses to store a blank amount as zero', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { period: '2026-Q4', amount: '', note: 'nothing typed' }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('blank field is not zero')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('THE CONTROL: an entered zero IS stored, and reads as entered', async () => {
    // The distinction the whole module exists to keep. Nobody looking and
    // somebody looking and finding nothing are different facts, and a suite
    // that only asserted "no zeroes" would pass over a route that refused a
    // legitimate zero entry too.
    asStaff('super')
    const response = await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '0.00',
        note: 'No taxable purchases this quarter — checked the expense ledger',
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.entry.amountCents).toBe(0)
    expect(body.entry.amountDollars).toBe('0.00')
  })

  it('clearing an entry returns the period to not computed', async () => {
    asStaff('super')
    await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '412.90',
        note: 'From the Q4 expense ledger',
      }),
    )
    const cleared = await DELETE(
      request('DELETE', { period: '2026-Q4', note: 'Entered against the wrong quarter' }),
    )
    expect(cleared.status).toBe(200)
    expect((await cleared.json()).entry).toBeNull()
    const after = await GET(request('GET', undefined, '?period=2026-Q4'))
    expect((await after.json()).entry).toBeNull()
  })
})

describe('reading is staff, writing is super', () => {
  it('answers support with what is entered', async () => {
    mockStore['2026-Q4'] = {
      period: '2026-Q4',
      amountCents: 41_290,
      note: 'From the Q4 expense ledger',
      updatedAtMs: Date.UTC(2026, 9, 5),
      updatedByEmail: 'filer@aglyn.com',
    }
    asStaff('support')
    const response = await GET(request('GET', undefined, '?period=2026-Q4'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.role).toBe('support')
    expect(body.entry.amountDollars).toBe('412.90')
  })

  it('refuses a support write, and stores nothing at all', async () => {
    asStaff('support')
    const response = await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '412.90',
        note: 'trying it on',
      }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('super')
    expect(mockSet).not.toHaveBeenCalled()
    // A refusal is not an audited event; the absence of a row is what tells a
    // reader nothing happened.
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('refuses a support DELETE too', async () => {
    mockStore['2026-Q4'] = { period: '2026-Q4', amountCents: 100, note: 'x' }
    asStaff('support')
    const response = await DELETE(
      request('DELETE', { period: '2026-Q4', note: 'trying it on' }),
    )
    expect(response.status).toBe(403)
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockStore['2026-Q4']).toBeDefined()
  })

  it('THE CONTROL: super is let through — so the refusals mean something', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '412.90',
        note: 'From the Q4 expense ledger, taxable purchases tab',
      }),
    )
    expect(response.status).toBe(200)
    expect(mockSet).toHaveBeenCalled()
  })
})

describe('a reason is required and the change is audited', () => {
  it('refuses a write with no reason', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { period: '2026-Q4', amount: '412.90', note: '   ' }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('reason is required')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('records a before, an after and the reason — with the figures', async () => {
    asStaff('super')
    await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '412.90',
        note: 'From the Q4 expense ledger',
      }),
    )
    await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '500.00',
        note: 'Corrected — a November invoice was missed',
      }),
    )
    const [collection, row] = mockAuditAdd.mock.calls.at(-1) as [
      string,
      Record<string, any>,
    ]
    expect(collection).toBe('adminAudit')
    expect(row.action).toBe('taxablePurchases.update')
    expect(row.actorUid).toBe('staff-1')
    expect(row.period).toBe('2026-Q4')
    expect(row.target).toBe('platformTaxablePurchases/2026-Q4')
    expect(row.note).toBe('Corrected — a November invoice was missed')
    // The FIGURE is recorded, unlike the filing route's identifiers. This
    // number goes onto a public filing; it is not a credential, and an audit
    // row that lost it would keep the event and lose the answer.
    expect(row.before.amountCents).toBe(41_290)
    expect(row.after.amountCents).toBe(50_000)
  })

  it('records the clear as an event of its own', async () => {
    asStaff('super')
    await PUT(
      request('PUT', { period: '2026-Q4', amount: '412.90', note: 'entered' }),
    )
    await DELETE(request('DELETE', { period: '2026-Q4', note: 'wrong quarter' }))
    const [, row] = mockAuditAdd.mock.calls.at(-1) as [string, Record<string, any>]
    expect(row.action).toBe('taxablePurchases.clear')
    expect(row.before.entered).toBe(true)
    expect(row.after.entered).toBe(false)
    expect(row.after.amountCents).toBeNull()
  })
})

describe('a figure entered for one period stays in that period', () => {
  it('does not leak into a neighboring quarter', async () => {
    asStaff('super')
    await PUT(
      request('PUT', {
        period: '2026-Q4',
        amount: '412.90',
        note: 'From the Q4 expense ledger',
      }),
    )
    const neighbor = await GET(request('GET', undefined, '?period=2026-Q3'))
    expect((await neighbor.json()).entry).toBeNull()
    const month = await GET(request('GET', undefined, '?period=2026-10'))
    expect((await month.json()).entry).toBeNull()

    // THE CONTROL for the three absences above: the figure really is stored
    // and really is readable — under its own period.
    const own = await GET(request('GET', undefined, '?period=2026-Q4'))
    expect((await own.json()).entry.amountDollars).toBe('412.90')
  })

  it('normalizes the period so one quarter cannot become two records', async () => {
    asStaff('super')
    await PUT(
      request('PUT', { period: '2026-q4', amount: '10.00', note: 'lowercase' }),
    )
    const response = await GET(request('GET', undefined, '?period=2026-Q4'))
    expect((await response.json()).entry.amountDollars).toBe('10.00')
    expect(Object.keys(mockStore)).toEqual(['2026-Q4'])
  })

  it('refuses a period that is not a period at all', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { period: 'last quarter', amount: '10.00', note: 'x' }),
    )
    expect(response.status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })
})
