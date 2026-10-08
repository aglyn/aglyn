/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ListFilterField } from '@aglyn/shared-util-tools/list-query/list-filter'
import type { ListQueryDeclaration } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { ENTRY_PUBLISH_SORT_FIELD } from './collection-entry-date'

/**
 * The array the quick search and the title filter read: the same key
 * `ENTRY_TITLE_TOKENS_FIELD` names in `content-query-fields.ts`, written by
 * `entryTitleSearchFields`. Named here rather than imported because that
 * module reaches the author model, which the native apps never read.
 */
const ENTRY_TITLE_TOKENS_FIELD = 'titleTokens'

/*
 * WHAT A COLLECTION'S ENTRY LIST ASKS FIRESTORE (AGL-3321), as one pure
 * module: the fields its Filters panel accepts, their headers, the orders a
 * filtered list may take, and the statuses. The console's Content page plans
 * its queries from here (`entry-list-query.ts`, `list-filters.ts`), and so do
 * the native apps, through the contracts codegen (AGL-3668).
 */

/*
 * Content entries (`hosts/{hostId}/collections/{collectionId}/entries`).
 *
 * EVERY clause below is on the Firestore query together (AGL-3321), composed
 * by `planListQuery` through `ENTRY_LIST_QUERY` in
 * this module, which also holds the orders a filtered list may take. Nothing is matched over the rows a page loaded.
 *
 * The equalities — status, category, author — and the title search each need
 * one composite per filtered order (index merging serves every combination of
 * them), which is what keeps this list's filtered orders to three. The two
 * dates are ranges over fields those orders already walk, so they cost no
 * index of their own; a range leads the order, and so reads with ONE ordered
 * query rather than the two-segment walk: every entry it matches carries the
 * field it ranges over.
 *
 * `status` matches the stored word. An entry with no `status` at all — only a
 * hand-written import bundle produces one — matches none of the three, and is
 * still on the unfiltered list.
 *
 * `categoryId` and `authorId` match the stable ids the entry editor writes.
 * An entry that still carries only the legacy free-typed `category` or
 * `authorName` matches no id until one is picked for it in the editor.
 *
 * `title` is WORD-level, over `titleTokens` (`entryTitleSearchFields`): the
 * quick search reads the same array, and a query holds one array clause, so
 * the two do not combine.
 *
 * `publishedAt` is the Published column, and ranges over the date that column
 * shows — `publishSortAt`, the scheduled date while an entry waits and the
 * published date after (AGL-3323). A draft has neither and matches no range.
 */
export const ENTRY_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'title',
    kind: 'text',
    path: 'title',
    tokensPath: 'titleTokens',
    operators: ['contains'],
  },
  {
    column: 'status',
    kind: 'exact',
    path: 'status',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'categoryId',
    kind: 'exact',
    path: 'categoryId',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'authorId',
    kind: 'exact',
    path: 'authorId',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'publishedAt',
    kind: 'date',
    path: 'publishSortAt',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
  {
    column: 'updatedAt',
    kind: 'date',
    path: 'updatedAt',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/** How each entry field reads — as a hidden column's header, and on a chip. */
export const ENTRY_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  title: 'Title',
  status: 'Status',
  categoryId: 'Category',
  authorId: 'Author',
  publishedAt: 'Published',
  updatedAt: 'Updated',
}

/**
 * Everything a FILTERED or searched entries list can ask of Firestore
 * (AGL-3321): the clauses (`ENTRY_LIST_FILTER_FIELDS`), the quick search's
 * token array, and the orders those predicates may be combined with.
 *
 * Three orders, each justified by the four composites it costs (one per
 * predicate field — status, category, author, title tokens):
 *
 *   Published, newest first   the list's default; mandatory.
 *   Published, oldest first   the same column reversed — the first posts in
 *                             a category, the earliest of an author's.
 *   Updated, newest first     what was just edited, which is the question an
 *                             editor brings to a filtered list.
 *
 * Title and Status, and Updated oldest first, would cost four more each and
 * are offered on the UNFILTERED list only, where they cost none.
 */
export const ENTRY_LIST_QUERY: ListQueryDeclaration = {
  fields: ENTRY_LIST_FILTER_FIELDS,
  sorts: [
    { path: ENTRY_PUBLISH_SORT_FIELD, direction: 'desc', column: 'publishedAt' },
    { path: ENTRY_PUBLISH_SORT_FIELD, direction: 'asc', column: 'publishedAt' },
    { path: 'updatedAt', direction: 'desc', column: 'updatedAt' },
  ],
  search: { tokensPath: ENTRY_TITLE_TOKENS_FIELD },
}

/** The stored statuses the Status filter offers, in the order it lists them. */
export const ENTRY_STATUS_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'scheduled', label: 'Scheduled' },
]
