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
 * AGL-1369: `versioning` (Pro+) enforced in /api/hosts/versions.
 *
 * The console used to check `hasEntitlement('versioning', org)` and then write
 * the new version document with the client SDK, so a Free org got Pro version
 * history by writing it directly. The rules could not simply deny the path:
 * every screen, layout and component is born with a version document, and a
 * resource with none cannot be opened at all.
 *
 * What the route is held to here is that it never asks the client which kind
 * of create this is. It counts what is already stored:
 *
 *   - zero versions -> the resource's first, allowed on every plan
 *   - one or more   -> retained history, `versioning` required
 *
 * The REAL `checkEntitlement` is wired in on purpose (only
 * `pluginRequestFromWeb` is faked), so a route that stopped consulting the
 * plan would fail here rather than pass against a stub.
 */

const mockVerifyIdToken = jest.fn()
const mockCreate = jest.fn()

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  parentExists: boolean
  /** Version ids the SERVER holds for the parent. */
  versions: Array<string>
  versionData: Record<string, Record<string, unknown>>
  /** Set when the route asked for a bounded read rather than the whole tree. */
  limits: Array<number>
} = {
  memberRoles: {},
  org: {},
  parentExists: true,
  versions: [],
  versionData: {},
  limits: [],
}

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

const versionsCollection = () => ({
  select: () => ({
    limit: (count: number) => {
      state.limits.push(count)
      return {
        get: async () => ({
          empty: state.versions.length === 0,
          docs: state.versions.slice(0, count).map((id) => ({ id })),
        }),
      }
    },
  }),
  doc: (id: string) => ({
    get: async () =>
      snapshotOf(
        state.versions.includes(id) ? (state.versionData[id] ?? {}) : null,
      ),
    create: (...args: unknown[]) => mockCreate(...args),
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        // hosts -> host doc -> parent collection -> parent doc -> versions
        collection: () => ({
          doc: () => ({
            get: async () => snapshotOf({ memberRoles: state.memberRoles }),
            collection: () => ({
              doc: () => ({
                get: async () =>
                  snapshotOf(state.parentExists ? { displayName: 'Home' } : null),
                collection: () => versionsCollection(),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: state.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan rules. Stubbing `checkEntitlement` would leave the only
  // assertion that matters — Free is refused, Pro is not — proving nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  createResourceUid: () => 'generated-id',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST } from '../app/api/hosts/versions/route'

const createVersion = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/versions', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        kind: 'screen',
        parentId: 'screen-1',
        data: { screenId: 'screen-1', nodes: {} },
        ...body,
      }),
    }),
  )

describe('version creation is entitlement-gated server-side (AGL-1369)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'editor' }
    state.org = { plan: 'free' }
    state.parentExists = true
    state.versions = []
    state.versionData = {}
    state.limits = []
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  describe('the first version is not the paid feature', () => {
    it('lets a FREE org seed a resource that has no version yet', async () => {
      // The one that must never break. Every screen, layout and component is
      // created with a version doc, so refusing this would stop authoring
      // outright on the plan most people are on.
      const response = await createVersion()
      expect(response.status).toBe(200)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it('stamps createdAt/updatedAt server-side rather than taking the client’s', async () => {
      await createVersion({
        data: { screenId: 'screen-1', nodes: {}, createdAt: 'last-year' },
      })
      const [written] = mockCreate.mock.calls[0] as [Record<string, unknown>]
      expect(written.createdAt).not.toBe('last-year')
      expect(written.updatedAt).toBeDefined()
    })
  })

  describe('a second version is', () => {
    beforeEach(() => {
      state.versions = ['v1']
      state.versionData = { v1: { screenId: 'screen-1', nodes: { root: {} } } }
    })

    it('refused to a FREE org — the bypass this issue is about', async () => {
      const response = await createVersion()
      expect(response.status).toBe(403)
      expect((await response.json()).error).toContain('Pro')
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('refused to a STARTER org', async () => {
      state.org = { plan: 'starter' }
      expect((await createVersion()).status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('allowed to a PRO org', async () => {
      state.org = { plan: 'pro' }
      expect((await createVersion()).status).toBe(200)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it('refused to a free org no matter what the body claims', async () => {
      // The client never gets to say which kind of create this is. There is
      // no field it could set to be believed, which is the whole point of
      // counting server-side — a `mode: 'seed'` parameter would have been
      // exactly as bypassable as the UI check it replaced.
      const response = await createVersion({
        seed: true,
        first: true,
        versioning: true,
        org: { plan: 'enterprise' },
        entitlements: { versioning: true },
      })
      expect(response.status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('snapshotting an existing version', () => {
    beforeEach(() => {
      state.org = { plan: 'pro' }
      state.versions = ['v1']
      state.versionData = {
        v1: { screenId: 'screen-1', nodes: { root: { id: 'root' } } },
      }
    })

    it('copies the STORED document, not a node map the client sent', async () => {
      const response = await createVersion({
        sourceVersionId: 'v1',
        data: { displayName: 'Copy of v1', nodes: { evil: true } },
      })
      expect(response.status).toBe(200)
      const [written] = mockCreate.mock.calls[0] as [Record<string, unknown>]
      // `displayName` is the caller's to set; `nodes` is not — the snapshot
      // means "what is stored", and a client that could substitute the node
      // map could write any content under the label of a copy.
      expect(written.displayName).toBe('Copy of v1')
      expect(written.nodes).toEqual({ root: { id: 'root' } })
    })

    it('404s when the source is missing rather than writing an empty version', async () => {
      const response = await createVersion({ sourceVersionId: 'nope' })
      expect(response.status).toBe(404)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('the checks that are not about the plan', () => {
    it('refuses a viewer', async () => {
      state.memberRoles = { 'user-1': 'viewer' }
      expect((await createVersion()).status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('refuses a suspended workspace', async () => {
      state.org = { plan: 'pro', suspendedAt: new Date().toISOString() }
      expect((await createVersion()).status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('refuses an unknown parent document', async () => {
      state.parentExists = false
      expect((await createVersion()).status).toBe(404)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('refuses an unknown parent kind, so only the three gated paths are servable', async () => {
      // `emailTemplates` versions are a different path with no `versioning`
      // gate; they must not be reachable through this route by name.
      const response = await createVersion({ kind: 'emailTemplate' })
      expect(response.status).toBe(400)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('refuses an unauthenticated caller', async () => {
      const response = await POST(
        new Request('https://app.aglyn.com/api/hosts/versions', {
          method: 'POST',
          body: JSON.stringify({
            hostId: 'host-1',
            kind: 'screen',
            parentId: 'screen-1',
            data: {},
          }),
        }),
      )
      expect(response.status).toBe(401)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  it('answers "any versions?" with a bounded read, not the whole history', async () => {
    // Every version document holds a full node map. Counting them to answer a
    // yes/no question would read the entire site's content on every create.
    await createVersion()
    expect(state.limits).toEqual([1])
  })
})
