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
 * The CRM's `pipeline` index (AGL-3080): what another plugin is told about
 * the organization's pipelines — live ones only, each with a name a person
 * reads and its stages — and only the ones the asking site can see.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockReads: Array<{ path: string; scopedTo: string | null; fields: string[]; limit: number | null }> = []

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return { id: path.split('/').pop() as string, exists: data !== undefined, data: () => data }
}

function mockQuery(path: string, state: { scopedTo: string | null; fields: string[]; limit: number | null }) {
  return {
    scope: (hostId: string) => mockQuery(path, { ...state, scopedTo: hostId }),
    select: (...fields: string[]) => mockQuery(path, { ...state, fields }),
    limit: (limit: number) => mockQuery(path, { ...state, limit }),
    doc: (id: string) => ({ get: async () => mockSnapshot(`${path}/${id}`) }),
    get: async () => {
      mockReads.push({ path, ...state })
      const docs = [...mockDocs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter(([, data]) => {
          if (!state.scopedTo) return true
          const visibleTo = (data['visibleTo'] as string[] | undefined) ?? []
          return visibleTo.includes('org') || visibleTo.includes(`host:${state.scopedTo}`)
        })
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, state.limit ?? undefined)
        .map(([key]) => mockSnapshot(key))
      return { docs }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (root: string) => ({
          doc: (orgId: string) => ({
            collection: (name: string) =>
              mockQuery(`${root}/${orgId}/${name}`, { scopedTo: null, fields: [], limit: null }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  scopedToHost: (ref: { scope: (hostId: string) => unknown }, hostId: string) => ref.scope(hostId),
}))

import { pipelineRecordIndex, UNTITLED_PIPELINE } from './pipeline-record-index'

beforeEach(() => {
  mockDocs.clear()
  mockReads.length = 0
  mockDocs.set('orgs/org-1/pipelines/p-a', {
    name: 'Sales',
    visibleTo: ['org'],
    stages: [{ id: 'new', name: 'New' }, { id: 'won', name: ' Won ' }, { name: 'No id' }, { id: 'nameless' }],
  })
  mockDocs.set('orgs/org-1/pipelines/p-b', { name: 'Old', visibleTo: ['org'], stages: [], archivedAt: 1_700_000_000_000 })
  mockDocs.set('orgs/org-1/pipelines/p-c', { visibleTo: ['host:host-2'], stages: [{ id: 'lead', name: 'Lead' }] })
})

describe('the CRM’s pipeline index', () => {
  it('lists the organization’s live pipelines with their stages, naming an unnamed one as the CRM does', async () => {
    expect(await pipelineRecordIndex.list({ orgId: 'org-1', limit: 10 })).toEqual({
      records: [
        {
          id: 'p-a',
          name: 'Sales',
          facts: {
            stages: [
              { id: 'new', name: 'New' },
              { id: 'won', name: 'Won' },
              { id: 'nameless', name: '' },
            ],
          },
        },
        { id: 'p-c', name: UNTITLED_PIPELINE, facts: { stages: [{ id: 'lead', name: 'Lead' }] } },
      ],
      truncated: false,
    })
  })

  it('answers a site the pipelines it can see, reading one more than asked to know there are more', async () => {
    const answer = await pipelineRecordIndex.list({ orgId: 'org-1', hostId: 'host-1', limit: 1 })
    expect(answer.records.map((record) => record.id)).toEqual(['p-a'])
    expect(answer.truncated).toBe(true)
    expect(mockReads).toEqual([
      { path: 'orgs/org-1/pipelines', scopedTo: 'host-1', fields: ['name', 'stages', 'archivedAt'], limit: 2 },
    ])
  })

  it('answers nothing without an organization', async () => {
    expect(await pipelineRecordIndex.list({ hostId: 'host-1', limit: 10 })).toEqual({ records: [], truncated: false })
    expect(await pipelineRecordIndex.get({ hostId: 'host-1', id: 'p-a' })).toBeNull()
    expect(mockReads).toEqual([])
  })

  it('reads one live pipeline, and none that is archived, missing, or out of the site’s sight', async () => {
    expect((await pipelineRecordIndex.get({ orgId: 'org-1', id: 'p-a' }))?.name).toBe('Sales')
    expect(await pipelineRecordIndex.get({ orgId: 'org-1', id: 'p-b' })).toBeNull()
    expect(await pipelineRecordIndex.get({ orgId: 'org-1', id: 'p-z' })).toBeNull()
    expect((await pipelineRecordIndex.get({ orgId: 'org-1', hostId: 'host-2', id: 'p-c' }))?.id).toBe('p-c')
    expect(await pipelineRecordIndex.get({ orgId: 'org-1', hostId: 'host-1', id: 'p-c' })).toBeNull()
  })
})
