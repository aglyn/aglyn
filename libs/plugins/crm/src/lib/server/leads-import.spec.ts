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
 * `crm/leads-import` (AGL-2701): who may call it, where a row lands, and
 * what it is allowed to say about the person.
 *
 * WHAT THE DOUBLES MODEL: `addHostLead` is the REAL capture door, reached
 * by its own path, because everything this route is judged on is the
 * door's — the `personKey` id under `hosts/{hostId}/leads`, the
 * `capturedByHostIds` stamp, the absence of `visibleTo`, the marketing
 * basis it does not write. A spy standing in for it would let the route
 * pass a spec by calling something that agrees with it. Firestore is an
 * in-memory map keyed by document path with a real-enough transaction, so
 * every assertion below reads what LANDED.
 */

import type { ConsentGroup } from '@aglyn/aglyn/server'

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

/** `FieldValue` sentinels applied the way the SDK applies them. */
function applyWrite(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const next: Record<string, any> = { ...(existing ?? {}) }
  for (const [key, field] of Object.entries(value)) {
    if (field && typeof field === 'object' && '__arrayUnion' in field) {
      const before = Array.isArray(next[key]) ? next[key] : []
      next[key] = [
        ...before,
        ...(field.__arrayUnion as unknown[]).filter((item) => !before.includes(item)),
      ]
    } else if (field && typeof field === 'object' && '__increment' in field) {
      next[key] = Number(next[key] ?? 0) + Number(field.__increment)
    } else {
      next[key] = field
    }
  }
  return next
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    firestore: fakeFirestore,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? applyWrite(docs.get(path), value) : { ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

/** An aggregate query, told apart from a document reference by this marker. */
function countQuery(path: string): any {
  return {
    __aggregate: true,
    get: async () => ({ data: () => ({ count: childPaths(path).length }) }),
  }
}

function collectionRef(path: string): any {
  return {
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    count: () => countQuery(path),
  }
}

const fakeFirestore: any = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshot(ref.path)),
  /**
   * The transaction the capture door writes inside. Serialization is not
   * modelled — the door's own contention spec owns that — but the reads
   * and the write are the real ones, so the ceiling and the merge behave
   * here as they do there.
   */
  runTransaction: async (body: (tx: any) => Promise<unknown>) => {
    const tx = {
      get: async (target: any) => (target?.__aggregate ? target.get() : target.get()),
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) => {
        docs.set(
          ref.path,
          options?.merge ? applyWrite(docs.get(ref.path), value) : { ...value },
        )
      },
    }
    return body(tx)
  },
}

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

const HOST_ID = 'site-1'
const OTHER_HOST_ID = 'site-2'
const ORG_ID = 'org-1'

let decodedToken: Record<string, unknown> = { uid: 'editor-uid' }
let membership: { orgId: string; member: Record<string, unknown> } | null = null
let manageData = true
let members: Record<string, unknown>[] = []
let org: Record<string, unknown> = {}
/**
 * The platform lead ceiling, lowered so a case can reach it.
 *
 * The route and the door read the SAME constant, so lowering it here moves
 * both walls together — which is what makes the reason on the skipped row
 * mean something: only the route's own pre-check can say `lead-ceiling`,
 * and a route that left the refusal to the door would report the row as
 * `write-failed` instead.
 */
let leadCeiling = 200_000

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    increment: (operand: number) => ({ __increment: operand }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  // The plan tables the suite gate reads, first so no module below is shadowed.
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contacts'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm-lead-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/form-abuse-ceiling'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/marketing-consent'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/person-key'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/visitor-record-ceiling'),
  get LEADS_MAX_PER_HOST() {
    return leadCeiling
  },
}))

/*
 * The door's two side effects on the way past. Neither is reached by an
 * import — no campaign touch travels with a file, and nothing here trips
 * the platform ceiling — but both modules would otherwise be loaded for
 * real by the door this spec deliberately does not stub.
 */
jest.mock(
  '../../../../../tenant/data/admin/src/lib/server/campaign-conversion-attribution',
  () => ({
    __esModule: true,
    attributeCampaignConversion: jest.fn(async () => undefined),
  }),
)
jest.mock('../../../../../tenant/data/admin/src/lib/server/notifications', () => ({
  __esModule: true,
  notifyHostManagers: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async (hostId: string) =>
    docs.has(`hosts/${hostId}`) ? { orgId: ORG_ID, org } : null,
  resolveOrgMembership: async () => membership,
  memberHasOrgPermission: async () => manageData,
  listOrgMembers: async () => members,
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  // The real capture door — see the file docblock.
  ...jest.requireActual(
    '../../../../../tenant/data/admin/src/lib/server/host-visitor-records',
  ),
}))

import { personKey, readMarketingBasis, soloConsentGroup } from '@aglyn/aglyn/server'
import { crmLeadsImportHandler } from './leads-import'

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
  await crmLeadsImportHandler(
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

const importRows = (rows: unknown[], hostId = HOST_ID) => drive({ hostId, rows })

/** The lead one address is filed under, on whichever site. */
const leadAt = (email: string, hostId = HOST_ID) =>
  docs.get(`hosts/${hostId}/leads/${personKey(email)}`)

const leadPaths = () => [...docs.keys()].filter((path) => path.includes('/leads/'))

beforeEach(() => {
  docs.clear()
  autoId = 0
  docs.set(`hosts/${HOST_ID}`, { memberRoles: { 'editor-uid': 'editor' } })
  docs.set(`hosts/${OTHER_HOST_ID}`, { memberRoles: { 'editor-uid': 'editor' } })
  decodedToken = { uid: 'editor-uid' }
  membership = { orgId: ORG_ID, member: { $id: 'editor-uid', role: 'editor' } }
  manageData = true
  members = []
  leadCeiling = 200_000
  // An org that pooled its sites — so the import context resolves REAL scope
  // tokens, and a lead that carried none proves the route dropped them
  // rather than never having had any — on Starter, the lowest plan carrying
  // the CRM suite.
  org = {
    plan: 'starter',
    consentGroups: [{ id: 'brand', name: 'Brand', hostIds: [HOST_ID, OTHER_HOST_ID] }],
  }
})

describe('the request shape and the gates', () => {
  it('answers only POST, and refuses a malformed batch before reading anything', async () => {
    const out = await drive({ hostId: HOST_ID, rows: [{ email: 'a@b.com' }] }, { method: 'GET' })
    expect(out.code).toBe(405)
    expect(out.headers['Allow']).toBe('POST')
    expect((await importRows([])).code).toBe(400)
    expect((await importRows(['not-a-row'])).code).toBe(400)
    expect(leadPaths()).toEqual([])
  })

  it('needs a bearer token, a site role, and data.manage', async () => {
    expect(
      (await drive({ hostId: HOST_ID, rows: [{ email: 'a@b.com' }] }, { headers: {} })).code,
    ).toBe(401)
    docs.set(`hosts/${HOST_ID}`, { memberRoles: {} })
    expect((await importRows([{ email: 'a@b.com' }])).code).toBe(403)
    docs.set(`hosts/${HOST_ID}`, { memberRoles: { 'editor-uid': 'editor' } })
    manageData = false
    expect((await importRows([{ email: 'a@b.com' }])).code).toBe(403)
    expect(leadPaths()).toEqual([])
  })
})

describe('what a row becomes', () => {
  it('files the person under the named site, keyed by address, with the working state', async () => {
    members = [{ $id: 'rep-uid', email: 'Rep@Example.com' }]
    const out = await importRows([
      {
        email: '  Dana@EXAMPLE.com ',
        name: ' Dana  Marsh ',
        status: 'Working',
        ownerEmail: 'rep@example.com',
        notes: 'Met at the trade show',
      },
    ])
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({
      received: 1,
      created: 1,
      merged: 0,
      skipped: [],
      ownersUnresolved: [],
    })
    expect(leadPaths()).toEqual([
      `hosts/${HOST_ID}/leads/${personKey('dana@example.com')}`,
    ])
    expect(leadAt('dana@example.com')).toMatchObject({
      email: 'dana@example.com',
      name: 'Dana Marsh',
      status: 'working',
      ownerUid: 'rep-uid',
      notes: 'Met at the trade show',
      sources: ['import'],
      submissionCount: 1,
      capturedByHostIds: [HOST_ID],
    })
  })

  /**
   * The one difference between a lead and the five org collections. A lead
   * is private to its site by PATH, the rules admit the site's own members
   * and the list reads it with no scope clause — so a `visibleTo` here
   * would be a field nothing reads, describing a sharing decision the
   * collection does not have. The org above pooled two sites, so the
   * import context really did resolve tokens to drop.
   */
  it('stamps no visibleTo and no facet map, because the site IS the scope', async () => {
    await importRows([{ email: 'dana@example.com', status: 'working' }])
    const lead = leadAt('dana@example.com') as Record<string, unknown>
    expect(lead).not.toHaveProperty('visibleTo')
    expect(lead).not.toHaveProperty('facets')
    expect(lead['capturedByHostIds']).toEqual([HOST_ID])
  })

  /**
   * The site the drawer named, and no other. The import context's whole
   * permission is granted for ONE host, so a second site's leads must be
   * untouched by a file imported into the first.
   */
  it('writes nothing under any other site', async () => {
    await importRows([{ email: 'dana@example.com' }])
    await importRows([{ email: 'ada@example.com' }], OTHER_HOST_ID)
    expect(leadAt('dana@example.com', OTHER_HOST_ID)).toBeUndefined()
    expect(leadAt('ada@example.com', HOST_ID)).toBeUndefined()
    expect(leadAt('dana@example.com', HOST_ID)).toBeDefined()
    expect(leadAt('ada@example.com', OTHER_HOST_ID)).toBeDefined()
  })

  /**
   * A CSV row has no capture event behind it, so there is no consent
   * column and nothing here may write a basis. `readMarketingBasis` is the
   * reader the SEND path uses, so a basis this asserts absent is one the
   * campaign would also fail to find.
   */
  it('records no marketing consent, however the file is headed', async () => {
    await importRows([
      { email: 'dana@example.com', name: 'Dana', marketingConsent: 'yes', consent: 'true' },
    ])
    const lead = leadAt('dana@example.com') as Record<string, unknown>
    expect(lead).not.toHaveProperty('marketingConsent')
    expect(readMarketingBasis(lead, soloConsentGroup(HOST_ID)).basis).toBe('unrecorded')
  })

  it('leaves an unresolvable owner off the lead and names the address', async () => {
    members = [{ $id: 'rep-uid', email: 'rep@example.com' }]
    const out = await importRows([
      { email: 'dana@example.com', ownerEmail: 'stranger@example.com' },
    ])
    expect(out.body.ownersUnresolved).toEqual(['stranger@example.com'])
    expect(leadAt('dana@example.com')).not.toHaveProperty('ownerUid')
    expect(out.body.created).toBe(1)
  })

  it('reports a cell it could not read without refusing the row', async () => {
    const out = await importRows([{ email: 'dana@example.com', status: 'Qualified' }])
    expect(out.body).toMatchObject({ created: 1, skipped: [], dropped: { status: 1 } })
    expect(leadAt('dana@example.com')).not.toHaveProperty('status')
  })

  it('touches nothing on the document when the file names no working state', async () => {
    await importRows([{ email: 'dana@example.com' }])
    const lead = leadAt('dana@example.com') as Record<string, unknown>
    expect(lead).not.toHaveProperty('status')
    expect(lead).not.toHaveProperty('ownerUid')
    expect(lead).not.toHaveProperty('updatedAt')
  })
})

describe('one person is one document', () => {
  it('skips the second row of one file that names the same person', async () => {
    const out = await importRows([
      { email: 'dana@example.com', notes: 'first' },
      { email: '  DANA@Example.com ', notes: 'second' },
    ])
    expect(out.body).toMatchObject({
      received: 2,
      created: 1,
      merged: 0,
      skipped: [{ index: 1, email: 'dana@example.com', reason: 'duplicate' }],
    })
    expect(leadPaths()).toHaveLength(1)
    expect(leadAt('dana@example.com')).toMatchObject({
      notes: 'first',
      submissionCount: 1,
    })
  })

  /**
   * Across requests the door's own dedupe answers. The tally has to say
   * UPDATED rather than added, which is why the route reads the chunk's
   * ids before it writes any of them.
   */
  it('merges onto a person the site already holds, and counts it as updated', async () => {
    await importRows([{ email: 'dana@example.com', notes: 'first' }])
    const out = await importRows([{ email: 'dana@example.com', status: 'working' }])
    expect(out.body).toMatchObject({ created: 0, merged: 1, skipped: [] })
    expect(leadPaths()).toHaveLength(1)
    expect(leadAt('dana@example.com')).toMatchObject({
      notes: 'first',
      status: 'working',
      submissionCount: 2,
      sources: ['import'],
    })
  })

  it('keeps the capture history a real visitor left, and adds the file to it', async () => {
    const key = personKey('dana@example.com') as string
    docs.set(`hosts/${HOST_ID}/leads/${key}`, {
      email: 'dana@example.com',
      sources: ['signup'],
      submissionCount: 3,
      firstSeenAtMs: 1_000,
      capturedByHostIds: [HOST_ID],
    })
    const out = await importRows([{ email: 'dana@example.com', status: 'working' }])
    expect(out.body).toMatchObject({ created: 0, merged: 1 })
    expect(leadAt('dana@example.com')).toMatchObject({
      sources: ['signup', 'import'],
      submissionCount: 4,
      firstSeenAtMs: 1_000,
      status: 'working',
    })
  })

  it('skips a row whose address cannot be keyed, and hands it back', async () => {
    const out = await importRows([
      { email: 'not-an-address', name: 'Dana' },
      { email: 'ada@example.com' },
    ])
    expect(out.body).toMatchObject({
      created: 1,
      skipped: [{ index: 0, email: 'not-an-address', reason: 'invalid-email' }],
    })
    expect(leadPaths()).toHaveLength(1)
  })
})

describe('the platform lead ceiling', () => {
  it('refuses a new person by name once the site is full', async () => {
    leadCeiling = 1
    await importRows([{ email: 'dana@example.com' }])
    const out = await importRows([{ email: 'ada@example.com', notes: 'no room' }])
    expect(out.body).toMatchObject({
      created: 0,
      merged: 0,
      skipped: [{ index: 0, email: 'ada@example.com', reason: 'lead-ceiling' }],
    })
    expect(leadAt('ada@example.com')).toBeUndefined()
  })

  /**
   * The door's rule, kept by the route's own pre-check: a full site still
   * takes an UPDATE. Refusing a person already recorded buys no capacity
   * and costs the customer the source and the status they would have
   * learned.
   */
  it('still updates a person the site already holds', async () => {
    leadCeiling = 1
    await importRows([{ email: 'dana@example.com' }])
    const out = await importRows([{ email: 'dana@example.com', status: 'working' }])
    expect(out.body).toMatchObject({ created: 0, merged: 1, skipped: [] })
    expect(leadAt('dana@example.com')).toMatchObject({
      status: 'working',
      submissionCount: 2,
    })
  })

  it('counts the room it has used within one request', async () => {
    leadCeiling = 2
    const out = await importRows([
      { email: 'dana@example.com' },
      { email: 'ada@example.com' },
      { email: 'kit@example.com' },
    ])
    expect(out.body).toMatchObject({
      created: 2,
      skipped: [{ index: 2, email: 'kit@example.com', reason: 'lead-ceiling' }],
    })
    expect(leadPaths()).toHaveLength(2)
  })
})

describe('the consent group is the site’s own', () => {
  /**
   * A declared group pools a CONTACT's basis across its sites; a lead's is
   * never pooled, because `hosts/{hostId}/leads` cannot be swept by a
   * sibling site. The type is named here so a change to the door's group
   * choice has to come past this file.
   */
  it('reads back under the solo group the door wrote for', async () => {
    await importRows([{ email: 'dana@example.com' }])
    const group: ConsentGroup = soloConsentGroup(HOST_ID)
    expect(group.hostIds).toEqual([HOST_ID])
    expect(
      readMarketingBasis(leadAt('dana@example.com') ?? null, group).basis,
    ).toBe('unrecorded')
  })
})

/**
 * THE PLAN (AGL-2787): the leads file is the CRM suite's to import, included
 * from Starter, and refused for a Free workspace whoever is asking — before
 * any site's leads are read or written.
 */
describe('the plan (AGL-2787)', () => {
  it('refuses a Free workspace, filing no lead under any site', async () => {
    org = { ...org, plan: 'free' }
    const out = await importRows([{ email: 'dana@example.com', status: 'working' }])
    expect(out.code).toBe(403)
    expect(out.body).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(out.body.error).toMatch(/part of the CRM/)
    expect(out.body.error).toMatch(/Included from Starter/)
    expect(leadPaths()).toEqual([])
  })

  it('refuses staff importing into a Free workspace the same way', async () => {
    org = { ...org, plan: 'free' }
    decodedToken = { uid: 'staff-uid', staff: true }
    docs.set(`hosts/${HOST_ID}`, { memberRoles: {} })
    membership = null
    const out = await importRows([{ email: 'dana@example.com' }])
    expect(out.code).toBe(403)
    expect(out.body).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(leadPaths()).toEqual([])
  })

  it('admits Starter, the lowest plan that carries the suite', async () => {
    const out = await importRows([{ email: 'dana@example.com' }])
    expect(out.code).toBe(200)
    expect(out.body.created).toBe(1)
    expect(leadAt('dana@example.com')).toBeDefined()
  })
})
