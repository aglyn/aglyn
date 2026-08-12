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
 * AGL-1377: /api/hosts/resources stores an ALLOW-list, like its sibling.
 *
 * The route used to persist the client body through a deny-list — everything
 * stored unless a `serverManagedFields` entry named it. Its neighbour
 * /api/hosts/collections has always done the opposite: nothing stored unless
 * named. Two adjacent routes, opposite defaults, and the deny-list side is
 * the bet this repo lost three times in one night (AGL-1354, AGL-1364,
 * AGL-1355/AGL-1361).
 *
 * The asymmetry, stated as an assertion: post an unexpected key at each
 * route and require that it is not stored. Before this change the
 * `resources` cases below failed (`$id`, `staff`, `role` all persisted) and
 * the `collections` case passed. Now both pass.
 *
 * The positive controls matter as much: a too-narrow allow-list drops
 * authoring input SILENTLY, which is the worse failure. Every payload below
 * was read off the console path named in its `caller` field, so each one is
 * a real create the product performs, not a guess at the model.
 */

const mockVerifyIdToken = jest.fn()
const mockWrite = jest.fn()

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
} = { memberRoles: {}, org: {} }

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

/**
 * A host subcollection with nothing in it — every quota and cap read
 * answers "zero", so the payload is the only thing under test here. The
 * caps themselves have their own suite (webhook-cap-server-enforced).
 */
function fakeSubcollection(): any {
  const api: any = {
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    select: () => api,
    where: () => api,
    limit: () => api,
    get: async () => ({ docs: [], empty: true }),
    doc: () => ({
      create: (payload: unknown) => mockWrite(payload),
      // Exists, so the versions route finds the parent it hangs a version
      // off; empty, so its "is this the FIRST version" count says yes.
      get: async () => snapshotOf({}),
      collection: () => fakeSubcollection(),
    }),
  }
  return api
}

const fakeHostRef = {
  get: async () =>
    snapshotOf({ memberRoles: state.memberRoles, orgId: 'org-1' }),
  collection: () => fakeSubcollection(),
}

const fakeFirestore = {
  collection: (name: string) => ({
    doc: () =>
      name === 'orgs'
        ? { get: async () => snapshotOf(state.org) }
        : fakeHostRef,
  }),
  // Both writes the collections route can make land in `mockWrite`, so the
  // two routes are asserted through one lens.
  runTransaction: async (body: (transaction: any) => Promise<unknown>) =>
    body({
      get: async (ref: any) =>
        typeof ref?.get === 'function' ? ref.get() : { docs: [], empty: true },
      create: (_ref: unknown, payload: unknown) => mockWrite(payload),
      set: (_ref: unknown, payload: unknown) => mockWrite(payload),
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: state.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlement/quota rules and the REAL collection-kind reader: a
  // spec that stubbed them would pass against a route enforcing nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  // The REAL screen kinds too (AGL-1400): both routes now read them, and a
  // stubbed `SCREEN_KIND_TEMPLATE` is `undefined` — which a screen create
  // sending no `kind` at all would match.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  createResourceUid: () => 'generated-id',
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST as COLLECTIONS_POST } from '../app/api/hosts/collections/route'
import { POST as RESOURCES_POST } from '../app/api/hosts/resources/route'
import { POST as VERSIONS_POST } from '../app/api/hosts/versions/route'

/**
 * Keys no caller sends and no resource should store. `$id` is the exact one
 * AGL-1374 found being written into stored documents by a listener spread;
 * `createdAt`/`updatedAt` are stamped server-side; `deletedAt` is what the
 * soft-delete caps count; `staff`/`role` are the shape of a field a later
 * feature makes load-bearing.
 */
const UNEXPECTED = {
  $id: 'synthetic-id',
  createdAt: 1,
  updatedAt: 2,
  deletedAt: { seconds: 1 },
  staff: true,
  role: 'admin',
}

const postResource = (resource: string, data: Record<string, unknown>) =>
  RESOURCES_POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', resource, data }),
    }),
  )

/**
 * Every create the console performs through this route, with the path the
 * payload was read off. Narrowing the allow-list past any of these breaks
 * authoring without an error anywhere, so they are the regression net.
 */
const CALLERS: Array<{
  resource: string
  caller: string
  data: Record<string, unknown>
}> = [
  {
    resource: 'screen',
    caller: 'hosts/[host]/screens/page.tsx',
    data: {
      displayName: 'Pricing',
      description: 'Plans and add-ons',
      slug: '/pricing',
      versionId: 'version-1',
    },
  },
  {
    resource: 'screen',
    caller: 'components/templates/create-page-from-template.ts',
    data: {
      displayName: 'About',
      description: 'From a template',
      seo: { title: 'About us' },
      versionId: 'version-1',
    },
  },
  {
    resource: 'screen',
    caller: 'plugins/email/.../create-email-screen.ts',
    data: { displayName: 'Untitled email', kind: 'email', versionId: 'v-1' },
  },
  {
    resource: 'template',
    caller: 'components/templates/save-as-template-dialog.component.tsx',
    data: {
      kind: 'page',
      displayName: 'Landing',
      description: 'Hero + pricing',
      placeholders: [{ name: 'headline' }],
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
      rootId: 'root',
      slug: '/landing',
      seo: { title: 'Landing' },
    },
  },
  {
    resource: 'layout',
    caller: 'hosts/[host]/layouts/page.tsx',
    data: {
      displayName: 'Site chrome',
      description: 'Header and footer',
      versionId: 'version-1',
    },
  },
  {
    resource: 'reusableComponent',
    caller: 'hosts/[host]/components/page.tsx',
    data: {
      displayName: 'Site nav',
      description: 'Shared navigation',
      rootId: 'root',
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
    },
  },
  {
    resource: 'variable',
    caller: 'plugins/logic/.../host-variables-card.component.tsx',
    data: {
      name: 'supportEmail',
      type: 'text',
      value: 'help@example.com',
      workflowId: 'workflow-1',
      workflowName: 'Compute support address',
    },
  },
  {
    resource: 'function',
    caller: 'plugins/logic/.../host-functions-card.component.tsx',
    data: {
      name: 'lineTotal',
      parameters: [{ name: 'P1', type: 'number', required: true }],
      variables: [{ name: 'P3', type: 'number' }],
      operations: [
        {
          if: { left: 'P1', comparator: '<=', right: '0' },
          then: [{ set: 'P3', expression: '0' }],
          otherwise: [],
        },
      ],
      returnValue: 'P3',
    },
  },
  {
    resource: 'workflow',
    caller: 'plugins/workflows/.../host-workflows-card.component.tsx',
    data: {
      name: 'Notify on order',
      steps: [{ functionName: 'lineTotal', args: ['1'], resultName: 'step1' }],
      returnValue: 'step1',
      trigger: { event: 'order.created', filter: 'total > 100' },
    },
  },
  {
    resource: 'service',
    caller: 'plugins/bookings/.../bookings-console-page.tsx',
    data: {
      name: 'Consultation',
      description: 'Intro call',
      durationMinutes: 30,
      priceUsd: 0,
      timezone: 'America/Chicago',
      windows: { 1: [{ start: 540, end: 1020 }] },
    },
  },
  {
    resource: 'redirect',
    caller: 'plugins/redirects/.../redirects-console-page.tsx',
    data: {
      source: '/old',
      destination: '/new',
      statusCode: 301,
      kind: 'exact',
      priority: 100,
      enabled: true,
    },
  },
  {
    resource: 'location',
    caller: 'plugins/commerce/.../locations-card.component.tsx',
    data: { name: 'Main warehouse', isDefault: true },
  },
  {
    resource: 'register',
    caller: 'plugins/commerce/.../registers-card.component.tsx',
    data: { name: 'Front counter', locationId: 'location-1' },
  },
  {
    resource: 'product',
    caller: 'plugins/commerce/.../product-editor-dialog.component.tsx',
    data: {
      name: 'Field notebook',
      slug: 'field-notebook',
      description: 'Pocket sized',
      type: 'physical',
      status: 'draft',
      mediaUrls: ['https://cdn.example.com/a.png'],
      categoryIds: ['category-1'],
      tags: ['paper'],
      options: [{ name: 'Size', values: ['S', 'L'] }],
      variants: [{ id: 'default', priceUsd: 12, inventory: 4 }],
      seo: { title: 'Field notebook' },
      supplierId: 'supplier-1',
      oversellPolicy: 'deny',
      taxExempt: false,
      digitalFiles: [{ url: 'https://cdn.example.com/f.pdf', fileName: 'f.pdf' }],
      downloadLimit: 3,
      subscription: { interval: 'month', trialDays: 7 },
      subscriptionOptional: true,
      gatedVideos: [{ url: 'https://cdn.example.com/v.mp4', title: 'Intro' }],
      relatedProductIds: ['product-2'],
      giftCard: false,
      lowStockThreshold: 2,
      priceUsd: 12,
      inventory: 4,
      imageUrl: 'https://cdn.example.com/a.png',
      createdAtMs: 1770000000000,
      updatedAtMs: 1770000000001,
    },
  },
  {
    resource: 'webhook',
    caller: 'plugins/workflows/.../host-webhooks-card.component.tsx',
    data: {
      name: 'Ship notifications',
      direction: 'outbound',
      url: 'https://example.com/hooks/aglyn',
      workflowName: '',
      secret: 'deadbeef',
      enabled: true,
    },
  },
]

describe('/api/hosts/resources stores an allow-list (AGL-1377)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    // Every entitlement on, so the payload assertions are never masked by a
    // plan wall — these tests are about what gets stored, not who may store.
    state.org = { plan: 'enterprise' }
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  describe.each(CALLERS)('$resource from $caller', ({ resource, data }) => {
    it('stores every field the caller sends', async () => {
      const response = await postResource(resource, data)
      expect(response.status).toBe(200)
      expect(mockWrite).toHaveBeenCalledTimes(1)
      const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
      // Field by field rather than a whole-object match: the failure message
      // then names the key that stopped round-tripping.
      for (const [key, value] of Object.entries(data)) {
        expect({ [key]: stored[key] }).toEqual({ [key]: value })
      }
    })

    it('stores nothing the caller did not send', async () => {
      // THE bug, as an assertion. Against the deny-list this failed for every
      // resource here: `$id`, `staff` and `role` were stored verbatim.
      const response = await postResource(resource, {
        ...data,
        ...UNEXPECTED,
      })
      expect(response.status).toBe(200)
      const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
      expect(stored).not.toHaveProperty('$id')
      expect(stored).not.toHaveProperty('deletedAt')
      expect(stored).not.toHaveProperty('staff')
      expect(stored).not.toHaveProperty('role')
      // Stamped, never taken from the body — a client clock is not a fact
      // about when the document was made.
      expect(stored['createdAt']).not.toBe(UNEXPECTED.createdAt)
      expect(stored['updatedAt']).not.toBe(UNEXPECTED.updatedAt)
      // And the legitimate fields still survive the same request.
      for (const key of Object.keys(data)) {
        expect(stored).toHaveProperty(key)
      }
    })
  })

  it('stamps template provenance rather than believing the client', async () => {
    // A marketplace claim is what the starter/authored split is FOR, so this
    // is the one key the route overwrites instead of merely dropping.
    const response = await postResource('template', {
      kind: 'page',
      displayName: 'Landing',
      nodes: {},
      source: { type: 'marketplace' },
    })
    expect(response.status).toBe(200)
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    expect(stored['source']).toEqual({ type: 'authored' })
  })

  /**
   * AGL-1384: two keys were on the allow-list only because a caller still
   * sent them, neither justified on its merits. Both callers stopped sending
   * them first — removing them from the route while a live caller still sent
   * them is exactly the silent narrowing AGL-1377 warns about — and these
   * assert the second half of that order.
   */
  it('no longer stores hostId on a reusable component', async () => {
    // Duplicated the document's own path (hosts/{hostId}/components/{id}) and
    // nothing read it; the other two component creators never sent it.
    const response = await postResource('reusableComponent', {
      displayName: 'Site nav',
      rootId: 'root',
      nodes: {},
      hostId: 'host-1',
    })
    expect(response.status).toBe(200)
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    expect(stored).not.toHaveProperty('hostId')
    // The create still works — that is the half that would break if the
    // ordering had been reversed.
    expect(stored['displayName']).toBe('Site nav')
  })

  it('no longer stores the vestigial versions array on a layout', async () => {
    // Every reader uses the `versions` SUBCOLLECTION, and nothing kept this
    // array in step, so it was stale from the second version onward.
    const response = await postResource('layout', {
      displayName: 'Site chrome',
      versionId: 'version-1',
      versions: ['version-1'],
    })
    expect(response.status).toBe(200)
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    expect(stored).not.toHaveProperty('versions')
    expect(stored['versionId']).toBe('version-1')
  })

  it('still stamps the screen name-prefix key from the stored displayName', async () => {
    await postResource('screen', { displayName: 'Pricing', nameLower: 'zzz' })
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    // Derived server-side (AGL-835); the client's own value never lands.
    expect(stored['nameLower']).toBe('pricing')
  })
})

/**
 * The neighbour audit's finding: /api/hosts/versions had NEITHER list —
 * `payload = { ...data }` went to Firestore whole, which is the resources
 * bug with the guard removed rather than merely inverted. Same one-line
 * shape, so it is fixed here alongside it.
 */
describe('/api/hosts/versions stores an allow-list too (AGL-1377)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.org = { plan: 'enterprise' }
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  const postVersion = (data: Record<string, unknown>) =>
    VERSIONS_POST(
      new Request('https://app.aglyn.com/api/hosts/versions', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({
          hostId: 'host-1',
          kind: 'screen',
          parentId: 'screen-1',
          data,
        }),
      }),
    )

  /** The union of every seed the console sends, across all three kinds. */
  const seed = {
    hostId: 'host-1',
    screenId: 'screen-1',
    layoutId: 'layout-1',
    componentId: 'component-1',
    displayName: 'Initial version',
    rootId: 'root',
    nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
  }

  it('stores every field the besigner seeds', async () => {
    const response = await postVersion(seed)
    expect(response.status).toBe(200)
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    for (const [key, value] of Object.entries(seed)) {
      expect({ [key]: stored[key] }).toEqual({ [key]: value })
    }
  })

  it('stores nothing the besigner did not seed', async () => {
    const response = await postVersion({ ...seed, ...UNEXPECTED })
    expect(response.status).toBe(200)
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    expect(stored).not.toHaveProperty('$id')
    expect(stored).not.toHaveProperty('deletedAt')
    expect(stored).not.toHaveProperty('staff')
    expect(stored).not.toHaveProperty('role')
    expect(stored['createdAt']).not.toBe(UNEXPECTED.createdAt)
    expect(stored['updatedAt']).not.toBe(UNEXPECTED.updatedAt)
    expect(stored['nodes']).toEqual(seed.nodes)
  })
})

describe('the sibling route already worked this way (AGL-1377)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.org = { plan: 'enterprise' }
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('/api/hosts/collections stores nothing the caller did not send', async () => {
    // Unchanged by this commit, and passing before it: the asymmetry is the
    // point. Two adjacent routes now answer an unexpected key the same way.
    const response = await COLLECTIONS_POST(
      new Request('https://app.aglyn.com/api/hosts/collections', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({
          hostId: 'host-1',
          action: 'create',
          kind: 'catalog',
          data: { name: 'Winter', slug: 'winter', mode: 'manual', ...UNEXPECTED },
        }),
      }),
    )
    expect(response.status).toBe(200)
    const stored = mockWrite.mock.calls[0][0] as Record<string, unknown>
    expect(stored['name']).toBe('Winter')
    expect(stored['slug']).toBe('winter')
    expect(stored).not.toHaveProperty('$id')
    expect(stored).not.toHaveProperty('staff')
    expect(stored).not.toHaveProperty('role')
    expect(stored).not.toHaveProperty('deletedAt')
  })
})
