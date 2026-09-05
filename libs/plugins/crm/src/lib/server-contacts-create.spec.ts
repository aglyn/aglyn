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
 * `crm/contacts-create` — a person added by hand (AGL-2596).
 *
 * What the route is FOR is one call to `upsertHostContact` with
 * `source: 'manual'` and the typed profile in `facet`, so most of what is
 * pinned here is the shape of that call and the shape of the answer:
 *
 *  1. THE GATE. No token is a 401; a member without `data.manage` is a 403;
 *     a member who does not reach the site is a 403 too, because the rules
 *     would refuse their browser and a route must not be the way round.
 *  2. THE FIELDS. A bad email or phone number is a 400 with a sentence; a
 *     good one reaches the upsert normalized, and the stage only when it is
 *     one of the list's.
 *  3. THE EXTRAS. Tags and the company name are not upsert inputs, so they
 *     are written by DOTTED path into the capturing group's facet after it
 *     — and the company name is echoed to the top for the search.
 *  4. THE ANSWER. `created` from a fresh row, `created: false` from a merge
 *     onto an existing address, and the list's own band sentence as a 409.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { resolvePluginApiRoute } from '@aglyn/aglyn/server'

/** The signed-in caller, as the token double answers. */
let mockDecoded: Record<string, unknown> = { uid: 'user-1', email: 'me@acme.test' }
/** The member document the org holds for the caller, or none. */
let mockMember: Record<string, unknown> | null = {
  $id: 'user-1',
  role: 'editor',
  allHosts: true,
}
let mockHasPermission = true
let mockUpsertResult: Record<string, unknown> = {
  contactId: 'con-new',
  created: true,
}
const mockUpsert = jest.fn(async () => mockUpsertResult)
const mockUpdate = jest.fn(async () => undefined)
/** The org's companies, by id, as the picker's choice is checked against them. */
let mockCompanies: Record<string, Record<string, unknown>> = {}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  // The route captures through the runtime wrapper so `contactCreated` fires
  // (AGL-2605); the double answers the verdict the case under test needs.
  captureHostContact: (...args: unknown[]) => mockUpsert(...(args as [])),
  emitHostEvent: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      // `orgs/{orgId}/companies/{companyId}` — the one document the route
      // reads before it writes anything.
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: (id: string) => ({
                get: async () => ({
                  exists: id in mockCompanies,
                  get: (field: string) => mockCompanies[id]?.[field],
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-1' ? { orgId: 'org-1', org: { plan: 'starter' } } : null,
  resolveOrgMembership: async () =>
    mockMember ? { orgId: 'org-1', member: mockMember } : null,
  memberHasOrgPermission: async () => mockHasPermission,
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  orgDataCollectionForHost: async () => ({
    doc: (id: string) => ({
      id,
      update: (...args: unknown[]) => mockUpdate(...(args as [])),
    }),
  }),
  upsertHostContact: (...args: unknown[]) => mockUpsert(...(args as [])),
}))

import { CONTACT_BAND_FULL_MESSAGE, registerCrmConsoleApi } from './server'

async function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer token' },
  method = 'POST',
) {
  registerCrmConsoleApi()
  const handler = resolvePluginApiRoute('crm/contacts-create')
  expect(handler).toBeDefined()
  let status = 0
  let payload: any
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    send: () => undefined,
    setHeader: () => undefined,
    redirect: () => undefined,
    end: () => undefined,
  }
  await handler?.(
    { method, query: {}, body, headers, cookies: {}, socket: {} },
    res,
  )
  return { status, payload }
}

const GOOD = {
  hostId: 'host-1',
  email: 'Ada@Example.test',
  name: 'Ada Lovelace',
  phone: '(512) 555-0107',
  jobTitle: 'Engineer',
  companyName: 'Analytical Engines',
  address: { line1: '1 Main St', city: 'Austin', country: 'us' },
  ownerUid: 'owner-1',
  lifecycleStage: 'lead',
  tags: ['VIP', ' vip ', 'beta'],
  marketingConsent: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDecoded = { uid: 'user-1', email: 'me@acme.test' }
  mockMember = { $id: 'user-1', role: 'editor', allHosts: true }
  mockHasPermission = true
  mockUpsertResult = { contactId: 'con-new', created: true }
  mockCompanies = {
    'co-acme': { name: 'Acme Corporation', visibleTo: ['host:host-1'] },
    'co-hidden': { name: 'Other client', visibleTo: ['host:host-9'] },
  }
})

/**
 * The picker's company (AGL-2613): checked for existence and visibility
 * before anything is written, handed to the upsert as the facet's
 * `companyId` — where the link is kept in step with its mirror and count —
 * and named on the record by the company's own stored name.
 */
describe('the company', () => {
  it('passes a visible company to the upsert and echoes its stored name', async () => {
    await post({ ...GOOD, companyId: 'co-acme', companyName: 'whatever the form said' })
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options.facet.companyId).toBe('co-acme')
    const [patch] = mockUpdate.mock.calls[0] as unknown as [Record<string, any>]
    expect(patch['facets.host-1.companyName']).toBe('Acme Corporation')
    expect(patch['companyName']).toBe('Acme Corporation')
  })

  it('refuses a company that does not exist, before the upsert', async () => {
    const { status, payload } = await post({ ...GOOD, companyId: 'co-nope' })
    expect(status).toBe(404)
    expect(payload.error).toMatch(/company/i)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a company the capturing site cannot see, as if it did not exist', async () => {
    const { status } = await post({ ...GOOD, companyId: 'co-hidden' })
    expect(status).toBe(404)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('hands the upsert no company when none was picked', async () => {
    await post(GOOD)
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options.facet).not.toHaveProperty('companyId')
  })
})

describe('the gate', () => {
  it('refuses any method but POST', async () => {
    const { status } = await post(GOOD, { authorization: 'Bearer t' }, 'GET')
    expect(status).toBe(405)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a caller with no token', async () => {
    const { status } = await post(GOOD, {})
    expect(status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a member without data.manage', async () => {
    mockHasPermission = false
    const { status, payload } = await post(GOOD)
    expect(status).toBe(403)
    expect(payload.error).toMatch(/data\.manage/)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a scoped member who does not reach this site', async () => {
    mockMember = { $id: 'user-1', role: 'editor', hostAccess: { 'host-2': 'editor' } }
    const { status } = await post(GOOD)
    expect(status).toBe(403)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('admits a scoped member for a site they reach', async () => {
    mockMember = { $id: 'user-1', role: 'editor', hostAccess: { 'host-1': 'editor' } }
    const { status } = await post(GOOD)
    expect(status).toBe(201)
  })

  it('admits staff with no membership at all', async () => {
    mockDecoded = { uid: 'staff-1', staff: true }
    mockMember = null
    const { status } = await post(GOOD)
    expect(status).toBe(201)
  })

  it('answers 404 for a site with no org', async () => {
    const { status } = await post({ ...GOOD, hostId: 'nowhere' })
    expect(status).toBe(404)
  })
})

describe('the fields', () => {
  it('refuses an email that is not one, before touching auth', async () => {
    const { status, payload } = await post({ ...GOOD, email: 'not-an-email' }, {})
    expect(status).toBe(400)
    expect(payload.error).toMatch(/email/i)
  })

  it('refuses a phone number it cannot read, with a sentence', async () => {
    const { status, payload } = await post({ ...GOOD, phone: 'call me' })
    expect(status).toBe(400)
    expect(payload.error).toMatch(/phone/i)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a stage that is not one of the list', async () => {
    const { status } = await post({ ...GOOD, lifecycleStage: 'vip' })
    expect(status).toBe(400)
  })

  it('hands the upsert a manual capture with the profile normalized', async () => {
    await post(GOOD)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options.hostId).toBe('host-1')
    expect(options.email).toBe('ada@example.test')
    expect(options.name).toBe('Ada Lovelace')
    expect(options.source).toBe('manual')
    expect(options.interaction).toEqual({ summary: 'Added by hand' })
    expect(options.marketingConsent).toBe(true)
    expect(options.facet).toEqual({
      phone: '+15125550107',
      jobTitle: 'Engineer',
      address: { line1: '1 Main St', city: 'Austin', country: 'US' },
      ownerUid: 'owner-1',
      lifecycleStage: 'lead',
    })
  })

  it('records no consent unless the box was ticked', async () => {
    await post({ ...GOOD, marketingConsent: 'yes' })
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options.marketingConsent).toBe(false)
  })
})

describe('the extras', () => {
  it('writes tags and the company name into the facet by dotted path', async () => {
    await post(GOOD)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [patch] = mockUpdate.mock.calls[0] as unknown as [Record<string, any>]
    expect(patch['facets.host-1.tags']).toEqual({ __arrayUnion: ['vip', 'beta'] })
    expect(patch['facets.host-1.companyName']).toBe('Analytical Engines')
    // The search echo, and nothing else at the top of the document.
    expect(patch['companyName']).toBe('Analytical Engines')
    expect(patch).not.toHaveProperty('facets')
    expect(patch).not.toHaveProperty('tags')
  })

  it('makes no second write when there is nothing extra to write', async () => {
    await post({ hostId: 'host-1', email: 'plain@example.test' })
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('the answer', () => {
  it('answers 201 with the id for a fresh row', async () => {
    const { status, payload } = await post(GOOD)
    expect(status).toBe(201)
    expect(payload).toEqual({ contactId: 'con-new', created: true })
  })

  it('answers 200 with created: false when the address already belonged to somebody', async () => {
    mockUpsertResult = { contactId: 'con-old', created: false }
    const { status, payload } = await post(GOOD)
    expect(status).toBe(200)
    expect(payload).toEqual({ contactId: 'con-old', created: false })
  })

  it("relays the band as a 409 in the list's own words", async () => {
    mockUpsertResult = { refused: 'band' }
    const { status, payload } = await post(GOOD)
    expect(status).toBe(409)
    expect(payload.error).toBe(CONTACT_BAND_FULL_MESSAGE)
    expect(payload.reason).toBe('band')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('answers 500 when the upsert swallowed a failure', async () => {
    mockUpsertResult = { refused: 'error' }
    const { status } = await post(GOOD)
    expect(status).toBe(500)
  })
})
