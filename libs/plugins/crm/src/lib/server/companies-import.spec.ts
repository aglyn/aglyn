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
 * `crm/companies-import` (AGL-2621): who may call it, how a row finds the
 * company it is about, and what each row becomes.
 *
 * WHAT THE DOUBLES MODEL, so a false green is visible:
 *
 *  1. The normalizer, the scope stamp, the search keys and the band's
 *     arithmetic are the REAL pure functions, so a domain that reaches the
 *     store is the hostname the file's cell actually normalizes to.
 *  2. Firestore is a small in-memory companies collection answering the
 *     two equality lookups the route makes — `domain` and `nameLower` —
 *     and recording every `add` and `update`.
 *  3. The band is a count the case sets, on an org the case shapes: a Free
 *     org hard-bands at its included hundred; a paid org never refuses.
 */

let decodedToken: Record<string, unknown> = { uid: 'editor-uid' }
let hostRoles: Record<string, string> = { 'editor-uid': 'editor' }
let membership: { orgId: string; member: Record<string, unknown> } | null = {
  orgId: 'org-1',
  member: { $id: 'editor-uid', role: 'editor' },
}
let manageData = true
let members: Record<string, unknown>[] = []
let org: Record<string, unknown> = {}
let crmRecordsCount = 0
let companies: Record<string, Record<string, unknown>> = {}
let companySeq = 0
const updates: Array<{ id: string; data: Record<string, unknown> }> = []
const listMembers = jest.fn(async () => members)

const ORG_ID = 'org-1'
const HOST_ID = 'site-1'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp',
    arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm-company-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/name-search'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
}))

/** `orgs/org-1/companies`, as much of it as the route touches. */
const companiesHandle = {
  where: (fieldPath: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => ({
        docs: Object.entries(companies)
          .filter(([, data]) => data[fieldPath] === wanted)
          .map(([id, data]) => ({
            id,
            get: (key: string) => data[key],
            ref: {
              update: async (patch: Record<string, unknown>) => {
                companies[id] = { ...companies[id], ...patch }
                updates.push({ id, data: patch })
              },
            },
          })),
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
  getOrgForHost: async () => ({ orgId: ORG_ID, org }),
  resolveOrgMembership: async () => membership,
  memberHasOrgPermission: async () => manageData,
  listOrgMembers: (...args: unknown[]) => listMembers(...(args as [])),
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  // The real verdict over the count the case set, so the band's own
  // arithmetic is what refuses a row.
  crmRecordsQuotaForOrg: jest.fn(async (billing: never) => ({
    ...jest
      .requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
      .checkCrmRecordsQuota(billing, crmRecordsCount),
    contactsCount: 0,
    companiesCount: crmRecordsCount,
    dealsCount: 0,
    crmRecordsCount,
  })),
}))

import { crmRecordsQuotaForOrg } from '@aglyn/tenant-data-admin'
import { crmCompaniesImportHandler } from './companies-import'

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
  await crmCompaniesImportHandler(
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

/** The one stored company, when the case created exactly one. */
const stored = () => Object.values(companies)

beforeEach(() => {
  decodedToken = { uid: 'editor-uid' }
  hostRoles = { 'editor-uid': 'editor' }
  membership = { orgId: ORG_ID, member: { $id: 'editor-uid', role: 'editor' } }
  manageData = true
  members = []
  org = {}
  crmRecordsCount = 0
  companies = {}
  companySeq = 0
  updates.length = 0
  listMembers.mockClear()
  ;(crmRecordsQuotaForOrg as jest.Mock).mockClear()
})

describe('the request shape', () => {
  it('answers only POST', async () => {
    const out = await drive({ hostId: HOST_ID, rows: [{}] }, { method: 'GET' })
    expect(out.code).toBe(405)
    expect(out.headers['Allow']).toBe('POST')
  })

  it('refuses an empty or malformed batch before reading anything', async () => {
    expect((await importRows([])).code).toBe(400)
    expect((await importRows(['not-a-row'])).code).toBe(400)
    expect((await drive({ hostId: HOST_ID, rows: [{}] }, { rawBody: 'x'.repeat(2_000_001) })).code).toBe(413)
  })
})

describe('who may import', () => {
  it('needs a bearer token, a site role, and data.manage', async () => {
    expect((await drive({ hostId: HOST_ID, rows: [{ name: 'Acme' }] }, { headers: {} })).code).toBe(401)
    hostRoles = {}
    expect((await importRows([{ name: 'Acme' }])).code).toBe(403)
    hostRoles = { 'editor-uid': 'editor' }
    manageData = false
    expect((await importRows([{ name: 'Acme' }])).code).toBe(403)
    expect(stored()).toEqual([])
  })

  it('lets staff through both gates', async () => {
    decodedToken = { uid: 'staff-uid', staff: true }
    hostRoles = {}
    manageData = false
    const out = await importRows([{ name: 'Acme' }])
    expect(out.code).toBe(200)
    expect(out.body.created).toBe(1)
  })
})

describe('what a row becomes', () => {
  it('creates a company with its keys, its normalized fields, its tags and the scope stamp', async () => {
    members = [{ $id: 'owner-uid', email: 'Owner@Example.com' }]
    const out = await importRows([
      {
        name: '  Acme   Coffee ',
        domain: 'https://www.Acme.com/about',
        website: 'acme.com',
        phone: '(512) 555-0123',
        industry: 'Hospitality',
        ownerEmail: 'owner@example.com',
        addressLine1: '1 Main St',
        addressCountry: 'us',
        tags: 'VIP | west',
        notes: 'Big account',
      },
    ])
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ received: 1, created: 1, merged: 0, skipped: [] })
    expect(stored()[0]).toMatchObject({
      name: 'Acme Coffee',
      nameLower: 'acme coffee',
      domain: 'acme.com',
      website: 'https://acme.com/',
      phone: '+15125550123',
      industry: 'Hospitality',
      ownerUid: 'owner-uid',
      address: { line1: '1 Main St', country: 'US' },
      tags: ['vip', 'west'],
      notes: 'Big account',
      hostId: HOST_ID,
      visibleTo: ['host:site-1'],
      createdByUid: 'editor-uid',
      createdAt: '__serverTimestamp',
    })
  })

  it('updates a company this scope can see by domain, unioning the tags and touching only what the row carries', async () => {
    companies['c-acme'] = {
      name: 'Acme Inc',
      nameLower: 'acme inc',
      domain: 'acme.com',
      website: 'https://acme.com/',
      visibleTo: ['host:site-1'],
    }
    const out = await importRows([{ name: 'Acme', domain: 'acme.com', tags: 'west' }])
    expect(out.body).toMatchObject({ created: 0, merged: 1 })
    expect(updates).toEqual([
      {
        id: 'c-acme',
        data: expect.objectContaining({
          name: 'Acme',
          nameLower: 'acme',
          domain: 'acme.com',
          tags: { op: 'union', values: ['west'] },
          updatedAt: '__serverTimestamp',
        }),
      },
    ])
    expect('website' in updates[0].data).toBe(false)
  })

  it('falls back to the name when no company carries the domain, and ignores one it cannot see', async () => {
    companies['c-theirs'] = { name: 'Acme', nameLower: 'acme', visibleTo: ['host:site-9'] }
    companies['c-ours'] = { name: 'Acme', nameLower: 'acme', visibleTo: ['org'] }
    const out = await importRows([{ name: 'ACME', domain: 'acme.com' }])
    expect(out.body).toMatchObject({ created: 0, merged: 1 })
    expect(updates.map((entry) => entry.id)).toEqual(['c-ours'])
  })

  it('skips a nameless row and a repeat of a company earlier in the request, and names both', async () => {
    const out = await importRows([
      { domain: 'nobody.com' },
      { name: 'Acme', domain: 'acme.com' },
      { name: 'Acme Inc', domain: 'acme.com' },
      { name: 'Globex' },
      { name: ' GLOBEX ' },
    ])
    expect(out.body.skipped).toEqual([
      { index: 0, name: 'nobody.com', reason: 'missing-name' },
      { index: 2, name: 'Acme Inc', reason: 'duplicate' },
      { index: 4, name: 'GLOBEX', reason: 'duplicate' },
    ])
    expect(out.body.created).toBe(2)
  })

  it('tallies the cells it could not read, by field, and names the owners it could not resolve', async () => {
    members = [{ $id: 'owner-uid', email: 'owner@example.com' }]
    const out = await importRows([
      { name: 'Acme', domain: 'not a domain', phone: '12345', ownerEmail: 'stranger@example.com' },
    ])
    expect(out.body.dropped).toEqual({ domain: 1, phone: 1 })
    expect(out.body.ownersUnresolved).toEqual(['stranger@example.com'])
    expect(stored()[0]).not.toHaveProperty('ownerUid')
  })

  it('does not read the roster for a file with no owner column', async () => {
    await importRows([{ name: 'Acme' }])
    expect(listMembers).not.toHaveBeenCalled()
  })
})

describe('the records band', () => {
  it('counts once per request, refuses the creates past a hard band by name, and still updates', async () => {
    // Free: a hard band of 100, of which 99 are used — one create fits.
    org = { plan: 'free' }
    crmRecordsCount = 99
    companies['c-acme'] = { name: 'Acme', nameLower: 'acme', visibleTo: ['host:site-1'] }
    const out = await importRows([
      { name: 'Globex' },
      { name: 'Initech' },
      { name: 'Acme', industry: 'Software' },
    ])
    expect(out.body).toMatchObject({ created: 1, merged: 1 })
    expect(out.body.skipped).toEqual([{ index: 1, name: 'Initech', reason: 'records-band' }])
    expect(crmRecordsQuotaForOrg).toHaveBeenCalledTimes(1)
  })
})
