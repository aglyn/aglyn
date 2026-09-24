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
 * The Published column sorts on the date it SHOWS (AGL-3206).
 *
 * The column is `field: 'publishedAt'`, but its cell falls back to `publishAt`
 * for a scheduled entry. With no `valueGetter` the grid sorted the raw field,
 * which a scheduled entry does not carry, and MUI DataGrid pins an empty value
 * to the bottom in BOTH sort directions. On the marketing blog that put three
 * posts due Sep 22/25/30 underneath posts published Jul 19 — on a column
 * header claiming to be descending.
 *
 * ## The assertion surface is the shared stamp, not a rendered row
 *
 * The defect was that the cell and the sort key held two copies of one rule
 * and disagreed. The repair was to give them one function, so that is what is
 * asserted here: `entryPublishStamp` decides what the column speaks for, and
 * the ordering property is checked through it rather than through a rendered
 * grid that could pass while sorting on something else entirely.
 *
 * ## The pre-fix behaviour is the control
 *
 * `sortsBy` is run twice on the same rows — once through the raw
 * `publishedAt` the column used to sort on, once through the shared stamp.
 * The raw pass must still produce the WRONG order. If someone makes the two
 * agree by weakening the helper, that control fails and says so, rather than
 * leaving a green suite over a column that is broken again.
 */

import { deleteField } from 'firebase/firestore'
import {
  entryPublishSortPatch,
  entryPublishStamp,
} from '../components/content/content-scope.context'
import {
  ENTRY_LIST_DEFAULT_SORT,
  entryListStoredSort,
} from '../components/content/entry-list-query'

/** A Firestore `Timestamp` as far as anything here is concerned. */
const stamp = (iso: string) => ({ toDate: () => new Date(iso) })

const PUBLISHED_AUG = {
  title: 'From a form to a dataset in five minutes',
  status: 'published',
  publishedAt: stamp('2026-08-08T12:00:00Z'),
}
const PUBLISHED_JUL = {
  title: 'Collect survey responses in 10 minutes',
  status: 'published',
  publishedAt: stamp('2026-07-19T12:00:00Z'),
}
const SCHEDULED_SEP_30 = {
  title: 'AI email campaigns without the spam',
  status: 'scheduled',
  publishAt: stamp('2026-09-30T12:00:00Z'),
}
const SCHEDULED_SEP_22 = {
  title: 'Agencies: 20 client sites from one brief',
  status: 'scheduled',
  publishAt: stamp('2026-09-22T12:00:00Z'),
}
const DRAFT = { title: 'What 10, 25, 50 or 100 client sites cost', status: 'draft' }
/* A schedule that was cancelled back to a draft and left its date behind. */
const DRAFT_WITH_STALE_PUBLISH_AT = {
  title: 'Cancelled schedule',
  status: 'draft',
  publishAt: stamp('2026-12-01T12:00:00Z'),
}

const ROWS = [
  PUBLISHED_AUG,
  SCHEDULED_SEP_30,
  PUBLISHED_JUL,
  SCHEDULED_SEP_22,
  DRAFT,
]

/**
 * Order `rows` the way the grid does: descending by `key`, with undated rows
 * pinned to the bottom in either direction, which is DataGrid's own handling
 * of an empty value and the behaviour the bug rode in on.
 */
function sortsBy(
  rows: ReadonlyArray<Record<string, any>>,
  key: (row: Record<string, any>) => Date | null,
): string[] {
  const dated = rows.filter((row) => key(row) !== null)
  const undated = rows.filter((row) => key(row) === null)
  return [
    ...dated.sort((a, b) => Number(key(b)) - Number(key(a))),
    ...undated,
  ].map((row) => row['title'] as string)
}

const sharedKey = (row: Record<string, any>) =>
  entryPublishStamp(row)?.toDate?.() ?? null
const rawPublishedAtKey = (row: Record<string, any>) =>
  row['publishedAt']?.toDate?.() ?? null

describe('the Published column speaks for one date', () => {
  it('reads publishedAt once an entry has gone out', () => {
    expect(entryPublishStamp(PUBLISHED_AUG)).toBe(PUBLISHED_AUG.publishedAt)
  })

  it('reads publishAt while a scheduled entry is still due', () => {
    expect(entryPublishStamp(SCHEDULED_SEP_30)).toBe(SCHEDULED_SEP_30.publishAt)
  })

  it('reads nothing for a draft', () => {
    expect(entryPublishStamp(DRAFT)).toBeUndefined()
  })

  it('reads nothing for a draft still holding a cancelled publishAt', () => {
    // The cell renders an em dash for this row; the sort key has to agree, or
    // an undated row sorts among the dated ones on a date it never shows.
    expect(entryPublishStamp(DRAFT_WITH_STALE_PUBLISH_AT)).toBeUndefined()
  })

  it('prefers publishedAt when an entry carries both', () => {
    const rescheduledThenPublished = {
      status: 'published',
      publishedAt: stamp('2026-08-08T12:00:00Z'),
      publishAt: stamp('2026-09-30T12:00:00Z'),
    }
    expect(entryPublishStamp(rescheduledThenPublished)).toBe(
      rescheduledThenPublished.publishedAt,
    )
  })
})

describe('descending by Published', () => {
  it('puts the furthest-future scheduled entry first', () => {
    expect(sortsBy(ROWS, sharedKey)).toEqual([
      'AI email campaigns without the spam', // Sep 30
      'Agencies: 20 client sites from one brief', // Sep 22
      'From a form to a dataset in five minutes', // Aug 8
      'Collect survey responses in 10 minutes', // Jul 19
      'What 10, 25, 50 or 100 client sites cost', // undated
    ])
  })

  it('leaves drafts at the bottom', () => {
    expect(sortsBy(ROWS, sharedKey).at(-1)).toBe(
      'What 10, 25, 50 or 100 client sites cost',
    )
  })

  /*
    The control. Sorting on the raw field is what the column did before
    AGL-3206, and it must still be demonstrably wrong — otherwise this suite
    would pass on a column that had quietly gone back to it.
  */
  it('is NOT what sorting on the raw publishedAt produces', () => {
    const raw = sortsBy(ROWS, rawPublishedAtKey)
    expect(raw.slice(0, 2)).toEqual([
      'From a form to a dataset in five minutes',
      'Collect survey responses in 10 minutes',
    ])
    expect(raw.indexOf('AI email campaigns without the spam')).toBeGreaterThan(
      raw.indexOf('Collect survey responses in 10 minutes'),
    )
    expect(raw).not.toEqual(sortsBy(ROWS, sharedKey))
  })
})

/*
  AGL-3323: the same rule, stored. The grid's comparator above only ever saw
  the rows of one page; the table sorts on the SERVER, which cannot fall back
  from one field to another, so every writer stores the stamp as
  `publishSortAt` and the walk orders on that. The ordering across pages is
  proved against a real Firestore in
  `content-entries-total-order.emulator.spec.ts`; this is the rule the writers
  and the query share.
*/
describe('the stored sort key (AGL-3323)', () => {
  it('is what the Published column walks, in both directions', () => {
    expect(entryListStoredSort(ENTRY_LIST_DEFAULT_SORT)).toEqual({
      field: 'publishSortAt',
      direction: 'desc',
    })
    expect(
      entryListStoredSort({ field: 'publishedAt', direction: 'asc' }),
    ).toEqual({ field: 'publishSortAt', direction: 'asc' })
  })

  it('leaves every other column on its own field', () => {
    for (const field of ['title', 'status', 'updatedAt']) {
      expect(entryListStoredSort({ field, direction: 'asc' })).toEqual({
        field,
        direction: 'asc',
      })
    }
  })

  it('stores the schedule while an entry waits', () => {
    expect(entryPublishSortPatch(SCHEDULED_SEP_30)).toEqual({
      publishSortAt: SCHEDULED_SEP_30.publishAt,
    })
  })

  it('stores the publish date once it has gone out', () => {
    expect(entryPublishSortPatch(PUBLISHED_AUG)).toEqual({
      publishSortAt: PUBLISHED_AUG.publishedAt,
    })
  })

  it('removes the key from a draft, so it lists after every dated entry', () => {
    expect(entryPublishSortPatch(DRAFT)).toEqual({
      publishSortAt: deleteField(),
    })
    expect(entryPublishSortPatch(DRAFT_WITH_STALE_PUBLISH_AT)).toEqual({
      publishSortAt: deleteField(),
    })
  })

  it('lists a rescheduled published entry under its new date', () => {
    // Scheduling a live entry takes it off the site until the date arrives,
    // and it keeps its old `publishedAt` only until the flip overwrites it.
    const rescheduled = {
      status: 'scheduled',
      publishedAt: stamp('2026-08-08T12:00:00Z'),
      publishAt: stamp('2026-10-01T12:00:00Z'),
    }
    expect(entryPublishStamp(rescheduled)).toBe(rescheduled.publishAt)
    expect(entryPublishSortPatch(rescheduled)).toEqual({
      publishSortAt: rescheduled.publishAt,
    })
  })
})
