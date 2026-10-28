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
 *
 * @jest-environment node
 */

/**
 * Index coverage for the starter search (AGL-4049).
 *
 * The emulator does not enforce index requirements, so a query shape with no
 * composite behind it works in every local run and fails in production with
 * `FAILED_PRECONDITION`. This asks the REAL `search()` every shape it can
 * take, records what it sent, and holds the index file to it: each clause
 * field paired with the order, the shape browse's `category` chip already
 * leans on, which Firestore serves by merging those composites. Whether
 * production agrees is settled once, empirically, before the promotion; if it
 * asks for a wider composite, that one is added here too.
 *
 * If you add or change a clause in `search()`, the shapes below find it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { missingListQueryIndexes } from '@aglyn/shared-ui-jsx/const/list-query-plan'

type Clause = { field: string; op: string }
const recorded: Array<{ clauses: Clause[]; order: { field: string; direction: string } | null }> = []

function query(clauses: Clause[], order: { field: string; direction: string } | null): any {
  return {
    where: (field: string, op: string) => query([...clauses, { field, op }], order),
    orderBy: (field: string, direction = 'asc') => query(clauses, { field, direction }),
    limit: () => query(clauses, order),
    get: async () => {
      recorded.push({ clauses, order })
      return { empty: true, docs: [] }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => {
          if (name !== 'marketplaceListings') throw new Error(`unexpected collection ${name}`)
          return query([], null)
        },
        getAll: async () => [],
      }),
    }),
  },
}))

import { marketplaceSiteStarterSource } from './site-starter-source'

const INDEXES = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

const ARRAY_OPS = new Set(['array-contains', 'array-contains-any'])

/** The composites one recorded query leans on: each clause field with the order. */
function needed(shape: (typeof recorded)[number]) {
  if (!shape.order) throw new Error('every starter search is ordered')
  const order = shape.order
  return shape.clauses.map((clause) => ({
    fields: [
      ARRAY_OPS.has(clause.op)
        ? { fieldPath: clause.field, arrayConfig: 'CONTAINS' as const }
        : { fieldPath: clause.field, order: 'ASCENDING' as const },
      { fieldPath: order.field, order: order.direction === 'desc' ? ('DESCENDING' as const) : ('ASCENDING' as const) },
    ],
  }))
}

async function shapeOf(input: { word?: string; filter?: Record<string, unknown> }) {
  recorded.length = 0
  await marketplaceSiteStarterSource.search(
    { word: input.word ?? '', filter: input.filter ?? {}, limit: 10 },
    { orgId: null, uid: 'u1' },
  )
  expect(recorded).toHaveLength(1)
  return recorded[0]
}

const SHAPES: Array<[string, { word?: string; filter?: Record<string, unknown> }]> = [
  ['no word', {}],
  ['a word', { word: 'bistro' }],
  ['a mode', { filter: { mode: 'base' } }],
  ['a mode and a word', { word: 'bistro', filter: { mode: 'ai' } }],
  ['a kind', { filter: { mode: 'base', kind: 'restaurant' } }],
  ['a base', { filter: { mode: 'base', base: 'bootstrap' } }],
  ['every facet the query holds, and a word', { word: 'bistro', filter: { mode: 'ai', kind: 'restaurant', base: 'bootstrap' } }],
]

describe('starter search indexes (AGL-4049)', () => {
  it.each(SHAPES)('declares what a search with %s leans on', async (_name, input) => {
    const shape = await shapeOf(input)
    expect(missingListQueryIndexes(INDEXES, 'marketplaceListings', needed(shape))).toEqual([])
  })

  it('reads the shapes it claims to: the audience or the tokens, never both', async () => {
    const plain = await shapeOf({})
    expect(plain.clauses.map((clause) => clause.field)).toEqual(['artifactType', 'browseAudience'])
    expect(plain.order).toEqual({ field: 'createdAt', direction: 'desc' })
    const worded = await shapeOf({ word: 'bistro', filter: { mode: 'ai', kind: 'restaurant', base: 'bootstrap' } })
    expect(worded.clauses.map((clause) => clause.field)).toEqual([
      'artifactType',
      'starterMode',
      'starterKind',
      'starterBase',
      'browseTokens',
    ])
  })

  it('needs no field override: every composite is COLLECTION scope', () => {
    const starterFields = ['artifactType', 'starterMode', 'starterKind', 'starterBase']
    const overrides = (INDEXES.fieldOverrides as Array<{ collectionGroup: string; fieldPath: string }>).filter(
      (entry) => entry.collectionGroup === 'marketplaceListings' && starterFields.includes(entry.fieldPath),
    )
    expect(overrides).toEqual([])
  })
})
