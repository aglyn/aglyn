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
 * `create-dataset` applies the org's Default sharing to the site it is created
 * from, and only to a site that site can be (AGL-2891).
 *
 * The setting "New datasets and files are shared with" stores
 * `defaultResourceScope` on the org. With `'host'`, a dataset created in a
 * site starts visible to that site alone; with `'org'`, or with no site in
 * context, it starts on All sites. The route always read the setting — what
 * it never received was a site, because the Data card did not send one.
 *
 * Now that the card does, the site id is a client claim that decides who can
 * see the result, so the route has to check it:
 *
 *  1. THE SETTING LANDS. `'host'` plus one of the org's own sites stamps that
 *     site's token, and nothing wider.
 *  2. ALL SITES WHERE THERE IS NO NARROWING. `'org'`, or no site at all, stamps
 *     `['org']` — the org Data page's case.
 *  3. ANOTHER ORG'S SITE IS REFUSED, and so is a site that does not exist,
 *     before anything is written — under either default, so a crafted id
 *     cannot wait for the setting to change.
 *  4. A SCOPED MEMBER CANNOT CREATE WHAT THEY CANNOT SEE. Naming a site of
 *     the org outside their own access would leave them a dataset they could
 *     never open, the create the rules' `canCreateScoped()` refuses elsewhere.
 *
 * The scope helpers, the member-visibility check and the plan table are the
 * REAL ones: stubbing `defaultScopeForNewResource` would let this suite pass
 * against a route that stamped whatever the stub said.
 *
 * The assertion surface is the stored document, not only the status code.
 */

/** host id → owning org, as `hostIndex` answers it. */
const mockHostIndex: Record<string, string> = {
  'host-a': 'org-1',
  'host-b': 'org-1',
  'host-foreign': 'org-2',
}
/** Every site id the route asked `hostIndex` about. */
let mockIndexLookups: string[]
/** The org document the route reads. */
let mockOrg: Record<string, unknown>
/** The caller's member document in org-1. */
let mockMember: Record<string, unknown>
/** Documents created under `orgs/org-1/datasets`. */
let mockCreates: Array<Record<string, unknown>>

const mockDatasetsCollection = {
  count: () => ({
    get: async () => ({ data: () => ({ count: mockCreates.length }) }),
  }),
  doc: () => ({
    create: async (payload: Record<string, unknown>) => {
      mockCreates.push(payload)
    },
  }),
}

const mockOrgRef = {
  get: async () => ({ exists: true, data: () => mockOrg }),
  collection: () => mockDatasetsCollection,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
      firestore: () => ({
        // Writes buffered and applied on commit, so a refusal can never leave a
        // row behind — see `data-store-release-gate.spec.ts`.
        runTransaction: async (body: (tx: any) => Promise<any>) => {
          const buffered: Array<() => Promise<unknown>> = []
          const result = await body({
            get: async (target: any) => target.get(),
            create: (ref: any, payload: unknown) => {
              buffered.push(() => ref.create(payload))
            },
          })
          for (const write of buffered) await write()
          return result
        },
        collection: () => ({ doc: () => mockOrgRef }),
      }),
    }),
  },
  dataStorageRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: mockMember }),
  resolveOrgIdForHost: async (hostId: string) => {
    mockIndexLookups.push(hostId)
    return mockHostIndex[hostId] ?? null
  },
  // The REAL role → permission resolution, as every suite over this route
  // uses it (AGL-2444): the fixtures' roles decide, exactly as in production.
  memberHasOrgPermission: async (
    _orgId: string,
    subject: unknown,
    permission: string,
  ) =>
    Boolean(
      (
        jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as {
          resolveOrgPermissions: (member: unknown) => Record<string, boolean>
        }
      ).resolveOrgPermissions(subject)[permission],
    ),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => '__now__' },
}))

import { POST } from '../app/api/orgs/datasets/route'

const OWNER = { role: 'owner' }
/** An editor granted one site, the agency's client collaborator. */
const COLLABORATOR = {
  role: 'editor',
  allHosts: false,
  hostAccess: { 'host-a': 'editor' },
}

async function createDataset(extra: Record<string, unknown> = {}) {
  return POST(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        orgId: 'org-1',
        action: 'create-dataset',
        displayName: 'Speakers',
        fields: ['name'],
        ...extra,
      }),
    }),
  )
}

beforeEach(() => {
  mockIndexLookups = []
  mockOrg = { plan: 'pro' }
  mockMember = OWNER
  mockCreates = []
})

describe('the org default reaches a dataset created in a site', () => {
  it("stamps the site alone when the org chose 'Only the site they were created in'", async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'host' }
    const response = await createDataset({ hostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(mockCreates).toHaveLength(1)
    expect(mockCreates[0]['visibleTo']).toEqual(['host:host-a'])
    // Checked against the index, not taken on trust.
    expect(mockIndexLookups).toEqual(['host-a'])
  })

  it("stamps All sites when the org chose 'All sites'", async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'org' }
    const response = await createDataset({ hostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(mockCreates[0]['visibleTo']).toEqual(['org'])
  })

  it('stamps All sites for an org that never chose, which is the default', async () => {
    const response = await createDataset({ hostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(mockCreates[0]['visibleTo']).toEqual(['org'])
  })

  it('stamps All sites with no site in context — the org Data page', async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'host' }
    const response = await createDataset()

    expect(response.status).toBe(200)
    expect(mockCreates[0]['visibleTo']).toEqual(['org'])
    // Nothing to check, so nothing read.
    expect(mockIndexLookups).toEqual([])
  })
})

describe('a site the org does not own is refused, and nothing is written', () => {
  it.each(['host', 'org'])(
    "another org's site, under the '%s' default",
    async (defaultResourceScope) => {
      mockOrg = { plan: 'pro', defaultResourceScope }
      const response = await createDataset({ hostId: 'host-foreign' })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'That site is not one of this organization’s',
      })
      expect(mockCreates).toEqual([])
    },
  )

  it('a site that does not exist', async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'host' }
    const response = await createDataset({ hostId: 'host-nowhere' })

    expect(response.status).toBe(400)
    expect(mockCreates).toEqual([])
  })

  it('an id that is not a document id at all, without asking the index', async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'host' }
    const response = await createDataset({ hostId: 'host-a/datasets/x' })

    expect(response.status).toBe(400)
    expect(mockIndexLookups).toEqual([])
    expect(mockCreates).toEqual([])
  })
})

describe("a scoped member creates only what they can see", () => {
  beforeEach(() => {
    mockMember = COLLABORATOR
  })

  it('may create in their own site, scoped to it', async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'host' }
    const response = await createDataset({ hostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(mockCreates[0]['visibleTo']).toEqual(['host:host-a'])
  })

  it("is refused a site of the org outside their access", async () => {
    mockOrg = { plan: 'pro', defaultResourceScope: 'host' }
    const response = await createDataset({ hostId: 'host-b' })

    expect(response.status).toBe(403)
    expect(mockCreates).toEqual([])
  })

  it('is not refused when the default shares it with every site anyway', async () => {
    // The refusal is about the scope the create PRODUCES. All sites is
    // visible to every member, so naming a site the setting ignores costs
    // nothing — refusing here would refuse a create that harms no one.
    mockOrg = { plan: 'pro', defaultResourceScope: 'org' }
    const response = await createDataset({ hostId: 'host-b' })

    expect(response.status).toBe(200)
    expect(mockCreates[0]['visibleTo']).toEqual(['org'])
  })
})
