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
 * `crm/contacts-import` (AGL-2602): who may call it, and what each row
 * becomes.
 *
 * WHAT THE DOUBLES MODEL, so a false green is visible:
 *
 *  1. `upsertHostContact` is a DOUBLE that answers whatever verdict the case
 *     sets. The door's own behavior — dedupe, band, facet writes — is
 *     `upsert-contact-verdict.spec.ts`'s question; what this file certifies
 *     is that the route hands the door the right options and turns its
 *     verdict into the right row report.
 *  2. The normalizer, the scope stamp and the search keys are the REAL pure
 *     functions, so a phone that reaches the door is the E.164 the file's
 *     phone actually normalizes to.
 *  3. Firestore is a small in-memory store modelling the three things the
 *     route reads or writes beside the door: the host document's roles, the
 *     field definitions, and the companies collection's `nameLower` lookup
 *     and `add`.
 */

let decodedToken: Record<string, unknown> = { uid: 'editor-uid' }
let hostRoles: Record<string, string> = { 'editor-uid': 'editor' }
let membership: { orgId: string; member: Record<string, unknown> } | null = {
  orgId: 'org-1',
  member: { $id: 'editor-uid', role: 'editor' },
}
let manageData = true
let members: Record<string, unknown>[] = []
let fieldDefinitions: Record<string, unknown>[] = []
let companies: Record<string, Record<string, unknown>> = {}
let companySeq = 0
const upsert = jest.fn()
const listMembers = jest.fn(async () => members)

const ORG_ID = 'org-1'
const HOST_ID = 'site-1'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/name-search'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
}))

/** `orgs/org-1/companies`, as much of it as the route touches. */
const companiesHandle = {
  where: (fieldPath: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => ({
        docs: Object.entries(companies)
          .filter(([, data]) => data[fieldPath] === wanted)
          .map(([id, data]) => ({ id, get: (key: string) => data[key] })),
      }),
    }),
  }),
  add: async (data: Record<string, unknown>) => {
    companySeq += 1
    const id = `company-${companySeq}`
    companies[id] = data
    return { id }
  },
}

const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => {
        if (name === 'hosts') {
          return {
            exists: id === HOST_ID,
            get: (key: string) => (key === 'memberRoles' ? hostRoles : undefined),
          }
        }
        throw new Error(`unexpected doc read ${name}/${id}`)
      },
      collection: (sub: string) => {
        if (name === 'orgs' && sub === 'contactFields') {
          return {
            limit: () => ({
              get: async () => ({
                docs: fieldDefinitions.map((data) => ({ data: () => data })),
              }),
            }),
          }
        }
        if (name === 'orgs' && sub === 'companies') return companiesHandle
        throw new Error(`unexpected collection ${name}/${id}/${sub}`)
      },
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  memberHasOrgPermission: async () => manageData,
  listOrgMembers: (...args: unknown[]) => listMembers(...(args as [])),
  // A group of one — the shape an org that declared nothing resolves to.
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  upsertHostContact: (...args: unknown[]) => upsert(...(args as [])),
}))

import { crmContactsImportHandler } from './contacts-import'

async function drive(
  body: unknown,
  options: { method?: string; headers?: Record<string, string>; rawBody?: string } = {},
) {
  const out: { code: number; body: any; headers: Record<string, unknown> } = {
    code: 0,
    body: undefined,
    headers: {},
  }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
    setHeader(name: string, value: unknown) {
      out.headers[name] = value
    },
  }
  await crmContactsImportHandler(
    {
      method: options.method ?? 'POST',
      body,
      rawBody: options.rawBody ?? JSON.stringify(body ?? ''),
      headers: options.headers ?? { authorization: 'Bearer token' },
      query: {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return out
}

const importRows = (rows: unknown[]) => drive({ hostId: HOST_ID, rows })

/** The options the door was handed for one address. */
const doorCall = (email: string) =>
  upsert.mock.calls.map(([options]) => options).find((options) => options.email === email)

beforeEach(() => {
  decodedToken = { uid: 'editor-uid' }
  hostRoles = { 'editor-uid': 'editor' }
  membership = { orgId: ORG_ID, member: { $id: 'editor-uid', role: 'editor' } }
  manageData = true
  members = []
  fieldDefinitions = []
  companies = {}
  companySeq = 0
  upsert.mockReset()
  upsert.mockImplementation(async () => ({ contactId: 'c-new', created: true }))
  listMembers.mockClear()
})

describe('the request shape', () => {
  it('answers only POST', async () => {
    const out = await drive({ hostId: HOST_ID, rows: [{}] }, { method: 'GET' })
    expect(out.code).toBe(405)
    expect(out.headers['Allow']).toBe('POST')
  })

  it('refuses an empty, oversized or malformed batch before reading anything', async () => {
    expect((await importRows([])).code).toBe(400)
    expect((await importRows(Array.from({ length: 201 }, () => ({})))).code).toBe(400)
    expect((await importRows(['a string'])).code).toBe(400)
    const big = await drive(
      { hostId: HOST_ID, rows: [{ email: 'a@b.co' }] },
      { rawBody: 'x'.repeat(2_000_001) },
    )
    expect(big.code).toBe(413)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('who may import', () => {
  it('needs a bearer token', async () => {
    const out = await drive({ hostId: HOST_ID, rows: [{ email: 'a@b.co' }] }, { headers: {} })
    expect(out.code).toBe(401)
  })

  it('needs a site admin or editor role on the host', async () => {
    hostRoles = { 'editor-uid': 'viewer' }
    expect((await importRows([{ email: 'a@b.co' }])).code).toBe(403)
    hostRoles = {}
    expect((await importRows([{ email: 'a@b.co' }])).code).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("needs the organization's data.manage permission, resolved through the member", async () => {
    manageData = false
    const out = await importRows([{ email: 'a@b.co' }])
    expect(out.code).toBe(403)
    expect(String(out.body.error)).toMatch(/does not allow managing contacts/)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('refuses a member who is not in the org at all', async () => {
    membership = null
    expect((await importRows([{ email: 'a@b.co' }])).code).toBe(403)
  })

  it('lets staff through both gates', async () => {
    decodedToken = { uid: 'staff-uid', staff: true }
    hostRoles = {}
    membership = null
    manageData = false
    const out = await importRows([{ email: 'a@b.co' }])
    expect(out.code).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('the per-row verdicts', () => {
  it('reports created and merged from what the door answered', async () => {
    upsert
      .mockResolvedValueOnce({ contactId: 'c-1', created: true })
      .mockResolvedValueOnce({ contactId: 'c-2', created: false })
    const out = await importRows([{ email: 'new@x.co' }, { email: 'seen@x.co' }])
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({
      received: 2,
      created: 1,
      merged: 1,
      skipped: [],
      companiesCreated: 0,
      ownersUnresolved: [],
    })
  })

  it('skips an unusable address without reaching the door, and names the row', async () => {
    const out = await importRows([
      { email: 'not an address' },
      { name: 'No address at all' },
      { email: 'ok@x.co' },
    ])
    expect(out.body.skipped).toEqual([
      { index: 0, email: 'not an address', reason: 'invalid-email' },
      { index: 1, email: '', reason: 'invalid-email' },
    ])
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(out.body.created).toBe(1)
  })

  it('skips a repeat of an address earlier in the same request', async () => {
    const out = await importRows([
      { email: 'Ada@X.co', name: 'First' },
      { email: 'ada@x.co', name: 'Second' },
    ])
    expect(out.body.skipped).toEqual([
      { index: 1, email: 'ada@x.co', reason: 'duplicate' },
    ])
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(doorCall('ada@x.co').name).toBe('First')
  })

  it("turns the door's refusals into the operator's reasons", async () => {
    upsert
      .mockResolvedValueOnce({ refused: 'band' })
      .mockResolvedValueOnce({ refused: 'error' })
      .mockResolvedValueOnce({ refused: 'invalid-email' })
    const out = await importRows([
      { email: 'full@x.co' },
      { email: 'broken@x.co' },
      { email: 'odd@x.co' },
    ])
    expect(out.body).toMatchObject({ created: 0, merged: 0 })
    expect(out.body.skipped).toEqual([
      { index: 0, email: 'full@x.co', reason: 'audience-band' },
      { index: 1, email: 'broken@x.co', reason: 'write-failed' },
      { index: 2, email: 'odd@x.co', reason: 'invalid-email' },
    ])
  })
})

describe('what the door is handed', () => {
  it('is an import interaction with the normalized profile in the facet', async () => {
    await importRows([
      {
        email: ' Ada@X.co ',
        name: 'Ada',
        phone: '512-555-0123',
        jobTitle: 'Analyst',
        addressLine1: '1 Main',
        addressCity: 'Austin',
        addressCountry: 'us',
        tags: 'VIP|beta',
        lifecycleStage: 'Customer',
        marketingConsent: 'yes',
      },
    ])
    expect(doorCall('ada@x.co')).toEqual({
      hostId: HOST_ID,
      email: 'ada@x.co',
      name: 'Ada',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
      marketingConsent: true,
      tags: ['vip', 'beta'],
      facet: {
        phone: '+15125550123',
        jobTitle: 'Analyst',
        address: { line1: '1 Main', city: 'Austin', country: 'US' },
        lifecycleStage: 'customer',
      },
      campaignIds: [],
    })
  })

  it('records no consent for a row that did not say yes', async () => {
    await importRows([{ email: 'a@x.co', marketingConsent: 'no' }, { email: 'b@x.co' }])
    expect(doorCall('a@x.co').marketingConsent).toBe(false)
    expect(doorCall('b@x.co').marketingConsent).toBe(false)
  })

  it('tallies the values it could not read, by field', async () => {
    const out = await importRows([
      { email: 'a@x.co', phone: '12', lifecycleStage: 'hot' },
      { email: 'b@x.co', phone: 'none' },
    ])
    expect(out.body.dropped).toEqual({ phone: 2, lifecycleStage: 1 })
    expect(doorCall('a@x.co').facet).toEqual({})
  })
})

describe('owners', () => {
  it('resolves an owner email to a member uid with one roster read, and names the misses', async () => {
    members = [
      { $id: 'u-1', email: 'Sam@Team.co' },
      { $id: 'u-2', email: 'pat@team.co' },
    ]
    const out = await importRows([
      { email: 'a@x.co', ownerEmail: 'sam@team.co' },
      { email: 'b@x.co', ownerEmail: 'nobody@team.co' },
      { email: 'c@x.co', ownerEmail: 'PAT@team.co' },
    ])
    expect(listMembers).toHaveBeenCalledTimes(1)
    expect(doorCall('a@x.co').facet.ownerUid).toBe('u-1')
    expect(doorCall('b@x.co').facet.ownerUid).toBeUndefined()
    expect(doorCall('c@x.co').facet.ownerUid).toBe('u-2')
    expect(out.body.ownersUnresolved).toEqual(['nobody@team.co'])
  })

  it('does not read the roster for a file with no owner column', async () => {
    await importRows([{ email: 'a@x.co' }])
    expect(listMembers).not.toHaveBeenCalled()
  })
})

describe('companies', () => {
  it('creates a missing company once for the request and points every row at it', async () => {
    const out = await importRows([
      { email: 'a@x.co', companyName: 'Acme Widgets' },
      { email: 'b@x.co', companyName: 'acme widgets' },
    ])
    expect(out.body.companiesCreated).toBe(1)
    const [id, company] = Object.entries(companies)[0]
    expect(company).toMatchObject({
      name: 'Acme Widgets',
      nameLower: 'acme widgets',
      hostId: HOST_ID,
      // The same stamp a contact captured on this site gets: this site alone.
      visibleTo: ['host:site-1'],
      createdByUid: 'editor-uid',
    })
    expect(doorCall('a@x.co').facet.companyId).toBe(id)
    expect(doorCall('b@x.co').facet.companyId).toBe(id)
  })

  it('reuses a company this scope can see and ignores one it cannot', async () => {
    companies = {
      theirs: { name: 'Acme', nameLower: 'acme', visibleTo: ['host:other-site'] },
      ours: { name: 'Acme', nameLower: 'acme', visibleTo: ['host:site-1'] },
    }
    const out = await importRows([{ email: 'a@x.co', companyName: 'ACME' }])
    expect(out.body.companiesCreated).toBe(0)
    expect(doorCall('a@x.co').facet.companyId).toBe('ours')
  })

  it('sees an org-wide company from any site, and never creates a twin of it', async () => {
    companies = {
      shared: { name: 'Acme', nameLower: 'acme', visibleTo: ['org'] },
    }
    const out = await importRows([{ email: 'a@x.co', companyName: 'Acme' }])
    expect(out.body.companiesCreated).toBe(0)
    expect(doorCall('a@x.co').facet.companyId).toBe('shared')
  })
})

describe('custom fields', () => {
  it('types each value by its live definition and drops the rest', async () => {
    fieldDefinitions = [
      { key: 'seats', type: 'number', visibleTo: ['org'] },
      { key: 'tier', type: 'select', options: ['Gold'], visibleTo: ['host:site-1'] },
      { key: 'old', type: 'text', visibleTo: ['org'], retiredAt: 1 },
      { key: 'theirs', type: 'text', visibleTo: ['host:other-site'] },
    ]
    const out = await importRows([
      {
        email: 'a@x.co',
        custom: { seats: '12', tier: 'gold', old: 'x', theirs: 'y', ghost: 'z' },
      },
    ])
    expect(doorCall('a@x.co').facet.custom).toEqual({ seats: 12, tier: 'Gold' })
    expect(out.body.dropped).toEqual({
      'custom:old': 1,
      'custom:theirs': 1,
      'custom:ghost': 1,
    })
  })
})
