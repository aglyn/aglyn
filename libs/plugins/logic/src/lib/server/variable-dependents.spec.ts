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
 * The variables computed from a workflow, as this plugin answers the "Used
 * by" scan the workflows plugin runs before a rename or a delete (AGL-3080).
 */

let mockDocs: Array<{ id: string; data: Record<string, unknown> }> = []
const mockRead: Array<{ path: string; limit: number }> = []

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (root: string) => ({
          doc: (hostId: string) => ({
            collection: (name: string) => ({
              limit: (count: number) => ({
                get: async () => {
                  mockRead.push({ path: `${root}/${hostId}/${name}`, limit: count })
                  const docs = mockDocs.slice(0, count).map((doc) => ({ id: doc.id, data: () => doc.data }))
                  return { docs, size: docs.length }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import {
  WORKFLOW_DEPENDENTS_VARIABLES_READ,
  findWorkflowDependents,
} from './variable-dependents'

const ask = { hostId: 'site-1', kind: 'workflow', id: 'wf-1', name: 'Quote' }

beforeEach(() => {
  mockDocs = []
  mockRead.length = 0
})

describe('the variables computed from a workflow (AGL-3080)', () => {
  it('names each live variable by how it refers to the workflow', async () => {
    mockDocs = [
      { id: 'v-both', data: { name: 'price', workflowId: 'wf-1', workflowName: 'Quote' } },
      // The workflow was renamed after it was picked: the id still finds it.
      { id: 'v-id', data: { name: 'total', workflowId: 'wf-1', workflowName: 'Old quote' } },
      // Picked before ids existed.
      { id: 'v-name', data: { name: 'legacy', workflowName: 'Quote' } },
      { id: 'v-other', data: { name: 'tax', workflowId: 'wf-2', workflowName: 'Tax' } },
      { id: 'v-plain', data: { name: 'greeting', value: 'Hi' } },
      { id: 'v-gone', data: { name: 'gone', workflowId: 'wf-1', deletedAt: 1 } },
      { id: 'v-unnamed', data: { workflowId: 'wf-1' } },
    ]
    await expect(findWorkflowDependents(ask)).resolves.toEqual({
      dependents: [
        { type: 'variable', id: 'v-both', name: 'price', via: ['id', 'name'] },
        { type: 'variable', id: 'v-id', name: 'total', via: ['id'] },
        { type: 'variable', id: 'v-name', name: 'legacy', via: ['name'] },
        { type: 'variable', id: 'v-unnamed', name: 'v-unnamed', via: ['id'] },
      ],
      truncated: false,
    })
    expect(mockRead).toEqual([
      { path: 'hosts/site-1/variables', limit: WORKFLOW_DEPENDENTS_VARIABLES_READ + 1 },
    ])
  })

  it('says the answer is partial when the site holds more variables than one scan reads', async () => {
    mockDocs = Array.from({ length: WORKFLOW_DEPENDENTS_VARIABLES_READ + 1 }, (_, index) => ({
      id: `v-${index}`,
      data: { name: `v${index}` },
    }))
    await expect(findWorkflowDependents(ask)).resolves.toEqual({ dependents: [], truncated: true })
  })

  it('reads nothing for a question that names no workflow', async () => {
    await expect(findWorkflowDependents({ ...ask, id: ' ', name: '' })).resolves.toEqual({
      dependents: [],
      truncated: false,
    })
    expect(mockRead).toEqual([])
  })
})
