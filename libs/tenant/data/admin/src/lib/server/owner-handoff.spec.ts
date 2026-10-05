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
 * AGL-3466 — a workspace staff build for a client is handed over with no
 * seat override.
 *
 * Two halves, both through the real `organizations.ts` against a Firestore
 * double:
 *
 * 1. Platform staff take none of the customer's seats. A Free workspace has
 *    one, and the staff member who built it held it, so the client could not
 *    be invited at all.
 * 2. An owner-handoff invite moves the owner seat in one transaction, and a
 *    `stay` handoff cannot be used to mint a free second manager.
 */

export {}

type Doc = Record<string, unknown>

let store = new Map<string, Doc>()
const DELETE = '__delete__'

/** Merge-set semantics, including the delete sentinel at any depth. */
function mockMerge(existing: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      throw new Error(`Cannot use "undefined" as a Firestore value (${key})`)
    }
    if (value === DELETE) {
      delete base[key]
      continue
    }
    if (
      merge &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object'
    ) {
      base[key] = mockMerge(base[key] as Doc, value as Doc, true)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      base[key] = mockMerge(undefined, value as Doc, false)
    } else {
      base[key] = value
    }
  }
  return base
}

function mockSetData(
  existing: Doc | undefined,
  data: Doc,
  options?: { merge?: boolean; mergeFields?: string[] },
): Doc {
  if (!options?.mergeFields) return mockMerge(existing, data, Boolean(options?.merge))
  const base: Doc = { ...(existing ?? {}) }
  for (const field of options.mergeFields) base[field] = data[field]
  return base
}

const mockSnapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  ref: mockMakeDoc(path),
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => (store.get(path) ?? {})[field],
})

interface MockQuery {
  __prefix: string
  __group?: string
  __filters: Array<[string, unknown]>
}

function mockRunQuery(query: MockQuery) {
  const docs = [...store.entries()].filter(([path, data]) => {
    if (query.__group) {
      const parts = path.split('/')
      if (parts.length % 2 !== 0 || parts[parts.length - 2] !== query.__group) return false
    } else {
      if (!path.startsWith(`${query.__prefix}/`)) return false
      if (path.slice(query.__prefix.length + 1).includes('/')) return false
    }
    return query.__filters.every(([field, value]) => (data[field] ?? null) === value)
  })
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map(([path]) => mockSnapshot(path)),
  }
}

function mockMakeQuery(prefix: string, filters: Array<[string, unknown]>, group?: string): any {
  return {
    __prefix: prefix,
    __group: group,
    __filters: filters,
    where: (field: string, _op: string, value: unknown) =>
      mockMakeQuery(prefix, [...filters, [field, value]], group),
    limit: () => mockMakeQuery(prefix, filters, group),
    get: async () => mockRunQuery({ __prefix: prefix, __group: group, __filters: filters }),
  }
}

function mockMakeDoc(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    set: async (data: Doc, options?: { merge?: boolean; mergeFields?: string[] }) => {
      store.set(path, mockSetData(store.get(path), data, options))
    },
    delete: async () => {
      store.delete(path)
    },
  }
}

let mockAutoId = 0

function mockMakeCollection(prefix: string): any {
  return {
    ...mockMakeQuery(prefix, []),
    doc: (id?: string) => mockMakeDoc(`${prefix}/${id ?? `auto-${(mockAutoId += 1)}`}`),
    add: async (data: Doc) => {
      const path = `${prefix}/auto-${(mockAutoId += 1)}`
      store.set(path, data)
      return mockMakeDoc(path)
    },
  }
}

function mockFirestore(): any {
  return {
    collection: (name: string) => mockMakeCollection(name),
    collectionGroup: (name: string) => mockMakeQuery('', [], name),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        set: (ref: { path: string }, data: Doc, options?: { merge?: boolean; mergeFields?: string[] }) => {
          writes.push(() => store.set(ref.path, mockSetData(store.get(ref.path), data, options)))
        },
        update: (ref: { path: string }, data: Doc) => {
          writes.push(() => store.set(ref.path, mockMerge(store.get(ref.path), data, true)))
        },
        delete: (ref: { path: string }) => {
          writes.push(() => store.delete(ref.path))
        },
        commit: async () => {
          for (const write of writes) write()
        },
      }
    },
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      // Buffered and applied only on a clean return, like the real thing, so
      // "nothing changed" after a refusal is a meaningful assertion.
      const writes: Array<() => void> = []
      const tx = {
        get: async (target: any) =>
          typeof target?.__prefix === 'string' && !target.path
            ? mockRunQuery(target as MockQuery)
            : mockSnapshot(target.path),
        set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
          writes.push(() => store.set(ref.path, mockMerge(store.get(ref.path), data, Boolean(options?.merge))))
        },
        delete: (ref: { path: string }) => {
          writes.push(() => store.delete(ref.path))
        },
      }
      const result = await fn(tx)
      for (const write of writes) write()
      return result
    },
  }
}

/** Accounts holding the `staff` claim, by uid and by address. */
const STAFF_UIDS = new Set(['staff'])
const STAFF_EMAILS = new Set(['zed@aglyn.test'])

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore() }) },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__now__',
    delete: () => '__delete__',
  },
}))
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteMemberHostProjections: async () => undefined,
  syncHostProjectionForMembers: async () => undefined,
  syncMemberHostProjections: async () => undefined,
}))
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async (uid: string) => ({
    record: { uid, customClaims: STAFF_UIDS.has(uid) ? { staff: true } : {} },
    tenantId: null,
  }),
  findUserByEmailAcrossPools: async (email: string) =>
    STAFF_EMAILS.has(email)
      ? { record: { uid: 'staff', customClaims: { staff: true } }, tenantId: null }
      : null,
}))
jest.mock('./update-existing', () => ({
  __esModule: true,
  updateExisting: async () => undefined,
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: async () => undefined,
}))

const {
  ManagerSeatLimitError,
  OwnerHandoffError,
  OwnerHandoffSeatError,
  CollaboratorSeatLimitError,
  acceptOwnerHandoff,
  createOrganization,
  grantHostAccess,
  managerSeatRefusal,
  ownerHandoffSeatRefusal,
  transferOrgOwnership,
  upsertOrgMember,
} = require('./organizations') as typeof import('./organizations')
const { clearStaffSeatStamps, isStaffAddress } =
  require('./staff-seat') as typeof import('./staff-seat')

const ORG = 'org-1'
const INVITE = 'invite-1'

/** A Free workspace (one team seat) whose owner is `ownerUid`. */
function seedOrg(ownerUid: string, ownerRow: Doc = {}): void {
  store.set(`orgs/${ORG}`, {
    name: 'Acme',
    slug: 'acme',
    plan: 'free',
    ownerUid,
    createdByUid: ownerUid,
    hosts: {},
  })
  store.set(`orgs/${ORG}/members/${ownerUid}`, {
    role: 'owner',
    allHosts: true,
    email: `${ownerUid}@example.test`,
    ...ownerRow,
  })
  store.set(`users/${ownerUid}/orgs/${ORG}`, {
    role: 'owner',
    orgName: 'Acme',
    slug: 'acme',
    orgWide: true,
  })
}

function seedHandoff(email: string, previousOwner: 'stay' | 'leave'): void {
  store.set(`orgs/${ORG}/invites/${INVITE}`, {
    email,
    role: 'owner',
    allHosts: true,
    hostAccess: {},
    handoff: { previousOwner },
    invitedBy: 'staff',
    acceptedAt: null,
  })
}

const member = (uid: string) => store.get(`orgs/${ORG}/members/${uid}`)
const index = (uid: string) => store.get(`users/${uid}/orgs/${ORG}`)
const org = () => store.get(`orgs/${ORG}`)

beforeEach(() => {
  store = new Map()
})

describe('platform staff take no customer seat (AGL-3466)', () => {
  it('createOrganization stamps a staff creator’s owner row', async () => {
    const orgId = await createOrganization({
      name: 'Prospect',
      slug: 'prospect',
      ownerUid: 'staff',
      ownerEmail: 'zed@aglyn.test',
      bypassFreeWorkspaceCap: true,
    })
    expect(store.get(`orgs/${orgId}/members/staff`)).toMatchObject({
      role: 'owner',
      staffSeat: true,
    })
  })

  it('a customer creator’s owner row is not stamped', async () => {
    const orgId = await createOrganization({
      name: 'Own',
      slug: 'own-org',
      ownerUid: 'client',
      ownerEmail: 'client@acme.test',
      bypassFreeWorkspaceCap: true,
    })
    expect(store.get(`orgs/${orgId}/members/client`)?.['staffSeat']).toBeUndefined()
  })

  it('on a Free workspace staff built, the client joins as admin with no override', async () => {
    seedOrg('staff', { staffSeat: true })
    await upsertOrgMember({
      orgId: ORG,
      uid: 'client',
      role: 'admin',
      allHosts: true,
      email: 'client@acme.test',
    })
    expect(member('client')).toMatchObject({ role: 'admin' })
    expect(member('client')?.['staffSeat']).toBeUndefined()
  })

  it('CONTROL: the same join is refused when a customer holds the one seat', async () => {
    seedOrg('owner')
    await expect(
      upsertOrgMember({ orgId: ORG, uid: 'client', role: 'admin', allHosts: true }),
    ).rejects.toBeInstanceOf(ManagerSeatLimitError)
    expect(member('client')).toBeUndefined()
  })

  it('a staff member joins a full workspace without a seat, and is stamped', async () => {
    seedOrg('owner')
    await upsertOrgMember({ orgId: ORG, uid: 'staff', role: 'admin', allHosts: true })
    expect(member('staff')).toMatchObject({ role: 'admin', staffSeat: true })
  })

  it('a stale stamp is taken off when a non-staff account’s row is rewritten', async () => {
    seedOrg('staff', { staffSeat: true })
    store.set(`orgs/${ORG}/members/former`, {
      role: 'editor',
      allHosts: false,
      hostAccess: { h1: 'editor' },
      staffSeat: true,
    })
    store.set(`orgs/${ORG}`, { ...(org() as Doc), plan: 'pro' })
    await upsertOrgMember({
      orgId: ORG,
      uid: 'former',
      role: 'editor',
      allHosts: false,
      hostAccess: { h1: 'editor' },
    })
    expect(member('former')?.['staffSeat']).toBeUndefined()
  })

  it('the send-time manager pre-flight lets a staff invitee through a full workspace', async () => {
    seedOrg('owner')
    const refused = await managerSeatRefusal({
      orgId: ORG,
      org: org() as never,
      becomesManager: true,
      self: { email: 'zed@aglyn.test' },
    })
    expect(refused?.status).toBe(403)
    expect(
      await managerSeatRefusal({
        orgId: ORG,
        org: org() as never,
        becomesManager: true,
        self: { email: 'zed@aglyn.test', staffSeat: true },
      }),
    ).toBeNull()
  })

  it('a staff collaborator on a full site takes no collaborator seat', async () => {
    seedOrg('owner')
    store.set(`orgs/${ORG}/members/client`, {
      role: 'viewer',
      allHosts: false,
      hostAccess: { h1: 'editor' },
      email: 'client@acme.test',
    })
    // CONTROL: Free holds one collaborator per site, and the client holds it.
    await expect(
      grantHostAccess({ orgId: ORG, uid: 'someone', hostId: 'h1', role: 'editor' }),
    ).rejects.toBeInstanceOf(CollaboratorSeatLimitError)
    await grantHostAccess({ orgId: ORG, uid: 'staff', hostId: 'h1', role: 'admin' })
    expect(member('staff')).toMatchObject({ hostAccess: { h1: 'admin' }, staffSeat: true })
  })

  it('isStaffAddress answers off the claim, and no account is not staff', async () => {
    expect(await isStaffAddress('zed@aglyn.test')).toBe(true)
    expect(await isStaffAddress('client@acme.test')).toBe(false)
    expect(await isStaffAddress('')).toBe(false)
  })

  it('transferOrgOwnership keeps the stamp where it was', async () => {
    seedOrg('staff', { staffSeat: true })
    store.set(`orgs/${ORG}/members/client`, { role: 'admin', allHosts: true })
    await transferOrgOwnership(ORG, 'staff', 'client')
    expect(member('staff')).toMatchObject({ role: 'admin', staffSeat: true })
    expect(member('client')).toMatchObject({ role: 'owner' })
    expect(member('client')?.['staffSeat']).toBeUndefined()
  })
})

describe('revoking staff takes the stamp off (AGL-3466)', () => {
  it('clears every row the account holds, and its pending invites', async () => {
    store.set('users/staff/orgs/a', { role: 'admin' })
    store.set('users/staff/orgs/b', { role: 'owner' })
    store.set('orgs/a/members/staff', { role: 'admin', staffSeat: true })
    store.set('orgs/b/members/staff', { role: 'owner', staffSeat: true })
    store.set('orgs/c/invites/i1', { email: 'zed@aglyn.test', staffSeat: true, acceptedAt: null })
    // Untouched: another account's stamp, and an invite already accepted.
    store.set('orgs/a/members/other', { role: 'admin', staffSeat: true })
    store.set('orgs/c/invites/i2', { email: 'zed@aglyn.test', staffSeat: true, acceptedAt: 'then' })
    const cleared = await clearStaffSeatStamps('staff', 'zed@aglyn.test', mockFirestore())
    expect(cleared).toEqual({ members: 2, invites: 1 })
    expect(store.get('orgs/a/members/staff')).toEqual({ role: 'admin' })
    expect(store.get('orgs/b/members/staff')).toEqual({ role: 'owner' })
    expect(store.get('orgs/c/invites/i1')?.['staffSeat']).toBeUndefined()
    expect(store.get('orgs/a/members/other')?.['staffSeat']).toBe(true)
    expect(store.get('orgs/c/invites/i2')?.['staffSeat']).toBe(true)
  })
})

describe('accepting an owner handoff (AGL-3466)', () => {
  const accept = (uid = 'client', email = 'client@acme.test') =>
    acceptOwnerHandoff({
      orgId: ORG,
      inviteId: INVITE,
      uid,
      email,
      emails: [email],
      displayName: 'Client',
    })

  it('stay: the client owns it, staff stays as a no-seat admin', async () => {
    seedOrg('staff', { staffSeat: true })
    seedHandoff('client@acme.test', 'stay')
    const result = await accept()
    expect(result).toEqual({ previousOwnerUid: 'staff', previousOwner: 'stay' })
    expect(org()?.['ownerUid']).toBe('client')
    // The creator attribution never moves (AGL-2265).
    expect(org()?.['createdByUid']).toBe('staff')
    expect(member('client')).toMatchObject({
      role: 'owner',
      allHosts: true,
      email: 'client@acme.test',
      displayName: 'Client',
      invitedBy: 'staff',
    })
    expect(member('staff')).toMatchObject({ role: 'admin', staffSeat: true })
    expect(index('client')).toMatchObject({ role: 'owner', orgWide: true, slug: 'acme' })
    expect(index('staff')).toMatchObject({ role: 'admin', orgWide: true })
    expect(store.get(`orgs/${ORG}/invites/${INVITE}`)).toMatchObject({
      acceptedBy: 'client',
    })
    const activity = [...store.entries()].filter(([path]) =>
      path.startsWith(`orgs/${ORG}/activity/`),
    )
    expect(activity.map(([, row]) => row['action'])).toContain(
      'Took over the workspace; staff@example.test stays on as an admin',
    )
  })

  it('leave: the outgoing owner is off the roster and the reverse index', async () => {
    seedOrg('staff', { staffSeat: true })
    seedHandoff('client@acme.test', 'leave')
    await accept()
    expect(org()?.['ownerUid']).toBe('client')
    expect(member('client')).toMatchObject({ role: 'owner' })
    expect(member('staff')).toBeUndefined()
    expect(index('staff')).toBeUndefined()
  })

  it('an existing collaborator becomes the owner with org-wide reach', async () => {
    seedOrg('staff', { staffSeat: true })
    store.set(`orgs/${ORG}/members/client`, {
      role: 'viewer',
      allHosts: false,
      hostAccess: { h1: 'editor' },
      joinedAt: 'earlier',
    })
    seedHandoff('client@acme.test', 'stay')
    await accept()
    expect(member('client')).toMatchObject({ role: 'owner', allHosts: true, joinedAt: 'earlier' })
    expect(index('client')).toMatchObject({ orgWide: true })
  })

  it('THE LOOPHOLE: a customer owner on Free cannot stay on beside a new owner', async () => {
    seedOrg('owner')
    seedHandoff('client@acme.test', 'stay')
    await expect(accept()).rejects.toBeInstanceOf(OwnerHandoffSeatError)
    // Nothing moved.
    expect(org()?.['ownerUid']).toBe('owner')
    expect(member('client')).toBeUndefined()
    expect(store.get(`orgs/${ORG}/invites/${INVITE}`)?.['acceptedAt']).toBeNull()
  })

  it('…and leaving instead hands the one seat over', async () => {
    seedOrg('owner')
    seedHandoff('client@acme.test', 'leave')
    await accept()
    expect(org()?.['ownerUid']).toBe('client')
    expect(member('owner')).toBeUndefined()
  })

  it('a staff invitee takes the workspace without a seat, and is stamped', async () => {
    seedOrg('owner')
    seedHandoff('zed@aglyn.test', 'stay')
    await accept('staff', 'zed@aglyn.test')
    expect(member('staff')).toMatchObject({ role: 'owner', staffSeat: true })
    expect(member('owner')).toMatchObject({ role: 'admin' })
  })

  it('refuses an invite addressed to somebody else', async () => {
    seedOrg('staff', { staffSeat: true })
    seedHandoff('client@acme.test', 'stay')
    await expect(accept('intruder', 'intruder@evil.test')).rejects.toMatchObject({
      reason: 'not-addressed',
    })
    expect(org()?.['ownerUid']).toBe('staff')
  })

  it('refuses an invite that is not a handoff, or already answered', async () => {
    seedOrg('staff', { staffSeat: true })
    store.set(`orgs/${ORG}/invites/${INVITE}`, {
      email: 'client@acme.test',
      role: 'admin',
      acceptedAt: null,
    })
    await expect(accept()).rejects.toBeInstanceOf(OwnerHandoffError)
    seedHandoff('client@acme.test', 'stay')
    store.set(`orgs/${ORG}/invites/${INVITE}`, {
      ...(store.get(`orgs/${ORG}/invites/${INVITE}`) as Doc),
      acceptedAt: 'then',
    })
    await expect(accept()).rejects.toMatchObject({ reason: 'not-pending' })
  })
})

describe('the handoff pre-flight at send (AGL-3466)', () => {
  it('refuses a stay that needs a seat, naming the way out', async () => {
    seedOrg('owner')
    const refused = await ownerHandoffSeatRefusal({
      orgId: ORG,
      email: 'client@acme.test',
      previousOwner: 'stay',
      inviteeStaff: false,
    })
    expect(refused?.status).toBe(403)
    const body = await refused?.json()
    expect(body).toMatchObject({ code: 'owner_handoff_seat', previousOwner: 'stay' })
    expect(body.error).toContain('Leave after the handoff')
  })

  it('lets a leave through on the same workspace', async () => {
    seedOrg('owner')
    expect(
      await ownerHandoffSeatRefusal({
        orgId: ORG,
        email: 'client@acme.test',
        previousOwner: 'leave',
        inviteeStaff: false,
      }),
    ).toBeNull()
  })

  it('lets a stay through when the outgoing owner is staff', async () => {
    seedOrg('staff', { staffSeat: true })
    expect(
      await ownerHandoffSeatRefusal({
        orgId: ORG,
        email: 'client@acme.test',
        previousOwner: 'stay',
        inviteeStaff: false,
      }),
    ).toBeNull()
  })

  it('lets a stay through when the invitee already holds a manager seat', async () => {
    seedOrg('owner')
    store.set(`orgs/${ORG}/members/client`, {
      role: 'admin',
      allHosts: true,
      email: 'client@acme.test',
    })
    expect(
      await ownerHandoffSeatRefusal({
        orgId: ORG,
        email: 'client@acme.test',
        previousOwner: 'stay',
        inviteeStaff: false,
      }),
    ).toBeNull()
  })
})
