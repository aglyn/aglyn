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
 * AGL-2627 — `/v1/leads`: the work queue over the API, and the conversion
 * through the one function the console's own dialog goes through.
 *
 * ## What each block has to prove, and what would make it lie
 *
 * - **The site.** A lead's id is only unique within its site, so every
 *   endpoint must refuse a request that names none, or one the organization
 *   does not own — and the refusal must name `siteId`.
 * - **The order and the page.** Newest `lastSeen` first, a cursor that does
 *   not replay or skip a row, and a `status` filter that finds the lead
 *   carrying NO status field — the one a `where` would miss. The double
 *   records every `where()`, so the suite can also assert that no clause
 *   reached Firestore: a composite index nobody shipped would pass a double
 *   that ignored the count and `500` in production.
 * - **The status machine.** `qualified` is refused with the pointer to the
 *   conversion, a converted lead's status is fixed, and a reason travels
 *   with `unqualified` alone.
 * - **The conversion is the console's.** The REAL `convertHostLead` runs
 *   against the store, with only the two runtime doors doubled — the capture
 *   (which plants the row the real one would) and the owner assignment. So
 *   the company, the deal and the stamp on the lead are what the dialog
 *   would have written, with `'api'` where the dialog writes a uid, and the
 *   contact's owner is what the api actor rule says: nobody, unless somebody
 *   was named or a rule assigned.
 */

let mockScopes: string[] = ['crm:read', 'crm:write']
/** The name the organization gave the key; null models a key the double did not name. */
let mockKeyName: string | null = null
let mockOrg: Record<string, unknown> = {}
let mockUidSeq = 0
/** Whether the capture door plants a contact; off models a band-full drop. */
let mockCapturePlants = true
const mockCapture = jest.fn()
const mockAssignOwner = jest.fn()
const mockNotifyAssigned = jest.fn()
const mockLogActivity = jest.fn()
let mockAssignment: Record<string, unknown> = { outcome: 'none', reason: 'no-rule' }

/*
 * The lead silo is org-scoped (AGL-3275), and the real capture door this spec
 * drives reaches it by RELATIVE path — so these two are doubled here as well
 * as on the barrel above, or `addHostLead` resolves a live Firebase app.
 */

jest.mock('../../../libs/tenant/data/admin/src/lib/server/organizations', () => {
  const consentGroups = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/consent-groups',
  )
  const double = jest.requireActual('./api-v1-crm-double')
  return {
    __esModule: true,
    // What the seam inside `host-visitor-records` resolves (AGL-3275).
    orgDataCollectionForHost: async (_hostId: string, name: string) =>
      double.mockFirestore.collection('orgs').doc('org-1').collection(name),
    resolveOrgIdForHost: async () => 'org-1',
    consentGroupForSite: async (hostId: string) => consentGroups.soloConsentGroup(hostId),
    scopedToHost: (ref: any, hostId: string) =>
      ref.where('visibleTo', 'array-contains-any', ['org', `host:${hostId}`]),
  }
})

jest.mock('../../../libs/tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  // The LEGACY host path behind the seam's carry: empty in this suite.
  default: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const double = jest.requireActual('./api-v1-crm-double')
  const consentGroups = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/consent-groups',
  )
  return {
    __esModule: true,
    ...apiHttp,
    // The REAL records band (AGL-2611) and the REAL contact–company link
    // writer (AGL-2613), over the same double the conversion writes to.
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/crm-records',
    ),
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/contact-company-link',
    ),
    // The real address lookup (AGL-2625): the index first, the query second.
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/contact-email-index',
    ),
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
      ...(mockKeyName ? { name: mockKeyName } : {}),
    }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => double.mockFirestore }),
      firestore: { FieldValue: double.mockFieldValue },
    },
    // The roster, as the owner-by-address resolution reads it.
    listOrgMembers: async (orgId: string) =>
      double
        .childPaths(`orgs/${orgId}/members`)
        .map((path: string) => ({
          $id: path.slice(path.lastIndexOf('/') + 1),
          ...double.mockDocs.get(path),
        })),
    // The real resolution's answer for an org that declared no pooling.
    consentGroupForSite: async (hostId: string, org: Record<string, unknown>) =>
      consentGroups.consentGroupForHost(org, hostId),
    orgDataCollectionForHost: async (_hostId: string, name: string) =>
      double.mockFirestore.collection('orgs').doc('org-1').collection(name),
    logHostActivity: (...args: unknown[]) => mockLogActivity(...args),
    // The real lead door — see the create's note above.
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/host-visitor-records',
    ),
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/crm'),
  // The custom-field reader both verbs judge a lead's map with (AGL-3272).
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/contact-custom-fields'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/name-search'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/person-key'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/visitor-record-ceiling'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/contact.types',
  ),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => `id_${++mockUidSeq}`,
}))

jest.mock('firebase-admin/firestore', () => {
  const double = jest.requireActual('./api-v1-crm-double')
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: double.MockTimestamp,
    FieldValue: double.mockFieldValue,
  }
})

/*
 * The two runtime doors the conversion walks through, doubled at the
 * modules the runtime's `convertHostLead` reaches them by. The capture
 * plants the contact the real door would — found by address under the org,
 * with the facet the call named — because the conversion's contract with it
 * is "call me, then find the row by email", and a double that returned an
 * id would let the code skip the lookup the real function forces on it.
 */
/*
 * The lead door (AGL-3231): `POST /v1/leads` writes through the real
 * `addHostLead`, so the create is judged on what the door leaves — the
 * person-key id, the `capturedByHostIds` stamp, no basis. Its two side
 * effects on the way past are stubbed: no campaign touch travels with an
 * API create, and nothing here trips the platform ceiling.
 */
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/campaign-conversion-attribution',
  () => ({
    __esModule: true,
    attributeCampaignConversion: jest.fn(async () => undefined),
  }),
)
jest.mock('../../../libs/tenant/data/admin/src/lib/server/notifications', () => ({
  __esModule: true,
  notifyHostManagers: jest.fn(async () => undefined),
}))

jest.mock('../../../libs/tenant/runtime/src/lib/capture-host-contact', () => ({
  __esModule: true,
  captureHostContact: (...args: unknown[]) => mockCapture(...args),
}))
jest.mock('../../../libs/tenant/runtime/src/lib/assign-contact-owner', () => ({
  __esModule: true,
  assignOwnerForCapture: (...args: unknown[]) => mockAssignOwner(...args),
  notifyRecordAssigned: (...args: unknown[]) => mockNotifyAssigned(...args),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  consentGroupForHost,
  soloConsentGroup,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { crmScopeTokens, DEFAULT_DEAL_STAGES } from '@aglyn/aglyn/app-utils/crm'
import { marketingConsentFieldsForGroup } from '@aglyn/aglyn/app-utils/marketing-consent'
import { DELETE, GET, PATCH, POST } from '../app/api/v1/[[...route]]/route'
import {
  childPaths,
  lastFilters,
  mockClock,
  mockCollectionRef,
  mockDocs,
  resetMockFirestore,
} from './api-v1-crm-double'

const readSource = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', '..', '..', ...parts), 'utf8')

const ORG = 'orgs/org-1'
const HOST = 'host-1'
const LEADS = `${ORG}/leads`
const COMPANIES = `${ORG}/companies`
const DEALS = `${ORG}/deals`
const PIPELINES = `${ORG}/pipelines`
const CONTACTS = `${ORG}/contacts`

const handlers = { GET, POST, PATCH, DELETE }

function call(
  method: keyof typeof handlers,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
) {
  const [pathname, search] = path.split('?')
  const segments = pathname.split('/').filter(Boolean)
  const request = new Request(
    `https://app.aglyn.com/api/v1/${pathname}${search ? `?${search}` : ''}`,
    {
      method,
      headers: {
        authorization: 'Bearer aglyn_sk_test',
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  return handlers[method](request, { params: Promise.resolve({ route: segments }) })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

/** The tokens the REAL model stamps for a record created from `hostId`. */
const tokensFor = (hostId: string) =>
  crmScopeTokens(mockOrg, consentGroupForHost(mockOrg, hostId))

/** A lead as `addHostLead` leaves one: no working state at all. */
/*
 * `visibleTo` names the capturing site (AGL-3275). The collection is org-wide
 * now, so the list selects by scope rather than by the collection's parent —
 * and a lead carrying no scope is visible to nobody, which is the direction
 * both enforcement layers fail in.
 */
const captured = (email: string, lastSeenAtMs: number, extra: Record<string, unknown> = {}) => ({
  email,
  sources: ['signup'],
  submissionCount: 1,
  firstSeenAtMs: lastSeenAtMs - 1_000,
  lastSeenAtMs,
  visibleTo: [`host:${HOST}`],
  ...extra,
})

const all = (collectionPath: string): Array<Record<string, any>> =>
  childPaths(collectionPath).map((path) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    ...mockDocs.get(path),
  }))

beforeEach(() => {
  resetMockFirestore()
  mockUidSeq = 0
  mockScopes = ['crm:read', 'crm:write']
  mockKeyName = null
  mockOrg = {
    plan: 'business',
    subscription: { status: 'active' },
    hosts: { 'host-1': true, 'host-2': true },
  }
  mockCapturePlants = true
  mockAssignment = { outcome: 'none', reason: 'no-rule' }
  mockCapture.mockReset()
  mockCapture.mockImplementation(async (options: Record<string, any>) => {
    if (!mockCapturePlants) return
    const contacts = mockCollectionRef(CONTACTS)
    const found = await contacts.where('email', '==', options.email).limit(1).get()
    if (!found.empty) return
    await contacts.add({
      email: options.email,
      ...(options.name ? { name: options.name } : {}),
      hostId: options.hostId,
      visibleTo: tokensFor(options.hostId),
      facets: {
        [options.hostId]: {
          sources: { [options.source]: true },
          interactions: [],
          ...(options.facet ?? {}),
        },
      },
    })
  })
  mockAssignOwner.mockReset()
  mockAssignOwner.mockImplementation(async () => mockAssignment)
  mockNotifyAssigned.mockReset()
  mockNotifyAssigned.mockResolvedValue(true)
  mockLogActivity.mockReset()
  mockLogActivity.mockResolvedValue(undefined)
  mockDocs.set(`${ORG}/members/u-owner`, { role: 'admin', email: 'owner@example.com' })
  mockDocs.set(`${ORG}/members/u-rep`, { role: 'editor', email: 'Rep@Example.com' })
  mockDocs.set(`${LEADS}/lead-a`, captured('ann@acme.com', 3_000, { name: 'Ann Lee' }))
  mockDocs.set(`${LEADS}/lead-b`, captured('bo@acme.com', 2_000, { status: 'working', ownerUid: 'u-rep' }))
  mockDocs.set(`${LEADS}/lead-c`, captured('cy@acme.com', 1_000))
})

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise', () => {
  it('enforces the CRM scopes and advertises the resource at the root', async () => {
    const source = readSource('apps/console/utils/api-v1/crm-leads.ts')
    expect(source).toContain("requireScope(ctx, 'crm:read')")
    expect(source).toContain("requireScope(ctx, 'crm:write')")
    const root = await json(await call('GET', ''))
    expect(root.resources).toContain('leads')
  })

  it('is gated by the suite before scope, and by scope before method', async () => {
    mockOrg = { ...mockOrg, entitlements: { features: { crm: false } } }
    const gated = await call('GET', `leads?siteId=${HOST}`)
    expect(gated.status).toBe(403)
    expect((await json(gated)).error).toMatchObject({ type: 'plan_required', code: 'crm' })

    mockOrg = { plan: 'business', subscription: { status: 'active' }, hosts: { [HOST]: true } }
    mockScopes = ['crm:read']
    const denied = await call('PATCH', `leads/lead-a?siteId=${HOST}`, { status: 'working' })
    expect(denied.status).toBe(403)
    expect((await json(denied)).error).toMatchObject({
      type: 'insufficient_scope',
      code: 'crm:write',
    })
    mockScopes = ['contacts:read']
    expect((await call('GET', `leads?siteId=${HOST}`)).status).toBe(403)
  })

  it('answers the verbs each path takes, and nothing else', async () => {
    const remove = await call('DELETE', 'leads')
    expect(remove.status).toBe(405)
    expect(remove.headers.get('Allow')).toBe('GET, POST')
    const removeOne = await call('DELETE', `leads/lead-a?siteId=${HOST}`)
    expect(removeOne.status).toBe(405)
    expect(removeOne.headers.get('Allow')).toBe('GET, PATCH')
    const read = await call('GET', `leads/lead-a/convert?siteId=${HOST}`)
    expect(read.status).toBe(405)
    expect(read.headers.get('Allow')).toBe('POST')
    expect((await call('POST', `leads/lead-a/merge?siteId=${HOST}`, {})).status).toBe(404)
  })
})

// ── The site ────────────────────────────────────────────────────────────────

describe('the site every request names', () => {
  it('refuses a request that names no site, on every endpoint, by the field', async () => {
    for (const [method, path, body] of [
      ['GET', 'leads', undefined],
      ['GET', 'leads/lead-a', undefined],
      ['PATCH', 'leads/lead-a', { status: 'working' }],
      ['POST', 'leads/lead-a/convert', {}],
      ['POST', 'leads', { email: 'new@acme.com' }],
    ] as const) {
      const response = await call(method, path, body)
      expect(`${method} ${path}: ${response.status}`).toBe(`${method} ${path}: 400`)
      expect((await json(response)).error).toMatchObject({
        code: 'validation_failed',
        fields: { siteId: expect.stringContaining('Required') },
      })
    }
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBeUndefined()
  })

  it('refuses a site the organization does not own, and takes the body’s site on a write', async () => {
    const foreign = await call('GET', 'leads?siteId=host-9')
    expect(foreign.status).toBe(400)
    expect((await json(foreign)).error.fields).toEqual({
      siteId: 'No such site in this organization',
    })
    const bodied = await call('PATCH', 'leads/lead-a', { siteId: HOST, status: 'working' })
    expect(bodied.status).toBe(200)
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBe('working')
  })
})

// ── The list ────────────────────────────────────────────────────────────────

describe('GET /v1/leads', () => {
  it('lists newest lastSeen first, narrowed to the site by scope (AGL-3275)', async () => {
    /*
     * This asserted NO clause reached Firestore, which was right while the
     * collection was the site's own: the path did the narrowing. On the org
     * collection the scope clause IS the narrowing, and its absence would
     * serve one site a sibling's leads — so the clause is the claim now.
     */
    const page = await json(await call('GET', `leads?siteId=${HOST}`))
    expect(page.data.map((lead: any) => lead.id)).toEqual(['lead-a', 'lead-b', 'lead-c'])
    expect(page.has_more).toBe(false)
    expect(lastFilters()).toEqual([
      { field: 'visibleTo', op: 'array-contains-any', value: ['org', `host:${HOST}`] },
    ])
  })

  it('publishes the capture and the working state, reading an absent status as new', async () => {
    mockDocs.set(`${LEADS}/lead-a`, {
      ...captured('ann@acme.com', 3_000, { name: 'Ann Lee' }),
      ...marketingConsentFieldsForGroup(soloConsentGroup(HOST), 2_500),
    })
    const lead = await json(await call('GET', `leads/lead-a?siteId=${HOST}`))
    expect(lead).toEqual({
      id: 'lead-a',
      object: 'lead',
      siteId: HOST,
      email: 'ann@acme.com',
      name: 'Ann Lee',
      status: 'new',
      ownerUid: null,
      notes: null,
      unqualifiedReason: null,
      company: null,
      jobTitle: null,
      phone: null,
      website: null,
      address: null,
      tags: [],
      leadSource: null,
      sources: ['signup'],
      submissionCount: 1,
      firstSeen: new Date(2_000).toISOString(),
      lastSeen: new Date(3_000).toISOString(),
      marketingConsent: true,
      marketingConsentAt: new Date(2_500).toISOString(),
      convertedContactId: null,
      convertedAt: null,
      companyId: null,
      dealId: null,
      // The org's own lead fields (AGL-3272) — `{}` on a lead that carries
      // none, so a client can index it without a guard.
      custom: {},
      created: null,
      updated: null,
    })
    const bare = await json(await call('GET', `leads/lead-c?siteId=${HOST}`))
    expect(bare.marketingConsent).toBe(false)
    expect(bare.marketingConsentAt).toBeNull()
    expect((await call('GET', `leads/nope?siteId=${HOST}`)).status).toBe(404)
  })

  it('pages with a cursor that neither replays nor skips a row', async () => {
    const first = await json(await call('GET', `leads?siteId=${HOST}&limit=2`))
    expect(first.data.map((lead: any) => lead.id)).toEqual(['lead-a', 'lead-b'])
    expect(first.has_more).toBe(true)
    const second = await json(
      await call('GET', `leads?siteId=${HOST}&limit=2&cursor=${first.next_cursor}`),
    )
    expect(second.data.map((lead: any) => lead.id)).toEqual(['lead-c'])
    expect(second.has_more).toBe(false)
    expect(second.next_cursor).toBeNull()
  })

  it('breaks a lastSeen tie by id, so two leads seen in one instant both list once', async () => {
    mockDocs.set(`${LEADS}/lead-b`, captured('bo@acme.com', 3_000))
    const first = await json(await call('GET', `leads?siteId=${HOST}&limit=1`))
    const second = await json(
      await call('GET', `leads?siteId=${HOST}&limit=1&cursor=${first.next_cursor}`),
    )
    const third = await json(
      await call('GET', `leads?siteId=${HOST}&limit=1&cursor=${second.next_cursor}`),
    )
    expect([first, second, third].map((page) => page.data[0].id).sort()).toEqual([
      'lead-a',
      'lead-b',
      'lead-c',
    ])
  })

  it('filters status on the page — finding the lead that carries no status field', async () => {
    const fresh = await json(await call('GET', `leads?siteId=${HOST}&status=new`))
    expect(fresh.data.map((lead: any) => lead.id)).toEqual(['lead-a', 'lead-c'])
    const working = await json(await call('GET', `leads?siteId=${HOST}&status=working`))
    expect(working.data.map((lead: any) => lead.id)).toEqual(['lead-b'])
    // On the page, not in the query: no STATUS equality reached Firestore.
    // The scope clause is there and has to be — see the list test above.
    expect(lastFilters().filter((clause: any) => clause.field !== 'visibleTo')).toEqual([])

    const owned = await json(await call('GET', `leads?siteId=${HOST}&ownerUid=u-rep`))
    expect(owned.data.map((lead: any) => lead.id)).toEqual(['lead-b'])

    const bogus = await call('GET', `leads?siteId=${HOST}&status=hot`)
    expect(bogus.status).toBe(400)
    expect((await json(bogus)).error.fields).toEqual({
      status: 'Must be one of: new, working, qualified, unqualified',
    })
  })

  it('reads one site alone — a sibling site’s leads are not in the page', async () => {
    // Held by the sibling site only: one collection, told apart by scope.
    mockDocs.set(`${ORG}/leads/lead-z`, {
      ...captured('zed@acme.com', 9_000),
      visibleTo: ['host:host-2'],
    })
    const page = await json(await call('GET', `leads?siteId=${HOST}`))
    expect(page.data.map((lead: any) => lead.id)).not.toContain('lead-z')
    const other = await json(await call('GET', 'leads?siteId=host-2'))
    expect(other.data.map((lead: any) => lead.id)).toEqual(['lead-z'])
  })
})

// ── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /v1/leads/{id}', () => {
  const patch = (id: string, body: unknown) => call('PATCH', `leads/${id}?siteId=${HOST}`, body)

  it('refuses the converted status, an unknown status and an unknown key, by the field', async () => {
    const qualified = await patch('lead-a', { status: 'qualified' })
    expect(qualified.status).toBe(400)
    expect((await json(qualified)).error.fields).toEqual({
      status: expect.stringContaining('POST /v1/leads/{id}/convert'),
    })
    const unknown = await patch('lead-a', { status: 'hot', email: 'x@y.z' })
    expect((await json(unknown)).error.fields).toEqual({
      status: 'Must be one of: new, working, unqualified',
      email: 'Not writable on a lead',
    })
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBeUndefined()
    expect((await patch('nope', { status: 'working' })).status).toBe(404)
  })

  it('writes the status and the notes, stamps updated, and clears a note with null', async () => {
    mockClock.nowMs = 1_760_000_100_000
    const moved = await json(await patch('lead-a', { status: 'working', notes: ' Called twice ' }))
    expect(moved).toMatchObject({ status: 'working', notes: 'Called twice' })
    expect(moved.updated).toBe(new Date(1_760_000_100_000).toISOString())
    expect(mockDocs.get(`${LEADS}/lead-a`)).toMatchObject({
      status: 'working',
      notes: 'Called twice',
      // What the capture door wrote is still there — the write is an update.
      sources: ['signup'],
    })
    const cleared = await json(await patch('lead-a', { notes: null }))
    expect(cleared.notes).toBeNull()
    expect('notes' in (mockDocs.get(`${LEADS}/lead-a`) ?? {})).toBe(false)
  })

  it('requires a reason to unqualify, keeps it with the state, and drops it on reopening', async () => {
    const bare = await patch('lead-a', { status: 'unqualified' })
    expect(bare.status).toBe(400)
    expect((await json(bare)).error.fields).toEqual({
      unqualifiedReason: 'A reason is required to mark a lead unqualified',
    })
    const misplaced = await patch('lead-a', { status: 'working', unqualifiedReason: 'Wrong fit' })
    expect((await json(misplaced)).error.fields).toEqual({
      unqualifiedReason: 'Only an unqualified lead carries a reason',
    })

    const closed = await json(
      await patch('lead-a', { status: 'unqualified', unqualifiedReason: 'Wrong fit' }),
    )
    expect(closed).toMatchObject({ status: 'unqualified', unqualifiedReason: 'Wrong fit' })
    // The reason alone, on a lead already closed, replaces it.
    const reworded = await json(await patch('lead-a', { unqualifiedReason: 'Out of region' }))
    expect(reworded.unqualifiedReason).toBe('Out of region')

    const reopened = await json(await patch('lead-a', { status: 'working' }))
    expect(reopened).toMatchObject({ status: 'working', unqualifiedReason: null })
    expect('unqualifiedReason' in (mockDocs.get(`${LEADS}/lead-a`) ?? {})).toBe(false)
  })

  it('resolves ownerEmail against the roster, checks ownerUid against it, and clears with null', async () => {
    const byAddress = await json(await patch('lead-a', { ownerEmail: 'rep@example.com' }))
    expect(byAddress.ownerUid).toBe('u-rep')

    const stranger = await patch('lead-a', { ownerEmail: 'nobody@example.com' })
    expect(stranger.status).toBe(400)
    expect((await json(stranger)).error.fields).toEqual({
      ownerEmail: 'No member of this organization has this address',
    })
    const notAnAddress = await patch('lead-a', { ownerEmail: 'u-rep' })
    expect((await json(notAnAddress)).error.fields).toEqual({
      ownerEmail: 'Must be an email address',
    })
    const both = await patch('lead-a', { ownerUid: 'u-rep', ownerEmail: 'rep@example.com' })
    expect((await json(both)).error.fields).toEqual({
      ownerEmail: expect.stringContaining('not both'),
    })
    const outsider = await patch('lead-a', { ownerUid: 'u-stranger' })
    expect((await json(outsider)).error.fields).toEqual({
      ownerUid: 'Must be a member of this organization',
    })
    expect(mockDocs.get(`${LEADS}/lead-a`)?.ownerUid).toBe('u-rep')

    const cleared = await json(await patch('lead-a', { ownerUid: null }))
    expect(cleared.ownerUid).toBeNull()
    expect('ownerUid' in (mockDocs.get(`${LEADS}/lead-a`) ?? {})).toBe(false)
  })

  it('fixes the status of a converted lead and still takes its notes', async () => {
    mockDocs.set(`${LEADS}/lead-a`, {
      ...captured('ann@acme.com', 3_000),
      status: 'qualified',
      convertedContactId: 'c-1',
    })
    const moved = await patch('lead-a', { status: 'working' })
    expect(moved.status).toBe(409)
    expect((await json(moved)).error).toMatchObject({ type: 'conflict', code: 'lead_converted' })
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBe('qualified')
    const noted = await json(await patch('lead-a', { notes: 'Big account' }))
    expect(noted).toMatchObject({ status: 'qualified', notes: 'Big account' })
  })

  it('treats {} as a no-op', async () => {
    const before = { ...mockDocs.get(`${LEADS}/lead-a`) }
    const response = await patch('lead-a', {})
    expect(response.status).toBe(200)
    expect(mockDocs.get(`${LEADS}/lead-a`)).toEqual(before)
  })
})

// ── Convert ─────────────────────────────────────────────────────────────────

// ── Create ──────────────────────────────────────────────────────────────────

describe('POST /v1/leads', () => {
  /**
   * The lead's own record (AGL-3231): the door's id and stamp, the profile
   * as the model stores it, the working state beside it — and no contact,
   * no company, no basis.
   */
  it('creates a lead through the door, with the profile and the working state', async () => {
    const response = await call('POST', `leads?siteId=${HOST}`, {
      email: '  Dana@ACME.com ',
      name: 'Dana Marsh',
      company: 'Acme Brands',
      jobTitle: 'CMO',
      phone: '(512) 555-0107',
      website: 'acme.com',
      address: { city: 'Austin', country: 'us' },
      tags: ['ICP2', 'a-list'],
      leadSource: 'Sales Navigator',
      status: 'working',
      ownerEmail: 'rep@example.com',
      notes: 'Met at the show',
    })
    expect(response.status).toBe(201)
    const lead = await json(response)
    const { personKey } = jest.requireActual('../../../libs/aglyn/src/lib/app-utils/person-key')
    expect(lead).toMatchObject({
      id: personKey('dana@acme.com'),
      object: 'lead',
      siteId: HOST,
      email: 'dana@acme.com',
      name: 'Dana Marsh',
      status: 'working',
      ownerUid: 'u-rep',
      notes: 'Met at the show',
      company: 'Acme Brands',
      jobTitle: 'CMO',
      phone: '+15125550107',
      website: 'https://acme.com/',
      address: { city: 'Austin', country: 'US' },
      tags: ['icp2', 'a-list'],
      leadSource: 'Sales Navigator',
      sources: ['api'],
      submissionCount: 1,
      marketingConsent: false,
    })
    const stored = mockDocs.get(`${LEADS}/${lead.id}`)
    expect(stored?.capturedByHostIds).toEqual([HOST])
    // Scoped like every other org row (AGL-3275). This asserted ABSENCE while
    // the collection was the site's own and the path was the scope; a lead
    // with no `visibleTo` would now be a row visible to nobody.
    expect(stored?.visibleTo).toEqual([`host:${HOST}`])
    expect(all(CONTACTS)).toEqual([])
    expect(all(COMPANIES)).toEqual([])
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('updates the lead the site already holds for the address, and answers 200', async () => {
    // Keyed the way the door keys every lead: by the person key.
    const { personKey } = jest.requireActual('../../../libs/aglyn/src/lib/app-utils/person-key')
    const id = personKey('ann@acme.com')
    mockDocs.set(`${LEADS}/${id}`, captured('ann@acme.com', 3_000, { name: 'Ann Lee' }))
    const response = await call('POST', `leads?siteId=${HOST}`, {
      email: 'ann@acme.com',
      company: 'Acme',
    })
    expect(response.status).toBe(200)
    const lead = await json(response)
    expect(lead.id).toBe(id)
    expect(lead.company).toBe('Acme')
    expect(lead.name).toBe('Ann Lee')
    expect(lead.sources).toEqual(['signup', 'api'])
    expect(lead.submissionCount).toBe(2)
  })

  it('refuses a malformed body by the field, before any write', async () => {
    const response = await call('POST', `leads?siteId=${HOST}`, {
      email: 'nope',
      phone: 'call me',
      website: 'javascript:x',
      status: 'qualified',
      unqualifiedReason: 'x',
      foo: 1,
    })
    expect(response.status).toBe(400)
    const fields = (await json(response)).error.fields
    expect(Object.keys(fields).sort()).toEqual([
      'email',
      'foo',
      'phone',
      'status',
      'unqualifiedReason',
      'website',
    ])
    expect(all(LEADS)).toHaveLength(3)
  })

  it('replays a settled Idempotency-Key with the original lead', async () => {
    const first = await call('POST', `leads?siteId=${HOST}`, { email: 'new@acme.com' }, 'k-1')
    expect(first.status).toBe(201)
    const again = await call('POST', `leads?siteId=${HOST}`, { email: 'new@acme.com' }, 'k-1')
    expect(again.status).toBe(201)
    expect((await json(again)).id).toBe((await json(first)).id)
    expect(all(LEADS)).toHaveLength(4)
  })
})

describe('PATCH /v1/leads/{id} — the profile', () => {
  it('writes the profile as the model stores it, and clears a field with null', async () => {
    mockDocs.set(`${LEADS}/lead-a`, {
      ...captured('ann@acme.com', 3_000, { name: 'Ann Lee', jobTitle: 'CMO', tags: ['warm'] }),
    })
    const response = await call('PATCH', `leads/lead-a?siteId=${HOST}`, {
      company: ' Acme  Brands ',
      jobTitle: null,
      phone: '5125550107',
      tags: 'icp2, a-list',
    })
    expect(response.status).toBe(200)
    const lead = await json(response)
    expect(lead).toMatchObject({
      company: 'Acme Brands',
      jobTitle: null,
      phone: '+15125550107',
      tags: ['icp2', 'a-list'],
    })
    expect(mockDocs.get(`${LEADS}/lead-a`)).not.toHaveProperty('jobTitle')
  })

  it('refuses a phone or a website it cannot hold, under the field', async () => {
    const response = await call('PATCH', `leads/lead-a?siteId=${HOST}`, {
      phone: 'call me',
      website: 'javascript:x',
    })
    expect(response.status).toBe(400)
    expect(Object.keys((await json(response)).error.fields).sort()).toEqual(['phone', 'website'])
  })
})

/*
 * THE ORG'S OWN LEAD FIELDS OVER THE WIRE (AGL-3272). One collection holds
 * every object's definitions, so what both verbs have to get right is
 * WHICH of them a lead's map is judged against — and that the view
 * publishes `{}` rather than nothing on a lead that carries none.
 */
describe('custom fields on leads (AGL-3272)', () => {
  const FIELDS = `${ORG}/contactFields`
  /** Two definitions sharing one key, one per object — a body can only pass against its own. */
  const seedFields = () => {
    mockDocs.set(`${FIELDS}/f-contact-region`, {
      key: 'region',
      label: 'Region',
      type: 'text',
      order: 0,
      visibleTo: ['org'],
      hostId: HOST,
    })
    mockDocs.set(`${FIELDS}/f-lead-region`, {
      key: 'region',
      label: 'Region',
      type: 'select',
      options: ['west', 'east'],
      order: 0,
      object: 'lead',
      visibleTo: ['org'],
      hostId: HOST,
    })
    mockDocs.set(`${FIELDS}/f-lead-retired`, {
      key: 'old_tier',
      label: 'Old tier',
      type: 'text',
      order: 1,
      object: 'lead',
      retiredAt: 1,
      visibleTo: ['org'],
      hostId: HOST,
    })
  }

  it('stores a map judged against the LEAD definitions, and publishes it', async () => {
    seedFields()
    const created = await json(
      await call('POST', `leads?siteId=${HOST}`, {
        email: 'dana@acme.com',
        custom: { region: 'west' },
      }),
    )
    expect(created.custom).toEqual({ region: 'west' })
    expect(mockDocs.get(`${LEADS}/${created.id}`)!.custom).toEqual({ region: 'west' })
    // A lead without a map publishes `{}`, never `null` — a client can
    // index it without a guard — and stores no key at all.
    const bare = await json(await call('POST', `leads?siteId=${HOST}`, { email: 'bare@acme.com' }))
    expect(bare.custom).toEqual({})
    expect(mockDocs.get(`${LEADS}/${bare.id}`)).not.toHaveProperty('custom')
  })

  it('refuses what the CONTACT field would allow, an unknown key and a retired one', async () => {
    seedFields()
    // `north` is a fine TEXT value for the contact `region` — and refused
    // here, because a lead's `region` is a choice of two.
    const refused = await json(
      await call('POST', `leads?siteId=${HOST}`, {
        email: 'dana@acme.com',
        custom: { region: 'north' },
      }),
    )
    expect(Object.keys(refused.error.fields)).toEqual(['custom.region'])
    const others = await json(
      await call('POST', `leads?siteId=${HOST}`, {
        email: 'dana@acme.com',
        custom: { nope: 'x', old_tier: 'gold' },
      }),
    )
    expect(Object.keys(others.error.fields).sort()).toEqual(['custom.nope', 'custom.old_tier'])
    // Nothing was written to retry against: a refused key never reaches
    // the door, so no lead was filed for the address.
    const { personKey } = jest.requireActual('../../../libs/aglyn/src/lib/app-utils/person-key')
    expect(mockDocs.get(`${LEADS}/${personKey('dana@acme.com')}`)).toBeUndefined()
  })

  it('merges a PATCH into the map rather than replacing it, and clears with null', async () => {
    seedFields()
    mockDocs.set(`${LEADS}/lead-a`, {
      ...captured('ann@acme.com', 3_000, { name: 'Ann Lee' }),
      custom: { region: 'west', kept: 'yes' },
    })
    const patched = await json(
      await call('PATCH', `leads/lead-a?siteId=${HOST}`, { custom: { region: 'east' } }),
    )
    expect(patched.custom).toEqual({ region: 'east', kept: 'yes' })
    const cleared = await json(
      await call('PATCH', `leads/lead-a?siteId=${HOST}`, { custom: { region: null } }),
    )
    // `null` is an explicit nothing that keeps the key present, which is
    // the shape a `where` clause can find.
    expect(cleared.custom).toEqual({ region: null, kept: 'yes' })
  })
})

describe('POST /v1/leads/{id}/convert', () => {
  const convert = (id: string, body: unknown, key?: string) =>
    call('POST', `leads/${id}/convert?siteId=${HOST}`, body, key)

  it('refuses a malformed body by the nested field, before any write', async () => {
    const shapes = await convert('lead-a', {
      company: { link: 'co-1', create: { name: 'Acme' } },
      deal: { title: '  ', amountCents: 12.5, currency: 'US', stageId: '' },
      ownerUid: 'u-rep',
      notes: 'x',
    })
    expect(shapes.status).toBe(400)
    expect((await json(shapes)).error.fields).toEqual({
      company: expect.stringContaining('exactly one'),
      'deal.title': 'A title is required',
      'deal.amountCents': 'Must be a whole number of cents, 0 or more',
      'deal.currency': 'Must be a three-letter ISO 4217 code, like usd',
      'deal.stageId': 'Must be a stage id',
      notes: 'Not writable on a conversion',
    })
    const domain = await convert('lead-a', { company: { create: { name: 'Acme', domain: 'acme' } } })
    expect((await json(domain)).error.fields).toEqual({
      'company.create.domain': 'Must be a domain, like acme.com',
    })
    expect(mockCapture).not.toHaveBeenCalled()
    expect((await convert('nope', {})).status).toBe(404)
  })

  it('converts through the console’s own function: contact, company, deal, then the lead', async () => {
    const response = await convert('lead-a', {
      company: { create: { name: '  Acme Coffee ', domain: 'https://www.Acme.com/about' } },
      deal: { title: 'Acme — first order', amountCents: 12_500, currency: 'USD' },
    })
    expect(response.status).toBe(201)
    const receipt = await json(response)

    // 1. The contact, through the capture door, as a sales record.
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith({
      hostId: HOST,
      email: 'ann@acme.com',
      name: 'Ann Lee',
      source: 'manual',
      interaction: { summary: 'Converted from a lead', refId: 'lead-a' },
      facet: { lifecycleStage: 'sales-qualified' },
    })
    const [contact] = all(CONTACTS)

    // 2. The company — stamped as a REST create would be, in the site's scope.
    const [company] = all(COMPANIES)
    expect(company).toMatchObject({
      name: 'Acme Coffee',
      domain: 'acme.com',
      visibleTo: tokensFor(HOST),
      hostId: HOST,
      createdByUid: 'api',
      contactsCount: 1,
    })
    expect(company.ownerUid).toBeUndefined()
    expect(contact.companyIds).toEqual([company.id])

    // 3. The deal, in the Sales pipeline seeded for an org that had none.
    const [pipeline] = all(PIPELINES)
    expect(pipeline).toMatchObject({ name: 'Sales', isDefault: true, createdByUid: 'api' })
    expect(pipeline.stages).toEqual(DEFAULT_DEAL_STAGES)
    const [deal] = all(DEALS)
    expect(deal).toMatchObject({
      title: 'Acme — first order',
      pipelineId: pipeline.id,
      stageId: 'qualified',
      status: 'open',
      amountCents: 12_500,
      currency: 'usd',
      contactId: contact.id,
      companyId: company.id,
      visibleTo: tokensFor(HOST),
      createdByUid: 'api',
    })

    // 4. The lead, stamped last — and owned by nobody: a key is not a person.
    expect(mockDocs.get(`${LEADS}/lead-a`)).toMatchObject({
      status: 'qualified',
      convertedContactId: contact.id,
      companyId: company.id,
      dealId: deal.id,
      sources: ['signup'],
    })
    expect(mockDocs.get(`${LEADS}/lead-a`)?.ownerUid).toBeUndefined()
    expect(contact.facets[HOST].ownerUid).toBeUndefined()
    expect(mockAssignOwner).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: contact.id, source: 'manual', actorUid: null }),
    )
    expect(mockNotifyAssigned).not.toHaveBeenCalled()

    // The audit line, attributed to the API.
    expect(mockLogActivity).toHaveBeenCalledWith(
      HOST,
      { uid: 'api', email: null },
      'Converted lead',
      { type: 'lead', id: 'lead-a', name: 'Ann Lee' },
    )

    expect(receipt).toEqual({
      object: 'lead_conversion',
      id: 'lead-a',
      siteId: HOST,
      contactId: contact.id,
      companyId: company.id,
      dealId: deal.id,
      alreadyConverted: false,
      lead: expect.objectContaining({
        id: 'lead-a',
        status: 'qualified',
        convertedContactId: contact.id,
        dealId: deal.id,
      }),
    })
  })

  /*
   * The audit line names the KEY (AGL-2632). `{ uid: 'api', email: null }`
   * renders as "Someone" in every feed, and three integrations then read as
   * one nobody; the key's name is what the organization gave it, and the
   * feed shows it as "API key Zapier".
   */
  it('attributes the conversion to the key by name', async () => {
    mockKeyName = 'Zapier'
    await convert('lead-a', {})
    expect(mockLogActivity).toHaveBeenCalledWith(
      HOST,
      { uid: 'api', email: null, apiKeyName: 'Zapier' },
      'Converted lead',
      { type: 'lead', id: 'lead-a', name: 'Ann Lee' },
    )
  })

  it('hands a named owner to the capture and tells them, by address as by uid', async () => {
    await convert('lead-a', { ownerEmail: 'rep@example.com' })
    expect(mockCapture.mock.calls[0][0].facet).toEqual({
      lifecycleStage: 'sales-qualified',
      ownerUid: 'u-rep',
    })
    const [contact] = all(CONTACTS)
    expect(mockNotifyAssigned).toHaveBeenCalledWith({
      hostId: HOST,
      orgId: 'org-1',
      ownerUid: 'u-rep',
      actorUid: null,
      record: { kind: 'contact', id: contact.id },
      who: 'Ann Lee',
    })
    expect(mockDocs.get(`${LEADS}/lead-a`)?.ownerUid).toBe('u-rep')
    // A person chose, so the rules were not asked.
    expect(mockAssignOwner).not.toHaveBeenCalled()

    const stranger = await convert('lead-c', { ownerUid: 'u-stranger' })
    expect(stranger.status).toBe(400)
    expect((await json(stranger)).error.fields).toEqual({
      ownerUid: 'Must be a member of this organization',
    })
  })

  it('lets the org’s rules own a contact nobody named, and prefers the lead’s own owner', async () => {
    mockAssignment = { outcome: 'assigned', ownerUid: 'u-owner', by: 'rule' }
    await convert('lead-a', { deal: { title: 'Acme' } })
    expect(mockDocs.get(`${LEADS}/lead-a`)?.ownerUid).toBe('u-owner')
    expect(all(DEALS)[0].ownerUid).toBe('u-owner')

    await convert('lead-b', {})
    expect(mockCapture.mock.calls[1][0].facet.ownerUid).toBe('u-rep')
  })

  it('links a company by id, and refuses one that does not exist by the field', async () => {
    mockDocs.set(`${COMPANIES}/co-1`, { name: 'Acme', visibleTo: tokensFor(HOST) })
    const missing = await convert('lead-a', { company: { link: 'co-nope' } })
    expect(missing.status).toBe(400)
    expect((await json(missing)).error.fields).toEqual({
      'company.link': 'No such company in this organization',
    })
    // The contact exists — the capture ran — but the lead is untouched.
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBeUndefined()

    const linked = await json(await convert('lead-a', { company: { link: 'co-1' } }))
    expect(linked.companyId).toBe('co-1')
    expect(all(CONTACTS)).toHaveLength(1)
    expect(mockDocs.get(`${COMPANIES}/co-1`)?.contactsCount).toBe(1)
  })

  it('answers 200 with the same ids on a second call and creates nothing more', async () => {
    const first = await json(await convert('lead-a', { deal: { title: 'Acme' } }))
    const second = await convert('lead-a', { deal: { title: 'Acme again' } })
    expect(second.status).toBe(200)
    expect(await json(second)).toMatchObject({
      contactId: first.contactId,
      dealId: first.dealId,
      alreadyConverted: true,
    })
    expect(all(DEALS)).toHaveLength(1)
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
  })

  it('replays a settled Idempotency-Key with the original receipt', async () => {
    const first = await convert('lead-a', { deal: { title: 'Acme' } }, 'convert-1')
    expect(first.status).toBe(201)
    const replay = await convert('lead-a', { deal: { title: 'Acme' } }, 'convert-1')
    expect(replay.status).toBe(200)
    expect(await json(replay)).toEqual(await json(first))
    expect(mockCapture).toHaveBeenCalledTimes(1)
  })

  it('refuses at the records band with the creates’ own code, and gives the key back', async () => {
    // A Free org granted the suite and the API by staff, banded at two: the
    // seeded contact and a company fill it, and the company this conversion
    // would create is the next record.
    mockOrg = {
      plan: 'free',
      hosts: { [HOST]: true },
      entitlements: {
        contactsPerHost: 2,
        apiRequestsPerMonth: 1_000,
        features: { crm: true, apiAccess: true },
      },
    }
    mockDocs.set(`${COMPANIES}/co-seed`, { name: 'Seed', visibleTo: ['org'] })
    mockDocs.set(`${CONTACTS}/c-seed`, { email: 'seed@acme.com' })
    const refused = await convert(
      'lead-a',
      { company: { create: { name: 'Acme' } } },
      'convert-band',
    )
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toMatchObject({
      type: 'plan_required',
      code: 'crm_records_quota',
    })
    expect(all(COMPANIES)).toHaveLength(1)
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBeUndefined()

    mockOrg = { ...mockOrg, entitlements: { ...(mockOrg.entitlements as object), contactsPerHost: 10 } }
    const retry = await convert(
      'lead-a',
      { company: { create: { name: 'Acme' } } },
      'convert-band',
    )
    expect(retry.status).toBe(201)
  })

  it('answers the states the data can be in — no address, no contact — as conflicts', async () => {
    mockDocs.set(`${LEADS}/lead-bad`, { email: 'not an address', lastSeenAtMs: 1 })
    const noEmail = await convert('lead-bad', {})
    expect(noEmail.status).toBe(409)
    expect((await json(noEmail)).error.code).toBe('lead_not_convertible')

    mockCapturePlants = false
    const dropped = await convert('lead-a', { deal: { title: 'Acme' } })
    expect(dropped.status).toBe(409)
    expect((await json(dropped)).error.code).toBe('contact_not_created')
    expect(all(DEALS)).toHaveLength(0)
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBeUndefined()
  })

  /*
   * An erased person is its own conflict (AGL-2632): `contact_not_created`
   * tells an integration the band may be full, and an integration told
   * that retries after an upgrade — against a decision no plan lifts.
   */
  it('answers an erased person as its own conflict, and changes nothing', async () => {
    mockCapture.mockImplementationOnce(async () => ({ refused: 'erased' }))
    const erased = await convert('lead-a', { deal: { title: 'Acme' } })
    expect(erased.status).toBe(409)
    expect((await json(erased)).error.code).toBe('person_erased')
    expect(all(CONTACTS)).toHaveLength(0)
    expect(all(DEALS)).toHaveLength(0)
    expect(mockDocs.get(`${LEADS}/lead-a`)?.status).toBeUndefined()
    expect(mockLogActivity).not.toHaveBeenCalled()
  })
})

// ── Usage ───────────────────────────────────────────────────────────────────

describe('GET /v1/usage', () => {
  it('sizes the organization’s leads in one count (AGL-3275)', async () => {
    /*
     * This summed one count per site, and seeded a lead under a second site
     * to prove the fan-out reached it. The collection is the org's now, so
     * the size is a single count — and a sum would report a lead two brands
     * in a consent group both hold twice.
     */
    mockDocs.set(`${ORG}/leads/lead-z`, captured('zed@acme.com', 9_000))
    const usage = await json(await call('GET', 'usage'))
    expect(usage.crm.leads).toMatchObject({ used: 4, included: null, remaining: null })
  })
})
