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
 * The site variables a workflow computes, as this plugin answers a page's
 * compose (AGL-129, AGL-3080): the site's live workflows, read once beside
 * the page's other reads and cached under the site's data tag, run for each
 * variable that names one — by id first, then by name — and a variable whose
 * workflow is gone, deleted or unreadable keeps its stored value.
 */

let mockDocs: Array<{ id: string; data: Record<string, unknown> }> = []
let mockReadFails = false
const mockRead: Array<{ path: string; limit: number }> = []
const mockCached: Array<{ key: unknown; tags: unknown }> = []

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
                  if (mockReadFails) throw new Error('storage down')
                  return { docs: mockDocs.map((doc) => ({ id: doc.id, data: () => doc.data })) }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { key: unknown; tags: unknown; read: () => Promise<unknown> }) => {
    mockCached.push({ key: options.key, tags: options.tags })
    return options.read()
  },
}))

import type { HostFunction } from '@aglyn/aglyn/app-utils/functions'
import type { WorkflowComputedVariable } from '../model/workflows'
import { COMPUTED_VARIABLE_WORKFLOWS_READ, prepareWorkflowVariables } from './workflow-variables'

const double: HostFunction = {
  name: 'Double',
  parameters: [{ name: 'X', type: 'number', required: true }],
  variables: [{ name: 'Y', type: 'number' }],
  operations: [
    {
      if: { left: '1', comparator: '==', right: '1' },
      then: [{ set: 'Y', expression: 'X * 2' }],
      otherwise: [],
    },
  ],
  returnValue: 'Y',
}

const QUOTE = { name: 'Quote', steps: [{ functionName: 'Double', args: ['21'] }] }

const VARIABLES: Record<string, WorkflowComputedVariable> = {
  'v-id': { name: 'byId', type: 'number', value: '1', workflowId: 'wf-quote', workflowName: 'Old name' },
  'v-name': { name: 'byName', type: 'number', value: '2', workflowName: 'Quote' },
  'v-gone': { name: 'gone', type: 'number', value: '3', workflowId: 'wf-gone' },
  'v-plain': { name: 'plain', type: 'text', value: 'Hi' },
}

beforeEach(() => {
  mockDocs = []
  mockReadFails = false
  mockRead.length = 0
  mockCached.length = 0
})

describe('the variables a workflow computes (AGL-3080)', () => {
  it('runs the workflow a variable names, by id or by name, and leaves the rest', async () => {
    mockDocs = [
      { id: 'wf-quote', data: QUOTE },
      { id: 'wf-deleted', data: { name: 'Deleted', steps: [], deletedAt: 1 } },
    ]
    const compute = await prepareWorkflowVariables('site-1')
    const computed = compute({ variables: VARIABLES, functions: { Double: double } })
    expect(computed['v-id']?.value).toBe('42')
    expect(computed['v-name']?.value).toBe('42')
    expect(computed['v-gone']?.value).toBe('3')
    expect(computed['v-plain']).toBe(VARIABLES['v-plain'])
    expect(mockRead).toEqual([{ path: 'hosts/site-1/workflows', limit: COMPUTED_VARIABLE_WORKFLOWS_READ }])
    expect(mockCached).toEqual([{ key: ['tenant-workflows', 'site-1'], tags: ['tenant-data:site-1'] }])
  })

  it('keeps every stored value when the site’s workflows cannot be read', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockReadFails = true
    const compute = await prepareWorkflowVariables('site-1')
    expect(compute({ variables: VARIABLES, functions: { Double: double } })).toEqual(VARIABLES)
    spy.mockRestore()
  })
})
