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

import type { PluginConnectionDeclaration } from '@aglyn/aglyn/app-utils/plugin-connections'
import {
  connectionFieldLabel,
  editorPluginConnections,
  listingForComponent,
  syncingConnectionsOf,
} from './editor-connections'

const CONNECTION = {
  id: 'gbp',
  provider: 'google',
  label: 'Google Business Profile',
  sync: {
    intervalHours: 6,
    requests: [],
    record: {
      fields: {
        rating: { type: 'number', path: 'averageRating', request: 'reviews' },
        reviewCount: { type: 'number', path: 'totalReviewCount', request: 'reviews' },
      },
    },
  },
} as unknown as PluginConnectionDeclaration

describe('the editor half of declared connections (AGL-4196)', () => {
  it('names a field for a person', () => {
    expect(connectionFieldLabel('reviewCount')).toBe('Review count')
    expect(connectionFieldLabel('average_rating')).toBe('Average rating')
    expect(connectionFieldLabel('rating')).toBe('Rating')
    // Abbreviations read in capitals, as the picker should print them.
    expect(connectionFieldLabel('reviewUrl')).toBe('Review URL')
    expect(connectionFieldLabel('url')).toBe('URL')
    expect(connectionFieldLabel('place_id')).toBe('Place ID')
  })

  it('attributes a component to the listing whose namespace it is in, longest first', () => {
    const listingFor = listingForComponent([
      { listingId: 'a', identity: 'acme' },
      { listingId: 'b', identity: 'acme.reviews' },
      { listingId: 'c' },
    ])
    expect(listingFor('acme.reviews.wall')).toBe('b')
    expect(listingFor('acme.badge')).toBe('a')
    expect(listingFor('other.thing')).toBeNull()
  })

  it('lists one variable per declared summary field, by name, with what the last sync wrote', () => {
    const value = editorPluginConnections({
      installs: [{ listingId: 'Kq3', identity: 'acme' }],
      listings: [{ listingId: 'Kq3', connections: [CONNECTION] }],
      records: { Kq3: { gbp: { fields: { rating: 4.8 }, items: [], syncedAtMs: 1 } } },
    })
    expect(value.variables).toEqual([
      { id: 'Kq3__gbp-rating', label: 'Google Business Profile: Rating', value: '4.8' },
      { id: 'Kq3__gbp-reviewCount', label: 'Google Business Profile: Review count', value: null },
    ])
    expect(value.listingFor('acme.wall')).toBe('Kq3')
  })

  it('only a connection that syncs writes a record', () => {
    expect(syncingConnectionsOf(null)).toEqual([])
    expect(syncingConnectionsOf({ connections: 'nope' })).toEqual([])
  })
})
