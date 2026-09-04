/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 *
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
 * Custom org roles: what they can express, and how many of them exist
 * (AGL-2334).
 *
 * `run-an-agency-workspace.md` sells custom roles as the way to get
 * "something narrower than the built-ins". Two things in the way of that,
 * both fixed here; a third — the publish permission itself — is not, and is
 * argued on the issue rather than half-built.
 *
 *  1. **Narrowing works, and the console said it did not.** The Role column's
 *     tooltip read "a custom role adds permissions on top of the base role —
 *     it does not replace it", which is not what `resolveOrgPermissions`
 *     does. It merges key-by-key and honours an explicit `false`. Anyone who
 *     believed the tooltip would conclude the guide's advice was impossible
 *     and stop looking. The behaviour is pinned here so the corrected
 *     sentence stays true.
 *  2. **The 51st role did not exist.** `GET /api/orgs/roles` answered a bare
 *     `.limit(50)` with no cursor and no count — an undocumented hard cap
 *     that applied to Enterprise, where the plan grid says unlimited. This
 *     card is where roles are ASSIGNED, so a role nobody can list is a role
 *     nobody can use.
 *
 * Plus one defect found while reading the route: deleting a role clears the
 * dangling `roleId` from every member carrying it, in ONE batch, off an
 * unbounded query. Firestore commits at most 500 writes per batch, so a
 * large org threw — after the role doc was already deleted, leaving exactly
 * the dangling references the cleanup exists to prevent.
 */
import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_PERMISSION_KEYS,
  resolveOrgPermissions,
} from '@aglyn/aglyn'

const mockVerifyIdToken = jest.fn()
const mockLogOrgActivity = jest.fn(async () => undefined)
/**
 * The projection re-run this route owes the rules.
 *
 * A role's permission map is an INPUT to every carrier's denormalized
 * `resolvedPermissions`, which is what `canWriteOrgDatasets()` reads. Editing
 * or deleting a role touches no membership, so it reaches none of the six
 * mutations that already call this writer — and without it a narrowing is
 * enforced by every server route while the rules go on granting.
 */
const mockSyncOrgAuthProjections = jest.fn(async () => undefined)
let mockHasPermission = true

/** Collection path → docId → data. */
let store: Record<string, Record<string, any>>
/** Every batch commit's size, in order — the 500-write cap is the subject. */
let batchSizes: number[]

const snapshot = (id: string, data: any) => ({
  id,
  exists: Boolean(data),
  data: () => data,
  get: (key: string) => data?.[key],
  ref: { path: id },
})

function makeQuery(
  path: string,
  filter: ((doc: any) => boolean) | null,
  ordered: boolean,
  take: number | null,
  after: string | null,
): any {
  const self: any = {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(
        path,
        (doc) => (filter ? filter(doc) : true) && doc?.[field] === value,
        ordered,
        take,
        after,
      ),
    orderBy: (field: unknown) =>
      makeQuery(path, filter, field === '__name__', take, after),
    limit: (count: number) => makeQuery(path, filter, ordered, count, after),
    startAfter: (cursor: string) =>
      makeQuery(path, filter, ordered, take, cursor),
    get: async () => {
      let ids = Object.keys(store[path] ?? {})
        .filter((id) => (filter ? filter(store[path][id]) : true))
        .sort()
      if (after !== null) ids = ids.filter((id) => id > after)
      if (take !== null) ids = ids.slice(0, take)
      const docs = ids.map((id) =>
        Object.assign(snapshot(id, store[path][id]), {
          ref: { __path: path, __id: id },
        }),
      )
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
  return self
}

function docRef(path: string, id: string): any {
  return {
    id,
    get: async () => snapshot(id, store[path]?.[id]),
    set: async (data: any, options?: { merge?: boolean }) => {
      store[path] = store[path] ?? {}
      store[path][id] = options?.merge
        ? { ...(store[path][id] ?? {}), ...data }
        : data
    },
    delete: async () => {
      if (store[path]) delete store[path][id]
    },
    collection: (sub: string) => collectionRef(`${path}/${id}/${sub}`),
  }
}

function collectionRef(path: string): any {
  return {
    ...makeQuery(path, null, false, null, null),
    doc: (id: string) => docRef(path, id),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => (global as any).__collectionRef(name),
        batch: () => (global as any).__batch(),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgDoc: async () => ({ $id: 'org-1', plan: 'enterprise' }),
  lockdownRefusal: async () => null,
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...(args as [])),
  memberHasOrgPermission: async () => mockHasPermission,
  syncOrgAuthProjections: (...args: unknown[]) =>
    mockSyncOrgAuthProjections(...(args as [])),
  resolveOrgMembership: async (uid: string) => ({
    orgId: 'org-1',
    member: { $id: uid, role: 'admin' },
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
}))

jest.mock('@aglyn/aglyn/server', () => {
  const permissions = jest.requireActual('@aglyn/aglyn/app-utils/org-permissions')
  return {
    __esModule: true,
    ...permissions,
    createResourceUid: () => 'role-new',
    pluginRequestFromWeb: async (request: Request) => {
      const url = new URL(request.url)
      const raw = await request.text().catch(() => '')
      return {
        method: request.method,
        query: Object.fromEntries(url.searchParams.entries()),
        body: raw ? JSON.parse(raw) : undefined,
        headers: {
          authorization: request.headers.get('authorization') ?? undefined,
        },
      }
    },
  }
})

;(global as any).__collectionRef = (name: string) => collectionRef(name)
/**
 * Firestore's real batch throws past 500 writes. Modelling that is the whole
 * point: a double that happily accepted 620 would let the very defect under
 * test pass, which is how an unfaithful fake manufactures a false green.
 */
;(global as any).__batch = () => {
  const writes: Array<() => void> = []
  return {
    set: (
      ref: { __path: string; __id: string },
      data: any,
      options?: { merge?: boolean },
    ) => {
      if (writes.length >= 500) {
        throw new Error('Firestore batch limit exceeded (500)')
      }
      writes.push(() => {
        store[ref.__path] = store[ref.__path] ?? {}
        store[ref.__path][ref.__id] = options?.merge
          ? { ...(store[ref.__path][ref.__id] ?? {}), ...data }
          : data
      })
    },
    commit: async () => {
      batchSizes.push(writes.length)
      writes.forEach((apply) => apply())
    },
  }
}

import { GET as rolesGet, POST as rolesPost } from '../app/api/orgs/roles/route'

const call = (
  handler: (request: Request) => Promise<Response>,
  init: { method: string; query?: Record<string, string>; body?: unknown },
) => {
  const url = new URL('https://app.aglyn.com/api/orgs/roles')
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return handler(
    new Request(url, {
      method: init.method,
      headers: { authorization: 'Bearer tok' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  )
}

/** Lists every role the way the console does — by following the cursor. */
async function listAllRoles(): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const payload = await (
      await call(rolesGet, {
        method: 'GET',
        query: { orgId: 'org-1', ...(cursor ? { cursor } : {}) },
      })
    ).json()
    ids.push(...payload.roles.map((role: any) => role.$id))
    cursor = payload.nextCursor
    if (!cursor) break
  }
  return ids
}

const seedRoles = (count: number) => {
  store['orgs/org-1/roles'] = {}
  for (let index = 0; index < count; index += 1) {
    store['orgs/org-1/roles'][`role-${String(index).padStart(4, '0')}`] = {
      name: `Role ${index}`,
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockHasPermission = true
  batchSizes = []
  store = { orgs: { 'org-1': { plan: 'enterprise' } } }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-1',
    email_verified: true,
    email: 'a@b.co',
  })
})

describe('a custom role can NARROW, not only widen (AGL-2334)', () => {
  it('REGRESSION — an explicit false takes a permission AWAY from the base role', () => {
    // The console's Role tooltip said a custom role "does not replace" the
    // base role, which reads as "cannot take anything away". It can, and the
    // guide's advice — "custom roles if you want something narrower" —
    // depends on it.
    const base = DEFAULT_ROLE_PERMISSIONS.editor
    expect(base['data.manage']).toBe(true)

    const narrowed = resolveOrgPermissions(
      { role: 'editor', roleId: 'role-1' } as never,
      { $id: 'role-1', permissions: { 'data.manage': false } },
    )
    expect(narrowed['data.manage']).toBe(false)
    // …and the rest of the base role is untouched, so it is a key-by-key
    // layer rather than a replacement in either direction.
    expect(narrowed['marketplace.publish']).toBe(true)
  })

  it('a custom role can also GRANT what the base role lacks', () => {
    const widened = resolveOrgPermissions(
      { role: 'editor', roleId: 'role-1' } as never,
      { $id: 'role-1', permissions: { 'billing.view': true } },
    )
    expect(DEFAULT_ROLE_PERMISSIONS.editor['billing.view']).toBe(false)
    expect(widened['billing.view']).toBe(true)
  })

  it('an omitted key is left alone — absence is not denial', () => {
    const partial = resolveOrgPermissions(
      { role: 'editor', roleId: 'role-1' } as never,
      { $id: 'role-1', permissions: { 'billing.view': true } },
    )
    for (const key of ORG_PERMISSION_KEYS) {
      if (key === 'billing.view') continue
      expect(partial[key]).toBe(DEFAULT_ROLE_PERMISSIONS.editor[key])
    }
  })

  it('a member override still wins over the custom role', () => {
    const resolved = resolveOrgPermissions(
      {
        role: 'editor',
        roleId: 'role-1',
        permissions: { 'data.manage': true },
      } as never,
      { $id: 'role-1', permissions: { 'data.manage': false } },
    )
    expect(resolved['data.manage']).toBe(true)
  })
})

describe('the role list is paged, not capped (AGL-2334)', () => {
  it('REGRESSION — the 51st role exists', async () => {
    seedRoles(120)
    const ids = await listAllRoles()
    // The old route answered `.limit(50)` with no cursor: role 51 was not on
    // a second page, it was absent. On the surface where roles are ASSIGNED,
    // invisible means unusable — and the plan grid sells Enterprise as
    // unlimited.
    expect(ids).toHaveLength(120)
    expect(ids).toContain('role-0050')
    expect(ids).toContain('role-0119')
  })

  it('says when there may be more, and stops saying so when there is not', async () => {
    seedRoles(100)
    const first = await (
      await call(rolesGet, { method: 'GET', query: { orgId: 'org-1' } })
    ).json()
    // A full page is not known to be the last one.
    expect(first.roles).toHaveLength(100)
    expect(first.nextCursor).toBe('role-0099')

    const second = await (
      await call(rolesGet, {
        method: 'GET',
        query: { orgId: 'org-1', cursor: first.nextCursor },
      })
    ).json()
    expect(second.roles).toHaveLength(0)
    expect(second.nextCursor).toBeNull()
  })

  it('a short list never claims a next page', async () => {
    seedRoles(3)
    const payload = await (
      await call(rolesGet, { method: 'GET', query: { orgId: 'org-1' } })
    ).json()
    expect(payload.roles).toHaveLength(3)
    expect(payload.nextCursor).toBeNull()
  })

  it('pages without a gap or a repeat', async () => {
    seedRoles(201)
    const ids = await listAllRoles()
    expect(ids).toHaveLength(201)
    expect(new Set(ids).size).toBe(201)
    expect([...ids].sort()).toEqual(ids)
  })
})

describe('deleting a role clears every carrier (AGL-2334)', () => {
  const seedCarriers = (count: number) => {
    store['orgs/org-1/members'] = {}
    for (let index = 0; index < count; index += 1) {
      store['orgs/org-1/members'][`member-${String(index).padStart(4, '0')}`] = {
        role: 'editor',
        roleId: 'role-doomed',
      }
    }
    store['orgs/org-1/roles'] = { 'role-doomed': { name: 'Doomed' } }
  }

  it('REGRESSION — an org past the 500-write batch cap does not throw', async () => {
    seedCarriers(620)
    const response = await call(rolesPost, {
      method: 'POST',
      body: { orgId: 'org-1', action: 'delete', roleId: 'role-doomed' },
    })
    // It used to build ONE batch off an unbounded query, so this threw a 500
    // — after the role doc was already deleted, leaving every member
    // pointing at a role that no longer existed. That is precisely the
    // dangling reference the cleanup is for.
    expect(response.status).toBe(200)
    expect(batchSizes.every((size) => size <= 500)).toBe(true)
    const carriers = Object.values(store['orgs/org-1/members'])
    expect(carriers).toHaveLength(620)
    expect(carriers.every((member: any) => member.roleId === null)).toBe(true)
    expect(store['orgs/org-1/roles']['role-doomed']).toBeUndefined()
  })

  it('a small org still commits, in one batch', async () => {
    seedCarriers(3)
    const response = await call(rolesPost, {
      method: 'POST',
      body: { orgId: 'org-1', action: 'delete', roleId: 'role-doomed' },
    })
    expect(response.status).toBe(200)
    expect(batchSizes).toEqual([3])
  })

  it('re-projects the roster, so the RULES see the carriers fall back', async () => {
    /*
     * Clearing `roleId` changes what every carrier may do, and the rules
     * decide dataset writes from the denormalized `resolvedPermissions` —
     * which still holds the deleted role's verdict until this runs.
     */
    seedCarriers(3)
    await call(rolesPost, {
      method: 'POST',
      body: { orgId: 'org-1', action: 'delete', roleId: 'role-doomed' },
    })
    expect(mockSyncOrgAuthProjections).toHaveBeenCalledWith('org-1')
  })

  it('CONTROL: a REFUSED delete re-projects nothing', async () => {
    // Without this the assertion above passes against a route that syncs
    // unconditionally, which would be a roster-wide write any member could
    // trigger by asking to delete a role they may not touch.
    mockHasPermission = false
    seedCarriers(1)
    await call(rolesPost, {
      method: 'POST',
      body: { orgId: 'org-1', action: 'delete', roleId: 'role-doomed' },
    })
    expect(mockSyncOrgAuthProjections).not.toHaveBeenCalled()
  })

  it('still requires members.manage', async () => {
    mockHasPermission = false
    seedCarriers(1)
    const response = await call(rolesPost, {
      method: 'POST',
      body: { orgId: 'org-1', action: 'delete', roleId: 'role-doomed' },
    })
    expect(response.status).toBe(403)
    expect(store['orgs/org-1/roles']['role-doomed']).toBeDefined()
  })
})
