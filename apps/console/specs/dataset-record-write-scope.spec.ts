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
 * A member adds records only to a dataset they can see (AGL-2894).
 *
 * `/api/orgs/datasets` gates its record actions on the writer role and
 * `data.manage`. Both are about the ORG: `data.manage` resolves from the role
 * alone, so an editor scoped to one client's site passes them. The route then
 * wrote into whatever `datasetId` the body named — including an internal
 * dataset shared only with other sites, which that collaborator can neither
 * list nor open, and which the rules would never let them touch a record of
 * (`parentDatasetVisible()`).
 *
 * The visibility check is the REAL `memberCanSee`, over the member's REAL scope
 * tokens: a stub would answer whatever it was told about who can see what.
 * Both halves are pinned for both actions — what a collaborator may write, and
 * what they may not — and a refusal must leave no row behind.
 */

const mockVerifyIdToken = jest.fn()

/** The caller's member document in org-1. */
let mockMember: Record<string, unknown>
/** The dataset under test, as stored. */
let mockDataset: Record<string, unknown>
/** Records created under it. */
let mockRecords: Array<Record<string, unknown>>

const mockRecordsCollection = () => ({
  count: () => ({
    get: async () => ({ data: () => ({ count: mockRecords.length }) }),
  }),
  doc: () => ({
    create: async (data: Record<string, unknown>) => {
      mockRecords.push(data)
    },
  }),
})

const mockFirestore = {
  // Writes buffered and applied on commit, as every suite over this route
  // models it — a refused transaction must not leave its row behind.
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
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ plan: 'pro' }) }),
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => mockDataset }),
          collection: () => mockRecordsCollection(),
        }),
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
  },
  // The byte band never blocks: its own suite is
  // `dataset-storage-quota-enforced.spec.ts`.
  dataStorageRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: mockMember }),
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
/** An editor granted `host-a` alone — the agency's client collaborator. */
const COLLABORATOR = {
  role: 'editor',
  allHosts: false,
  hostAccess: { 'host-a': 'editor' },
}

const ACTIONS = {
  'create-record': { values: { name: 'Avery' } },
  'import-records': {
    records: [{ values: { name: 'Avery' } }, { values: { name: 'Blake' } }],
  },
} as const

type Action = keyof typeof ACTIONS

const write = (action: Action) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        orgId: 'org-1',
        action,
        datasetId: 'ds-1',
        ...ACTIONS[action],
      }),
    }),
  )

/** A v1 dataset: `fields` alone, which derives an all-text model. */
const dataset = (visibleTo?: string[]) => ({
  displayName: 'Rate card',
  fields: ['name'],
  ...(visibleTo ? { visibleTo } : {}),
})

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockMember = COLLABORATOR
  mockDataset = dataset(['org'])
  mockRecords = []
})

describe.each(Object.keys(ACTIONS) as Action[])('%s', (action) => {
  describe('writes where the caller can see the dataset', () => {
    it('a dataset shared with the collaborator’s own site', async () => {
      mockDataset = dataset(['host:host-a'])
      const response = await write(action)

      expect(response.status).toBe(200)
      expect(mockRecords.length).toBeGreaterThan(0)
    })

    it('a dataset shared with every site', async () => {
      const response = await write(action)

      expect(response.status).toBe(200)
      expect(mockRecords.length).toBeGreaterThan(0)
    })

    it('any dataset at all, for an org-wide member', async () => {
      mockMember = OWNER
      mockDataset = dataset(['host:host-b'])
      const response = await write(action)

      expect(response.status).toBe(200)
      expect(mockRecords.length).toBeGreaterThan(0)
    })

    it('any dataset at all, for staff', async () => {
      // Staff are exempt here as on the export route beside this one.
      mockVerifyIdToken.mockResolvedValue({
        uid: 'user-1',
        email_verified: true,
        staff: true,
      })
      mockDataset = dataset(['host:host-b'])
      const response = await write(action)

      expect(response.status).toBe(200)
    })
  })

  describe('refuses where the caller cannot, and writes nothing', () => {
    it('a dataset shared only with another site', async () => {
      // Red before the fix: 200, with the rows written into a dataset this
      // collaborator cannot list, open or edit a row of.
      mockDataset = dataset(['host:host-b'])
      const response = await write(action)

      expect(response.status).toBe(404)
      // The same answer as a dataset that does not exist.
      await expect(response.json()).resolves.toEqual({ error: 'Unknown dataset' })
      expect(mockRecords).toEqual([])
    })

    it('a dataset with no sharing stored, which no site can see', async () => {
      mockDataset = dataset()
      const response = await write(action)

      expect(response.status).toBe(404)
      expect(mockRecords).toEqual([])
    })
  })
})
