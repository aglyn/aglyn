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

/**
 * `POST /v1/contacts/{id}/merge` (AGL-2625): the REAL merge behind the
 * route, over the same double every `/v1` contact spec writes to — so what
 * these cases read back is what the console's own merge would have left.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'

let mockScopes: string[] = ['contacts:read', 'contacts:write']
let mockOrg: Record<string, unknown> = {}
const mockLogHostActivity = jest.fn(async () => undefined)

jest.mock('../../../libs/tenant/data/admin/src/lib/server/organizations', () => ({
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...(args as [])),
}))

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
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/contact-company-link',
    ),
    // The REAL merge (AGL-2625): the repoint, the transaction and the index
    // are the properties under test, not a double's idea of them.
    ...jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/contact-merge'),
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
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/contact.types',
  ),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => 'con_x',
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
import { childPaths, mockDocs, resetMockFirestore } from './api-v1-crm-double'

const ORG = 'orgs/org-1'
const CONTACTS = `${ORG}/contacts`
const handlers = { GET, POST, PATCH, DELETE }

function call(
  method: keyof typeof handlers,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
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
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  return handlers[method](request, { params: Promise.resolve({ route: segments }) })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

const LEAD = `hosts/host-2/leads/${personKey('jane@gmail.com')}`

function seed() {
  mockDocs.set(`${CONTACTS}/c-keep`, {
    email: 'jane@acme.com',
    name: 'Jane Doe',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    capturedByHostIds: ['host-1'],
    companyIds: ['co-acme'],
    tags: ['b2b'],
    facets: {
      'host-1': {
        sources: { form: true },
        interactions: [{ type: 'form', atMs: 100, refId: 's1', hostId: 'host-1' }],
        phone: '+15125550100',
        lifecycleStage: 'lead',
      },
    },
  })
  mockDocs.set(`${CONTACTS}/c-gone`, {
    email: 'jane@gmail.com',
    name: 'J Doe',
    hostId: 'host-2',
    visibleTo: ['host:host-2'],
    capturedByHostIds: ['host-2'],
    companyIds: ['co-acme', 'co-bolt'],
    tags: ['newsletter'],
    facets: {
      'host-1': {
        sources: { order: true },
        interactions: [{ type: 'order', atMs: 200, refId: 'o1', hostId: 'host-1' }],
        jobTitle: 'Buyer',
        lifecycleStage: 'customer',
      },
      'host-2': { sources: { newsletter: true }, interactions: [] },
    },
  })
  mockDocs.set(`${ORG}/companies/co-acme`, { name: 'Acme', contactsCount: 2 })
  mockDocs.set(`${ORG}/companies/co-bolt`, { name: 'Bolt', contactsCount: 1 })
  mockDocs.set(`${ORG}/deals/d-1`, { title: 'Renewal', contactId: 'c-gone' })
  mockDocs.set(`${ORG}/crmTasks/t-1`, { title: 'Call', contactId: 'c-gone' })
  mockDocs.set(LEAD, { email: 'jane@gmail.com', convertedContactId: 'c-gone' })
}

beforeEach(() => {
  resetMockFirestore()
  mockScopes = ['contacts:read', 'contacts:write']
  mockLogHostActivity.mockClear()
  mockOrg = {
    plan: 'business',
    subscription: { status: 'active' },
    hosts: { 'host-1': true, 'host-2': true },
  }
  seed()
})

describe('POST /v1/contacts/{id}/merge', () => {
  it('folds the source into the contact in the path and answers the survivor', async () => {
    const response = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone' })
    expect(response.status).toBe(200)
    const view = await json(response)
    expect(view).toMatchObject({
      id: 'c-keep',
      object: 'contact',
      email: 'jane@acme.com',
      name: 'Jane Doe',
      alternateEmails: ['jane@gmail.com'],
      tags: ['b2b', 'newsletter'],
      companyIds: ['co-acme', 'co-bolt'],
      // The organization-wide profile: the first holder that set each field.
      phone: '+15125550100',
      jobTitle: 'Buyer',
      lifecycleStage: 'lead',
    })
    expect(mockDocs.has(`${CONTACTS}/c-gone`)).toBe(false)
    const stored = mockDocs.get(`${CONTACTS}/c-keep`)!
    expect(stored.visibleTo).toEqual(['host:host-1', 'host:host-2'])
    expect((stored.facets as any)['host-1']).toMatchObject({
      sources: { form: true, order: true },
      phone: '+15125550100',
      jobTitle: 'Buyer',
      lifecycleStage: 'lead',
    })
    expect((stored.facets as any)['host-2']).toEqual({
      sources: { newsletter: true },
      interactions: [],
    })
  })

  it('repoints the rows that named the source, indexes both addresses, and settles the counts', async () => {
    await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone' })
    expect(mockDocs.get(`${ORG}/deals/d-1`)?.contactId).toBe('c-keep')
    expect(mockDocs.get(`${ORG}/crmTasks/t-1`)?.contactId).toBe('c-keep')
    expect(mockDocs.get(LEAD)?.convertedContactId).toBe('c-keep')
    for (const email of ['jane@acme.com', 'jane@gmail.com']) {
      expect(mockDocs.get(`${ORG}/emailIndex/${personKey(email)}`)).toMatchObject({
        email,
        contactId: 'c-keep',
      })
    }
    expect(mockDocs.get(`${ORG}/companies/co-acme`)?.contactsCount).toBe(1)
    expect(mockDocs.get(`${ORG}/companies/co-bolt`)?.contactsCount).toBe(1)
    const notes = childPaths(`${ORG}/crmActivities`).map((path) => mockDocs.get(path)!)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      kind: 'note',
      body: 'Merged with jane@gmail.com',
      contactId: 'c-keep',
      byUid: 'api',
      byName: 'API',
    })
    // No site did the work, so no site's feed carries it.
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('reads the survivor back through one site when asked', async () => {
    const response = await call(
      'POST',
      'contacts/c-keep/merge?consentSiteId=host-2',
      { sourceContactId: 'c-gone' },
    )
    expect(response.status).toBe(200)
    const view = await json(response)
    // host-2's own profile of the person carries no phone or title.
    expect(view).toMatchObject({ phone: null, jobTitle: null, alternateEmails: ['jane@gmail.com'] })
  })

  it('names the source field when it is missing, blank, itself, or beside a stray key', async () => {
    const missing = await json(await call('POST', 'contacts/c-keep/merge', {}))
    expect(missing.error.fields.sourceContactId).toMatch(/Required/)
    const blank = await json(await call('POST', 'contacts/c-keep/merge', { sourceContactId: ' ' }))
    expect(blank.error.fields.sourceContactId).toMatch(/Must be a contact id/)
    const self = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-keep' })
    expect(self.status).toBe(400)
    expect((await json(self)).error.fields.sourceContactId).toMatch(/different contact/)
    const stray = await json(
      await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone', name: 'x' }),
    )
    expect(stray.error.fields.name).toBe('Not accepted on a merge')
    expect(mockDocs.has(`${CONTACTS}/c-gone`)).toBe(true)
  })

  it('answers 404 for a missing survivor, and a coded 404 for a missing source', async () => {
    const survivor = await call('POST', 'contacts/c-none/merge', { sourceContactId: 'c-gone' })
    expect(survivor.status).toBe(404)
    expect((await json(survivor)).error.message).toBe('No such contact')
    const source = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-none' })
    expect(source.status).toBe(404)
    expect((await json(source)).error).toMatchObject({
      message: 'No such contact to merge',
      code: 'source_not_found',
    })
    expect(mockDocs.get(`${ORG}/deals/d-1`)?.contactId).toBe('c-gone')
  })

  it('takes POST only on the merge path, and the write scope', async () => {
    const got = await call('GET', 'contacts/c-keep/merge')
    expect(got.status).toBe(405)
    expect(got.headers.get('Allow')).toBe('POST')
    mockScopes = ['contacts:read']
    const denied = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone' })
    expect(denied.status).toBe(403)
    expect((await json(denied)).error.type).toBe('insufficient_scope')
    expect(mockDocs.has(`${CONTACTS}/c-gone`)).toBe(true)
  })

  it('replays the original answer for a retry carrying the same Idempotency-Key', async () => {
    const headers = { 'Idempotency-Key': 'merge-1' }
    const first = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone' }, headers)
    expect(first.status).toBe(200)
    const again = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone' }, headers)
    expect(again.status).toBe(200)
    expect(await json(again)).toEqual(await json(first))
    // Without the key, the source is simply gone.
    const bare = await call('POST', 'contacts/c-keep/merge', { sourceContactId: 'c-gone' })
    expect(bare.status).toBe(404)
  })
})
