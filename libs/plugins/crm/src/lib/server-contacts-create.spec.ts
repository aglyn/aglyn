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
 *  5. THE PLAN (AGL-2787). A contact typed in by hand is the CRM suite's: a
 *     workspace whose plan does not carry it is a 403, staff included.
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
const mockLogActivity = jest.fn(async () => undefined)
/** The site's org document; Starter is the lowest plan carrying the CRM suite. */
let mockOrg: Record<string, unknown> = { plan: 'starter' }
/** The org's custom field definitions, as `orgs/{orgId}/contactFields` holds them. */
let mockDefinitions: Record<string, unknown>[] = []
/** Which collections the route read a definition list from, in order. */
let mockDefinitionReads: string[] = []

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: jest.fn(),
}))
// The route captures through the CRM's capture door so `contactCreated` fires
// (AGL-2605); the double answers the verdict the case under test needs.
jest.mock('./server/capture-host-contact', () => ({
  __esModule: true,
  captureHostContact: (...args: unknown[]) => mockUpsert(...(args as [])),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  // The list-fields restamp (AGL-3321) is `crm-records`' own spec's; here a no-op.
  restampCrmListFieldsAt: async () => 'current',
  restampCrmListFieldsOf: async () => ({ restamped: 0, current: 0, missing: 0 }),
  restampCrmListFields: async () => ({ restamped: 0, current: 0, missing: 0 }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      // `orgs/{orgId}/companies/{companyId}` — the one document the route
      // reads before it writes anything — and `orgs/{orgId}/contactFields`,
      // the definitions a `custom` map is judged against (AGL-3971).
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => ({
              doc: (id: string) => ({
                get: async () => ({
                  exists: id in mockCompanies,
                  get: (field: string) => mockCompanies[id]?.[field],
                }),
              }),
              limit: () => ({
                get: async () => {
                  mockDefinitionReads.push(name)
                  return {
                    docs: (name === 'contactFields' ? mockDefinitions : []).map(
                      (definition) => ({ data: () => definition }),
                    ),
                  }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-1' ? { orgId: 'org-1', org: mockOrg } : null,
  resolveOrgMembership: async () =>
    mockMember ? { orgId: 'org-1', member: mockMember } : null,
  memberHasOrgPermission: async () => mockHasPermission,
  logHostActivity: (...args: unknown[]) => mockLogActivity(...(args as [])),
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
  mockOrg = { plan: 'starter' }
  mockDefinitions = []
  mockDefinitionReads = []
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

/**
 * The org's own fields, in the SAME call (AGL-3971). The route used to read
 * every body key but `custom`, so the native apps' create sheets — which
 * offer the custom fields, as the console's record page does — stored the
 * person and silently dropped every value typed into them. Judged exactly
 * as `crm/contact-update` judges them: the definitions read only when a map
 * was sent, a currency amount kept as that field's minor units, and a key
 * that is unknown, retired or the wrong type refused before anything is
 * written.
 */
describe('the custom values', () => {
  const FIELDS = [
    { key: 'budget', label: 'Budget', type: 'currency', currency: 'jpy', object: 'contact', order: 0 },
    { key: 'deposit', label: 'Deposit', type: 'currency', currency: 'bhd', object: 'contact', order: 1 },
    { key: 'tier', label: 'Tier', type: 'select', options: ['Gold', 'Silver'], object: 'contact', order: 2 },
    { key: 'legacy', label: 'Legacy', type: 'text', object: 'contact', order: 3, retiredAt: 1 },
    { key: 'region', label: 'Region', type: 'text', object: 'company', order: 4 },
  ]

  beforeEach(() => {
    mockDefinitions = FIELDS
  })

  it('hands the upsert the judged values in the facet, currency in minor units', async () => {
    const { status } = await post({
      ...GOOD,
      custom: { budget: '¥1,500', deposit: '1.250', tier: 'Gold' },
    })
    expect(status).toBe(201)
    expect(mockDefinitionReads).toEqual(['contactFields'])
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    // ¥1,500 is 1500 minor units; BD 1.250 is 1250 (three digits).
    expect(options.facet.custom).toEqual({ budget: 1500, deposit: 1250, tier: 'Gold' })
  })

  it('reads no definitions when the body carried no map', async () => {
    await post(GOOD)
    expect(mockDefinitionReads).toEqual([])
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options.facet).not.toHaveProperty('custom')
  })

  it('refuses a currency value that is not an amount, before the upsert', async () => {
    const { status, payload } = await post({ ...GOOD, custom: { budget: 'lots' } })
    expect(status).toBe(400)
    expect(payload.field).toBe('custom.budget')
    expect(payload.error).toMatch(/JPY minor units/)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a key the org has not defined, rather than dropping it', async () => {
    const { status, payload } = await post({ ...GOOD, custom: { tier: 'Gold', budjet: 1 } })
    expect(status).toBe(400)
    expect(payload).toEqual({ error: 'No such contact field', field: 'custom.budjet' })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("refuses a retired field and another object's field", async () => {
    expect((await post({ ...GOOD, custom: { legacy: 'x' } })).status).toBe(400)
    expect((await post({ ...GOOD, custom: { region: 'north' } })).status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('refuses a custom value that is not a map, before touching auth', async () => {
    const { status, payload } = await post({ ...GOOD, custom: ['Gold'] }, {})
    expect(status).toBe(400)
    expect(payload.error).toMatch(/keyed by field key/)
    expect(mockDefinitionReads).toEqual([])
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

  /**
   * The audit line is the route's (AGL-2622): it verified the caller and
   * performed the write, so it is the one writer that cannot record an add
   * that did not happen, and the console no longer writes one of its own. A
   * merge into a person the org already held is said to be an update.
   */
  it('writes the host activity entry as the verified caller, and says merge from add', async () => {
    mockLogActivity.mockClear()
    await post(GOOD)
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
    expect(mockLogActivity).toHaveBeenCalledWith(
      'host-1',
      { uid: 'user-1', email: 'me@acme.test' },
      'Added contact',
      { type: 'contact', id: 'con-new', name: 'Ada Lovelace' },
    )
    mockLogActivity.mockClear()
    mockUpsertResult = { contactId: 'con-old', created: false }
    await post({ hostId: 'host-1', email: 'ada@example.test' })
    expect(mockLogActivity).toHaveBeenCalledWith(
      'host-1',
      { uid: 'user-1', email: 'me@acme.test' },
      'Updated contact',
      { type: 'contact', id: 'con-old', name: 'ada@example.test' },
    )
    mockUpsertResult = { contactId: 'con-new', created: true }
  })

  it('records no consent unless the box was ticked', async () => {
    await post({ ...GOOD, marketingConsent: 'yes' })
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options.marketingConsent).toBe(false)
  })

  /*
   * The drawer shows the site's consent-group sentence beside the box and
   * sends back its key (AGL-3320); the capture pools the opt-in only on the
   * group's current key, so the route's part is to hand it on — beside a
   * ticked box, and never beside an unticked one.
   */
  it('hands the capture the key of the sentence the drawer showed, beside an opt-in', async () => {
    await post({ ...GOOD, marketingConsent: true, disclosedConsentGroup: 'abcd1234' })
    const [options] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(options).toMatchObject({ marketingConsent: true, disclosedConsentGroup: 'abcd1234' })

    mockUpsert.mockClear()
    await post({ ...GOOD, marketingConsent: false, disclosedConsentGroup: 'abcd1234' })
    const [unticked] = mockUpsert.mock.calls[0] as unknown as [Record<string, any>]
    expect(unticked).not.toHaveProperty('disclosedConsentGroup')
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

/**
 * THE PLAN (AGL-2787). A person added by hand is the CRM suite's, included
 * from Starter. The route asks once it knows the caller, and it asks of the
 * workspace, so staff acting inside a Free one get the answer a member does.
 */
describe('the plan (AGL-2787)', () => {
  it('refuses a Free workspace, adding, writing and logging nothing', async () => {
    mockOrg = { plan: 'free' }
    const { status, payload } = await post(GOOD)
    expect(status).toBe(403)
    expect(payload).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(payload.error).toMatch(/part of the CRM/)
    expect(payload.error).toMatch(/Included from Starter/)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
  })

  it('refuses staff acting inside a Free workspace the same way', async () => {
    mockOrg = { plan: 'free' }
    mockDecoded = { uid: 'staff-1', staff: true }
    mockMember = null
    const { status, payload } = await post(GOOD)
    expect(status).toBe(403)
    expect(payload).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(payload.error).toMatch(/part of the CRM/)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('tells a member without data.manage about the permission, not the plan', async () => {
    mockOrg = { plan: 'free' }
    mockHasPermission = false
    const { status, payload } = await post(GOOD)
    expect(status).toBe(403)
    expect(payload.error).toMatch(/data\.manage/)
    expect(payload).not.toHaveProperty('reason')
  })

  it('admits Starter, the lowest plan that carries the suite', async () => {
    mockOrg = { plan: 'starter' }
    const { status } = await post(GOOD)
    expect(status).toBe(201)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })
})
