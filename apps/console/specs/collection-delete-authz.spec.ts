/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-1324: deleting a collection through /api/resources/erase.
 *
 * The console dialog computes the same blockers for fast feedback, so every
 * assertion here is about the half a stale client cannot be trusted with:
 * the role gate, the dependency refusals, and the fact that a refusal calls
 * NOTHING — `eraseSubtree` is `recursiveDelete`, so a check that runs after
 * it has already run is not a check.
 *
 * The real `collectionDeleteDenial` is wired in on purpose (only
 * `pluginRequestFromWeb` is faked). A spec that stubbed the guard would pass
 * against a route that never called it.
 */

const mockVerifyIdToken = jest.fn()
const mockEraseSubtree = jest.fn()

interface FakeScreen {
  displayName?: string
  deletedAt?: unknown
  /** So a screen fake is usable wherever the snapshot fake takes doc data. */
  [field: string]: unknown
}

const state: {
  memberRoles: Record<string, string>
  collection: Record<string, unknown> | null
  entryCount: number
  screens: Record<string, FakeScreen>
} = { memberRoles: {}, collection: null, entryCount: 0, screens: {} }

const snapshotOf = (data: Record<string, unknown> | null, extra: object = {}) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
  ...extra,
})

const collectionSnapshot = () =>
  snapshotOf(state.collection, {
    id: 'col-1',
    ref: {
      collection: () => ({
        count: () => ({
          get: async () => ({ data: () => ({ count: state.entryCount }) }),
        }),
      }),
    },
  })

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            // `hosts/{hostId}` — the role gate reads memberRoles here, and
            // no `orgId` keeps the suspension read out of this fake.
            get: async () =>
              name === 'hosts'
                ? snapshotOf({ memberRoles: state.memberRoles })
                : snapshotOf({}),
            collection: (sub: string) => ({
              doc: (subId: string) =>
                sub === 'screens'
                  ? { __screenId: subId }
                  : { get: async () => collectionSnapshot() },
            }),
          }),
        }),
        getAll: async (...refs: Array<{ __screenId: string }>) =>
          refs.map((ref) =>
            snapshotOf(state.screens[ref.__screenId] ?? null, {
              id: ref.__screenId,
            }),
          ),
      }),
    }),
  },
  eraseSubtree: (...args: unknown[]) => mockEraseSubtree(...args),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL rule, not a stub — see the file comment.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-delete'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST } from '../app/api/resources/erase/route'

const erase = (body: Record<string, unknown> = {}, token = 'tok') =>
  POST(
    new Request('https://app.aglyn.com/api/resources/erase', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({
        scope: 'hosts',
        scopeId: 'host-1',
        kind: 'collections',
        id: 'col-1',
        collectionKind: 'content',
        ...body,
      }),
    }),
  )

describe('collection delete authorization + safety (AGL-1324)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.collection = { displayName: 'Legal', slug: 'legal', kind: 'content' }
    state.entryCount = 0
    state.screens = {}
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('401s an unauthenticated caller', async () => {
    const response = await POST(
      new Request('https://app.aglyn.com/api/resources/erase', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'hosts',
          scopeId: 'host-1',
          kind: 'collections',
          id: 'col-1',
        }),
      }),
    )
    expect(response.status).toBe(401)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('403s an editor — a collection delete is an admin action', async () => {
    // The load-bearing case: `editor` is exactly the role that may delete an
    // individual ENTRY, and could delete a whole collection before AGL-1324.
    state.memberRoles = { 'user-1': 'editor' }
    const response = await erase()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('admin')
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('403s a member with no role at all', async () => {
    state.memberRoles = {}
    expect((await erase()).status).toBe(403)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('deletes an unreferenced, empty collection through the cascade helper', async () => {
    const response = await erase()
    expect(response.status).toBe(200)
    // The shared recursive helper, addressed by name — never a path the
    // caller supplied and never a hand-rolled loop.
    expect(mockEraseSubtree).toHaveBeenCalledTimes(1)
    expect(mockEraseSubtree).toHaveBeenCalledWith([
      'hosts',
      'host-1',
      'collections',
      'col-1',
    ])
  })

  it('409s while a template screen still renders it, naming the screen', async () => {
    state.collection = { displayName: 'Legal', listScreenId: 'scr-1' }
    state.screens = { 'scr-1': { displayName: 'Legal index' } }
    const response = await erase()
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.error).toContain('Legal index')
    expect(payload.blockers).toEqual(['template-bound'])
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('ignores a binding whose screen no longer exists', async () => {
    // A stale pointer is not a dependency; otherwise deleting a screen would
    // strand its collection forever — the same one-way door, one level down.
    state.collection = { displayName: 'Legal', listScreenId: 'gone' }
    state.screens = {}
    expect((await erase()).status).toBe(200)
    expect(mockEraseSubtree).toHaveBeenCalledTimes(1)
  })

  it('409s while entries still live under it, and does not cascade them', async () => {
    state.entryCount = 4
    const response = await erase()
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.error).toContain('4 entries')
    expect(payload.blockers).toEqual(['has-entries'])
    // The whole point: `eraseSubtree` is recursiveDelete. Reaching it with
    // entries present destroys published content.
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('blocks a staff caller too — dependencies are not an authz question', async () => {
    // Staff skip the role gate; the safety guard is a separate check and
    // must not be skipped with it.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    state.entryCount = 2
    expect((await erase()).status).toBe(409)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('still refuses a catalog collection named as content (AGL-954)', async () => {
    state.collection = { name: 'Shoes', kind: 'catalog' }
    const response = await erase()
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('different part')
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })
})
