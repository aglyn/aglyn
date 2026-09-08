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
 * `crm/deals-import` (AGL-2662): who may call it, how a row finds its
 * pipeline and its stage by name, and what each row becomes.
 *
 * WHAT THE DOUBLES MODEL: the normalizer, the placement, the scope stamp
 * and the band's arithmetic are the REAL pure functions; Firestore is an
 * in-memory pipelines collection the route reads once and a deals
 * collection recording every `add`; the band is a count the case sets.
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
let pipelines: Record<string, Record<string, unknown>> = {}
let deals: Record<string, Record<string, unknown>> = {}
let dealSeq = 0
let pipelineReads = 0

const ORG_ID = 'org-1'
const HOST_ID = 'site-1'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm-deal-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/name-search'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
}))

const orgHandle = {
  collection: (sub: string) => {
    if (sub === 'pipelines') {
      return {
        get: async () => {
          pipelineReads += 1
          return {
            docs: Object.entries(pipelines).map(([id, data]) => ({ id, data: () => data })),
          }
        },
      }
    }
    if (sub === 'deals') {
      return {
        add: async (data: Record<string, unknown>) => {
          dealSeq += 1
          deals[`deal-${dealSeq}`] = data
          return { id: `deal-${dealSeq}` }
        },
      }
    }
    throw new Error(`unexpected collection orgs/${ORG_ID}/${sub}`)
  },
}

const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => {
      if (name === 'hosts') {
        return {
          get: async () => ({
            exists: id === HOST_ID,
            get: (key: string) => (key === 'memberRoles' ? hostRoles : undefined),
          }),
        }
      }
      if (name === 'orgs') return orgHandle
      throw new Error(`unexpected doc ${name}/${id}`)
    },
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
  listOrgMembers: async () => members,
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  crmRecordsQuotaForOrg: jest.fn(async (billing: never) => ({
    ...jest
      .requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
      .checkCrmRecordsQuota(billing, crmRecordsCount),
    contactsCount: 0,
    companiesCount: 0,
    dealsCount: crmRecordsCount,
    crmRecordsCount,
  })),
}))

import { crmDealsImportHandler } from './deals-import'

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
  await crmDealsImportHandler(
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
const stored = () => Object.values(deals)

const SALES = {
  name: 'Sales',
  isDefault: true,
  visibleTo: ['org'],
  stages: [
    { id: 'won', name: 'Won', order: 4, probability: 100, kind: 'won' },
    { id: 'qualified', name: 'Qualified', order: 0, probability: 10, kind: 'open' },
    { id: 'proposal', name: 'Proposal sent', order: 2, probability: 40, kind: 'open' },
  ],
}

beforeEach(() => {
  decodedToken = { uid: 'editor-uid' }
  hostRoles = { 'editor-uid': 'editor' }
  membership = { orgId: ORG_ID, member: { $id: 'editor-uid', role: 'editor' } }
  manageData = true
  members = []
  org = {}
  crmRecordsCount = 0
  pipelines = { 'p-sales': SALES }
  deals = {}
  dealSeq = 0
  pipelineReads = 0
})

describe('the request shape and the gates', () => {
  it('answers only POST, and refuses a malformed batch before reading anything', async () => {
    const out = await drive({ hostId: HOST_ID, rows: [{}] }, { method: 'GET' })
    expect(out.code).toBe(405)
    expect(out.headers['Allow']).toBe('POST')
    expect((await importRows([])).code).toBe(400)
    expect((await importRows(['not-a-row'])).code).toBe(400)
  })

  it('needs a bearer token, a site role, and data.manage', async () => {
    expect((await drive({ hostId: HOST_ID, rows: [{ title: 'x' }] }, { headers: {} })).code).toBe(401)
    hostRoles = {}
    expect((await importRows([{ title: 'x' }])).code).toBe(403)
    hostRoles = { 'editor-uid': 'editor' }
    manageData = false
    expect((await importRows([{ title: 'x' }])).code).toBe(403)
    expect(stored()).toEqual([])
  })
})

describe('what a row becomes', () => {
  it('files a deal in the named pipeline and stage, owner by address, with the scope stamp', async () => {
    members = [{ $id: 'owner-uid', email: 'Owner@Example.com' }]
    const out = await importRows([
      {
        title: ' Acme  renewal ',
        pipeline: 'sales',
        stage: 'PROPOSAL SENT',
        amount: '$1,250.00',
        currency: 'EUR',
        ownerEmail: 'owner@example.com',
        expectedClose: '2026-12-01',
        notes: 'Q4',
      },
    ])
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ received: 1, created: 1, merged: 0, skipped: [] })
    expect(stored()[0]).toMatchObject({
      title: 'Acme renewal',
      titleLower: 'acme renewal',
      pipelineId: 'p-sales',
      stageId: 'proposal',
      status: 'open',
      closedAtMs: null,
      amountCents: 125_000,
      currency: 'eur',
      ownerUid: 'owner-uid',
      expectedCloseAtMs: Date.UTC(2026, 11, 1, 12),
      notes: 'Q4',
      hostId: HOST_ID,
      visibleTo: ['host:site-1'],
      createdByUid: 'editor-uid',
      createdAt: '__serverTimestamp',
    })
    expect(typeof stored()[0]['stageChangedAtMs']).toBe('number')
  })

  it('lands a row with no pipeline in the default one and no stage in its first open stage', async () => {
    const out = await importRows([{ title: 'Bare' }])
    expect(out.body.created).toBe(1)
    expect(stored()[0]).toMatchObject({
      pipelineId: 'p-sales',
      stageId: 'qualified',
      status: 'open',
      currency: 'usd',
    })
    expect('amountCents' in stored()[0]).toBe(false)
  })

  it('closes a deal filed into a won stage, stamped with one clock', async () => {
    const out = await importRows([{ title: 'Done deal', stage: 'Won' }])
    expect(out.body.created).toBe(1)
    const deal = stored()[0]
    expect(deal['status']).toBe('won')
    expect(deal['closedAtMs']).toBe(deal['stageChangedAtMs'])
  })

  it('refuses, by name, a pipeline or a stage the org does not have, and reads the pipelines once', async () => {
    pipelines['p-archived'] = { ...SALES, name: 'Old', isDefault: false, archivedAt: 1 }
    pipelines['p-theirs'] = { ...SALES, name: 'Theirs', isDefault: false, visibleTo: ['host:site-9'] }
    const out = await importRows([
      { title: 'A', pipeline: 'Old' },
      { title: 'B', pipeline: 'Theirs' },
      { title: 'C', stage: 'Signed' },
      { title: 'D' },
      { amount: '5' },
    ])
    expect(out.body.skipped).toEqual([
      { index: 0, title: 'A', reason: 'unknown-pipeline' },
      { index: 1, title: 'B', reason: 'unknown-pipeline' },
      { index: 2, title: 'C', reason: 'unknown-stage' },
      { index: 4, title: '', reason: 'missing-title' },
    ])
    expect(out.body.created).toBe(1)
    expect(pipelineReads).toBe(1)
  })

  it('names an owner address nobody on the team has, and files the deal without one', async () => {
    members = [{ $id: 'owner-uid', email: 'owner@example.com' }]
    const out = await importRows([{ title: 'A', ownerEmail: 'ghost@example.com' }])
    expect(out.body.ownersUnresolved).toEqual(['ghost@example.com'])
    expect('ownerUid' in stored()[0]).toBe(false)
  })

  it('tallies the cells it dropped, by field', async () => {
    const out = await importRows([{ title: 'A', amount: 'lots', expectedClose: 'soon' }])
    expect(out.body.dropped).toEqual({ amount: 1, expectedClose: 1 })
    expect(out.body.created).toBe(1)
  })
})

describe('the records band', () => {
  it('refuses the rows past a hard band, counting what this request created', async () => {
    org = { plan: 'free' }
    crmRecordsCount = 99
    const out = await importRows([{ title: 'A' }, { title: 'B' }])
    expect(out.body.created).toBe(1)
    expect(out.body.skipped).toEqual([{ index: 1, title: 'B', reason: 'records-band' }])
  })
})
