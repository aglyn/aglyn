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

import { mediaSearchToken } from './media-metadata'
import { nameSearchNormalizers } from './name-search'
import type {
  ListFilterField,
  ListFilterRequest,
} from '@aglyn/shared-util-tools/list-query/list-filter'
import type { ListFilterOption } from '@aglyn/shared-util-tools/list-query/list-filter-codecs'
import {
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryNormalizers,
  type ListQueryPlan,
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'

/*
 * What the media library filters and searches by, declared for the
 * console's list query plan (AGL-3327).
 *
 * The library composes every clause and the search word onto ONE Firestore
 * query through `planListQuery` (AGL-3321) — nothing is matched over the
 * pages already read. What one query cannot hold (a second array clause, a
 * second range, more than thirty disjunctions) the plan refuses by name and
 * the library says so; the rest still stands.
 *
 * Every field is stored on the media document by every writer
 * (`mediaFilterKeys` in `@aglyn/aglyn/app-utils/media-metadata`) and by the
 * backfill for the documents written before (`backfill-media-filter-keys`):
 *
 *   type         `kind`, the family (image, video, pdf, document)
 *   tags         `tags`, lower-cased by every writer, matched whole
 *   uploaded     `createdAt`
 *   size         `sizeBytes`, asked in megabytes
 *   uploadedBy   `uploadedBy`, a uid, or `api:<key id>` from the REST API
 *   alt          `hasAlt`, so "missing" is a value a query can find
 *   orientation  `orientation`, from the stored pixel size
 *   name         `nameLower`, for the Name sort and "starts with"
 *   search       `nameTokens`, the word prefixes of the file name
 *
 * Not offered, because no query serves them: custom metadata (its keys are
 * the reader's own, and each would need composites of its own), the width
 * and the height as ranges (each a range field that would have to lead the
 * order, with composites for every other field — Orientation answers the
 * question people ask of them), and "contains" on the alt text itself.
 *
 * Firestore merges one `[field, sort]` composite per field for any
 * combination of equalities; `media-scope-indexes.spec.ts` holds the index
 * file to `listQueryIndexes` of this declaration.
 */

/** The family a file belongs to, as the Type filter offers it. */
export const MEDIA_TYPE_OPTIONS: readonly ListFilterOption[] = [
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'pdf', label: 'PDF' },
  { value: 'document', label: 'Other documents' },
]

/** Orientation, as the stored `orientation` names it. */
export const MEDIA_ORIENTATION_OPTIONS: readonly ListFilterOption[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' },
]

/** Alt text, as the two answers a query can give about it. */
export const MEDIA_ALT_OPTIONS: readonly ListFilterOption[] = [
  { value: 'false', label: 'Missing' },
  { value: 'true', label: 'Set' },
]

const MB = 1024 * 1024

/**
 * The fields the Filters panel offers, each as the query serves it.
 *
 * Tags is an array matched whole: `exact` with its `tokensPath`, so `contains`
 * is `array-contains` and `isAnyOf` is `array-contains-any` — the panel shows
 * `contains` as the select's "is" (`MEDIA_TAGS_CODEC`). Size is asked in
 * megabytes and served in bytes (`mediaQueryRequest`).
 */
export const MEDIA_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'type', kind: 'exact', path: 'kind', operators: ['equals', 'isAnyOf'] },
  {
    column: 'tags',
    kind: 'exact',
    path: 'tags',
    tokensPath: 'tags',
    operators: ['contains', 'isAnyOf'],
  },
  { column: 'uploaded', kind: 'date', path: 'createdAt', presence: 'always' },
  { column: 'sizeMb', kind: 'number', path: 'sizeBytes', operators: ['>', '>=', '<', '<='] },
  { column: 'uploadedBy', kind: 'exact', path: 'uploadedBy', operators: ['equals', 'isAnyOf'] },
  { column: 'alt', kind: 'boolean', path: 'hasAlt', operators: ['equals'] },
  {
    column: 'orientation',
    kind: 'exact',
    path: 'orientation',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'fileName',
    kind: 'text',
    path: 'fileName',
    lowerPath: 'nameLower',
    operators: ['startsWith'],
  },
]

export const MEDIA_FILTER_HEADERS: Readonly<Record<string, string>> = {
  type: 'Type',
  tags: 'Tags',
  uploaded: 'Uploaded',
  sizeMb: 'Size (MB)',
  uploadedBy: 'Uploaded by',
  alt: 'Alt text',
  orientation: 'Orientation',
  fileName: 'Name',
}

/** The fields one library offers. */
export function mediaFilterFields(options: {
  /** A picker's fixed kind (AGL-2953): Type is not the reader's to change. */
  typeLocked: boolean
  /**
   * The query carries the scope clause (AGL-1042), which is its one array
   * clause, so Tags could never be applied and is not offered.
   */
  scoped: boolean
}): ListFilterField[] {
  return MEDIA_FILTER_FIELDS.filter(
    (field) =>
      !(options.typeLocked && field.column === 'type') &&
      !(options.scoped && field.column === 'tags'),
  )
}

// ---------------------------------------------------------------------------
// The sorts
// ---------------------------------------------------------------------------

export type MediaSort = 'newest' | 'oldest' | 'name' | 'size'

export const MEDIA_SORTS: readonly MediaSort[] = ['newest', 'oldest', 'name', 'size']

/** What each sort orders by, and the List view column that sorts it. */
export const MEDIA_SORT_ORDER: Readonly<Record<MediaSort, ListQuerySort>> = {
  newest: { path: 'createdAt', direction: 'desc', column: 'uploaded' },
  oldest: { path: 'createdAt', direction: 'asc', column: 'uploaded' },
  // `nameLower`, so the order ignores case, and a "starts with" range — the
  // name's own range — orders the list the way this sort already does.
  name: { path: 'nameLower', direction: 'asc', column: 'fileName' },
  size: { path: 'sizeBytes', direction: 'desc', column: 'size' },
}

export const MEDIA_SORT_LABELS: Readonly<Record<MediaSort, string>> = {
  newest: 'Newest',
  oldest: 'Oldest',
  name: 'Name',
  size: 'Largest',
}

/** The library's sort for a query order, or null for one it does not offer. */
export function mediaSortOf(order: ListQuerySort): MediaSort | null {
  const found = MEDIA_SORTS.find(
    (sort) =>
      MEDIA_SORT_ORDER[sort].path === order.path &&
      MEDIA_SORT_ORDER[sort].direction === order.direction,
  )
  return found ?? null
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * The library as the list query plan reads it. Newest first is the default,
 * and every sort is one the index file holds for every field.
 */
export const MEDIA_LIST_QUERY: ListQueryDeclaration = {
  fields: MEDIA_FILTER_FIELDS,
  sorts: MEDIA_SORTS.map((sort) => MEDIA_SORT_ORDER[sort]),
  search: { tokensPath: 'nameTokens' },
}

/**
 * The normalizers the media writers stamped the name fields with: the
 * platform's name search, except that a file name's words are split at every
 * separator (`mediaSearchToken`), so `hero-banner.png` is found by "banner".
 */
export const MEDIA_NAME_NORMALIZERS: ListQueryNormalizers = {
  ...nameSearchNormalizers,
  token: (value) => mediaSearchToken(value),
}

/** The predicates every query of one library view carries, before any clause. */
export function mediaBaseFilters(input: {
  /** Every file, the files in no folder, or the files in these folders. */
  folder: 'all' | 'root' | readonly string[]
  /** The scope clause a scoped reader's query must carry (AGL-1042), or null. */
  scopeTokens: readonly string[] | null
}): ListQueryFilter[] {
  const { folder, scopeTokens } = input
  return [
    ...(folder === 'root'
      ? [{ path: 'folderId', op: '==' as const, value: null }]
      : folder === 'all'
        ? []
        : folder.length === 1
          ? [{ path: 'folderId', op: '==' as const, value: folder[0] }]
          : [{ path: 'folderId', op: 'in' as const, value: [...folder] }]),
    ...(scopeTokens
      ? [{ path: 'visibleTo', op: 'array-contains-any' as const, value: [...scopeTokens] }]
      : []),
  ]
}

/** The scope predicates, as `listQueryIndexes` enumerates them. */
export const MEDIA_BASE_INDEX_FIELDS = [
  { path: 'folderId' },
  { path: 'visibleTo', array: true },
] as const

/** Firestore's cap on disjunctions: the product of every `in` and `-any`. */
export const MEDIA_DISJUNCTION_LIMIT = 30

/** A clause as the query asks it: a size in bytes, the rest as written. */
export function mediaQueryRequest(clause: ListFilterRequest): ListFilterRequest {
  if (clause.field !== 'sizeMb') return clause
  const megabytes = Number(clause.value)
  return Number.isFinite(megabytes) && String(clause.value).trim() !== ''
    ? { ...clause, value: String(Math.round(megabytes * MB)) }
    : clause
}

export interface MediaQueryInput {
  /** Every clause in force, a picker's fixed kind included. */
  clauses: readonly ListFilterRequest[]
  sort: MediaSort
  folder: 'all' | 'root' | readonly string[]
  scopeTokens: readonly string[] | null
  /** The quick search's words. */
  search: readonly string[]
}

export interface MediaQuery {
  plan: ListQueryPlan
  /**
   * Whether Include subfolders had to give way to the open folder alone:
   * its subfolders times the scope's tokens pass Firestore's thirty
   * disjunctions.
   */
  subfoldersDropped: boolean
}

/** Said when a scoped reader's search is served as a name range. */
export const MEDIA_SCOPED_SEARCH_NOTICE =
  'In a library limited to some sites, search finds files whose name ' +
  'starts with what you type.'

/**
 * A scoped reader's search, as the clause their query can serve (AGL-3327).
 *
 * The quick search is `array-contains` on `nameTokens`, and the scope clause
 * a scoped reader's query must carry (`visibleTo array-contains-any`,
 * AGL-1042) is the query's one array filter, so the two cannot share one
 * query. Folding the word into the scope clause (`search.scoped` in the list
 * query plan) cannot be used here either: the security rules prove a scoped
 * reader's list from its `visibleTo` clause, and a query that asks only for
 * `<scope>~<word>` tokens proves nothing about `visibleTo`, so Firestore
 * refuses it outright (probed against the emulator, AGL-3327). What the rules
 * and one query can both hold is a range on `nameLower` beside the scope
 * clause: the files whose name starts with what was typed, claimed first so
 * a date or size range gives way to it rather than the other way round.
 */
export function mediaScopedSearchClause(
  search: readonly string[],
): ListFilterRequest | null {
  const typed = search.map((word) => word.trim()).filter(Boolean).join(' ')
  return typed ? { field: 'fileName', op: 'startsWith', value: typed } : null
}

/**
 * The one query a view of the library reads (AGL-3327).
 *
 * The folder and the scope clause are the base every query carries. A range
 * filter orders the query by its own field; where the reader's sort is on
 * that field already (Oldest under an Uploaded filter), its direction stands.
 * Under the scope clause the search is a name range
 * (`mediaScopedSearchClause`), and the library says so.
 */
export function mediaQuery(input: MediaQueryInput): MediaQuery {
  const { sort, scopeTokens } = input
  const scopedSearch = scopeTokens ? mediaScopedSearchClause(input.search) : null
  const clauses = scopedSearch ? [scopedSearch, ...input.clauses] : input.clauses
  const search = scopedSearch ? [] : input.search
  const tokens = scopeTokens?.length ?? 1
  const subfoldersDropped =
    Array.isArray(input.folder) &&
    input.folder.length > 1 &&
    input.folder.length * tokens > MEDIA_DISJUNCTION_LIMIT
  const folder =
    subfoldersDropped && Array.isArray(input.folder) ? [input.folder[0]] : input.folder
  const asked = MEDIA_SORT_ORDER[sort]
  const plan = planListQuery(
    MEDIA_LIST_QUERY,
    {
      base: mediaBaseFilters({ folder, scopeTokens }),
      clauses: clauses.map(mediaQueryRequest),
      search,
      sort: asked,
    },
    MEDIA_NAME_NORMALIZERS,
  )
  const orderBy =
    plan.orderBy.path === asked.path && plan.orderBy.direction !== asked.direction
      ? asked
      : plan.orderBy
  const notices = scopedSearch ? [MEDIA_SCOPED_SEARCH_NOTICE, ...plan.notices] : plan.notices
  return { plan: { ...plan, orderBy, notices }, subfoldersDropped }
}

/**
 * Every folder at or under `folderId`, the folder itself first. Walks the
 * parent links downward and never revisits one, so a cycle a stale write
 * left behind cannot loop.
 */
export function mediaFolderDescendants(
  folderId: string,
  folders: ReadonlyArray<{ $id: string; parentId?: string | null }>,
): string[] {
  const children = new Map<string, string[]>()
  for (const folder of folders) {
    const parent = folder.parentId ?? null
    if (!parent) continue
    children.set(parent, [...(children.get(parent) ?? []), folder.$id])
  }
  const ids: string[] = []
  const queue = [folderId]
  const seen = new Set<string>()
  while (queue.length) {
    const next = queue.shift() as string
    if (seen.has(next)) continue
    seen.add(next)
    ids.push(next)
    queue.push(...(children.get(next) ?? []))
  }
  return ids
}
