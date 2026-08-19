/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * "Your named success manager is copied on every ticket" (AGL-2332).
 *
 * The console said that to Enterprise orgs, and behind it there was a bare
 * `namedManager: true` on the tier table: **no field naming anyone**, and
 * nothing reading the flag at ticket creation. `notifyStaff` raised one
 * generic alert to the whole staff roster, which is the opposite of a named
 * human.
 *
 * The failure mode to avoid was doing it badly — a field nobody populates
 * renders the same sentence with the same nothing behind it, now with a
 * schema implying otherwise. So the properties asserted here are about the
 * claim being KEPT, not about code existing:
 *
 *  - a promised manager who is assigned is **actually emailed**, and the
 *    outcome is stamped on the ticket rather than assumed;
 *  - a tier that promises one with **nobody appointed sends nothing**, and
 *    the console is told the difference so it can stop asserting;
 *  - a tier that promises nothing sends nothing even if someone is assigned;
 *  - the appointment is **staff-only**, and the storage path is one no client
 *    rule reaches — which is checked against the rules file itself, not
 *    asserted in prose.
 *
 * The tier ladder is the REAL `support-tiers` module. Stubbing the gate under
 * test would prove only that this file agrees with itself.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockVerifyIdToken = jest.fn()
const mockNotifyStaff = jest.fn()
const mockSendEmail = jest.fn()
const mockMeterPlatformEmail = jest.fn(async () => undefined)

/** Collection path → docId → data. Subcollections are `a/{id}/b` paths. */
let store: Record<string, Record<string, any>>
let autoId = 0

const snapshot = (id: string, data: any) => ({
  id,
  exists: Boolean(data),
  data: () => data,
  get: (key: string) => data?.[key],
})

function makeQuery(path: string, filter: ((doc: any) => boolean) | null): any {
  const self: any = {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(
        path,
        (doc) => (filter ? filter(doc) : true) && doc?.[field] === value,
      ),
    orderBy: () => makeQuery(path, filter),
    limit: () => self,
    get: async () => {
      const docs = Object.entries(store[path] ?? {})
        .filter(([, data]) => (filter ? filter(data) : true))
        .map(([id, data]) => snapshot(id, data))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
  return self
}

function docRef(path: string, id: string): any {
  return {
    id,
    get: async () => snapshot(id, store[path]?.[id]),
    set: async (data: any, options?: { merge?: boolean }) => {
      store[path] = store[path] ?? {}
      store[path][id] = options?.merge
        ? { ...(store[path][id] ?? {}), ...data }
        : data
    },
    // Modelled because `writeSuccessManager` un-appoints with it, and a
    // double that silently ignored the delete would let "clearing works"
    // pass while the manager stayed assigned.
    delete: async () => {
      if (store[path]) delete store[path][id]
    },
    collection: (sub: string) => collectionRef(`${path}/${id}/${sub}`),
  }
}

function collectionRef(path: string): any {
  const query = makeQuery(path, null)
  return {
    ...query,
    doc: (id?: string) => docRef(path, id ?? `auto-${(autoId += 1)}`),
    add: async (data: any) => {
      const id = `auto-${(autoId += 1)}`
      store[path] = store[path] ?? {}
      store[path][id] = data
      return { id }
    },
  }
}

const MEMBERSHIPS: Record<string, string[]> = {
  'user-ent': ['org-ent'],
  'user-pro': ['org-pro'],
}
const ORG_PLANS: Record<string, string> = {
  'org-ent': 'enterprise',
  'org-pro': 'pro',
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => (global as any).__collectionRef(name),
      }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => ({ toMillis: () => 1_700_000_000_000 }),
        increment: (value: number) => ({ __increment: value }),
      },
      Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  notifyStaff: (...args: unknown[]) => mockNotifyStaff(...args),
  meterPlatformEmail: () => mockMeterPlatformEmail(),
  getOrgForUser: async (uid: string, orgId?: string | null) => {
    const mine = MEMBERSHIPS[uid] ?? []
    const resolved = orgId ?? mine[0] ?? null
    if (!resolved || !mine.includes(resolved)) return null
    return {
      orgId: resolved,
      org: { $id: resolved, name: `Org ${resolved}`, plan: ORG_PLANS[resolved] },
      member: { $id: uid },
    }
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@aglyn/aglyn/server', () => {
  // The REAL ladder — `namedManager` is the gate under test.
  const tiers = jest.requireActual('@aglyn/aglyn/app-utils/support-tiers')
  return {
    __esModule: true,
    ...tiers,
    pluginRequestFromWeb: async (request: Request) => {
      const url = new URL(request.url)
      const raw = await request.text().catch(() => '')
      return {
        method: request.method,
        query: Object.fromEntries(url.searchParams.entries()),
        body: raw ? JSON.parse(raw) : undefined,
        headers: {
          authorization: request.headers.get('authorization') ?? undefined,
        },
      }
    },
  }
})

// Exposed on `global` so the hoisted module factory above can reach the store.
;(global as any).__collectionRef = (name: string) => collectionRef(name)

import {
  GET as ticketsGet,
  PATCH as ticketsPatch,
  POST as ticketsPost,
} from '../app/api/support/tickets/route'
import {
  GET as managerGet,
  POST as managerPost,
} from '../app/api/admin/org-success-manager/route'

type Handler = (request: Request) => Promise<Response>

const call = (
  handler: Handler,
  path: string,
  init: {
    method: string
    token?: string
    query?: Record<string, string>
    body?: unknown
  },
) => {
  const url = new URL(`https://app.aglyn.com${path}`)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return handler(
    new Request(url, {
      method: init.method,
      headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  )
}

const signedInAs = (uid: string, extra: Record<string, unknown> = {}) =>
  mockVerifyIdToken.mockResolvedValue({
    uid,
    email_verified: true,
    email: `${uid}@example.com`,
    ...extra,
  })

/** Appoints a manager directly, as the staff route would have. */
const assignManager = (orgId: string, name = 'Dana Reyes') => {
  store[`orgs/${orgId}/support`] = {
    manager: { name, email: 'dana@aglyn.com' },
  }
}

const openTicket = (uid: string, orgId: string) =>
  call(ticketsPost as Handler, '/api/support/tickets', {
    method: 'POST',
    token: 'tok',
    body: { orgId, subject: 'Checkout is failing', body: 'It 500s.' },
  })

const managerEmails = () =>
  mockSendEmail.mock.calls.map((args) => (args[0] as any).to)

beforeEach(() => {
  jest.clearAllMocks()
  mockSendEmail.mockResolvedValue({ sent: true, id: 'email-1' })
  autoId = 0
  store = {
    supportTickets: {},
    orgs: { 'org-ent': { plan: 'enterprise' }, 'org-pro': { plan: 'pro' } },
    adminAudit: {},
  }
})

describe('the promise is kept when it is made (AGL-2332)', () => {
  it('REGRESSION — an assigned manager is actually emailed on a new ticket', async () => {
    assignManager('org-ent')
    signedInAs('user-ent')
    const response = await openTicket('user-ent', 'org-ent')
    expect(response.status).toBe(200)

    // The sentence in the console says "copied on every ticket". Before this
    // change nothing read `namedManager` here at all.
    expect(managerEmails()).toEqual(['dana@aglyn.com'])
    const sent = mockSendEmail.mock.calls[0][0] as any
    expect(sent.subject).toContain('Checkout is failing')
    expect(sent.text).toContain('Dana Reyes')
    // A platform commitment, metered as one — billing the customer's email
    // allowance to be told what they were promised would be backwards.
    expect(mockMeterPlatformEmail).toHaveBeenCalledTimes(1)
  })

  it('REGRESSION — the outcome is RECORDED on the ticket, not assumed', async () => {
    assignManager('org-ent')
    signedInAs('user-ent')
    await openTicket('user-ent', 'org-ent')
    const ticket = Object.values(store['supportTickets'])[0] as any
    expect(ticket.managerCopy).toEqual({
      email: 'dana@aglyn.com',
      sent: true,
    })
  })

  it('REGRESSION — a send that did NOT happen is recorded as not happening', async () => {
    // `sendEmail` resolves `{ sent: false }` rather than throwing when Resend
    // is unconfigured. A cc whose result is dropped recreates exactly the
    // defect this change repairs: a claim with nothing behind it.
    mockSendEmail.mockResolvedValue({ sent: false, reason: 'unconfigured' })
    assignManager('org-ent')
    signedInAs('user-ent')
    await openTicket('user-ent', 'org-ent')
    const ticket = Object.values(store['supportTickets'])[0] as any
    expect(ticket.managerCopy).toEqual({
      email: 'dana@aglyn.com',
      sent: false,
      reason: 'unconfigured',
    })
  })

  it('copies them on a CUSTOMER reply too — "every ticket" includes follow-ups', async () => {
    assignManager('org-ent')
    signedInAs('user-ent')
    const opened = await openTicket('user-ent', 'org-ent')
    const { ticketId } = await opened.json()
    mockSendEmail.mockClear()

    await call(ticketsPatch as Handler, '/api/support/tickets', {
      method: 'PATCH',
      token: 'tok',
      body: { orgId: 'org-ent', ticketId, body: 'Still failing.' },
    })
    expect(managerEmails()).toEqual(['dana@aglyn.com'])
  })

  it('does NOT copy them on a staff reply — they are the sender, not a recipient', async () => {
    assignManager('org-ent')
    signedInAs('user-ent')
    const { ticketId } = await (await openTicket('user-ent', 'org-ent')).json()
    mockSendEmail.mockClear()

    signedInAs('user-staff', { staff: true })
    await call(ticketsPatch as Handler, '/api/support/tickets', {
      method: 'PATCH',
      token: 'tok',
      body: { ticketId, body: 'Looking now.' },
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('the promise is not faked when it cannot be kept (AGL-2332)', () => {
  it('REGRESSION — a promised manager who is UNASSIGNED sends nothing', async () => {
    // No `assignManager`. The old sentence was rendered off the tier alone,
    // so this org was told a mechanism existed that did not.
    signedInAs('user-ent')
    const response = await openTicket('user-ent', 'org-ent')
    expect(response.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
    const ticket = Object.values(store['supportTickets'])[0] as any
    expect(ticket.managerCopy).toBeUndefined()
  })

  it('the console is told the difference between owed and assigned', async () => {
    signedInAs('user-ent')
    const unassigned = await (
      await call(ticketsGet as Handler, '/api/support/tickets', {
        method: 'GET',
        token: 'tok',
        query: { orgId: 'org-ent' },
      })
    ).json()
    // Null, so the page can say "being assigned" instead of repeating the
    // claim. A route that omitted the key entirely would read the same as a
    // failed load, which is how the original sentence stayed unfalsifiable.
    expect(unassigned.successManager).toBeNull()

    assignManager('org-ent')
    const assigned = await (
      await call(ticketsGet as Handler, '/api/support/tickets', {
        method: 'GET',
        token: 'tok',
        query: { orgId: 'org-ent' },
      })
    ).json()
    expect(assigned.successManager).toEqual({
      name: 'Dana Reyes',
      email: 'dana@aglyn.com',
    })
  })

  it('a tier that promises no manager copies nobody, even with one assigned', async () => {
    assignManager('org-pro')
    signedInAs('user-pro')
    await openTicket('user-pro', 'org-pro')
    expect(mockSendEmail).not.toHaveBeenCalled()

    // …and the customer is not shown one either, so Pro never sees a
    // sentence Enterprise pays for.
    const payload = await (
      await call(ticketsGet as Handler, '/api/support/tickets', {
        method: 'GET',
        token: 'tok',
        query: { orgId: 'org-pro' },
      })
    ).json()
    expect(payload.successManager).toBeNull()
  })
})

describe('appointing a manager is staff-only (AGL-2332)', () => {
  const post = (body: unknown, token = 'tok') =>
    call(managerPost as Handler, '/api/admin/org-success-manager', {
      method: 'POST',
      token,
      body,
    })

  it('REGRESSION — an org OWNER cannot appoint their own success manager', async () => {
    // The whole point of the sentence is that we assigned this person. An
    // org admin who could appoint themselves would make it true about
    // someone we never chose — and the org doc's rules are deny-lists, which
    // is why the field does not live there.
    signedInAs('user-ent')
    const response = await post({
      orgId: 'org-ent',
      name: 'Self Appointed',
      email: 'owner@customer.com',
    })
    expect(response.status).toBe(403)
    expect(store['orgs/org-ent/support']).toBeUndefined()
  })

  it('staff can appoint, and it is audited', async () => {
    signedInAs('user-staff', { staff: true })
    const response = await post({
      orgId: 'org-ent',
      name: 'Dana Reyes',
      email: 'dana@aglyn.com',
    })
    expect(response.status).toBe(200)
    expect(store['orgs/org-ent/support']['manager']).toMatchObject({
      name: 'Dana Reyes',
      email: 'dana@aglyn.com',
      updatedBy: 'user-staff',
    })
    expect(Object.values(store['adminAudit'])[0]).toMatchObject({
      action: 'org.successManagerSet',
      target: 'orgs/org-ent/support/manager',
    })
  })

  it('clearing the email un-appoints them — the claim comes back down', async () => {
    signedInAs('user-staff', { staff: true })
    await post({ orgId: 'org-ent', name: 'Dana Reyes', email: 'dana@aglyn.com' })
    await post({ orgId: 'org-ent', name: '', email: '' })
    expect(store['orgs/org-ent/support']['manager']).toBeUndefined()

    // And the customer stops being told about them.
    signedInAs('user-ent')
    const payload = await (
      await call(ticketsGet as Handler, '/api/support/tickets', {
        method: 'GET',
        token: 'tok',
        query: { orgId: 'org-ent' },
      })
    ).json()
    expect(payload.successManager).toBeNull()
  })

  it('refuses an address with no name — a NAMED manager needs a name', async () => {
    signedInAs('user-staff', { staff: true })
    const response = await post({
      orgId: 'org-ent',
      name: '',
      email: 'dana@aglyn.com',
    })
    expect(response.status).toBe(400)
    expect(store['orgs/org-ent/support']).toBeUndefined()
  })

  it('refuses a malformed address rather than mailing into the void', async () => {
    signedInAs('user-staff', { staff: true })
    const response = await post({
      orgId: 'org-ent',
      name: 'Dana',
      email: 'dana(at)aglyn',
    })
    expect(response.status).toBe(400)
  })

  it('reports whether the tier OWES a manager, so staff can see the gap', async () => {
    signedInAs('user-staff', { staff: true })
    const owed = await (
      await call(managerGet as Handler, '/api/admin/org-success-manager', {
        method: 'GET',
        token: 'tok',
        query: { orgId: 'org-ent' },
      })
    ).json()
    expect(owed).toEqual({ manager: null, promised: true })

    const notOwed = await (
      await call(managerGet as Handler, '/api/admin/org-success-manager', {
        method: 'GET',
        token: 'tok',
        query: { orgId: 'org-pro' },
      })
    ).json()
    expect(notOwed.promised).toBe(false)
  })
})

describe('the storage path is out of every client rule (AGL-2332)', () => {
  /**
   * Not prose. The staff-only guarantee rests on `orgs/{orgId}/support/**`
   * having no `match` block and no wildcard above it — Firestore denies an
   * unmatched path, which is why this needed no rules edit and therefore has
   * no deploy-ordering window. If someone later adds a `{document=**}` under
   * `orgs`, this becomes a customer-writable field that mails an arbitrary
   * address, and the failure would be silent everywhere else.
   */
  const rules = readFileSync(
    join(__dirname, '../../../cloud/firebase-firestore.rules'),
    'utf8',
  )
  const orgBlock = (() => {
    const start = rules.indexOf('match /orgs/{orgId} {')
    expect(start).toBeGreaterThan(-1)
    const end = rules.indexOf('\n    match /orgSlugs/{slug}', start)
    expect(end).toBeGreaterThan(start)
    return rules.slice(start, end)
  })()

  it('read the real rules file — an empty string would pass everything', () => {
    expect(rules.length).toBeGreaterThan(10_000)
    expect(orgBlock.length).toBeGreaterThan(5_000)
    // A control that cannot see its own subject proves nothing: pin that
    // this slice really is the org block by a rule known to be inside it.
    expect(orgBlock).toMatch(/match\s+\/members\/\{memberUid\}/)
    expect(orgBlock).toMatch(/match\s+\/datasets\/\{datasetId\}/)
  })

  it('has no `support` subcollection rule', () => {
    expect(orgBlock).not.toMatch(/match\s+\/support\//)
  })

  it('has no recursive wildcard that would reach it', () => {
    expect(orgBlock).not.toMatch(/match\s+\/\{[A-Za-z]+=\*\*\}/)
    expect(orgBlock).not.toMatch(/match\s+\/\{[A-Za-z]+\}\/\{document=\*\*\}/)
  })
})
