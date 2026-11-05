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
 *
 * @jest-environment node
 */

/**
 * `/api/orgs/datasets` answers by where a dataset is placed (AGL-4047): "Manage
 * data", unless a site narrows the member on the one site it sits on; or that
 * one site's verdict. Editing one shared beyond a site stays with the workspace
 * key, and a site's verdict never reaches it.
 *
 * Real permission resolution and real scope tokens. The assertion surface is the
 * write as well as the status: a refusal writes nothing.
 */

const ORG_ID = 'org-1'
const HOST = 'host-1'

let mockMember: Record<string, unknown> | null
let mockVisibleTo: string[]
let mockHost: Record<string, unknown> | undefined
let mockUpdates: Array<Record<string, unknown>>

const mockDataset = {
  get: async () => ({
    exists: true,
    data: () => ({ displayName: 'Menu', visibleTo: mockVisibleTo, model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } } }),
  }),
  update: async () => undefined,
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true }),
      update: async (payload: Record<string, unknown>) => {
        mockUpdates.push(payload)
      },
    }),
  }),
}

const mockOrgRef = {
  get: async () => ({ exists: true, data: () => ({ plan: 'pro' }) }),
  collection: () => ({ doc: () => mockDataset }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () =>
            name === 'hosts'
              ? {
                  get: async () => ({
                    exists: Boolean(mockHost),
                    get: (field: string) => mockHost?.[field],
                  }),
                }
              : mockOrgRef,
        }),
      }),
    }),
  },
  dataStorageRefusal: async () => null,
  emailUnverifiedResponse: () => Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  resolveOrgIdForHost: async () => ORG_ID,
  resolveOrgMembership: async () => (mockMember ? { member: mockMember } : null),
  isServerReleaseFlagOnForOrg: async () => true,
  memberHasOrgPermission: async (_orgId: string, subject: unknown, permission: string) =>
    Boolean(
      (
        jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as {
          resolveOrgPermissions: (member: unknown) => Record<string, boolean>
        }
      ).resolveOrgPermissions(subject)[permission],
    ),
}))

jest.mock('./announce-dataset-records', () => ({ announceDatasetRecords: async () => true }))

import { projectMemberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import { registerDataDeclarations } from '../declarations'
import { datasetsHandler } from './datasets-route'

const seated = (member: Record<string, unknown>) => ({ ...member, scopeTokens: projectMemberScopeTokens(member as never) })
const hostOf = (role: string, stamp?: Record<string, boolean>) => ({
  orgId: ORG_ID,
  memberRoles: { 'user-1': role },
  ...(stamp ? { memberPermissions: { 'user-1': stamp } } : {}),
})

const updateRecord = () =>
  datasetsHandler(
    new Request('https://console.test/api/orgs/datasets', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG_ID, action: 'update-record', datasetId: 'd-1', recordId: 'r-1', values: { name: 'New' } }),
    }),
    { params: {} } as never,
  )

const THIS_SITE = [`host:${HOST}`]

beforeAll(() => registerDataDeclarations())

beforeEach(() => {
  mockUpdates = []
  mockVisibleTo = THIS_SITE
  mockHost = undefined
  mockMember = null
})

describe('on a dataset placed on this one site', () => {
  it('admits an editor of the whole workspace, without reading the site', async () => {
    mockMember = seated({ role: 'editor', allHosts: true })
    expect((await updateRecord()).status).toBe(200)
    expect(mockUpdates).toHaveLength(1)
  })

  it('refuses an editor narrowed to Viewer on it, naming the site’s permission, and writes nothing', async () => {
    mockMember = seated({ role: 'editor', allHosts: true, hostAccess: { [HOST]: 'viewer' } })
    mockHost = hostOf('viewer', { 'data.siteManage': false })
    const response = await updateRecord()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'permission', permission: 'data.siteManage' })
    expect(mockUpdates).toHaveLength(0)
  })

  it('admits that editor where the site’s stamp gives it back', async () => {
    mockMember = seated({ role: 'editor', allHosts: true, hostAccess: { [HOST]: 'viewer' } })
    mockHost = hostOf('viewer', { 'data.siteManage': true })
    expect((await updateRecord()).status).toBe(200)
  })

  it.each([
    ['admin', true],
    ['editor', true],
    ['author', false],
    ['viewer', false],
  ])('a site %s on the viewer role, with no stamp yet: the preset says %s', async (siteRole, admitted) => {
    mockMember = seated({ role: 'viewer', allHosts: false, hostAccess: { [HOST]: siteRole } })
    mockHost = hostOf(siteRole)
    expect((await updateRecord()).status).toBe(admitted ? 200 : 403)
  })

  it('a member refused "Manage data" does not regain it from their site role', async () => {
    mockMember = seated({ role: 'editor', allHosts: true, permissions: { 'data.manage': false } })
    mockHost = hostOf('editor')
    expect((await updateRecord()).status).toBe(403)
  })

  it('refuses on a suspended site, and on another workspace’s', async () => {
    mockMember = seated({ role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'admin' } })
    mockHost = { ...hostOf('admin', { 'data.siteManage': true }), suspendedAt: 1 }
    expect((await updateRecord()).status).toBe(403)
    mockHost = { ...hostOf('admin', { 'data.siteManage': true }), orgId: 'org-elsewhere' }
    expect((await updateRecord()).status).toBe(403)
  })
})

describe('on a dataset shared beyond one site', () => {
  it.each([
    ['every site', ['org']],
    ['two sites', [`host:${HOST}`, 'host:2']],
  ])('%s: a site Admin on the viewer role gains nothing, naming "Manage data"', async (_placement, visibleTo) => {
    mockVisibleTo = visibleTo
    mockMember = seated({ role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'admin' } })
    mockHost = hostOf('admin', { 'data.siteManage': true })
    const response = await updateRecord()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'data.manage' })
    expect(mockUpdates).toHaveLength(0)
  })

  it.each([
    ['every site', ['org']],
    ['two sites', [`host:${HOST}`, 'host:2']],
  ])('%s: an editor narrowed on one of them keeps the workspace verdict', async (_placement, visibleTo) => {
    mockVisibleTo = visibleTo
    mockMember = seated({ role: 'editor', allHosts: true, hostAccess: { [HOST]: 'viewer' } })
    expect((await updateRecord()).status).toBe(200)
  })

  it('a site-only holder of "Manage data" keeps editing what the workspace shares, which stays as it was', async () => {
    mockVisibleTo = ['org']
    mockMember = seated({ role: 'editor', allHosts: false, hostAccess: { [HOST]: 'viewer' } })
    expect((await updateRecord()).status).toBe(200)
  })
})
