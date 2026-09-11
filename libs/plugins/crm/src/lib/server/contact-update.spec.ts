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
 * `crm/contact-update` — the console's one writer of a contact's facets
 * (AGL-2804).
 *
 * What is pinned here:
 *
 *  1. THE GATE. A method other than POST, a body without a scope, contacts
 *     or readable fields, and a caller the rules would refuse a write are
 *     each refused before a contact is read.
 *  2. THE PLAN. The suite's fields — owner, company, custom values, files —
 *     are refused to a Free workspace with `plan_required` before a contact
 *     is read, and Starter is admitted. The profile a capture writes, tags,
 *     notes and campaign filing are saved on Free.
 *  3. THE WRITE. One dotted `update()` per contact into ONE holder's facet,
 *     with the echoes, the company link's mirror, label and count, and the
 *     tag cap — and nothing of another holder's.
 *  4. THE SCOPE. A contact this site cannot see, or that is gone, is refused
 *     on its own row and nothing is written to it; at the organization level
 *     each contact is written through its own primary holder.
 *
 * The Admin SDK is an in-memory store that applies dotted paths and the
 * FieldValue sentinels the way Firestore does, and the assertions read the
 * store back. `@aglyn/aglyn/server` is the REAL module, so the facet path,
 * the consent groups, the custom-field judgment and the phone normalizer
 * are the ones the route ships with.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const getOrgDoc = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const resolveOrgPermissions = jest.fn()
/** Every read of contacts by id — what a refusal before the read must never reach. */
const readContacts = jest.fn()

type Doc = Record<string, any>
let store: Record<string, Doc> = {}
/** Every contact `update()` that landed, in order. */
let contactWrites: Array<{ path: string; patch: Doc }> = []
let failBatches = false
/** Documents whose single `update()` is refused, for the fallback case. */
let refuseUpdate = new Set<string>()

/** A dotted-path update, as Firestore applies one, sentinels included. */
function applyPatch(target: Doc, patch: Doc): Doc {
  const next: Doc = JSON.parse(JSON.stringify(target))
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    let node = next
    for (const key of keys.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== 'object') node[key] = {}
      node = node[key]
    }
    const leaf = keys[keys.length - 1]
    const op = value && typeof value === 'object' ? value.__sentinel : undefined
    if (op === 'delete') delete node[leaf]
    else if (op === 'serverTimestamp') node[leaf] = 'server-time'
    else if (op === 'arrayUnion') {
      node[leaf] = [...new Set([...(node[leaf] ?? []), ...value.values])]
    } else if (op === 'arrayRemove') {
      node[leaf] = (node[leaf] ?? []).filter((entry: unknown) => !value.values.includes(entry))
    } else if (op === 'increment') node[leaf] = Number(node[leaf] ?? 0) + value.by
    else node[leaf] = JSON.parse(JSON.stringify(value))
  }
  return next
}

const snapshotOf = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  ref: docHandle(path),
  exists: path in store,
  get: (field: string) => store[path]?.[field],
  data: () => (path in store ? JSON.parse(JSON.stringify(store[path])) : undefined),
})

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get: async () => snapshotOf(path),
  update: async (patch: Doc) => {
    if (!(path in store) || refuseUpdate.has(path)) {
      throw Object.assign(new Error(`no update at ${path}`), { code: 5 })
    }
    store[path] = applyPatch(store[path], patch)
    if (path.includes('/contacts/')) contactWrites.push({ path, patch })
  },
  delete: async () => {
    delete store[path]
  },
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const childrenOf = (path: string) =>
  Object.keys(store).filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )

const queryHandle = (path: string, cap?: number): any => ({
  limit: (count: number) => queryHandle(path, count),
  get: async () => {
    const docs = childrenOf(path).slice(0, cap ?? Infinity).map(snapshotOf)
    return { docs, empty: docs.length === 0, size: docs.length }
  },
})

const collectionHandle = (path: string): any => ({
  ...queryHandle(path),
  doc: (id: string) => docHandle(`${path}/${id}`),
})

const firestoreHandle = {
  collection: (name: string) => collectionHandle(name),
  getAll: async (...refs: Array<{ path: string }>) => {
    readContacts(refs.map((ref) => ref.path))
    return refs.map((ref) => snapshotOf(ref.path))
  },
  batch: () => {
    const staged: Array<{ ref: any; patch: Doc }> = []
    return {
      update: (ref: any, patch: Doc) => void staged.push({ ref, patch }),
      commit: async () => {
        // A batch is all or nothing: one refused document refuses them all.
        if (failBatches || staged.some(({ ref }) => !(ref.path in store))) {
          throw new Error('the batch was refused')
        }
        for (const { ref, patch } of staged) await ref.update(patch)
      },
    }
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    delete: () => ({ __sentinel: 'delete' }),
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    arrayUnion: (...values: unknown[]) => ({ __sentinel: 'arrayUnion', values }),
    arrayRemove: (...values: unknown[]) => ({ __sentinel: 'arrayRemove', values }),
    increment: (by: number) => ({ __sentinel: 'increment', by }),
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: jest.fn(),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) => resolveOrgPermissions(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  // The Admin-sentinel spellers of the link planner are the REAL ones.
  const link = jest.requireActual(
    '../../../../../tenant/data/admin/src/lib/server/contact-company-link',
  )
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
        firestore: () => firestoreHandle,
      }),
    },
    getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
    getOrgDoc: (...args: unknown[]) => getOrgDoc(...args),
    resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
    memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
    notifyUsers: jest.fn(),
    recomputeCrmNextTaskAt: jest.fn(),
    crmNextActivityLinksOf: jest.fn(),
    contactCompanyLinkFields: link.contactCompanyLinkFields,
    companyContactsCountFields: link.companyContactsCountFields,
  }
})

import { crmContactUpdateHandler } from './contact-update'

const ORG_ID = 'org-1'
const HOST = 'host-1'
const OTHER_HOST = 'host-2'
const CONTACTS = `orgs/${ORG_ID}/contacts`
const COMPANIES = `orgs/${ORG_ID}/companies`

/** The caller the token `good` verifies as. */
let caller: Record<string, unknown>
/** The org both sites belong to; Starter is the lowest plan carrying the suite. */
let org: Record<string, unknown>
/** The organization's member documents, by uid. */
let members: Record<string, Record<string, unknown>>

async function post(
  body: Record<string, unknown>,
  options: { token?: string | null; method?: string } = {},
) {
  const token = options.token === undefined ? 'good' : options.token
  let status = 0
  let payload: any
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    send: () => undefined,
    end: () => undefined,
    redirect: () => undefined,
  }
  await crmContactUpdateHandler(
    {
      method: options.method ?? 'POST',
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return { status, payload, headers }
}

/** A request under the site, for `ada` unless it names others. */
const onSite = (set: Record<string, unknown>, contactIds: string[] = ['ada']) => ({
  hostId: HOST,
  contactIds,
  set,
})
const contact = (id: string) => store[`${CONTACTS}/${id}`]
const facetOf = (id: string, holder = HOST) => contact(id)?.facets?.[holder]

beforeEach(() => {
  jest.clearAllMocks()
  failBatches = false
  refuseUpdate = new Set()
  contactWrites = []
  caller = { uid: 'editor-uid' }
  org = { plan: 'starter' }
  members = {
    'editor-uid': { role: 'editor', allHosts: true, scopeTokens: ['org'] },
    'owner-uid': { role: 'owner', allHosts: true, scopeTokens: ['org'] },
    'scoped-uid': {
      role: 'editor',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      scopeTokens: ['org', `host:${HOST}`],
    },
    'viewer-uid': { role: 'viewer', allHosts: true, scopeTokens: ['org'] },
  }
  verifyIdToken.mockImplementation(async (token: string) => {
    if (token !== 'good') throw new Error('bad token')
    return caller
  })
  getOrgForHost.mockImplementation(async (hostId: string) =>
    [HOST, OTHER_HOST].includes(hostId) ? { orgId: ORG_ID, org } : null,
  )
  getOrgDoc.mockImplementation(async (orgId: string) => (orgId === ORG_ID ? org : null))
  resolveOrgMembership.mockImplementation(async (uid: string) =>
    members[uid] ? { orgId: ORG_ID, member: { $id: uid, ...members[uid] } } : null,
  )
  memberHasOrgPermission.mockImplementation(
    async (_orgId: string, member: { role?: string }) => member?.role !== 'viewer',
  )
  resolveOrgPermissions.mockImplementation(async (uid: string) =>
    members[uid]
      ? {
          orgId: ORG_ID,
          orgWide: members[uid]['allHosts'] === true,
          role: members[uid]['role'],
          permissions: { 'data.manage': members[uid]['role'] !== 'viewer' },
        }
      : null,
  )
  store = {
    [`${CONTACTS}/ada`]: {
      email: 'ada@example.test',
      visibleTo: [`host:${HOST}`, `host:${OTHER_HOST}`],
      capturedByHostIds: [HOST, OTHER_HOST],
      phone: '+15125550100',
      facets: {
        [HOST]: {
          sources: { form: true },
          interactions: [],
          tags: ['vip'],
          phone: '+15125550100',
          jobTitle: 'Engineer',
          ownerUid: 'owner-uid',
          lifecycleStage: 'lead',
          custom: { tier: 'gold' },
        },
        // Another site's reading of the same person.
        [OTHER_HOST]: {
          sources: { form: true },
          interactions: [],
          notes: 'Their notes',
          ownerUid: 'editor-uid',
        },
      },
    },
    [`${CONTACTS}/bea`]: {
      email: 'bea@example.test',
      visibleTo: [`host:${HOST}`],
      capturedByHostIds: [HOST],
      facets: {
        [HOST]: {
          sources: {},
          interactions: [],
          tags: Array.from({ length: 20 }, (_, index) => `t${index}`),
        },
      },
    },
    [`${CONTACTS}/theirs`]: {
      email: 'theirs@example.test',
      visibleTo: [`host:${OTHER_HOST}`],
      capturedByHostIds: [OTHER_HOST],
      facets: { [OTHER_HOST]: { sources: {}, interactions: [] } },
    },
    // Held by nobody: an org-wide row no capture ever attributed.
    [`${CONTACTS}/nobody`]: { email: 'nobody@example.test', visibleTo: ['org'] },
    [`${COMPANIES}/co-acme`]: { name: 'Acme', visibleTo: [`host:${HOST}`], contactsCount: 0 },
    [`${COMPANIES}/co-hidden`]: {
      name: 'Hidden',
      visibleTo: [`host:${OTHER_HOST}`],
      contactsCount: 0,
    },
    [`orgs/${ORG_ID}/contactFields/f-tier`]: {
      key: 'tier',
      label: 'Tier',
      type: 'select',
      options: ['gold', 'platinum'],
      order: 1,
    },
    [`orgs/${ORG_ID}/contactFields/f-size`]: {
      key: 'size',
      label: 'Size',
      type: 'number',
      order: 2,
    },
  }
})

describe('the gate', () => {
  it('refuses any method but POST, before reading a token', async () => {
    const { status, headers } = await post(onSite({ notes: 'x' }), { method: 'GET' })
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it('refuses a body with no scope, no contacts or no readable field, before reading a token', async () => {
    expect((await post({ contactIds: ['ada'], set: { notes: 'x' } })).status).toBe(400)
    expect((await post({ hostId: HOST, set: { notes: 'x' } })).status).toBe(400)
    const tooMany = Array.from({ length: 201 }, (_, index) => `c${index}`)
    expect((await post(onSite({ notes: 'x' }, tooMany))).status).toBe(400)
    expect((await post(onSite({}))).status).toBe(400)
    const unknown = await post(onSite({ email: 'moved@example.test' }))
    expect(unknown.status).toBe(400)
    expect(unknown.payload.error).toMatch(/email/)
    const phone = await post(onSite({ phone: 'call me maybe' }))
    expect(phone.status).toBe(400)
    expect(phone.payload.error).toMatch(/phone number could not be read/)
    const both = await post(onSite({ tags: ['vip'], addTag: 'beta' }))
    expect(both.status).toBe(400)
    expect(verifyIdToken).not.toHaveBeenCalled()
    expect(contactWrites).toEqual([])
  })

  it('refuses a caller with no token', async () => {
    const { status } = await post(onSite({ notes: 'x' }), { token: null })
    expect(status).toBe(401)
    expect(readContacts).not.toHaveBeenCalled()
  })

  it('refuses a viewer, and a collaborator on a site their access does not reach', async () => {
    caller = { uid: 'viewer-uid' }
    const viewer = await post(onSite({ notes: 'x' }))
    expect(viewer.status).toBe(403)
    expect(viewer.payload.reason).toBeUndefined()
    caller = { uid: 'scoped-uid' }
    const elsewhere = await post({ hostId: OTHER_HOST, contactIds: ['theirs'], set: { notes: 'x' } })
    expect(elsewhere.status).toBe(403)
    expect(readContacts).not.toHaveBeenCalled()
    expect(contactWrites).toEqual([])
  })
})

/**
 * THE PLAN (AGL-2804). The suite's fields are refused to a plan without the
 * suite once the caller is known to be a writer, and before any contact is
 * read — the same answer the console's locks give, where a script holding a
 * member's token cannot walk round it.
 */
describe('the plan', () => {
  it.each([
    ['an owner', { ownerUid: 'owner-uid' }],
    ['a company', { companyId: 'co-acme' }],
    ['a company label', { companyName: 'Acme' }],
    ['a custom value', { custom: { tier: 'platinum' } }],
    ['a file', { mediaIds: ['media-1'] }],
  ])('refuses a Free workspace %s before any contact is read', async (_label, set) => {
    org = { plan: 'free' }
    const { status, payload } = await post(onSite(set))
    expect(status).toBe(403)
    expect(payload).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(payload.error).toMatch(/part of the CRM suite/)
    expect(payload.error).toMatch(/Included from Starter/)
    expect(readContacts).not.toHaveBeenCalled()
    expect(contactWrites).toEqual([])
    expect(facetOf('ada').ownerUid).toBe('owner-uid')
  })

  it('refuses a Free workspace a suite field even beside the fields Free keeps', async () => {
    org = { plan: 'free' }
    const { status } = await post(onSite({ notes: 'A note', ownerUid: 'editor-uid' }))
    expect(status).toBe(403)
    expect(contactWrites).toEqual([])
    expect(facetOf('ada').notes).toBeUndefined()
  })

  it('tells a viewer on a Free workspace about the role, not the plan', async () => {
    org = { plan: 'free' }
    caller = { uid: 'viewer-uid' }
    const { status, payload } = await post(onSite({ ownerUid: 'owner-uid' }))
    expect(status).toBe(403)
    expect(payload.reason).toBeUndefined()
  })

  it('admits Starter to the suite fields', async () => {
    org = { plan: 'starter' }
    const { status, payload } = await post(
      onSite({ ownerUid: 'editor-uid', custom: { tier: 'platinum' }, mediaIds: ['media-1'] }),
    )
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, results: [{ contactId: 'ada', ok: true }] })
    expect(facetOf('ada')).toMatchObject({
      ownerUid: 'editor-uid',
      custom: { tier: 'platinum' },
      mediaIds: ['media-1'],
    })
  })

  it('saves the profile a capture writes, tags, notes and campaign filing on Free', async () => {
    org = { plan: 'free' }
    const { status, payload } = await post(
      onSite({
        name: 'Ada L.',
        phone: '(512) 555-0199',
        jobTitle: 'Founder',
        address: { line1: ' 1 Main St ', city: 'Austin', country: 'us' },
        notes: 'Prefers email',
        tags: ['VIP', ' beta ', 'vip'],
        campaignIds: ['spring', 'spring'],
      }),
    )
    expect(status).toBe(200)
    expect(payload.results).toEqual([{ contactId: 'ada', ok: true }])
    expect(facetOf('ada')).toMatchObject({
      name: 'Ada L.',
      phone: '+15125550199',
      jobTitle: 'Founder',
      address: { line1: '1 Main St', city: 'Austin', country: 'US' },
      notes: 'Prefers email',
      tags: ['vip', 'beta'],
      campaignIds: ['spring'],
      // The suite's fields are where they were.
      ownerUid: 'owner-uid',
      lifecycleStage: 'lead',
    })
    // The phone's search echo.
    expect(contact('ada').phone).toBe('+15125550199')
  })

  it('adds a tag on Free', async () => {
    org = { plan: 'free' }
    const { status } = await post(onSite({ addTag: 'Wholesale' }))
    expect(status).toBe(200)
    expect(facetOf('ada').tags).toEqual(['vip', 'wholesale'])
  })
})

describe('the write', () => {
  it("lands in this site's facet by dotted path, and leaves another holder's untouched", async () => {
    const before = JSON.stringify(facetOf('ada', OTHER_HOST))
    await post(onSite({ notes: 'Called on Monday', ownerUid: 'editor-uid' }))
    expect(contactWrites).toHaveLength(1)
    for (const key of Object.keys(contactWrites[0].patch)) {
      expect([key, key.startsWith(`facets.${HOST}.`) || key === 'updatedAt']).toEqual([key, true])
    }
    expect(JSON.stringify(facetOf('ada', OTHER_HOST))).toBe(before)
    expect(contact('ada').updatedAt).toBe('server-time')
  })

  it('clears a text field sent empty rather than storing an empty string', async () => {
    await post(onSite({ phone: '', jobTitle: '', name: '' }))
    expect(facetOf('ada')).not.toHaveProperty('phone')
    expect(facetOf('ada')).not.toHaveProperty('jobTitle')
    expect(facetOf('ada')).not.toHaveProperty('name')
    expect(contact('ada')).not.toHaveProperty('phone')
  })

  it("links a company: the facet, the mirror, the company's own name and its count", async () => {
    const { status } = await post(onSite({ companyId: 'co-acme' }))
    expect(status).toBe(200)
    expect(facetOf('ada')).toMatchObject({ companyId: 'co-acme', companyName: 'Acme' })
    expect(contact('ada').companyName).toBe('Acme')
    expect(contact('ada').companyIds).toEqual(['co-acme'])
    expect(store[`${COMPANIES}/co-acme`].contactsCount).toBe(1)
  })

  it('unlinks with null, clearing the label and moving the count back', async () => {
    store[`${CONTACTS}/ada`].companyIds = ['co-acme']
    store[`${CONTACTS}/ada`].companyName = 'Acme'
    Object.assign(store[`${CONTACTS}/ada`].facets[HOST], {
      companyId: 'co-acme',
      companyName: 'Acme',
    })
    store[`${COMPANIES}/co-acme`].contactsCount = 1
    const { status } = await post(onSite({ companyId: null }))
    expect(status).toBe(200)
    expect(facetOf('ada')).not.toHaveProperty('companyId')
    expect(facetOf('ada')).not.toHaveProperty('companyName')
    expect(contact('ada')).not.toHaveProperty('companyName')
    expect(contact('ada').companyIds).toEqual([])
    expect(store[`${COMPANIES}/co-acme`].contactsCount).toBe(0)
  })

  it('refuses a company this site cannot see, writing nothing', async () => {
    const { status, payload } = await post(onSite({ companyId: 'co-hidden' }))
    expect(status).toBe(404)
    expect(payload).toEqual({ error: 'Unknown company' })
    expect(contactWrites).toEqual([])
  })

  it('judges custom values against the definitions, and refuses what they do not allow', async () => {
    expect((await post(onSite({ custom: { tier: 'platinum' } }))).status).toBe(200)
    expect(facetOf('ada').custom).toEqual({ tier: 'platinum' })
    const wrongType = await post(onSite({ custom: { size: 'big' } }))
    expect(wrongType.status).toBe(400)
    expect(wrongType.payload.error).toBe('Must be a number')
    const unknown = await post(onSite({ custom: { mood: 'sunny' } }))
    expect(unknown.status).toBe(400)
    expect(facetOf('ada').custom).toEqual({ tier: 'platinum' })
  })

  it('refuses an owner who is not a member of the organization', async () => {
    const { status, payload } = await post(onSite({ ownerUid: 'stranger-uid' }))
    expect(status).toBe(400)
    expect(payload.error).toMatch(/not a member/)
    expect(contactWrites).toEqual([])
  })

  it("adds a tag with a union, and refuses a row already at the drawer's cap by name", async () => {
    const { status, payload } = await post(onSite({ addTag: ' Wholesale ' }, ['ada', 'bea']))
    expect(status).toBe(200)
    expect(payload.results).toEqual([
      { contactId: 'ada', ok: true },
      { contactId: 'bea', ok: false, error: 'already has 20 tags' },
    ])
    expect(facetOf('ada').tags).toEqual(['vip', 'wholesale'])
    expect(facetOf('bea').tags).toHaveLength(20)
    expect(contactWrites.map((write) => write.path)).toEqual([`${CONTACTS}/ada`])
  })

  it('removes a tag only where it is carried', async () => {
    const { payload } = await post(onSite({ removeTag: 'VIP' }, ['ada', 'bea']))
    expect(payload.results).toEqual([
      { contactId: 'ada', ok: true },
      { contactId: 'bea', ok: true },
    ])
    expect(facetOf('ada').tags).toEqual([])
    expect(contactWrites.map((write) => write.path)).toEqual([`${CONTACTS}/ada`])
  })

  it('attaches files as a bounded list of ids', async () => {
    await post(onSite({ mediaIds: ['media-1', 'media-1', 'media-2'] }))
    expect(facetOf('ada').mediaIds).toEqual(['media-1', 'media-2'])
  })
})

describe('the scope', () => {
  it('refuses a contact this site cannot see, and one that is gone, each on its own row', async () => {
    const { status, payload } = await post(onSite({ notes: 'x' }, ['ada', 'theirs', 'gone']))
    expect(status).toBe(200)
    expect(payload.results).toEqual([
      { contactId: 'ada', ok: true },
      { contactId: 'theirs', ok: false, error: 'That contact is not visible to this site.' },
      { contactId: 'gone', ok: false, error: 'That contact no longer exists.' },
    ])
    expect(contactWrites.map((write) => write.path)).toEqual([`${CONTACTS}/ada`])
  })

  it("writes a site collaborator's own site's contacts", async () => {
    caller = { uid: 'scoped-uid' }
    const { status, payload } = await post(onSite({ notes: 'From the collaborator' }))
    expect(status).toBe(200)
    expect(payload.results).toEqual([{ contactId: 'ada', ok: true }])
    expect(facetOf('ada').notes).toBe('From the collaborator')
  })
})

describe('the organization variant', () => {
  it('writes each contact through its own primary holder', async () => {
    caller = { uid: 'owner-uid' }
    const { status, payload } = await post({
      orgId: ORG_ID,
      contactIds: ['theirs', 'nobody'],
      set: { notes: 'Seen from the org' },
    })
    expect(status).toBe(200)
    expect(payload.results).toEqual([
      { contactId: 'theirs', ok: true },
      {
        contactId: 'nobody',
        ok: false,
        error: 'No site holds this contact yet, so it has no profile to edit.',
      },
    ])
    expect(facetOf('theirs', OTHER_HOST).notes).toBe('Seen from the org')
    expect(contact('nobody')).not.toHaveProperty('facets')
  })

  it('refuses a site collaborator the organization level', async () => {
    caller = { uid: 'scoped-uid' }
    const { status } = await post({ orgId: ORG_ID, contactIds: ['ada'], set: { notes: 'x' } })
    expect(status).toBe(403)
    expect(contactWrites).toEqual([])
  })
})

describe('a refused batch', () => {
  it('falls back to one write per contact, and names only the one that failed', async () => {
    failBatches = true
    refuseUpdate = new Set([`${CONTACTS}/bea`])
    const { status, payload } = await post(onSite({ notes: 'Both' }, ['ada', 'bea']))
    expect(status).toBe(200)
    expect(payload.results).toEqual([
      { contactId: 'ada', ok: true },
      { contactId: 'bea', ok: false, error: 'The contact could not be saved.' },
    ])
    expect(facetOf('ada').notes).toBe('Both')
    expect(facetOf('bea').notes).toBeUndefined()
  })
})
