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
 * `/api/orgs/datasets` asks "Manage data" (`data.manage`) and nothing about
 * the role (AGL-4047).
 *
 * Every action is permission-checked and a role is only a preset, so the
 * owner, admin and editor keep the key by default and a viewer does not, and
 * a custom role or a per-member override decides it for any role. The
 * resolver is the REAL one (`resolveOrgPermissions`, the custom role and the
 * member's own permissions applied), so the fixtures' roles and grants decide
 * exactly as they do in production.
 *
 * The assertion surface is the Firestore `create`, not only the status: a
 * refusal must write nothing.
 */

const ORG_ID = 'org-1'

/** The caller's membership as stored, or null for a non-member. */
let mockMember: Record<string, unknown> | null
/** The custom role the member's `roleId` names, if any. */
let mockCustomRole: { permissions: Record<string, boolean> } | null
/** Whether the caller's token carries the staff claim. */
let mockIsStaff: boolean
/** Payloads written to `orgs/{id}/datasets/{id}`. */
let mockCreates: Array<Record<string, unknown>>

const datasetsCollection = {
  count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
  doc: () => ({
    create: async (payload: Record<string, unknown>) => {
      mockCreates.push(payload)
    },
  }),
}

const orgRef = {
  get: async () => ({ exists: true, data: () => ({ plan: 'pro' }) }),
  collection: () => datasetsCollection,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email_verified: true,
          staff: mockIsStaff,
        }),
      }),
      firestore: () => ({
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
        collection: () => ({ doc: () => orgRef }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => (mockMember ? { member: mockMember } : null),
  isServerReleaseFlagOnForOrg: async () => true,
  memberHasOrgPermission: async (_orgId: string, subject: unknown, permission: string) =>
    Boolean(
      (
        jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as {
          resolveOrgPermissions: (member: unknown, customRole?: unknown) => Record<string, boolean>
        }
      ).resolveOrgPermissions(subject, mockCustomRole)[permission],
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: () => true,
  checkDatasetQuota: () => ({ allowed: true, limit: 100 }),
  checkQuota: () => ({ allowed: true, limit: 100 }),
  createResourceUid: () => 'dataset-1',
  defaultScopeForNewResource: () => 'org',
  newResourceScopeFields: () => ({ resourceScope: ['org'] }),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('../model/dataset-models', () => ({
  ...jest.requireActual('../model/dataset-models'),
  coerceDocumentValues: (values: unknown) => values,
  effectiveDatasetModel: () => ({}),
  validateDocument: () => ({ valid: true, errors: [] }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => '__now__' },
}))

import { datasetsHandler } from './datasets-route'

const REFUSAL = {
  error: 'Your role does not include "Manage data" — ask an organization admin',
  reason: 'permission',
  permission: 'data.manage',
}

async function createDataset() {
  return datasetsHandler(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ orgId: ORG_ID, action: 'create-dataset', displayName: 'Customers', fields: ['name'] }),
    }),
    { params: {} },
  )
}

beforeEach(() => {
  mockMember = null
  mockCustomRole = null
  mockIsStaff = false
  mockCreates = []
})

describe('the role presets keep today’s access (AGL-4047)', () => {
  it.each(['owner', 'admin', 'editor'])('a %s with no grant or refusal creates a dataset', async (role) => {
    mockMember = { role, allHosts: true }
    const response = await createDataset()
    expect(response.status).toBe(200)
    expect(mockCreates).toHaveLength(1)
  })

  it('a viewer is refused, in words that name the permission, and nothing is written', async () => {
    mockMember = { role: 'viewer', allHosts: true }
    const response = await createDataset()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
    expect(mockCreates).toEqual([])
  })

  it('a non-member is refused the same way', async () => {
    const response = await createDataset()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
    expect(mockCreates).toEqual([])
  })
})

describe('the key decides, not the role (AGL-4047)', () => {
  it('a viewer whose custom role grants "Manage data" creates a dataset', async () => {
    mockMember = { role: 'viewer', allHosts: true, roleId: 'role-data' }
    mockCustomRole = { permissions: { 'data.manage': true } }
    const response = await createDataset()
    expect(response.status).toBe(200)
    expect(mockCreates).toHaveLength(1)
  })

  it('a viewer granted "Manage data" on their own creates a dataset', async () => {
    mockMember = { role: 'viewer', allHosts: true, permissions: { 'data.manage': true } }
    const response = await createDataset()
    expect(response.status).toBe(200)
    expect(mockCreates).toHaveLength(1)
  })

  it('an editor whose custom role takes it away is refused', async () => {
    mockMember = { role: 'editor', allHosts: true, roleId: 'role-read-only' }
    mockCustomRole = { permissions: { 'data.manage': false } }
    const response = await createDataset()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
    expect(mockCreates).toEqual([])
  })

  it('an editor refused it on their own is refused', async () => {
    mockMember = { role: 'editor', allHosts: true, permissions: { 'data.manage': false } }
    const response = await createDataset()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(REFUSAL)
    expect(mockCreates).toEqual([])
  })

  it('staff keep their bypass of the key, as the rules’ isStaff() does, and still need a membership', async () => {
    mockIsStaff = true
    mockMember = { role: 'viewer', allHosts: true }
    expect((await createDataset()).status).toBe(200)
    mockMember = null
    const refused = await createDataset()
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual(REFUSAL)
    expect(mockCreates).toHaveLength(1)
  })
})
