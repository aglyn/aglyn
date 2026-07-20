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
  COLLECTION_TOKEN_CATALOG,
  datasetItemToken,
  datasetItemTokens,
  ENTRY_TOKEN_CATALOG,
} from './binding-token-catalog'
import { collectionEntryTokens } from './collection-entries'
import type { DatasetModel } from './dataset-models'

/** `{{entry.title}}` → `entry.title` (the resolver map key). */
const tokenKey = (token: string) => token.replace(/^\{\{|\}\}$/g, '')

describe('binding token catalog (AGL-583)', () => {
  describe('ENTRY_TOKEN_CATALOG', () => {
    it('mirrors collectionEntryTokens exactly — no drift in either direction', () => {
      const resolverKeys = Object.keys(collectionEntryTokens({}, 'blog'))
      const catalogKeys = ENTRY_TOKEN_CATALOG.map((entry) =>
        tokenKey(entry.token),
      )
      // Every browsable token resolves…
      for (const key of catalogKeys) {
        expect(resolverKeys).toContain(key)
      }
      // …and every resolvable token is browsable.
      for (const key of resolverKeys) {
        expect(catalogKeys).toContain(key)
      }
    })

    it('gives every token a friendly label and description', () => {
      for (const entry of ENTRY_TOKEN_CATALOG) {
        expect(entry.token).toMatch(/^\{\{entry\.[a-zA-Z]+\}\}$/)
        expect(entry.label.length).toBeGreaterThan(0)
        // Labels are friendly names, never raw token paths.
        expect(entry.label).not.toContain('entry.')
        expect(entry.description?.length).toBeGreaterThan(0)
      }
    })

    it('names the everyday fields the way editors know them', () => {
      const byToken = Object.fromEntries(
        ENTRY_TOKEN_CATALOG.map((entry) => [entry.token, entry.label]),
      )
      expect(byToken['{{entry.title}}']).toBe('Title')
      expect(byToken['{{entry.url}}']).toBe('Link URL')
      expect(byToken['{{entry.date}}']).toBe('Published date')
    })
  })

  describe('COLLECTION_TOKEN_CATALOG', () => {
    it('covers the collection page tokens', () => {
      const tokens = COLLECTION_TOKEN_CATALOG.map((entry) => entry.token)
      expect(tokens).toEqual(['{{collection.name}}', '{{collection.slug}}'])
      for (const entry of COLLECTION_TOKEN_CATALOG) {
        expect(entry.label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('datasetItemToken', () => {
    it('formats the plain field token from the stable id', () => {
      expect(datasetItemToken('price')).toBe('{{item.price}}')
    })

    it('formats the one-hop reference token', () => {
      expect(datasetItemToken('author', 'name')).toBe('{{item.author.name}}')
    })
  })

  describe('datasetItemTokens', () => {
    const model: DatasetModel = {
      order: ['title', 'author', 'price'],
      fields: {
        title: { name: 'Post title', type: 'text' },
        author: {
          name: 'Author',
          type: 'reference',
          reference: { datasetId: 'authors', displayFieldId: 'full_name' },
        },
        price: { name: 'Price', type: 'float' },
      },
    }

    it('labels tokens with display names while inserting reference ids', () => {
      const entries = datasetItemTokens(model)
      expect(entries).toContainEqual(
        expect.objectContaining({
          token: '{{item.title}}',
          label: 'Post title',
        }),
      )
      // The token always carries the stable id, never the display name.
      expect(
        entries.some((entry) => entry.token.includes('Post title')),
      ).toBe(false)
    })

    it('keeps model order', () => {
      const tokens = datasetItemTokens(model).map((entry) => entry.token)
      expect(tokens.indexOf('{{item.title}}')).toBeLessThan(
        tokens.indexOf('{{item.author}}'),
      )
      expect(tokens.indexOf('{{item.author}}')).toBeLessThan(
        tokens.indexOf('{{item.price}}'),
      )
    })

    it('adds a one-hop token for reference fields with a display field', () => {
      const entries = datasetItemTokens(model)
      expect(entries).toContainEqual(
        expect.objectContaining({
          token: '{{item.author.full_name}}',
          label: 'Author → Full name',
        }),
      )
    })

    it('describes fields by their type label', () => {
      const price = datasetItemTokens(model).find(
        (entry) => entry.token === '{{item.price}}',
      )
      expect(price?.description).toBe('Number')
    })

    it('falls back to a humanized id when the display name is blank', () => {
      const entries = datasetItemTokens({
        order: ['roast_preference'],
        fields: { roast_preference: { name: '  ', type: 'text' } },
      })
      expect(entries[0]).toEqual(
        expect.objectContaining({
          token: '{{item.roast_preference}}',
          label: 'Roast preference',
        }),
      )
    })

    it('skips order entries with no field definition', () => {
      const entries = datasetItemTokens({
        order: ['ghost', 'title'],
        fields: { title: { name: 'Title', type: 'text' } },
      })
      expect(entries).toHaveLength(1)
      expect(entries[0].token).toBe('{{item.title}}')
    })
  })
})
