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

import { editorConnectionRecordsPageData, type EditorPluginConnections } from './plugin-connection-editor'
import { pluginConnectionRecordFor, type PluginConnectionSiteRecord } from './plugin-connection-records'

const RECORD: PluginConnectionSiteRecord = { fields: { rating: 4.8 }, items: [], syncedAtMs: 1 }

const connections: EditorPluginConnections = {
  listingFor: (componentId) => (componentId.startsWith('acme.reviews.') ? 'listing-1' : null),
  records: { 'listing-1': { gbp: RECORD } },
  variables: [],
}

describe('editorConnectionRecordsPageData (AGL-4196)', () => {
  it('attributes a signed element to its listing, so the hook hands it its own record', () => {
    const data = editorConnectionRecordsPageData(connections, [
      { $id: 'n1', componentId: 'acme.reviews.wall' },
      { $id: 'n2', componentId: 'mui.Box' },
    ])
    expect(data).toEqual({ nodes: { n1: 'listing-1' }, records: { 'listing-1': { gbp: RECORD } } })
    expect(pluginConnectionRecordFor(data, 'n1', 'gbp')).toEqual(RECORD)
    expect(pluginConnectionRecordFor(data, 'n2', 'gbp')).toBeNull()
  })

  it('is nothing without the context, a namespaced element, or a record', () => {
    expect(editorConnectionRecordsPageData(undefined, [{ $id: 'n1', componentId: 'acme.reviews.wall' }])).toBeUndefined()
    expect(editorConnectionRecordsPageData(connections, [{ $id: 'n1', componentId: 'Box' }])).toBeUndefined()
    expect(
      editorConnectionRecordsPageData({ ...connections, records: {} }, [{ $id: 'n1', componentId: 'acme.reviews.wall' }]),
    ).toBeUndefined()
    expect(editorConnectionRecordsPageData(connections, [null, { componentId: 'acme.reviews.wall' }])).toBeUndefined()
  })
})
