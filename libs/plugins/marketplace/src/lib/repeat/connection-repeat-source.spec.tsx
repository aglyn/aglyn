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
 * A plugin connection's record in the editor (AGL-4212): the picker lists
 * this site's connections by name, the canvas draws rows from the records the
 * provider already holds (through core's shared row function, so they are the
 * published page's), and the insert-token menu names each declared field.
 */

import {
  EditorPluginConnectionsContext,
  type EditorPluginConnections,
} from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  connectionRepeatAnswer,
  connectionRepeatFields,
  connectionRepeatOptions,
  connectionRepeatSource,
  useConnectionRepeatRows,
} from './connection-repeat-source'

const NOV_3 = Date.UTC(2026, 10, 3)

const CONNECTIONS: EditorPluginConnections = {
  listingFor: () => null,
  variables: [],
  records: {
    Kq3: {
      google: {
        fields: { rating: 4.6, reviewCount: 120 },
        items: [
          { author: 'Jordan Lee', reply: 'Thanks!', publishedAt: NOV_3 },
          { author: 'Pat Lee', publishedAt: NOV_3 },
        ],
        syncedAtMs: 1,
      },
    },
  },
  repeatables: [
    {
      identity: 'aglyn.google-reviews',
      listingId: 'Kq3',
      connectionId: 'google',
      label: 'Google',
      types: {
        fields: { rating: 'number', reviewCount: 'number' },
        items: { author: 'string', reply: 'string', publishedAt: 'datetime' },
      },
    },
  ],
}

describe('the connection repeat source (AGL-4212)', () => {
  it('picks from this site’s connections by name, never by a typed id', () => {
    expect(connectionRepeatOptions(CONNECTIONS)).toEqual([
      { value: '', label: 'None' },
      { value: 'aglyn.google-reviews/google', label: 'Google: each item' },
      { value: 'aglyn.google-reviews/google/fields', label: 'Google: summary' },
    ])
    expect(connectionRepeatOptions(undefined)).toEqual([{ value: '', label: 'No connections on this site' }])
  })

  it('is a picker under repeatConnection, offered only where the site has a connection', () => {
    const source = connectionRepeatSource(CONNECTIONS)
    expect(source).toMatchObject({
      id: 'pluginConnection',
      keyProp: 'repeatConnection',
      offered: true,
      keyAttribute: { component: 'select', label: 'Repeat over a connection' },
    })
    expect(connectionRepeatSource().offered).toBe(false)
    // The same reader hook whatever the site, so a mounted reader keeps its hooks.
    expect(connectionRepeatSource().useRows).toBe(source.useRows)
  })

  it('answers the items, under the stored value and the key the expansion looks up', () => {
    const answer = connectionRepeatAnswer(CONNECTIONS, 'aglyn.google-reviews/google')
    expect(answer.status).toBe('ready')
    if (answer.status !== 'ready') return
    expect(answer.label).toBe('Google')
    const rows = answer.rowsByKey['aglyn.google-reviews/google']
    expect(answer.rowsByKey['connection:aglyn.google-reviews/google']).toBe(rows)
    expect(rows.records).toEqual([
      {
        $id: '0',
        author: 'Jordan Lee',
        reply: 'Thanks!',
        publishedAt: 'Nov 3, 2026',
        publishedAtIso: '2026-11-03T00:00:00.000Z',
      },
      { $id: '1', author: 'Pat Lee', publishedAt: 'Nov 3, 2026', publishedAtIso: '2026-11-03T00:00:00.000Z' },
    ])
  })

  it('answers the summary as one row', () => {
    const answer = connectionRepeatAnswer(CONNECTIONS, 'aglyn.google-reviews/google/fields')
    expect(answer.status === 'ready' && answer.rowsByKey['aglyn.google-reviews/google/fields'].records).toEqual([
      { $id: 'fields', rating: 4.6, reviewCount: 120 },
    ])
  })

  it('is missing for a key this site cannot name, or with no connections known', () => {
    expect(connectionRepeatAnswer(CONNECTIONS, 'someone.else/google')).toEqual({ status: 'missing' })
    expect(connectionRepeatAnswer(CONNECTIONS, 'not a key')).toEqual({ status: 'missing' })
    expect(connectionRepeatAnswer(undefined, 'aglyn.google-reviews/google')).toEqual({ status: 'missing' })
  })

  it('names each field a token can use, the Iso sibling included', () => {
    expect(connectionRepeatFields(CONNECTIONS, 'aglyn.google-reviews/google')).toEqual([
      { id: 'author', label: 'Author' },
      { id: 'reply', label: 'Reply' },
      { id: 'publishedAt', label: 'Published at' },
      { id: 'publishedAtIso', label: 'Published at (ISO date)' },
    ])
    expect(connectionRepeatSource(CONNECTIONS).fields?.('aglyn.google-reviews/google/fields')).toEqual([
      { id: 'rating', label: 'Rating' },
      { id: 'reviewCount', label: 'Review count' },
    ])
    expect(connectionRepeatSource().fields?.('aglyn.google-reviews/google')).toBeUndefined()
  })

  it('reads the provider’s records, with no read of its own', () => {
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <EditorPluginConnectionsContext.Provider value={CONNECTIONS}>{children}</EditorPluginConnectionsContext.Provider>
    )
    const { result } = renderHook(() => useConnectionRepeatRows({ hostId: 'h1', key: 'aglyn.google-reviews/google' }), {
      wrapper,
    })
    expect(result.current.status).toBe('ready')
  })
})
