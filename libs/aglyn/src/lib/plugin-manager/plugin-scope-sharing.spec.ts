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

import {
  listScopeSharingCollections,
  registerPluginScopeSharingPatch,
  resetScopeSharingPatchesForTests,
  scopeSharingPatchFor,
} from './plugin-scope-sharing'

describe('the collections the sweep walks', () => {
  afterEach(() => resetScopeSharingPatchesForTests())

  it('holds every resource the owner chose for all sites except', () => {
    expect(listScopeSharingCollections().map((row) => row.name).sort()).toEqual(
      [
        'automations',
        'companies',
        'contacts',
        'crmActivities',
        'crmTasks',
        'datasets',
        'deals',
        'emailCampaigns',
        'leads',
        'media',
        'mediaFolders',
      ].sort(),
    )
  })

  it('does not hold what stays out: member access, segments, lists, forms', () => {
    const names = listScopeSharingCollections().map((row) => row.name)
    for (const name of ['members', 'contactSegments', 'contactFields', 'emailLists', 'forms']) {
      expect(names).not.toContain(name)
    }
  })

  it('caps every CRM collection at the most a list query can fold', () => {
    const crm = listScopeSharingCollections().filter((row) => row.pluginId === 'crm')
    expect(crm).toHaveLength(6)
    for (const row of crm) {
      expect(row.maxIncluded).toBe(30)
      expect(row.keepSiteFields).toEqual(['hostId', 'capturedByHostIds'])
    }
  })

  it('caps and keeps nothing for the rest', () => {
    const others = listScopeSharingCollections().filter((row) => row.pluginId !== 'crm')
    for (const row of others) {
      expect(row.maxIncluded).toBeUndefined()
      expect(row.keepSiteFields).toBeUndefined()
      expect(row.patch).toBeUndefined()
    }
  })

  it('names one owner per collection', () => {
    const names = listScopeSharingCollections().map((row) => row.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('takes a patch only from the plugin that declared the collection with one', () => {
    const patch = () => ({})
    registerPluginScopeSharingPatch(['contacts'], patch, { pluginId: 'crm' })
    expect(scopeSharingPatchFor('contacts')).toBe(patch)
    expect(scopeSharingPatchFor('leads')).toBeNull()
    expect(() => registerPluginScopeSharingPatch(['contacts'], patch, { pluginId: 'data' })).toThrow(
      'did not declare',
    )
    expect(() => registerPluginScopeSharingPatch(['crmActivities'], patch, { pluginId: 'crm' })).toThrow(
      'did not declare',
    )
    expect(() => registerPluginScopeSharingPatch(['media'], patch, { pluginId: 'crm' })).toThrow(
      'did not declare',
    )
    expect(() => registerPluginScopeSharingPatch(['contacts'], patch)).toThrow('no owner')
  })
})
