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
 * AGL-2606 — a contact's CRM profile over `/v1`: `phone`, `jobTitle`,
 * `companyId`, `address`, `ownerUid` and `lifecycleStage`.
 *
 * The profile lives on a FACET — one holder's knowledge of the person, under
 * `facets.{groupId}` — and the assertions that carry weight are the ones
 * about where a write landed, not what came back:
 *
 *  - a PATCH must write dotted paths into the named site's facet and leave
 *    every other holder's facet exactly as it was;
 *  - `companyId` must keep the top-level `companyIds` twin in step, because
 *    that array is the only thing `?companyId=` can query;
 *  - `?lifecycleStage=` and `?ownerUid=` cannot be Firestore clauses, so the
 *    double's record of every `where()` proves they never become one.
 */

let mockScopes: string[] = ['contacts:read', 'contacts:write']
let mockOrg: Record<string, unknown> = {}
let mockUidSeq = 0

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const double = jest.requireActual('./api-v1-crm-double')
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
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
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL facet helpers, the REAL consent groups and the REAL normalizers:
  // "the profile lands on the holder's facet" is the property under test, and
  // `contactFacetPath` is how the console gets there.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/crm'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/contact.types',
  ),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => `con_${++mockUidSeq}`,
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

import { DELETE, GET, PATCH, POST } from '../app/api/v1/[[...route]]/route'
import { lastFilters, mockDocs, resetMockFirestore } from './api-v1-crm-double'

const CONTACTS = 'orgs/org-1/contacts'
const handlers = { GET, POST, PATCH, DELETE }

function call(method: keyof typeof handlers, path: string, body?: unknown) {
  const [pathname, search] = path.split('?')
  const segments = pathname.split('/').filter(Boolean)
  const request = new Request(
    `https://app.aglyn.com/api/v1/${pathname}${search ? `?${search}` : ''}`,
    {
      method,
      headers: {
        authorization: 'Bearer aglyn_sk_test',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  return handlers[method](request, { params: Promise.resolve({ route: segments }) })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

const PROFILE = {
  phone: '(512) 555-0123',
  jobTitle: 'Head of Beans',
  companyId: 'co-acme',
  address: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us' },
  ownerUid: 'u-owner',
  lifecycleStage: 'customer',
}

beforeEach(() => {
  resetMockFirestore()
  mockUidSeq = 0
  mockScopes = ['contacts:read', 'contacts:write']
  // host-1 and host-2 are two brands of one agency; host-3 pools with host-1
  // under a declared consent group, so a write through host-3 lands on the
  // GROUP's facet and not on a facet of its own.
  mockOrg = {
    plan: 'business',
    subscription: { status: 'active' },
    hosts: { 'host-1': true, 'host-2': true, 'host-3': true },
    consentGroups: { 'grp-a': { name: 'Group A', hostIds: ['host-1', 'host-3'] } },
  }
  mockDocs.set('orgs/org-1/members/u-owner', { role: 'admin' })
  mockDocs.set('orgs/org-1/companies/co-acme', { name: 'Acme' })
  mockDocs.set('orgs/org-1/companies/co-bolt', { name: 'Bolt' })
})

describe('POST /v1/contacts with a CRM profile', () => {
  it('files the profile on the named site’s facet, normalized, and nowhere else', async () => {
    const response = await call('POST', 'contacts', {
      email: 'robin@example.com',
      consentSiteId: 'host-1',
      ...PROFILE,
    })
    expect(response.status).toBe(201)
    const view = await json(response)
    expect(view).toMatchObject({
      phone: '+15125550123',
      jobTitle: 'Head of Beans',
      companyId: 'co-acme',
      address: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      ownerUid: 'u-owner',
      lifecycleStage: 'customer',
      companyIds: ['co-acme'],
    })
    const stored = mockDocs.get(`${CONTACTS}/${view.id}`)!
    // Under the GROUP host-1 belongs to, the way a capture on host-1 files.
    const facets = stored.facets as Record<string, Record<string, unknown>>
    expect(Object.keys(facets)).toEqual(['grp-a'])
    expect(facets['grp-a']).toMatchObject({
      phone: '+15125550123',
      lifecycleStage: 'customer',
      companyId: 'co-acme',
      sources: { api: true },
    })
    expect(stored.companyIds).toEqual(['co-acme'])
    // Never at the top of the document, where every holder would read it.
    for (const field of ['phone', 'jobTitle', 'companyId', 'address', 'ownerUid', 'lifecycleStage']) {
      expect(stored).not.toHaveProperty(field)
    }
    // The consent fields are untouched by a write that carried no consent.
    expect(stored).not.toHaveProperty('marketingConsent')
  })

  it('requires the site a profile field is written for', async () => {
    const response = await call('POST', 'contacts', {
      email: 'robin@example.com',
      phone: '+15125550123',
    })
    expect(response.status).toBe(400)
    expect((await json(response)).error.fields.consentSiteId).toMatch(
      /Required with a CRM profile field/,
    )
    // The site alone, with nothing for it to qualify, is still refused.
    const alone = await call('POST', 'contacts', {
      email: 'robin@example.com',
      consentSiteId: 'host-1',
    })
    expect((await json(alone)).error.fields.consentSiteId).toMatch(/Only accepted alongside/)
    // Beside a refusal the site is accepted — it names the facet.
    const refused = await call('POST', 'contacts', {
      email: 'robin@example.com',
      marketingConsent: false,
      consentSiteId: 'host-2',
      jobTitle: 'CTO',
    })
    expect(refused.status).toBe(201)
    expect(mockDocs.get(`${CONTACTS}/${(await json(refused)).id}`)).toMatchObject({
      marketingConsent: false,
      facets: { 'host-2': { jobTitle: 'CTO' } },
    })
  })

  it('names each value that does not survive its normalizer or its lookup', async () => {
    const response = await call('POST', 'contacts', {
      email: 'robin@example.com',
      consentSiteId: 'host-1',
      phone: '555',
      lifecycleStage: 'customers',
      address: 'Austin',
    })
    expect(response.status).toBe(400)
    const { fields } = (await json(response)).error
    expect(Object.keys(fields).sort()).toEqual(['address', 'lifecycleStage', 'phone'])
    expect(fields.lifecycleStage).toMatch(/subscriber, lead, .*customer/)
    // The reads happen only once the grammar passes, and each names its field.
    const refs = await call('POST', 'contacts', {
      email: 'robin@example.com',
      consentSiteId: 'host-1',
      ownerUid: 'u-stranger',
      companyId: 'co-missing',
    })
    expect((await json(refs)).error.fields).toEqual({
      ownerUid: 'Must be a member of this organization',
      companyId: 'No such company in this organization',
    })
    expect([...mockDocs.keys()].filter((key) => key.startsWith(`${CONTACTS}/`))).toEqual([])
  })

  it('stores a blank address as none at all', async () => {
    const view = await json(
      await call('POST', 'contacts', {
        email: 'robin@example.com',
        consentSiteId: 'host-2',
        address: { line1: '', city: ' ' },
        jobTitle: 'CTO',
      }),
    )
    expect(view.address).toBeNull()
    expect(mockDocs.get(`${CONTACTS}/${view.id}`)!.facets).toEqual({
      'host-2': { sources: { api: true }, interactions: [], jobTitle: 'CTO' },
    })
  })
})

describe('PATCH /v1/contacts/{id} with a CRM profile', () => {
  const seed = () => {
    mockDocs.set(`${CONTACTS}/c-1`, {
      email: 'robin@example.com',
      companyIds: ['co-acme', 'co-other'],
      facets: {
        'grp-a': { sources: {}, interactions: [], phone: '+15125550123', companyId: 'co-acme' },
        'host-2': { sources: {}, interactions: [], phone: '+15125550999', lifecycleStage: 'lead' },
      },
    })
  }

  it('writes dotted paths into the named facet and leaves the other holder alone', async () => {
    seed()
    const response = await call('PATCH', 'contacts/c-1', {
      consentSiteId: 'host-3',
      jobTitle: 'CTO',
      phone: null,
      lifecycleStage: 'opportunity',
    })
    expect(response.status).toBe(200)
    const stored = mockDocs.get(`${CONTACTS}/c-1`)!
    const facets = stored.facets as Record<string, Record<string, unknown>>
    // host-3 pools with host-1: the write landed on the group's facet.
    expect(facets['grp-a']).toEqual({
      sources: {},
      interactions: [],
      companyId: 'co-acme',
      jobTitle: 'CTO',
      lifecycleStage: 'opportunity',
    })
    expect(facets['host-2']).toEqual({
      sources: {},
      interactions: [],
      phone: '+15125550999',
      lifecycleStage: 'lead',
    })
    // Read back through the site that wrote: its profile, not host-2's phone.
    expect(await json(response)).toMatchObject({
      phone: null,
      jobTitle: 'CTO',
      lifecycleStage: 'opportunity',
      companyId: 'co-acme',
    })
  })

  it('keeps companyIds in step: a move removes the old id unless another holder has it', async () => {
    seed()
    await call('PATCH', 'contacts/c-1', { consentSiteId: 'host-1', companyId: 'co-bolt' })
    let stored = mockDocs.get(`${CONTACTS}/c-1`)!
    // co-acme left (nobody else filed the person under it); co-other, put
    // there by some other surface, stayed; co-bolt joined.
    expect(stored.companyIds).toEqual(['co-other', 'co-bolt'])
    expect((stored.facets as any)['grp-a'].companyId).toBe('co-bolt')

    // host-2 now files them under co-bolt too; grp-a clearing keeps the id.
    await call('PATCH', 'contacts/c-1', { consentSiteId: 'host-2', companyId: 'co-bolt' })
    await call('PATCH', 'contacts/c-1', { consentSiteId: 'host-1', companyId: null })
    stored = mockDocs.get(`${CONTACTS}/c-1`)!
    expect(stored.companyIds).toEqual(['co-other', 'co-bolt'])
    expect((stored.facets as any)['grp-a']).not.toHaveProperty('companyId')
  })

  it('refuses a profile field with no site, and a site the org does not own', async () => {
    seed()
    const none = await call('PATCH', 'contacts/c-1', { phone: '+15125550123' })
    expect(none.status).toBe(400)
    expect((await json(none)).error.fields).toHaveProperty('consentSiteId')
    const foreign = await call('PATCH', 'contacts/c-1', {
      consentSiteId: 'not-ours',
      phone: '+15125550123',
    })
    expect((await json(foreign)).error.fields).toEqual({
      consentSiteId: 'No such site in this organization',
    })
    expect(mockDocs.get(`${CONTACTS}/c-1`)!.facets).toMatchObject({
      'grp-a': { phone: '+15125550123' },
    })
  })
})

describe('reading the profile', () => {
  beforeEach(() => {
    mockDocs.set(`${CONTACTS}/c-1`, {
      email: 'robin@example.com',
      tags: ['vip'],
      companyIds: ['co-acme'],
      facets: {
        'host-2': { sources: {}, interactions: [], phone: '+15125550999', ownerUid: 'u-owner' },
        'grp-a': { sources: {}, interactions: [], lifecycleStage: 'customer', companyId: 'co-acme' },
      },
    })
    mockDocs.set(`${CONTACTS}/c-2`, {
      email: 'sam@example.com',
      facets: { 'grp-a': { sources: {}, interactions: [], lifecycleStage: 'lead', ownerUid: 'u-owner' } },
    })
    mockDocs.set(`${CONTACTS}/c-3`, { email: 'kit@example.com', tags: ['vip'] })
  })

  it('publishes the union across holders, in stable holder order', async () => {
    const view = await json(await call('GET', 'contacts/c-1'))
    expect(view).toMatchObject({
      phone: '+15125550999',
      ownerUid: 'u-owner',
      lifecycleStage: 'customer',
      companyId: 'co-acme',
      jobTitle: null,
      address: null,
      companyIds: ['co-acme'],
    })
  })

  it('publishes one holder’s profile when ?consentSiteId= names its site', async () => {
    const view = await json(await call('GET', 'contacts/c-1?consentSiteId=host-1'))
    expect(view).toMatchObject({
      phone: null,
      ownerUid: null,
      lifecycleStage: 'customer',
      companyId: 'co-acme',
    })
    const bad = await call('GET', 'contacts/c-1?consentSiteId=not-ours')
    expect(bad.status).toBe(400)
    expect((await json(bad)).error.fields).toHaveProperty('consentSiteId')
  })

  it('filters by company with one indexed clause on companyIds', async () => {
    const page = await json(await call('GET', 'contacts?companyId=co-acme'))
    expect(page.data.map((row: any) => row.id)).toEqual(['c-1'])
    expect(lastFilters()).toEqual([
      { field: 'companyIds', op: 'array-contains', value: 'co-acme' },
    ])
    // Beside a tag, the company is the clause and the tag is checked on the page.
    const both = await json(await call('GET', 'contacts?companyId=co-acme&tag=vip'))
    expect(both.data.map((row: any) => row.id)).toEqual(['c-1'])
    expect(lastFilters()).toHaveLength(1)
    expect(lastFilters()[0].field).toBe('companyIds')
    // Beside an email, the email is the clause.
    const withEmail = await json(
      await call('GET', 'contacts?companyId=co-acme&email=kit%40example.com'),
    )
    expect(withEmail.data).toEqual([])
    expect(lastFilters()).toEqual([{ field: 'email', op: '==', value: 'kit@example.com' }])
  })

  it('filters facet fields on the page, never as a clause', async () => {
    const stage = await json(await call('GET', 'contacts?lifecycleStage=lead'))
    expect(stage.data.map((row: any) => row.id)).toEqual(['c-2'])
    expect(lastFilters()).toEqual([])
    const owner = await json(await call('GET', 'contacts?ownerUid=u-owner'))
    expect(owner.data.map((row: any) => row.id)).toEqual(['c-1', 'c-2'])
    expect(lastFilters()).toEqual([])
    // Against the named site's facet alone: host-1's group never set an owner
    // on c-1, so c-1 drops out.
    const scoped = await json(
      await call('GET', 'contacts?ownerUid=u-owner&consentSiteId=host-1'),
    )
    expect(scoped.data.map((row: any) => row.id)).toEqual(['c-2'])
    const bad = await call('GET', 'contacts?lifecycleStage=customers')
    expect(bad.status).toBe(400)
    expect((await json(bad)).error.fields.lifecycleStage).toMatch(/Must be one of/)
  })
})
