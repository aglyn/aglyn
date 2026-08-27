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
 * ONE translation from a grid filter to a Firestore query (AGL-693).
 *
 * Every paged list in the console now shares it, so a mistake here is a
 * mistake on all of them at once — and the failure mode is the quiet kind: a
 * predicate that returns nothing reads as "no such record" rather than as
 * "this console cannot ask that".
 *
 * The two rules that are easy to get wrong, and that these cases pin:
 *
 *   1. An operator the translator cannot serve returns NULL, and the caller
 *      lists everything. Returning an empty query instead would answer a
 *      question the console cannot ask, with the one answer it must never get
 *      wrong.
 *   2. A list that owns its ordering keeps it. The activity feeds are
 *      `createdAt DESC` with a cursor into that ordering; re-sorting to suit
 *      a predicate would not narrow them, it would shuffle them and
 *      invalidate every cursor already issued.
 */

const mockDocumentId = { __name__: true }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: {
      FieldPath: { documentId: () => mockDocumentId },
      Timestamp: { fromDate: (date: Date) => ({ __ts: date.toISOString() }) },
    },
  },
}))

import { applyListFilter } from '../utils/server/list-filter'
import {
  listFilterOperators,
  type ListFilterField,
} from '@aglyn/shared-ui-jsx/const/list-filter'

/** Records what the builder was asked for, in order. */
interface Recorded {
  wheres: Array<[unknown, string, unknown]>
  ordering: unknown[]
  startAt: unknown
  endAt: unknown
}

const query = (log: Recorded): any => ({
  where: (path: unknown, op: string, value: unknown) => {
    log.wheres.push([path, op, value])
    return query(log)
  },
  orderBy: (path: unknown) => {
    log.ordering.push(path)
    return query(log)
  },
  startAt: (value: unknown) => {
    log.startAt = value
    return query(log)
  },
  endAt: (value: unknown) => {
    log.endAt = value
    return query(log)
  },
})

const run = (
  fields: readonly ListFilterField[],
  input: { field: string; op: string; value?: string },
  options: Parameters<typeof applyListFilter>[3] = {},
) => {
  const log: Recorded = {
    wheres: [],
    ordering: [],
    startAt: undefined,
    endAt: undefined,
  }
  const result = applyListFilter(
    query(log),
    fields,
    { field: input.field, op: input.op, value: input.value ?? '' },
    options,
  )
  return { result, log }
}

const NAME: ListFilterField = {
  column: 'name',
  kind: 'text',
  path: 'name',
  lowerPath: 'nameLower',
  tokensPath: 'nameTokens',
  reversedPath: 'nameReversed',
  presence: 'always',
}
const PLAN: ListFilterField = { column: 'plan', kind: 'exact', path: 'plan' }
const NULLABLE: ListFilterField = {
  column: 'tier',
  kind: 'exact',
  path: 'tier',
  presence: 'nullable',
}
const CREATED: ListFilterField = {
  column: 'createdAt',
  kind: 'date',
  path: 'createdAt',
  presence: 'always',
}
const SEATS: ListFilterField = { column: 'seats', kind: 'number', path: 'seats' }
const FIELDS = [NAME, PLAN, NULLABLE, CREATED, SEATS]

describe('THE CONTROL: a filter this console CAN serve builds a query', () => {
  it('equality on the normalized key, ordered by document id', () => {
    // Without this the "returns null" cases below cannot be told from a
    // translator that returns null for everything.
    const { result, log } = run(FIELDS, {
      field: 'name',
      op: 'equals',
      value: '  Acme Coffee ',
    })
    expect(result).not.toBeNull()
    expect(log.wheres).toEqual([['nameLower', '==', 'acme coffee']])
    expect(log.ordering).toEqual([mockDocumentId])
  })
})

describe('a prefix range spans the prefix, not just the prefix', () => {
  it('startsWith ends at the prefix plus the high sentinel', () => {
    /*
     * `\uf8ff` is a very high private-use codepoint, so the range covers
     * every string starting with the prefix. Without it the range collapses
     * to [prefix, prefix] — an exact match wearing the shape of a prefix
     * search, which is the quiet way "starts with" stops working.
     */
    const { log } = run(FIELDS, {
      field: 'name',
      op: 'startsWith',
      value: 'Acme',
    })
    expect(log.startAt).toBe('acme')
    expect(log.endAt).toBe('acme\uf8ff')
    expect(log.endAt).not.toBe('acme')
  })

  it('endsWith is the same range read backwards', () => {
    // A Firestore range is anchored at the FRONT of a value, so the only way
    // to ask about the end is against a reversed copy of the key.
    const { log } = run(FIELDS, {
      field: 'name',
      op: 'endsWith',
      value: 'Coffee',
    })
    expect(log.ordering).toEqual(['nameReversed'])
    expect(log.startAt).toBe('eeffoc')
    expect(log.endAt).toBe('eeffoc\uf8ff')
  })
})

describe('an operator that cannot be served lists everything', () => {
  const unfiltered = (input: { field: string; op: string; value?: string }) =>
    expect(run(FIELDS, input).result).toBeNull()

  it('doesNotContain, which no index can answer', () => {
    // Firestore has no negated substring match, and no denormalization fixes
    // it: the inverse of a token array is unbounded.
    unfiltered({ field: 'name', op: 'doesNotContain', value: 'acme' })
  })

  it('isEmpty on a field writers OMIT', () => {
    // `== null` matches an explicit null and never a missing field, so this
    // would report "none" for a question with real answers.
    unfiltered({ field: 'plan', op: 'isEmpty' })
  })

  it('isEmpty and isNotEmpty on a field that is ALWAYS written', () => {
    // Each has a foregone answer — every row, then none.
    unfiltered({ field: 'name', op: 'isEmpty' })
    unfiltered({ field: 'name', op: 'isNotEmpty' })
  })

  it('a field that was never declared', () => {
    unfiltered({ field: 'nonesuch', op: 'equals', value: 'x' })
  })

  it('a blank value, which is not a filter', () => {
    unfiltered({ field: 'name', op: 'equals', value: '   ' })
  })

  it('a number that is not a number', () => {
    unfiltered({ field: 'seats', op: '>', value: 'lots' })
  })
})

describe('isEmpty is served where writers store null', () => {
  it('a nullable field answers both empty operators', () => {
    expect(listFilterOperators(NULLABLE)).toEqual(
      expect.arrayContaining(['isEmpty', 'isNotEmpty']),
    )
    const { result, log } = run(FIELDS, { field: 'tier', op: 'isEmpty' })
    expect(result).not.toBeNull()
    expect(log.wheres).toEqual([['tier', '==', null]])
  })

  it('a sparse field answers isNotEmpty exactly, and never isEmpty', () => {
    // `!=` in Firestore also requires the field to EXIST, which is the
    // meaning wanted; absence is what it cannot ask about.
    expect(listFilterOperators(PLAN)).toContain('isNotEmpty')
    expect(listFilterOperators(PLAN)).not.toContain('isEmpty')
    const { log } = run(FIELDS, { field: 'plan', op: 'isNotEmpty' })
    expect(log.wheres).toEqual([['plan', '!=', null]])
  })
})

describe('a date filter is a DAY, not an instant', () => {
  it('`is` becomes a range across the day', () => {
    // A stored timestamp carries a time, so equality against midnight matches
    // nothing — a date column filtered by `is` would answer "none" for every
    // row, every time.
    const { log } = run(FIELDS, {
      field: 'createdAt',
      op: 'is',
      value: '2026-07-18',
    })
    expect(log.wheres).toEqual([])
    expect(new Date((log.endAt as any).__ts).getTime()).toBeGreaterThan(
      new Date((log.startAt as any).__ts).getTime(),
    )
  })

  it('`before` bounds below the start of the day', () => {
    const { log } = run(FIELDS, {
      field: 'createdAt',
      op: 'before',
      value: '2026-07-18',
    })
    expect(log.wheres.length).toBe(1)
    expect(log.wheres[0][0]).toBe('createdAt')
    expect(log.wheres[0][1]).toBe('<')
  })
})

/**
 * A feed that owns its ordering keeps it.
 *
 * The activity feeds are `orderBy('createdAt', 'desc')` and their cursor is a
 * DOCUMENT in that ordering. Firestore also requires the first `orderBy` to be
 * the range field — so with the order pinned, only equality and a range over
 * the sort field itself are possible. Anything else must decline rather than
 * reorder.
 */
describe('a pinned sort is not the filter’s to change', () => {
  const pinned = { fixedOrderBy: 'createdAt' }

  it('equality adds a predicate and NO ordering', () => {
    const { result, log } = run(
      FIELDS,
      { field: 'plan', op: 'equals', value: 'free' },
      pinned,
    )
    expect(result).not.toBeNull()
    expect(log.wheres).toEqual([['plan', '==', 'free']])
    // The caller applies its own `orderBy` after this returns; adding one here
    // would make it the FIRST, which is the one Firestore sorts by.
    expect(log.ordering).toEqual([])
  })

  it('`in` likewise', () => {
    const { log } = run(
      FIELDS,
      { field: 'plan', op: 'isAnyOf', value: 'free, starter' },
      pinned,
    )
    expect(log.wheres).toEqual([['plan', 'in', ['free', 'starter']]])
    expect(log.ordering).toEqual([])
  })

  it('a range over the SORT field is allowed, still without ordering', () => {
    const { result, log } = run(
      FIELDS,
      { field: 'createdAt', op: 'onOrAfter', value: '2026-07-18' },
      pinned,
    )
    expect(result).not.toBeNull()
    expect(log.wheres.length).toBe(1)
    expect(log.wheres[0][0]).toBe('createdAt')
    expect(log.ordering).toEqual([])
  })

  it('a range over ANY OTHER field is refused', () => {
    // Serving it would require `seats` to be the first `orderBy`, which would
    // unsort the feed and invalidate every cursor already handed out.
    expect(
      run(FIELDS, { field: 'seats', op: '>', value: '3' }, pinned).result,
    ).toBeNull()
  })

  it('a text prefix range is refused for the same reason', () => {
    expect(
      run(FIELDS, { field: 'name', op: 'startsWith', value: 'Acme' }, pinned)
        .result,
    ).toBeNull()
  })

  it('THE CONTRAST: unpinned, those same two DO build a query', () => {
    // Otherwise "refused when pinned" could just be "refused always".
    expect(run(FIELDS, { field: 'seats', op: '>', value: '3' }).result).not.toBeNull()
    expect(
      run(FIELDS, { field: 'name', op: 'startsWith', value: 'Acme' }).result,
    ).not.toBeNull()
  })
})

describe('Firestore’s own limits are respected', () => {
  it('`in` never carries more than thirty values', () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}`).join(',')
    const { log } = run(FIELDS, {
      field: 'plan',
      op: 'isAnyOf',
      value: many,
    })
    expect((log.wheres[0][2] as string[]).length).toBe(30)
  })
})
