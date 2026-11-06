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
 * @jest-environment jsdom
 */

import { EditorPluginConnectionsContext } from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import { usePluginConnectionRecord } from '@aglyn/aglyn/app-utils/plugin-connection-record'
import { RealmElementNodeContext } from '@aglyn/aglyn/app-utils/realm-elements-context'
import { render, screen } from '@testing-library/react'
import { ConnectionRecordsScope } from './connection-records-scope'

/**
 * A signed element on the canvas reads its own listing's connection record
 * (AGL-4196), as the published page hands it one, and nothing else does.
 */

const connections = {
  listingFor: (componentId: string) => (componentId.startsWith('acme.') ? 'listing-1' : null),
  records: { 'listing-1': { gbp: { fields: { rating: 4.8 }, items: [], syncedAtMs: 1 } } },
  variables: [],
}

function Element() {
  const record = usePluginConnectionRecord('gbp')
  return <span data-testid="rating">{record ? String(record.fields['rating']) : 'none'}</span>
}

const draw = (node: { $id: string; componentId: string }, value = connections) =>
  render(
    <EditorPluginConnectionsContext.Provider value={value}>
      <ConnectionRecordsScope node={node}>
        <RealmElementNodeContext.Provider value={node.$id}>
          <Element />
        </RealmElementNodeContext.Provider>
      </ConnectionRecordsScope>
    </EditorPluginConnectionsContext.Provider>,
  )

describe('ConnectionRecordsScope (AGL-4196)', () => {
  it('hands a signed element its listing’s record', () => {
    draw({ $id: 'n1', componentId: 'acme.wall' })
    expect(screen.getByTestId('rating').textContent).toBe('4.8')
  })

  it('hands another plugin’s element nothing', () => {
    draw({ $id: 'n2', componentId: 'other.wall' })
    expect(screen.getByTestId('rating').textContent).toBe('none')
  })
})
