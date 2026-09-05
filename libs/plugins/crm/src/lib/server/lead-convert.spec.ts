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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { DEFAULT_DEAL_STAGES } from '@aglyn/aglyn/server'
import { leadConvertHandler, stageForNewDeal } from './lead-convert'

/**
 * The lead conversion route (AGL-2608): one act, four writes, the lead
 * stamped last, and the contact only ever through `upsertHostContact`.
 *
 * Firestore is an in-memory map keyed by document path, so every assertion
 * reads what LANDED rather than what the handler answered. The upsert door
 * is a spy that also plants the contact the real one would, because the
 * route's contract with it is "call me, then find the row by email" and a
 * fake that returned an id would let the route skip the lookup the real
 * function forces on it.
 */

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

/** `FieldValue` sentinels and dotted paths, applied the way the SDK applies them. */
function applyWrite(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const next: Record<string, any> = { ...(existing ?? {}) }
  for (const [key, field] of Object.entries(value)) {
    let target = next
    let leaf = key
    if (key.includes('.')) {
      const parts = key.split('.')
      leaf = parts.pop() as string
      for (const part of parts) {
        target[part] = { ...(target[part] ?? {}) }
        target = target[part]
      }
    }
    if (field && typeof field === 'object' && '__arrayUnion' in field) {
      const before = Array.isArray(target[leaf]) ? target[leaf] : []
      target[leaf] = [
        ...before,
        ...(field.__arrayUnion as unknown[]).filter((item) => !before.includes(item)),
      ]
    } else if (field && typeof field === 'object' && '__increment' in field) {
      target[leaf] = Number(target[leaf] ?? 0) + Number(field.__increment)
    } else {
      target[leaf] = field
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
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? applyWrite(docs.get(path), value) : { ...value })
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, applyWrite(existing, value))
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

interface Filter {
  field: string
  value: unknown
}

function collectionRef(path: string): any {
  const make = (filters: Filter[], max: number | undefined): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`fake firestore: unsupported op ${op}`)
      return make([...filters, { field, value }], max)
    },
    limit: (n: number) => make(filters, n),
    // Document-id order is the map's insertion order, which is creation order.
    orderBy: () => make(filters, max),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) =>
          filters.every((filter) => snap.data()?.[filter.field] === filter.value),
        )
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    add: async (data: Record<string, any>) => {
      const ref = docRef(`${path}/auto-${++autoId}`)
      await ref.set(data)
      return ref
    },
  })
  return make([], undefined)
}

const fakeFirestore = {
  collection: (name: string) => collectionRef(name),
  /**
   * A batch as the link writer commits one: the queued writes applied in
   * order on `commit`, so a contact link and its company count land
   * together or not at all.
   */
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      set: (ref: any, value: Record<string, any>) =>
        void queued.push(() => ref.set(value)),
      update: (ref: any, value: Record<string, any>) =>
        void queued.push(() => ref.update(value)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

const all = (collectionPath: string): Array<Record<string, any>> =>
  childPaths(collectionPath).map((path) => ({
    id: path.split('/').pop() as string,
    ...docs.get(path),
  }))

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

const HOST = 'h1'
const ORG = 'org1'
const CALLER = 'uid-caller'

let mockOrg: Record<string, unknown> = {}
const mockVerifyIdToken = jest.fn(async () => ({ uid: CALLER }))
const mockResolveOrgPermissions = jest.fn(async () => ({
  orgId: ORG,
  role: 'editor',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'editor',
}))
/**
 * The upsert door, as a spy that plants the row the real one would: found by
 * normalized email under the org, created with the facet the call named.
 * `mockUpsertPlants` is switched off to model a band-full drop, where the real
 * function returns having written nothing.
 */
let mockUpsertPlants = true
const mockUpsertHostContact = jest.fn(async (options: any) => {
  if (!mockUpsertPlants) return
  const contacts = collectionRef(`orgs/${ORG}/contacts`)
  const found = await contacts.where('email', '==', options.email).limit(1).get()
  if (!found.empty) return
  await contacts.add({
    email: options.email,
    ...(options.name ? { name: options.name } : {}),
    hostId: options.hostId,
    visibleTo: [`host:${options.hostId}`],
    facets: {
      [options.hostId]: {
        sources: { [options.source]: true },
        interactions: [],
        ...(options.facet ?? {}),
      },
    },
  })
})

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    increment: (operand: number) => ({ __increment: operand }),
  },
  FieldPath: { documentId: () => '__name__' },
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: (...args: unknown[]) =>
    (mockResolveOrgPermissions as any)(...args),
}))

/** What the org's assignment pass answers for a contact with no owner (AGL-2618). */
let mockAssignment: Record<string, any> = { outcome: 'none', reason: 'no-rule' }
const mockAssignOwnerForCapture = jest.fn(async () => mockAssignment)
const mockNotifyRecordAssigned = jest.fn(async () => true)

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  // The route captures through the runtime wrapper so `contactCreated` fires
  // (AGL-2605); the double answers what the case under test needs.
  captureHostContact: (...args: unknown[]) => (mockUpsertHostContact as any)(...args),
  assignOwnerForCapture: (...args: unknown[]) => (mockAssignOwnerForCapture as any)(...args),
  notifyRecordAssigned: (...args: unknown[]) => (mockNotifyRecordAssigned as any)(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => (mockVerifyIdToken as any)(...args) }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === HOST ? { orgId: ORG, org: mockOrg } : null,
  // The real resolution's narrow answer: an org that declared no pooling
  // resolves every site to a group of one.
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('../../../../../aglyn/src/lib/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionRef(`orgs/${ORG}/${name}`),
  upsertHostContact: (...args: unknown[]) => (mockUpsertHostContact as any)(...args),
  // The real link writer (AGL-2613): the facet, the mirror and the count as
  // one commit are what the company assertions below read back.
  ...jest.requireActual(
    '../../../../../tenant/data/admin/src/lib/server/contact-company-link',
  ),
}))

// ---------------------------------------------------------------------------
// Driving the handler
// ---------------------------------------------------------------------------

async function call(
  body: unknown,
  options: { method?: string; token?: string | null } = {},
) {
  const { method = 'POST', token = 'token' } = options
  let status = 0
  let answer: any
  const headers: Record<string, unknown> = {}
  const res: PluginApiResponse = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    send: (value: unknown) => {
      answer = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  const req = {
    method,
    query: {},
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await leadConvertHandler(req, res)
  return { status, body: answer, headers }
}

const leadPath = (id: string) => `hosts/${HOST}/leads/${id}`

beforeEach(() => {
  docs.clear()
  autoId = 0
  mockOrg = {}
  mockUpsertPlants = true
  mockUpsertHostContact.mockClear()
  mockAssignment = { outcome: 'none', reason: 'no-rule' }
  mockAssignOwnerForCapture.mockClear()
  mockNotifyRecordAssigned.mockClear()
  mockVerifyIdToken.mockClear()
  mockResolveOrgPermissions.mockClear()
  mockResolveOrgPermissions.mockResolvedValue({
    orgId: ORG,
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  } as never)
  docs.set(leadPath('lead-1'), {
    email: 'Ann@Acme.com',
    name: 'Ann Lee',
    sources: ['form'],
    submissionCount: 1,
    lastSeenAtMs: 1_000,
  })
})

describe('the door', () => {
  it('answers only a POST', async () => {
    const { status, headers } = await call({}, { method: 'GET' })
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
  })

  it('refuses a caller with no token', async () => {
    const { status } = await call({ hostId: HOST, leadId: 'lead-1' }, { token: null })
    expect(status).toBe(401)
    expect(mockUpsertHostContact).not.toHaveBeenCalled()
  })

  it('refuses a member without the data permission, and one without a role on the site', async () => {
    mockResolveOrgPermissions.mockResolvedValueOnce({
      orgId: ORG,
      role: 'viewer',
      isOwner: false,
      permissions: { 'data.manage': false },
      orgWide: true,
      hostRole: 'viewer',
    } as never)
    expect((await call({ hostId: HOST, leadId: 'lead-1' })).status).toBe(403)
    mockResolveOrgPermissions.mockResolvedValueOnce({
      orgId: ORG,
      role: 'editor',
      isOwner: false,
      permissions: { 'data.manage': true },
      orgWide: false,
      hostRole: null,
    } as never)
    expect((await call({ hostId: HOST, leadId: 'lead-1' })).status).toBe(403)
    expect(mockUpsertHostContact).not.toHaveBeenCalled()
    expect(docs.get(leadPath('lead-1'))?.status).toBeUndefined()
  })

  it('refuses a lead whose address cannot become a contact', async () => {
    docs.set(leadPath('lead-bad'), { email: 'not an address' })
    const { status } = await call({ hostId: HOST, leadId: 'lead-bad' })
    expect(status).toBe(422)
    expect(mockUpsertHostContact).not.toHaveBeenCalled()
  })
})

describe('converting a lead', () => {
  it('creates the contact through the upsert door and stamps the lead with it', async () => {
    const { status, body } = await call({ hostId: HOST, leadId: 'lead-1' })
    expect(status).toBe(200)
    expect(mockUpsertHostContact).toHaveBeenCalledTimes(1)
    expect(mockUpsertHostContact).toHaveBeenCalledWith({
      hostId: HOST,
      email: 'ann@acme.com',
      name: 'Ann Lee',
      source: 'manual',
      interaction: { summary: 'Converted from a lead', refId: 'lead-1' },
      facet: { lifecycleStage: 'sales-qualified' },
    })
    const [contact] = all(`orgs/${ORG}/contacts`)
    expect(body).toEqual({
      ok: true,
      contactId: contact.id,
      alreadyConverted: false,
    })
    const lead = docs.get(leadPath('lead-1'))
    expect(lead?.status).toBe('qualified')
    expect(lead?.convertedContactId).toBe(contact.id)
    expect(lead?.convertedAtMs).toEqual(expect.any(Number))
    // Nobody chose and no rule assigned, so the converter owns what they made.
    expect(lead?.ownerUid).toBe(CALLER)
    expect(contact.facets[HOST].ownerUid).toBe(CALLER)
    expect(mockNotifyRecordAssigned).not.toHaveBeenCalled()
    expect(lead?.dealId).toBeUndefined()
    expect(lead?.companyId).toBeUndefined()
    // What the capture door wrote is still there — the stamp is an update.
    expect(lead?.sources).toEqual(['form'])
  })

  it("prefers the lead's owner to the caller, and the body's owner to both", async () => {
    docs.set(leadPath('lead-1'), { ...docs.get(leadPath('lead-1')), ownerUid: 'uid-rep' })
    await call({ hostId: HOST, leadId: 'lead-1' })
    expect(mockUpsertHostContact.mock.calls[0][0].facet.ownerUid).toBe('uid-rep')

    docs.set(leadPath('lead-2'), { email: 'bo@acme.com', ownerUid: 'uid-rep' })
    await call({ hostId: HOST, leadId: 'lead-2', ownerUid: 'uid-manager' })
    expect(mockUpsertHostContact.mock.calls[1][0].facet.ownerUid).toBe('uid-manager')
    expect(docs.get(leadPath('lead-2'))?.ownerUid).toBe('uid-manager')
    // A person chose, so the rules were not asked.
    expect(mockAssignOwnerForCapture).not.toHaveBeenCalled()
  })

  it('tells a colleague the converter picked, and not the lead’s own owner or the caller (AGL-2618)', async () => {
    docs.set(leadPath('lead-1'), { ...docs.get(leadPath('lead-1')), ownerUid: 'uid-rep' })
    await call({ hostId: HOST, leadId: 'lead-1' })
    expect(mockNotifyRecordAssigned).not.toHaveBeenCalled()

    docs.set(leadPath('lead-2'), { email: 'bo@acme.com', name: 'Bo' })
    await call({ hostId: HOST, leadId: 'lead-2', ownerUid: 'uid-manager' })
    expect(mockNotifyRecordAssigned).toHaveBeenCalledTimes(1)
    const [contact] = all(`orgs/${ORG}/contacts`).filter((c) => c['email'] === 'bo@acme.com')
    expect(mockNotifyRecordAssigned).toHaveBeenCalledWith({
      hostId: HOST,
      orgId: ORG,
      ownerUid: 'uid-manager',
      actorUid: CALLER,
      record: { kind: 'contact', id: contact.id },
      who: 'Bo',
    })

    // The converter naming themselves is the helper's self case: it is
    // handed the actor and declines, which is the one place that rule lives.
    docs.set(leadPath('lead-3'), { email: 'cy@acme.com' })
    await call({ hostId: HOST, leadId: 'lead-3', ownerUid: CALLER })
    expect(mockNotifyRecordAssigned).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerUid: CALLER, actorUid: CALLER }),
    )
  })

  it('lets the org’s assignment rules own a contact nobody chose an owner for (AGL-2618)', async () => {
    mockAssignment = { outcome: 'assigned', ownerUid: 'uid-rules', by: 'rule', leadMirrored: true, notified: true }
    const { body } = await call({ hostId: HOST, leadId: 'lead-1', deal: { title: 'Acme' } })
    expect(mockAssignOwnerForCapture).toHaveBeenCalledWith({
      hostId: HOST,
      contactId: body.contactId,
      email: 'ann@acme.com',
      source: 'manual',
      actorUid: CALLER,
    })
    expect(docs.get(leadPath('lead-1'))?.ownerUid).toBe('uid-rules')
    expect(all(`orgs/${ORG}/deals`)[0]['ownerUid']).toBe('uid-rules')
    // The pass told the owner itself; the route does not tell them twice.
    expect(mockNotifyRecordAssigned).not.toHaveBeenCalled()
  })

  it('keeps the owner a contact the org already held (AGL-2618)', async () => {
    await collectionRef(`orgs/${ORG}/contacts`).add({
      email: 'ann@acme.com',
      visibleTo: [`host:${HOST}`],
      facets: { [HOST]: { ownerUid: 'uid-held' } },
    })
    await call({ hostId: HOST, leadId: 'lead-1' })
    expect(mockAssignOwnerForCapture).not.toHaveBeenCalled()
    expect(docs.get(leadPath('lead-1'))?.ownerUid).toBe('uid-held')
  })

  it('creates the company and the deal, seeding the Sales pipeline when the org has none', async () => {
    const { status, body } = await call({
      hostId: HOST,
      leadId: 'lead-1',
      createCompany: { name: '  Acme Coffee ', domain: 'https://www.Acme.com/about' },
      deal: { title: 'Acme — first order', amountCents: 12_500.4, currency: 'USD' },
    })
    expect(status).toBe(200)

    const [company] = all(`orgs/${ORG}/companies`)
    expect(company).toMatchObject({
      name: 'Acme Coffee',
      nameLower: 'acme coffee',
      nameTokens: expect.arrayContaining(['acme', 'coffee']),
      domain: 'acme.com',
      ownerUid: CALLER,
      visibleTo: ['host:h1'],
      hostId: HOST,
      createdByUid: CALLER,
    })

    const [contact] = all(`orgs/${ORG}/contacts`)
    // Both shapes of the association, in step — and the company counts the
    // person it just gained (AGL-2613).
    expect(contact.companyIds).toEqual([company.id])
    expect(contact.facets[HOST].companyId).toBe(company.id)
    expect(company.contactsCount).toBe(1)

    const pipelines = all(`orgs/${ORG}/pipelines`)
    expect(pipelines).toHaveLength(1)
    expect(pipelines[0]).toMatchObject({
      name: 'Sales',
      isDefault: true,
      visibleTo: ['host:h1'],
      hostId: HOST,
    })
    expect(pipelines[0].stages).toEqual(DEFAULT_DEAL_STAGES)
    // A COPY — the module's default set must not be the document's array.
    expect(pipelines[0].stages).not.toBe(DEFAULT_DEAL_STAGES)

    const [deal] = all(`orgs/${ORG}/deals`)
    expect(deal).toMatchObject({
      title: 'Acme — first order',
      titleLower: 'acme — first order',
      pipelineId: pipelines[0].id,
      stageId: 'qualified',
      status: 'open',
      amountCents: 12_500,
      currency: 'usd',
      ownerUid: CALLER,
      contactId: contact.id,
      companyId: company.id,
      visibleTo: ['host:h1'],
      hostId: HOST,
      createdByUid: CALLER,
    })
    expect(deal.stageChangedAtMs).toEqual(expect.any(Number))

    expect(body).toEqual({
      ok: true,
      contactId: contact.id,
      companyId: company.id,
      dealId: deal.id,
      alreadyConverted: false,
    })
    expect(docs.get(leadPath('lead-1'))).toMatchObject({
      status: 'qualified',
      convertedContactId: contact.id,
      companyId: company.id,
      dealId: deal.id,
    })
  })

  it('stamps org-wide scope when the org has chosen it', async () => {
    mockOrg = { defaultResourceScope: 'org' }
    await call({
      hostId: HOST,
      leadId: 'lead-1',
      createCompany: { name: 'Acme' },
      deal: { title: 'Acme' },
    })
    expect(all(`orgs/${ORG}/companies`)[0].visibleTo).toEqual(['org'])
    expect(all(`orgs/${ORG}/pipelines`)[0].visibleTo).toEqual(['org'])
    expect(all(`orgs/${ORG}/deals`)[0].visibleTo).toEqual(['org'])
  })

  it('reuses a company the caller can see by domain rather than minting a second', async () => {
    // One the caller cannot see shares the domain and must NOT be picked.
    docs.set(`orgs/${ORG}/companies/co-hidden`, {
      name: 'Acme (other client)',
      domain: 'acme.com',
      visibleTo: ['host:elsewhere'],
    })
    docs.set(`orgs/${ORG}/companies/co-1`, {
      name: 'Acme',
      domain: 'acme.com',
      visibleTo: ['host:h1'],
    })
    const { body } = await call({
      hostId: HOST,
      leadId: 'lead-1',
      createCompany: { name: 'Acme Inc', domain: 'acme.com' },
    })
    expect(body.companyId).toBe('co-1')
    expect(all(`orgs/${ORG}/companies`)).toHaveLength(2)
    expect(all(`orgs/${ORG}/contacts`)[0].companyIds).toEqual(['co-1'])
  })

  it('links an existing company by id and refuses one that does not exist', async () => {
    docs.set(`orgs/${ORG}/companies/co-1`, { name: 'Acme', visibleTo: ['host:h1'] })
    const missing = await call({ hostId: HOST, leadId: 'lead-1', companyId: 'co-nope' })
    expect(missing.status).toBe(404)
    // The contact exists — the upsert ran — but the lead is untouched, so the
    // converter can try again with the right company.
    expect(docs.get(leadPath('lead-1'))?.status).toBeUndefined()

    const linked = await call({ hostId: HOST, leadId: 'lead-1', companyId: 'co-1' })
    expect(linked.status).toBe(200)
    expect(linked.body.companyId).toBe('co-1')
    expect(all(`orgs/${ORG}/contacts`)).toHaveLength(1)
    expect(docs.get(`orgs/${ORG}/companies/co-1`)?.contactsCount).toBe(1)
  })

  it('opens the deal in the existing default pipeline, at the stage asked for', async () => {
    docs.set(`orgs/${ORG}/pipelines/p-1`, {
      name: 'Sales',
      isDefault: true,
      stages: [...DEFAULT_DEAL_STAGES],
      visibleTo: ['host:h1'],
    })
    const { body } = await call({
      hostId: HOST,
      leadId: 'lead-1',
      deal: { title: 'Acme', stageId: 'proposal-sent' },
    })
    expect(all(`orgs/${ORG}/pipelines`)).toHaveLength(1)
    const [deal] = all(`orgs/${ORG}/deals`)
    expect(deal.pipelineId).toBe('p-1')
    expect(deal.stageId).toBe('proposal-sent')
    expect(deal.status).toBe('open')
    expect(body.dealId).toBe(deal.id)
  })

  it('answers the same contact on a second call and creates nothing more', async () => {
    const first = await call({ hostId: HOST, leadId: 'lead-1', deal: { title: 'Acme' } })
    const second = await call({ hostId: HOST, leadId: 'lead-1', deal: { title: 'Acme' } })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({
      ok: true,
      contactId: first.body.contactId,
      dealId: first.body.dealId,
      alreadyConverted: true,
    })
    expect(all(`orgs/${ORG}/deals`)).toHaveLength(1)
    expect(mockUpsertHostContact).toHaveBeenCalledTimes(1)
  })

  it('answers 409 and leaves the lead alone when the upsert produced no contact', async () => {
    mockUpsertPlants = false
    const { status } = await call({ hostId: HOST, leadId: 'lead-1', deal: { title: 'Acme' } })
    expect(status).toBe(409)
    expect(all(`orgs/${ORG}/deals`)).toHaveLength(0)
    expect(docs.get(leadPath('lead-1'))?.status).toBeUndefined()
  })

  it('refuses a malformed company domain and an untitled deal before reading anything', async () => {
    const domain = await call({
      hostId: HOST,
      leadId: 'lead-1',
      createCompany: { name: 'Acme', domain: 'acme' },
    })
    expect(domain.status).toBe(400)
    const title = await call({ hostId: HOST, leadId: 'lead-1', deal: { title: '  ' } })
    expect(title.status).toBe(400)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })
})

describe('stageForNewDeal', () => {
  const stages = [...DEFAULT_DEAL_STAGES]

  it('takes the requested stage when the pipeline has it', () => {
    expect(stageForNewDeal({ stages }, 'negotiation')?.id).toBe('negotiation')
  })

  it('falls back to the first open stage by order, whatever the array order', () => {
    expect(stageForNewDeal({ stages: [...stages].reverse() }, undefined)?.id).toBe(
      'qualified',
    )
    expect(stageForNewDeal({ stages }, 'not-a-stage')?.id).toBe('qualified')
  })

  it('never defaults into a closed stage while an open one exists', () => {
    const closedFirst = [
      { id: 'lost', name: 'Lost', order: 0, probability: 0, kind: 'lost' as const },
      { id: 'open', name: 'Open', order: 1, probability: 50, kind: 'open' as const },
    ]
    expect(stageForNewDeal({ stages: closedFirst }, undefined)?.id).toBe('open')
  })

  it('answers null for a pipeline with no stages', () => {
    expect(stageForNewDeal({ stages: [] }, undefined)).toBeNull()
  })
})
