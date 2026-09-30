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
 * The workflows that call a function, as this plugin answers the "Used by"
 * scan (AGL-3080): a step naming the function's id is a rename-safe
 * reference, a step naming only its old name is one a rename breaks, and a
 * scan that read part of the site's workflows says so.
 */

const mockListed: Array<{ hostId?: string | null; limit: number }> = []
let mockRecords: Array<{ id: string; name: string; facts: Record<string, unknown> }> = []
let mockTruncated = false

jest.mock('./automation-record-index', () => ({
  workflowRecordIndex: {
    list: async (request: { hostId?: string | null; limit: number }) => {
      mockListed.push({ hostId: request.hostId, limit: request.limit })
      return { records: mockRecords, truncated: mockTruncated }
    },
    get: async () => null,
  },
}))

import {
  FUNCTION_DEPENDENTS_WORKFLOWS_READ,
  findFunctionDependents,
} from './workflow-dependents'

const ask = { hostId: 'site-1', kind: 'function', id: 'fn-1', name: 'rateFor' }

beforeEach(() => {
  mockListed.length = 0
  mockRecords = []
  mockTruncated = false
})

describe('the workflows that call a function (AGL-3080)', () => {
  it('names each workflow by how its steps refer to the function', async () => {
    mockRecords = [
      { id: 'wf-both', name: 'Quote', facts: { steps: [{ functionId: 'fn-1', functionName: 'rateFor' }] } },
      // Renamed since the step was written: the id still finds it.
      { id: 'wf-id', name: 'Renamed', facts: { steps: [{ functionId: 'fn-1', functionName: 'oldRate' }] } },
      // Written before ids existed.
      { id: 'wf-name', name: 'Legacy', facts: { steps: [{ functionName: 'rateFor' }] } },
      { id: 'wf-other', name: 'Tax', facts: { steps: [{ functionId: 'fn-2', functionName: 'taxFor' }] } },
      { id: 'wf-odd', name: 'Odd', facts: { steps: 'not a list' } },
      { id: 'wf-mixed', name: 'Mixed', facts: { steps: [null, 'x', { functionName: 'rateFor' }, { functionId: 'fn-1' }] } },
    ]
    await expect(findFunctionDependents(ask)).resolves.toEqual({
      dependents: [
        { type: 'workflow', id: 'wf-both', name: 'Quote', via: ['id', 'name'] },
        { type: 'workflow', id: 'wf-id', name: 'Renamed', via: ['id'] },
        { type: 'workflow', id: 'wf-name', name: 'Legacy', via: ['name'] },
        { type: 'workflow', id: 'wf-mixed', name: 'Mixed', via: ['id', 'name'] },
      ],
      truncated: false,
    })
    expect(mockListed).toEqual([{ hostId: 'site-1', limit: FUNCTION_DEPENDENTS_WORKFLOWS_READ }])
  })

  it('matches no name when the scan names none', async () => {
    mockRecords = [{ id: 'wf-name', name: 'Legacy', facts: { steps: [{ functionName: '' }] } }]
    await expect(findFunctionDependents({ ...ask, name: undefined })).resolves.toEqual({
      dependents: [],
      truncated: false,
    })
  })

  it('says the answer is partial when the site holds more workflows than were read', async () => {
    mockTruncated = true
    await expect(findFunctionDependents(ask)).resolves.toMatchObject({ truncated: true })
  })
})
