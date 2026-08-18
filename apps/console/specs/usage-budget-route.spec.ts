/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * The console's budget surface (AGL-1528).
 *
 * Zach, 2026-08-18, verbatim: "*Always make sure features are available in
 * the console and not just that the capability exists.*" The cron can
 * evaluate a budget with no route at all — and would then be alerting on a
 * number no customer could ever have chosen. This suite is the proof that a
 * customer can set one, see one, and remove one.
 *
 * The Firestore double models the semantics that actually bite here, not a
 * convenient approximation:
 *
 *   - `update()` interprets a DOTTED field path as a nested path; `set()`
 *     does not, and would create a literal top-level `"usageAlerts.budget"`
 *     field. The route depends on the difference, so the double enforces it.
 *   - `update()` throws NOT_FOUND on a missing document.
 *   - `undefined` is rejected on write.
 */

const mockDELETE = Symbol('FieldValue.delete')
const mockSERVER_TIMESTAMP = Symbol('FieldValue.serverTimestamp')

interface OrgDocState {
  exists: boolean
  data: Record<string, any>
}

let org: OrgDocState
/** Every `update()` payload, verbatim, in order. */
let updates: Array<Record<string, unknown>>
let mockAudits: Array<Record<string, unknown>>
/** `orgs/{id}/usage/{month}` and `assistUsage/{month}` by document id. */
let usageDocs: Record<string, Record<string, unknown>>
let assistDocs: Record<string, Record<string, unknown>>
let mockDecodedToken: Record<string, unknown>
let mockPermission: boolean

class NotFoundError extends Error {
  code = 5
}

function mockDocSnapshot(fields: Record<string, unknown> | undefined) {
  return {
    exists: fields !== undefined,
    data: () => fields,
    get: (field: string) => fields?.[field],
  }
}

function assertNoUndefined(payload: Record<string, unknown>) {
  for (const [key, value] of Object.entries(payload)) {
    // Firestore rejects `undefined` outright. A double that accepts it lets a
    // route ship a write that throws only in production.
    if (value === undefined) {
      throw new Error(`Cannot use "undefined" as a Firestore value (${key})`)
    }
  }
}

const mockOrgRef = {
  get: async () => mockDocSnapshot(org.exists ? org.data : undefined),
  update: async (payload: Record<string, unknown>) => {
    if (!org.exists) throw new NotFoundError('NOT_FOUND: no document to update')
    assertNoUndefined(payload)
    updates.push(payload)
    for (const [path, value] of Object.entries(payload)) {
      if (path.includes('.')) {
        // Dot path: a NESTED write, which is the whole reason the route uses
        // `update()` here rather than `set(..., {merge:true})`.
        const [head, ...rest] = path.split('.')
        const parent = (org.data[head] ??= {})
        let cursor: any = parent
        for (const segment of rest.slice(0, -1)) cursor = cursor[segment] ??= {}
        const leaf = rest[rest.length - 1]
        if (value === mockDELETE) delete cursor[leaf]
        else cursor[leaf] = value
        continue
      }
      if (value === mockDELETE) delete org.data[path]
      else org.data[path] = value
    }
  },
  set: async () => {
    // Deliberately hostile: if the route ever goes back to `set()` for the
    // nested guard delete, the dot path would become a literal field name and
    // the guard would survive while looking deleted.
    throw new Error('the budget route must use update() — see its comments')
  },
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () =>
        mockDocSnapshot(name === 'usage' ? usageDocs[id] : assistDocs[id]),
    }),
  }),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    delete: () => mockDELETE,
    serverTimestamp: () => mockSERVER_TIMESTAMP,
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'orgs') return { doc: () => mockOrgRef }
          if (name === 'adminAudit') {
            return {
              add: async (entry: Record<string, unknown>) => {
                mockAudits.push(entry)
              },
            }
          }
          return { doc: () => ({ get: async () => mockDocSnapshot(undefined) }) }
        },
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: async () => mockPermission,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/billing/usage-budget/route'

const MONTH = new Date().toISOString().slice(0, 7)

async function call(body: Record<string, unknown>) {
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-budget', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: 'acme', ...body }),
    }),
  )
  return { status: response.status, payload: await response.json() }
}

beforeEach(() => {
  delete process.env.BILL_ASSIST_TOKENS_FROM
  org = { exists: true, data: { plan: 'pro' } }
  updates = []
  mockAudits = []
  usageDocs = {}
  assistDocs = {}
  mockPermission = true
  mockDecodedToken = { uid: 'u1', email: 'owner@acme.test', email_verified: true }
})

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await POST(
      new Request('https://app.aglyn.com/api/billing/usage-budget', {
        method: 'POST',
        body: JSON.stringify({ orgId: 'acme', action: 'get' }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('refuses a member without billing.manage', async () => {
    // Forced red by dropping the mockPermission check: any member could set the
    // budget their owner relies on, including setting it absurdly high so the
    // alerts stop arriving.
    mockPermission = false
    expect((await call({ action: 'get' })).status).toBe(403)
  })

  it('refuses an unverified email', async () => {
    mockDecodedToken = { uid: 'u1', email_verified: false }
    expect((await call({ action: 'get' })).status).toBe(403)
  })

  it('rejects an unknown action', async () => {
    expect((await call({ action: 'setCap' })).status).toBe(400)
  })
})

describe('get', () => {
  it('reports no budget for an org that never set one', async () => {
    const { status, payload } = await call({ action: 'get' })
    expect(status).toBe(200)
    expect(payload.budgetSet).toBe(false)
    expect(payload.amountUsd).toBeNull()
    // The form still needs a sensible starting ladder to render.
    expect(payload.defaultThresholdPcts).toEqual([50, 90, 100])
  })

  it('reports the budget and this month’s spend against it', async () => {
    org.data.usageBudget = { amountUsd: 50, thresholdPcts: [25, 100] }
    usageDocs[MONTH] = { month: MONTH, billedCents: 1_250 }
    const { payload } = await call({ action: 'get' })
    expect(payload.budgetSet).toBe(true)
    expect(payload.amountUsd).toBe(50)
    expect(payload.thresholdPcts).toEqual([25, 100])
    expect(payload.spend.meteredUsd).toBeCloseTo(12.5, 5)
    expect(payload.spend.meteredFresh).toBe(true)
  })

  it('says the month is NOT totalled rather than reporting $0', async () => {
    // Forced red by defaulting `meteredFresh` to true: a brand-new org was
    // told it had spent $0.00, which is a claim rather than an absence — and
    // the card renders the two differently on purpose.
    org.data.usageBudget = { amountUsd: 50 }
    const { payload } = await call({ action: 'get' })
    expect(payload.spend.meteredFresh).toBe(false)
    expect(payload.spend.totalUsd).toBe(0)
  })

  it('does NOT count Assist spend the customer is not charged for', async () => {
    org.data.usageBudget = { amountUsd: 50 }
    usageDocs[MONTH] = { month: MONTH, billedCents: 100 }
    assistDocs[MONTH] = { estCostUsd: 30 }
    const { payload } = await call({ action: 'get' })
    expect(payload.spend.assistUsd).toBe(30)
    expect(payload.spend.assistBilled).toBe(false)
    expect(payload.spend.totalUsd).toBeCloseTo(1, 5)
  })
})

describe('setBudget', () => {
  it('rejects an amount outside the legal range', async () => {
    for (const amountUsd of [0, -1, 100_001, 'lots', null]) {
      const { status, payload } = await call({ action: 'setBudget', amountUsd })
      expect(status).toBe(400)
      expect(payload.code).toBe('invalid_amount')
    }
    expect(updates).toHaveLength(0)
  })

  it('stores the amount and the normalized rules', async () => {
    const { status, payload } = await call({
      action: 'setBudget',
      amountUsd: 75,
      thresholdPcts: [100, 50, 50, 'x'],
    })
    expect(status).toBe(200)
    expect(payload.thresholdPcts).toEqual([50, 100])
    expect(org.data.usageBudget.amountUsd).toBe(75)
    expect(org.data.usageBudget.setBy).toBe('u1')
  })

  it('keeps a mistyped percentage from losing the amount', async () => {
    // Coerced, not refused. Rejecting the whole save over a percentage that
    // has a perfectly good default would lose the part that matters.
    const { status, payload } = await call({
      action: 'setBudget',
      amountUsd: 75,
      thresholdPcts: ['nonsense'],
    })
    expect(status).toBe(200)
    expect(payload.thresholdPcts).toEqual([50, 90, 100])
  })

  it('CLEARS the dedupe guard, nested, so a lowered budget can speak', async () => {
    // The subtle one. The guard records "we already told you about 90%",
    // which is a claim about a SPECIFIC amount. Lower $500 to $50 and the
    // recorded 90 would suppress the alert the tighter budget exists to
    // produce — a control that reads as tightened while going quiet.
    //
    // Forced red twice: once by omitting the guard delete (the stale 90
    // survived), and once by writing it through `set(..., {merge:true})`,
    // where the dot path is a LITERAL field name — the double throws on
    // `set()` for exactly that reason.
    org.data.usageAlerts = {
      budget: { month: MONTH, threshold: 90 },
      mediaStorage: { month: MONTH, threshold: 80 },
    }
    await call({ action: 'setBudget', amountUsd: 50 })
    expect(org.data.usageAlerts.budget).toBeUndefined()
    // And ONLY that key — the storage warning's own guard is untouched, or
    // every quota alert on the platform would re-fire on a budget edit.
    expect(org.data.usageAlerts.mediaStorage).toEqual({
      month: MONTH,
      threshold: 80,
    })
  })

  it('writes an audit row', async () => {
    await call({ action: 'setBudget', amountUsd: 50 })
    expect(mockAudits[0].action).toBe('billing.usageBudget.set')
    expect(mockAudits[0].target).toBe('orgs/acme')
  })

  it('404s on an org that does not exist, before writing anything', async () => {
    org = { exists: false, data: {} }
    expect((await call({ action: 'setBudget', amountUsd: 50 })).status).toBe(404)
    expect(updates).toHaveLength(0)
  })
})

describe('clearBudget', () => {
  it('removes the budget and its guard together', async () => {
    org.data.usageBudget = { amountUsd: 50 }
    org.data.usageAlerts = { budget: { month: MONTH, threshold: 100 } }
    const { status, payload } = await call({ action: 'clearBudget' })
    expect(status).toBe(200)
    expect(payload.budgetSet).toBe(false)
    expect(org.data.usageBudget).toBeUndefined()
    expect(org.data.usageAlerts.budget).toBeUndefined()
  })

  it('is available to an org that never set one', async () => {
    // Clearing is never gated. An org that wants the alerts off must not have
    // to argue with a precondition.
    expect((await call({ action: 'clearBudget' })).status).toBe(200)
  })
})
