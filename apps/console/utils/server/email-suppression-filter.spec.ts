/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The staff suppression list's filters and search are served by its query,
 * beneath its `suppressedAt` cursor, and every query shape it can issue has
 * its composite index (AGL-3321).
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: {
      FieldPath: { documentId: () => ({ __name__: true }) },
      Timestamp: { fromDate: (date: Date) => ({ __ts: date.toISOString() }) },
    },
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFilterOperators } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  SUPPRESSION_ALONGSIDE_FIELDS,
  SUPPRESSION_FILTER_FIELDS,
  SUPPRESSION_FILTER_OPTIONS,
  SUPPRESSION_SINGLE_FIELDS,
} from '../email-suppression-filters'
import { readSuppressionFilters, suppressionQuery } from './email-suppression-filter'

type Where = [unknown, string, unknown]

/** A query that records what it was asked for, and refuses anything else. */
const recorder = () => {
  const wheres: Where[] = []
  const refused: string[] = []
  const query: any = {
    where: (path: unknown, op: string, value: unknown) => {
      wheres.push([path, op, value])
      return query
    },
    orderBy: () => {
      refused.push('orderBy')
      return query
    },
    startAt: () => {
      refused.push('startAt')
      return query
    },
    endAt: () => {
      refused.push('endAt')
      return query
    },
  }
  return { query, wheres, refused }
}

const run = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search = '',
) => {
  const log = recorder()
  const result = suppressionQuery(log.query, clauses, search)
  return { result, ...log }
}

describe('suppressionQuery', () => {
  it('adds nothing for no clauses and no search', () => {
    const { result, wheres } = run([])
    expect(result.error).toBeNull()
    expect(wheres).toEqual([])
  })

  it('serves Status, Reason, the search and a date range together, in index order', () => {
    const { result, wheres, refused } = run(
      [
        { field: 'suppressedAt', op: 'onOrAfter', value: '2026-09-01T00:00:00.000Z' },
        { field: 'reason', op: 'isAnyOf', value: 'bounce,complaint' },
        { field: 'status', op: 'equals', value: 'false' },
      ],
      '  Jane.Doe@Example ',
    )
    expect(result.error).toBeNull()
    expect(wheres.map(([path, op]) => `${path} ${op}`)).toEqual([
      'released ==',
      'reason in',
      'emailTokens array-contains',
      'suppressedAt >=',
    ])
    expect(wheres[0][2]).toBe(false)
    expect(wheres[1][2]).toEqual(['bounce', 'complaint'])
    // Lower-cased, first word, capped at the stored token length.
    expect(wheres[2][2]).toBe('jane.doe@exa')
    // The list owns its order and its cursor; nothing here may touch either.
    expect(refused).toEqual([])
  })

  it('serves Learned from and Site ID by equality', () => {
    expect(run([{ field: 'context', op: 'equals', value: 'invite' }]).wheres).toEqual([
      ['context', '==', 'invite'],
    ])
    expect(run([{ field: 'hostId', op: 'equals', value: 'h1' }]).wheres).toEqual([
      ['hostId', '==', 'h1'],
    ])
  })

  it('treats a search that normalizes to nothing as no search', () => {
    const { result, wheres } = run([], '   ')
    expect(result.error).toBeNull()
    expect(wheres).toEqual([])
  })

  it.each([
    ['an undeclared field', [{ field: 'email', op: 'contains', value: 'x' }]],
    ['an operator the field does not offer', [{ field: 'suppressedAt', op: 'is', value: '2026-09-01' }]],
    ['two one-at-a-time fields', [
      { field: 'reason', op: 'equals', value: 'bounce' },
      { field: 'hostId', op: 'equals', value: 'h1' },
    ]],
    ['two clauses on one field', [
      { field: 'status', op: 'equals', value: 'true' },
      { field: 'status', op: 'equals', value: 'false' },
    ]],
    ['a value the translator cannot use', [{ field: 'status', op: 'equals', value: 'maybe' }]],
    ['an empty value', [{ field: 'context', op: 'equals', value: '' }]],
  ])('refuses %s rather than listing a superset', (_label, clauses) => {
    const { result } = run(clauses)
    expect(result.error).toEqual(expect.any(String))
  })
})

describe('readSuppressionFilters', () => {
  it('reads a JSON array of clauses', () => {
    expect(
      readSuppressionFilters({
        filters: JSON.stringify([{ field: 'reason', op: 'equals', value: 'bounce' }]),
      }),
    ).toEqual([{ field: 'reason', op: 'equals', value: 'bounce' }])
  })

  it('reads no parameter as no clauses', () => {
    expect(readSuppressionFilters({})).toEqual([])
  })

  it.each([['not json'], ['{"field":"reason"}'], ['[1]'], [JSON.stringify(new Array(9).fill({ field: 'a', op: 'b' }))]])(
    'refuses %s',
    (raw) => {
      expect(readSuppressionFilters({ filters: raw })).toBeNull()
    },
  )

  it('refuses a repeated parameter', () => {
    expect(readSuppressionFilters({ filters: ['[]', '[]'] })).toBeNull()
  })
})

describe('every query the list can issue has its composite index', () => {
  const indexes = (
    JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
        'utf8',
      ),
    ).indexes as Array<{
      collectionGroup: string
      queryScope: string
      fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>
    }>
  )
    .filter(
      (index) =>
        index.collectionGroup === 'emailSuppressions' && index.queryScope === 'COLLECTION',
    )
    .map((index) =>
      index.fields
        .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`)
        .join(','),
    )

  /** A sample value each field's operator accepts. */
  const sample = (field: string, op: string): string => {
    if (field === 'suppressedAt') return '2026-09-01T00:00:00.000Z'
    const options = SUPPRESSION_FILTER_OPTIONS[field]
    if (options) return op === 'isAnyOf' ? options.map((o) => o.value).join(',') : options[0].value
    return 'value'
  }
  const clausesFor = (field: string) => {
    const declared = SUPPRESSION_FILTER_FIELDS.find((entry) => entry.column === field)
    return listFilterOperators(declared!).map((op) => ({ field, op, value: sample(field, op) }))
  }

  /*
   * Every ask the card can make: at most one of the one-at-a-time fields,
   * with or without each field that stands alongside, with or without the
   * search — every operator of each.
   */
  const asks: Array<{ clauses: Array<{ field: string; op: string; value: string }>; search: string }> = []
  const optional = (field: string) => [null, ...clausesFor(field)]
  for (const single of [null, ...SUPPRESSION_SINGLE_FIELDS.flatMap(clausesFor)]) {
    for (const status of optional(SUPPRESSION_ALONGSIDE_FIELDS[0])) {
      for (const range of optional(SUPPRESSION_ALONGSIDE_FIELDS[1])) {
        for (const search of ['', 'jane']) {
          asks.push({
            clauses: [single, status, range].filter(
              (clause): clause is { field: string; op: string; value: string } => clause !== null,
            ),
            search,
          })
        }
      }
    }
  }

  it.each(asks.map((ask) => [JSON.stringify(ask), ask]))('%s', (_name, ask) => {
    const { result, wheres } = run(ask.clauses, ask.search)
    expect(result.error).toBeNull()
    const equalities = wheres.filter(([, op]) => op === '==' || op === 'in')
    const contains = wheres.filter(([, op]) => op === 'array-contains')
    // Only the sort field may carry a range: anything else would lead the sort.
    for (const [path, op] of wheres) {
      if (!['==', 'in', 'array-contains'].includes(op)) expect(path).toBe('suppressedAt')
    }
    const shape = [
      ...equalities.map(([path]) => `${path}:ASCENDING`),
      ...contains.map(([path]) => `${path}:CONTAINS`),
      'suppressedAt:DESCENDING',
    ].join(',')
    // A range over the sort field alone is served by its single-field index.
    if (!equalities.length && !contains.length) return
    expect(indexes).toContain(shape)
  })

  it('the enumeration reaches every declared field', () => {
    const asked = new Set(asks.flatMap((ask) => ask.clauses.map((clause) => clause.field)))
    expect([...asked].sort()).toEqual(
      SUPPRESSION_FILTER_FIELDS.map((field) => field.column).sort(),
    )
  })
})
