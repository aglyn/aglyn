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
 */

/**
 * AGL-3330: a form's counters follow a row removed by a path that is not the
 * forms plugin's own, through the platform's `host.records.removed` event.
 */

const mockRecounts: Array<{ hostId: string; formId: string }> = []
jest.mock('./server/form-stats', () => ({
  recountFormStats: async (options: { hostId: string; formId: string }) => {
    mockRecounts.push({ hostId: options.hostId, formId: options.formId })
    return null
  },
}))

import {
  listPluginEventHandlers,
  resetPluginEventHandlersForTests,
  runPluginEventHandlers,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import { formsCountingRemovedRecords, registerFormsServerDeclarations } from './declarations.server'

beforeEach(() => {
  mockRecounts.length = 0
  resetPluginEventHandlersForTests()
})

describe('the forms a removed record was counted by', () => {
  it('names a submission\'s form on its own site', () => {
    expect(
      formsCountingRemovedRecords({
        orgId: 'org-1',
        hostIds: ['host-1'],
        collection: 'formSubmissions',
        records: [
          { id: 's1', data: { formId: 'form-1', hostId: 'host-1' } },
          { id: 's2', data: { formId: 'form-1' } },
          { id: 's3', data: {} },
        ],
      }),
    ).toEqual([{ hostId: 'host-1', formIds: ['form-1'] }])
  })

  it("names every form in a lead's sources, on each of the organization's sites", () => {
    expect(
      formsCountingRemovedRecords({
        orgId: 'org-1',
        hostIds: ['host-1', 'host-2'],
        collection: 'leads',
        records: [{ id: 'p1', data: { sources: ['form:form-1', 'booking', 'form:form-2'] } }],
      }),
    ).toEqual([
      { hostId: 'host-1', formIds: ['form-1', 'form-2'] },
      { hostId: 'host-2', formIds: ['form-1', 'form-2'] },
    ])
  })

  it('names nothing for a collection no form counts', () => {
    expect(
      formsCountingRemovedRecords({
        orgId: 'org-1',
        hostIds: ['host-1'],
        collection: 'orders',
        records: [{ id: 'o1', data: { formId: 'form-1' } }],
      }),
    ).toEqual([])
  })
})

describe('registerFormsServerDeclarations', () => {
  it('recounts each form a removal fed, as the forms plugin', async () => {
    registerFormsServerDeclarations()
    expect(listPluginEventHandlers('host.records.removed')).toEqual(['forms'])
    const result = await runPluginEventHandlers('host.records.removed', {
      orgId: 'org-1',
      hostIds: ['host-1'],
      collection: 'formSubmissions',
      records: [{ id: 's1', data: { formId: 'form-1' } }],
    })
    expect(result).toEqual({ handled: 1, failed: [] })
    expect(mockRecounts).toEqual([{ hostId: 'host-1', formId: 'form-1' }])
  })
})
