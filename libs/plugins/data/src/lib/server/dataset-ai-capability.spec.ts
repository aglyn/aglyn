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
 * The `dataset` build operation (AGL-3616): flat arguments a planner fills
 * in, turned into content the data plugin's own writer accepts, under the
 * gates every dataset create has.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-data-admin/server/data-storage-gate', () => ({ __esModule: true, dataStorageRefusal: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  memberHasOrgPermission: jest.fn(),
  resolveOrgIdForHost: jest.fn(),
  resolveOrgMembership: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({ __esModule: true, isServerReleaseFlagOnForOrg: jest.fn() }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  datasetAiCapability,
  datasetAiFieldOf,
  datasetDraftContentFromArgs,
  registerDatasetAiCapability,
} from './dataset-ai-capability'
import { checkDatasetDraftContent, DATASET_DRAFT_RESOURCE } from './dataset-drafts'

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

const ARGS = {
  name: 'Team',
  fields: ['Name', 'Role:text', 'Years:integer', 'Specialties:list', 'Bookable:boolean'],
  records: ['Head chef | Runs the kitchen | 12 | pasta; bread | true', 'Pastry chef | Desserts and breads |  | | false'],
  pageAddressFrom: 'Name',
}

describe('the dataset operation', () => {
  it('is well formed, and a draft the data plugin writes', () => {
    expect(pluginAiCapabilityProblem(datasetAiCapability)).toBeNull()
    expect(datasetAiCapability).toMatchObject({
      op: 'dataset',
      draftResource: DATASET_DRAFT_RESOURCE,
      feature: 'dataStore',
      quota: 'datasetsPerOrg',
      freeAllowed: false,
      maxPerPlan: 3,
    })
    expect(datasetAiCapability.estimateCredits(ARGS)).toBe(0)
    expect(pluginAiCapabilityArgsProblems(datasetAiCapability.argsSchema, ARGS)).toEqual([])
  })

  it('reads a field as Name:type, and a type it does not know as text', () => {
    expect(datasetAiFieldOf('Price:number')).toEqual({ name: 'Price', type: 'number' })
    expect(datasetAiFieldOf('Opening time: 9:00')).toEqual({ name: 'Opening time: 9:00', type: 'text' })
    expect(datasetAiFieldOf('Name')).toEqual({ name: 'Name', type: 'text' })
  })

  it('turns each record into values by field name, leaving an empty value out', () => {
    const content = datasetDraftContentFromArgs(ARGS)
    expect(content).toEqual({
      name: 'Team',
      fields: [
        { name: 'Name', type: 'text' },
        { name: 'Role', type: 'text' },
        { name: 'Years', type: 'integer' },
        { name: 'Specialties', type: 'list' },
        { name: 'Bookable', type: 'boolean' },
      ],
      records: [
        { Name: 'Head chef', Role: 'Runs the kitchen', Years: '12', Specialties: ['pasta', 'bread'], Bookable: 'true' },
        { Name: 'Pastry chef', Role: 'Desserts and breads', Bookable: 'false' },
      ],
      pageAddressFrom: 'Name',
    })
    // …which the writer's own check accepts, typed and addressed.
    expect(checkDatasetDraftContent(content)).toMatchObject({ ok: true, facts: { records: 2, addressField: 'slug' } })
  })

  it('registers as the data plugin’s', () => {
    registerDatasetAiCapability()
    expect(pluginAiCapability('dataset')?.pluginId).toBe('data')
  })
})
