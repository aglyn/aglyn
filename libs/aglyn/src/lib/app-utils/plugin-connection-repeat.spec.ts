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
 * The one function a connection's record becomes rows through (AGL-4212):
 * the marketplace's server reader answers the published page with it and its
 * editor source draws the canvas with it, so these cases pin what both get.
 */

import {
  parsePluginConnectionRepeat,
  pluginConnectionDate,
  pluginConnectionFieldTypes,
  pluginConnectionRepeatFieldNames,
  pluginConnectionRepeatRow,
  pluginConnectionRepeatRows,
  pluginConnectionRepeatValue,
} from './plugin-connection-repeat'

const TYPES = {
  fields: { rating: 'number', reviewCount: 'number', name: 'string' },
  items: {
    author: 'string',
    rating: 'number',
    text: 'string',
    reply: 'string',
    publishedAt: 'datetime',
    verified: 'boolean',
  },
} as const

/** 2026-11-03T15:30:00Z */
const NOV_3 = Date.UTC(2026, 10, 3, 15, 30)

describe('parsePluginConnectionRepeat', () => {
  it('reads an items value, a summary value, and the key repeatKey makes', () => {
    expect(parsePluginConnectionRepeat('aglyn.google-reviews/google')).toEqual({
      identity: 'aglyn.google-reviews',
      connectionId: 'google',
      part: 'items',
    })
    expect(parsePluginConnectionRepeat(' aglyn.google-reviews/google/fields ')).toEqual({
      identity: 'aglyn.google-reviews',
      connectionId: 'google',
      part: 'fields',
    })
    expect(parsePluginConnectionRepeat('connection:aglyn.google-reviews/google')).toEqual({
      identity: 'aglyn.google-reviews',
      connectionId: 'google',
      part: 'items',
    })
  })

  it('names nothing for a malformed value', () => {
    for (const value of [
      '',
      'google',
      'aglyn.google-reviews',
      'aglyn.google-reviews/',
      'aglyn.google-reviews/google/items',
      'aglyn.google-reviews/google/fields/more',
      'no-dot/google',
      'aglyn.google-reviews/Google',
      '../x/google',
      42,
      null,
    ]) {
      expect(parsePluginConnectionRepeat(value)).toBeNull()
    }
  })

  it('round-trips through pluginConnectionRepeatValue', () => {
    for (const value of ['acme.reviews/google', 'acme.reviews/google/fields']) {
      expect(pluginConnectionRepeatValue(parsePluginConnectionRepeat(value)!)).toBe(value)
    }
  })
})

describe('pluginConnectionDate', () => {
  it('prints en-US short date in UTC, with the ISO instant', () => {
    expect(pluginConnectionDate(NOV_3)).toEqual({
      text: 'Nov 3, 2026',
      iso: '2026-11-03T15:30:00.000Z',
    })
    // The words the platform's Intl options print, so either side agrees.
    expect(pluginConnectionDate(NOV_3)?.text).toBe(
      new Date(NOV_3).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    )
  })

  it('names no date for a value that is no instant', () => {
    for (const value of [Number.NaN, Infinity, 'soon', '', null, undefined, {}]) {
      expect(pluginConnectionDate(value)).toBeNull()
    }
  })
})

describe('pluginConnectionRepeatRow', () => {
  it('keeps types, prints a datetime with its Iso sibling, and leaves the missing absent', () => {
    expect(
      pluginConnectionRepeatRow(
        { author: 'Jordan Lee', rating: 5, publishedAt: NOV_3, verified: false, reply: null, extra: 'x' },
        TYPES.items,
      ),
    ).toEqual({
      author: 'Jordan Lee',
      rating: 5,
      publishedAt: 'Nov 3, 2026',
      publishedAtIso: '2026-11-03T15:30:00.000Z',
      verified: false,
    })
  })

  it('never writes over a field the plugin declared under the Iso name', () => {
    expect(
      pluginConnectionRepeatRow(
        { at: NOV_3, atIso: 'mine' },
        { at: 'datetime', atIso: 'string' },
      ),
    ).toEqual({ at: 'Nov 3, 2026', atIso: 'mine' })
  })
})

describe('pluginConnectionRepeatRows', () => {
  const record = {
    fields: { rating: 4.6, reviewCount: 120, name: 'Acme Builders' },
    items: [
      { author: 'Jordan Lee', rating: 5, text: 'Great', reply: 'Thanks!', publishedAt: NOV_3 },
      { author: 'Pat Lee', rating: 4, text: 'Good' },
    ],
  }

  it('makes one row per item, each with its position as $id', () => {
    const rows = pluginConnectionRepeatRows(record, TYPES as any, 'items')
    expect(rows.records.map((row) => row['$id'])).toEqual(['0', '1'])
    expect(rows.records[1]).toEqual({ $id: '1', author: 'Pat Lee', rating: 4, text: 'Good' })
  })

  it('makes exactly one row of the summary fields', () => {
    expect(pluginConnectionRepeatRows(record, TYPES as any, 'fields').records).toEqual([
      { $id: 'fields', rating: 4.6, reviewCount: 120, name: 'Acme Builders' },
    ])
  })

  it('makes no rows before the first sync', () => {
    expect(pluginConnectionRepeatRows(null, TYPES as any, 'fields').records).toEqual([])
    expect(pluginConnectionRepeatRows(undefined, TYPES as any, 'items').records).toEqual([])
  })
})

describe('field types and names', () => {
  it('reads the types a declaration gives its record', () => {
    expect(
      pluginConnectionFieldTypes({
        sync: {
          intervalHours: 24,
          requests: [],
          record: {
            fields: { rating: { type: 'number', path: 'rating', request: 'place' } },
            items: {
              request: 'reviews',
              maxItems: 5,
              fields: { publishedAt: { type: 'datetime', path: 'time' } },
            },
          },
        },
      }),
    ).toEqual({ fields: { rating: 'number' }, items: { publishedAt: 'datetime' } })
    expect(pluginConnectionFieldTypes(undefined)).toEqual({ fields: {}, items: {} })
  })

  it('names every token a repeat can use, each datetime followed by its Iso', () => {
    expect(pluginConnectionRepeatFieldNames(TYPES as any, 'items')).toEqual([
      'author',
      'rating',
      'text',
      'reply',
      'publishedAt',
      'publishedAtIso',
      'verified',
    ])
    expect(pluginConnectionRepeatFieldNames(TYPES as any, 'fields')).toEqual([
      'rating',
      'reviewCount',
      'name',
    ])
  })
})
