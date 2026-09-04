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
const mockLogHostActivity = jest.fn(async (..._args: unknown[]) => undefined)

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
  // CAPTURED, not stubbed away: the same count that gates the entitlement
  // also decides whether this create is an EVENT (AGL-118), so the two
  // questions are asked of one read and belong in one file. Named explicitly
  // because this factory is a closed world — an absent export is `undefined`,
  // the route throws past every assertion below, and its own catch answers
  // 500, which reads exactly like the route regressing.
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...args),
  getOrgForHost: async () => ({ org: state.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // Lockdown (AGL-1501): the verdict's own logic is unit-tested in
  // libs/tenant/data/admin lockdown.spec.ts; this mirror keeps its contract
  // observable here — staff bypass, suspended org/host => locked (423).
  getLockdownVerdict: async (options: Record<string, any>) =>
    options?.staff === true
      ? null
      : options?.org?.suspendedAt != null
        ? { scope: 'org', reason: 'manual' }
        : options?.host?.suspendedAt != null
          ? { scope: 'host', reason: 'manual' }
          : null,
  lockdownJsonResponse: (state: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...state }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan rules. Stubbing `checkEntitlement` would leave the only
  // assertion that matters — Free is refused, Pro is not — proving nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // The REAL node codec (AGL-1151). The route under test compresses any
  // `nodes` it writes, and this factory is a CLOSED WORLD — an absent export
  // throws inside the route and its own catch answers 500, which reads
  // exactly like the behaviour under test regressing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  // The REAL host-role gate (AGL-2334). These routes ask
  // `hostRoleCanWrite` whether the caller may write at all, and this factory
  // is a CLOSED WORLD — anything it does not name is `undefined`, so leaving
  // it out makes the route throw and every assertion below read a 500 as if
  // the behaviour under test had regressed. Stubbed `() => true` it would be
  // worse: the suite would pass against a route that admits anybody.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
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
import { compress } from '@aglyn/aglyn/app-utils/compress'
import {
  decodeStoredNodes,
  storedNodesForm,
} from '@aglyn/aglyn/app-utils/stored-nodes'

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
      // Compared through the decoder because the route stores the tree
      // compressed (AGL-1151); the property under test is still WHOSE tree
      // was written, and the client's `{ evil: true }` is not in it.
      expect(decodeStoredNodes(written.nodes)).toEqual({ root: { id: 'root' } })
    })

    /**
     * A version is BORN compressed (AGL-1151).
     *
     * This route is where every screen, layout, component and form version
     * first exists, and it wrote `nodes` as a plain Firestore map — so a
     * document arrived at roughly 1.4x the bytes of the form the besigner
     * writes, against the same 1 MiB ceiling, and stayed that way until
     * somebody happened to open it and press Save.
     */
    it('stores a seeded tree as msgpack, not as a plain map', async () => {
      state.versions = []
      const response = await createVersion({
        data: { nodes: { root: { id: 'root' } } },
      })
      expect(response.status).toBe(200)
      const [written] = mockCreate.mock.calls[0] as [Record<string, unknown>]
      expect(storedNodesForm(written.nodes)).toBe('bytes')
      expect(decodeStoredNodes(written.nodes)).toEqual({ root: { id: 'root' } })
    })

    /**
     * The snapshot branch reads `source.data()`, which hands back a `Buffer`
     * for a compressed source — and msgpack of msgpack decodes to a byte
     * array rather than a node map, which no reader would recognise and none
     * would throw on.
     */
    it('does not re-encode a source that is already compressed', async () => {
      state.versionData = {
        v1: { nodes: Buffer.from(compress({ root: { id: 'root' } })) },
      }
      const response = await createVersion({ sourceVersionId: 'v1' })
      expect(response.status).toBe(200)
      const [written] = mockCreate.mock.calls[0] as [Record<string, unknown>]
      // One decode, not two, is what proves it was not encoded again.
      expect(decodeStoredNodes(written.nodes)).toEqual({ root: { id: 'root' } })
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

    it('refuses a suspended workspace — 423, the distinct lockdown status (AGL-1501)', async () => {
      state.org = { plan: 'pro', suspendedAt: new Date().toISOString() }
      expect((await createVersion()).status).toBe(423)
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

  /*
   * The SAME count, answering the second question (AGL-118).
   *
   * This route creates version documents for two different acts, and only one
   * of them is an event. Getting that wrong is silent in both directions: log
   * on every create and a template that seeds a dozen screens doubles the
   * feed it was supposed to be recording; log on none, and the one act on
   * this route a person deliberately performs — naming a restore point — has
   * no record anywhere, which is where it stood before this.
   */
  describe('a RETAINED version is an event; a resource\u2019s first is not', () => {
    it('THE CONTROL — a retained version writes one entry naming the snapshot', async () => {
      // First, because the "writes nothing" cases below also pass against a
      // route that logs nothing at all, in any branch, forever.
      state.org = { plan: 'pro' }
      state.versions = ['v1']
      state.versionData = { v1: { screenId: 'screen-1', nodes: {} } }

      const response = await createVersion({
        data: { screenId: 'screen-1', nodes: {}, displayName: 'Before the sale' },
      })

      expect(response.status).toBe(200)
      // The version document really landed — otherwise this asserts the log of
      // a create that did not happen.
      expect(mockCreate).toHaveBeenCalledTimes(1)

      expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
      const [hostId, actor, action, target] = mockLogHostActivity.mock
        .calls[0] as unknown as [
        string,
        { uid: string; email: string | null },
        string,
        Record<string, unknown>,
      ]
      expect(hostId).toBe('host-1')
      expect(actor).toEqual({ uid: 'user-1', email: null })
      expect(action).toBe('Created a version of the screen')
      // `versionId` is the NEW document, `id` the parent — the feed deep-links
      // to the exact version, and an entry naming only the screen cannot.
      expect(target).toEqual({
        type: 'screen',
        id: 'screen-1',
        versionId: 'generated-id',
        name: 'Before the sale',
      })
    })

    it('writes NOTHING for a resource\u2019s FIRST version', async () => {
      // A screen, its first version and its route are ONE act, and
      // /api/hosts/resources already recorded it. A row here would be an
      // invented second event on every create the product makes.
      expect((await createVersion()).status).toBe(200)

      expect(mockCreate).toHaveBeenCalledTimes(1)
      expect(mockLogHostActivity).not.toHaveBeenCalled()
    })

    it('writes NOTHING when the plan refuses the retained version', async () => {
      state.org = { plan: 'free' }
      state.versions = ['v1']

      expect((await createVersion()).status).toBe(403)

      expect(mockCreate).not.toHaveBeenCalled()
      expect(mockLogHostActivity).not.toHaveBeenCalled()
    })

    it('writes NOTHING when the id already exists', async () => {
      // `create()` throws ALREADY_EXISTS into the 409 below. An entry written
      // before it would claim a version that does not exist.
      state.org = { plan: 'pro' }
      state.versions = ['v1']
      // `Once`, not a standing implementation: `clearAllMocks` forgets the
      // CALLS and keeps the IMPLEMENTATION, so a rejection set here would
      // leak into every later case and turn a working create into a 409.
      mockCreate.mockRejectedValueOnce(
        Object.assign(new Error('taken'), { code: 6 }),
      )

      expect((await createVersion({ id: 'v1' })).status).toBe(409)

      expect(mockLogHostActivity).not.toHaveBeenCalled()
    })

    it('records a SNAPSHOT of an existing version too', async () => {
      // The besigner's versions panel takes this path — `sourceVersionId`,
      // no `nodes` on the wire. It is the surface that never called the
      // client logger at all, so a discriminator keyed on the request body
      // rather than on the stored count would drop exactly this case.
      state.org = { plan: 'pro' }
      state.versions = ['v1']
      state.versionData = { v1: { screenId: 'screen-1', nodes: { root: {} } } }

      await createVersion({
        sourceVersionId: 'v1',
        data: { displayName: 'Copy of v1' },
      })

      expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
      expect(
        (mockLogHostActivity.mock.calls[0] as unknown as unknown[])[3],
      ).toMatchObject({ name: 'Copy of v1', versionId: 'generated-id' })
    })
  })

  it('answers "any versions?" with a bounded read, not the whole history', async () => {
    // Every version document holds a full node map. Counting them to answer a
    // yes/no question would read the entire site's content on every create.
    await createVersion()
    expect(state.limits).toEqual([1])
  })
})
