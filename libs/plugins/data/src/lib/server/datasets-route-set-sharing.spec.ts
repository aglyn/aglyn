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
 * `set-sharing` on `/api/orgs/datasets` (AGL-4047): the one door that sets or
 * removes the all-sites-except marker. It asks what the rule on a client's
 * `visibleTo` write asks, "Manage data" with every site in reach, and reads the
 * workspace's sites in its transaction. A refusal writes nothing.
 *
 * Real permission resolution, the real helpers and the real `fieldsToWrite`.
 * `scope-sharing-sweep.emulator.spec.ts` holds the real field deletes.
 */

import { FieldValue } from 'firebase-admin/firestore'

const ORG_ID = 'org-1'

let mockMember: Record<string, unknown> | null
let mockDataset: Record<string, unknown> | null
let mockOrgHosts: Record<string, unknown>
let mockReads: string[]
let mockWrites: Array<Record<string, unknown>>
let mockStaff: boolean

const mockDatasetRef = { path: 'dataset' }
const mockOrgRef = {
  path: 'org',
  get: async () => ({ exists: true, data: () => ({ plan: 'pro', hosts: mockOrgHosts }) }),
  collection: () => ({ doc: () => mockDatasetRef }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true, ...(mockStaff ? { staff: true } : {}) }),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => mockOrgRef }),
        runTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
          work({
            getAll: async (...refs: Array<{ path: string }>) => {
              mockReads.push(...refs.map((ref) => ref.path))
              return refs.map((ref) =>
                ref.path === 'org'
                  ? { exists: true, data: () => ({ hosts: mockOrgHosts }) }
                  : { exists: Boolean(mockDataset), data: () => mockDataset ?? undefined },
              )
            },
            update: (_ref: unknown, payload: Record<string, unknown>) => {
              mockWrites.push(payload)
            },
          }),
      }),
    }),
  },
  resolveOrgMembership: async () => (mockMember ? { member: mockMember } : null),
  memberHasOrgPermission: async (_orgId: string, member: { role?: string }, key: string) => {
    const { resolveOrgPermissions } = jest.requireActual('@aglyn/aglyn/app-utils/org-permissions')
    return resolveOrgPermissions(member)[key] === true
  },
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  emailUnverifiedResponse: () => new Response(null, { status: 403 }),
  isImpersonationSession: () => false,
  dataStorageRefusal: async () => null,
  resolveOrgIdForHost: async () => ORG_ID,
}))
jest.mock('./announce-dataset-records', () => ({ announceDatasetRecords: async () => true }))

import { projectMemberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import { registerDataDeclarations } from '../declarations'
import { datasetsHandler } from './datasets-route'

const seated = (member: Record<string, unknown>) => ({ ...member, scopeTokens: projectMemberScopeTokens(member as never) })
const OWNER = seated({ role: 'owner', allHosts: true })
const EDITOR = seated({ role: 'editor', allHosts: true })
const VIEWER = seated({ role: 'viewer', allHosts: true })
const NARROWED_EDITOR = seated({ role: 'editor', allHosts: true, hostAccess: { a: 'viewer' } })
const SITE_ONLY = seated({ role: 'editor', allHosts: false, hostAccess: { a: 'editor' } })

const send = (body: Record<string, unknown>) =>
  datasetsHandler(
    new Request('https://console.test/api/orgs/datasets', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG_ID, action: 'set-sharing', datasetId: 'ds', ...body }),
    }),
    { params: {} } as never,
  )

beforeAll(() => registerDataDeclarations())

beforeEach(() => {
  mockMember = OWNER
  mockDataset = { displayName: 'Menu', visibleTo: ['org'] }
  mockOrgHosts = { a: true, b: true, c: true }
  mockReads = []
  mockWrites = []
  mockStaff = false
})

describe('what it writes', () => {
  it('all sites except some: the sites in, and the marker', async () => {
    const response = await send({ choice: { mode: 'allExcept', exceptHostIds: ['b'] } })

    expect(response.status).toBe(200)
    expect(mockWrites).toHaveLength(1)
    expect(mockWrites[0]).toMatchObject({ visibleTo: ['host:a', 'host:c'], scopeMode: 'allExcept', scopeExcept: ['host:b'] })
  })

  it('back to All sites collapses to the org token and DELETES the marker, never storing null', async () => {
    mockDataset = { visibleTo: ['host:a'], scopeMode: 'allExcept', scopeExcept: ['host:b'] }

    await send({ choice: { mode: 'all' } })

    expect(mockWrites[0]['visibleTo']).toEqual(['org'])
    expect(mockWrites[0]['scopeMode']).toEqual(FieldValue.delete())
    expect(mockWrites[0]['scopeExcept']).toEqual(FieldValue.delete())
  })

  it('chosen sites: the sites, and no marker', async () => {
    mockDataset = { visibleTo: ['host:a'], scopeMode: 'allExcept', scopeExcept: ['host:b'] }

    await send({ choice: { mode: 'selected', hostIds: ['a', 'c'] } })

    expect(mockWrites[0]['visibleTo']).toEqual(['host:a', 'host:c'])
    expect(mockWrites[0]['scopeMode']).toEqual(FieldValue.delete())
  })

  it('reads the workspace’s sites in the transaction, which is what closes the race with a new site', async () => {
    await send({ choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(mockReads).toEqual(['org', 'dataset'])
  })
})

describe('what it refuses, writing nothing', () => {
  it.each([
    ['nothing left out', { mode: 'allExcept', exceptHostIds: [] }, /at least one site to leave out/],
    ['everything left out', { mode: 'allExcept', exceptHostIds: ['a', 'b', 'c'] }, /Keep at least one site in/],
    ['leaving out only sites it doesn’t hold', { mode: 'allExcept', exceptHostIds: ['elsewhere'] }, /at least one site to leave out/],
    ['no site chosen', { mode: 'selected', hostIds: [] }, /at least one site/],
    ['only sites it doesn’t hold', { mode: 'selected', hostIds: ['elsewhere'] }, /at least one site/],
  ])('%s', async (_name, choice, message) => {
    const response = await send({ choice })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(message)
    expect(mockWrites).toEqual([])
  })

  it.each([
    ['no choice', undefined],
    ['an unknown mode', { mode: 'some' }],
    ['ids that are not a list', { mode: 'selected', hostIds: 'a' }],
    ['an id that is not a string', { mode: 'selected', hostIds: [1] }],
    ['a token in place of an id', { mode: 'allExcept', exceptHostIds: ['host:a'] }],
    ['a path in place of an id', { mode: 'selected', hostIds: ['a/b'] }],
  ])('%s is a bad request', async (_name, choice) => {
    const response = await send({ choice })
    expect(response.status).toBe(400)
    expect(mockWrites).toEqual([])
  })

  it('a dataset that isn’t there', async () => {
    mockDataset = null
    const response = await send({ choice: { mode: 'all' } })
    expect(response.status).toBe(404)
    expect(mockWrites).toEqual([])
  })

  it('a site from another workspace never reaches the document', async () => {
    await send({ choice: { mode: 'selected', hostIds: ['a', 'elsewhere'] } })
    expect(mockWrites[0]['visibleTo']).toEqual(['host:a'])
  })
})

describe('who may, as the rule on a client’s `visibleTo` write asks', () => {
  it.each([
    ['the owner', OWNER],
    ['an editor', EDITOR],
    // A site that narrows them takes the schema and records, and sharing is not among those.
    ['an editor a site narrows', NARROWED_EDITOR],
  ])('%s', async (_name, member) => {
    mockMember = member
    expect((await send({ choice: { mode: 'allExcept', exceptHostIds: ['b'] } })).status).toBe(200)
    expect(mockWrites).toHaveLength(1)
  })

  it('a viewer is refused, naming "Manage data"', async () => {
    mockMember = VIEWER
    const response = await send({ choice: { mode: 'all' } })
    expect(response.status).toBe(403)
    const payload = await response.json()
    expect(payload.permission).toBe('data.manage')
    expect(payload.error).toContain('Manage data')
    expect(mockWrites).toEqual([])
  })

  it('a site-only holder of "Manage data" is refused, naming the reach it takes', async () => {
    mockMember = SITE_ONLY
    const response = await send({ choice: { mode: 'allExcept', exceptHostIds: ['b'] } })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('every site in the workspace')
    expect(mockWrites).toEqual([])
  })

  it('no membership is refused', async () => {
    mockMember = null
    expect((await send({ choice: { mode: 'all' } })).status).toBe(403)
    expect(mockWrites).toEqual([])
  })

  it('staff may, with a membership, as the rules’ `isStaff()`', async () => {
    mockStaff = true
    mockMember = VIEWER
    expect((await send({ choice: { mode: 'all' } })).status).toBe(200)
  })
})
