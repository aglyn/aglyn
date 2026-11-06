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

import type { EditorPluginConnections } from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import { bindingLookupsFromDocs, connectionVariableDocs } from '../hooks/use-host-binding-docs'

/**
 * The variables a site's declared plugin connections give it (AGL-4196), in
 * the editor's binding lookups: by the connection's name and the field's,
 * never the id, holding what the last sync wrote so the canvas prints it.
 */

const connections: EditorPluginConnections = {
  listingFor: () => null,
  records: {},
  variables: [
    { id: 'Kq3__gbp-rating', label: 'Google Business Profile: Rating', value: '4.8' },
    { id: 'Kq3__gbp-reviewCount', label: 'Google Business Profile: Review count', value: null },
  ],
}

describe('connection variables in the editor lookups (AGL-4196)', () => {
  it('are documents named for a person, keyed by the token id', () => {
    expect(connectionVariableDocs(connections)).toEqual([
      { $id: 'Kq3__gbp-rating', name: 'Google Business Profile: Rating', value: '4.8', connection: true },
      { $id: 'Kq3__gbp-reviewCount', name: 'Google Business Profile: Review count', value: '', connection: true },
    ])
    const { variables } = bindingLookupsFromDocs([], [], connections)
    expect(variables['Kq3__gbp-rating']).toMatchObject({ name: 'Google Business Profile: Rating', value: '4.8' })
  })

  it('a site variable that shares a name keeps it', () => {
    const own = { $id: 'abc', name: 'Google Business Profile: Rating', value: 'mine' }
    const { variables } = bindingLookupsFromDocs([own], [], connections)
    expect(variables['Google Business Profile: Rating']).toBe(own)
    expect(variables['Kq3__gbp-rating']).toMatchObject({ value: '4.8' })
  })

  it('nothing without the context', () => {
    expect(connectionVariableDocs(undefined)).toEqual([])
    expect(Object.keys(bindingLookupsFromDocs([], [], undefined).variables)).toEqual([])
  })
})
