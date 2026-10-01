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
  pluginRecordListSource,
  pluginRecordsFromRows,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * A site's overlays, as another plugin's picker lists them: the query is this
 * plugin's, over its own collection, and so is how one document reads.
 */

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  orderBy: (field: unknown) => ({ orderBy: field }),
  limit: (value: number) => ({ limit: value }),
  query: (base: { path: string }, ...constraints: unknown[]) => ({ path: base.path, constraints }),
}))

import {
  overlayIndexedRecord,
  overlayRecordListSource,
  registerMarketingRecordLists,
} from './overlay-record-list'

describe('the overlay list source', () => {
  it('is published under `overlay` by this plugin', () => {
    resetPluginServicesForTests()
    registerMarketingRecordLists()
    expect(pluginRecordListSource('overlay')?.pluginId).toBe(BUNDLE_ID)
  })

  it('lists a site’s overlays in document order, at most the limit asked', () => {
    expect(overlayRecordListSource.query({} as never, { hostId: 'site-1', limit: 101 })).toEqual({
      path: 'hosts/site-1/overlays',
      constraints: [{ orderBy: '__name__' }, { limit: 101 }],
    })
  })

  it('lists none for the organization: an overlay is a site’s', () => {
    expect(overlayRecordListSource.query({} as never, { orgId: 'org-1', limit: 10 })).toBeNull()
  })

  it('names an overlay by its name, its bar’s text, its popup’s headline, else its id', () => {
    expect(overlayIndexedRecord('a', { name: ' Spring sale ' })?.name).toBe('Spring sale')
    expect(overlayIndexedRecord('b', { bar: { text: 'Free shipping' } })?.name).toBe('Free shipping')
    expect(overlayIndexedRecord('c', { popup: { headline: 'Join us' } })?.name).toBe('Join us')
    expect(overlayIndexedRecord('d', {})?.name).toBe('d')
  })

  it('leaves a retired overlay out', () => {
    resetPluginServicesForTests()
    registerMarketingRecordLists()
    expect(
      pluginRecordsFromRows('overlay', [
        { $id: 'live', name: 'Live' },
        { $id: 'gone', name: 'Gone', deletedAt: 1 },
      ]).map((record) => record.id),
    ).toEqual(['live'])
  })
})
