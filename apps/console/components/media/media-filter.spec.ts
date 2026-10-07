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

import { mediaFilterKeys } from '@aglyn/aglyn/app-utils/media-metadata'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  mediaFilterFields,
  mediaFolderDescendants,
  mediaQuery,
  type MediaQueryInput,
  mediaSortOf,
} from '@aglyn/aglyn/app-utils/media-filter'

/*
 * The media library's query (AGL-3327): every filter and the search on it,
 * through the console's list query plan, with nothing matched over the pages
 * already read.
 */

const query = (input: Partial<MediaQueryInput>) =>
  mediaQuery({
    clauses: [],
    sort: 'newest',
    folder: 'all',
    scopeTokens: null,
    search: [],
    ...input,
  })

const clause = (field: string, op: string, value = ''): ListFilterRequest => ({
  field,
  op,
  value,
})

/** The query's predicates as `path op value`, for readable assertions. */
const filters = (input: Partial<MediaQueryInput>) =>
  query(input).plan.filters.map(
    (filter) =>
      `${filter.path} ${filter.op} ${
        filter.value instanceof Date ? 'date' : JSON.stringify(filter.value)
      }`,
  )

const order = (input: Partial<MediaQueryInput>) => {
  const { orderBy } = query(input).plan
  return `${orderBy.path} ${orderBy.direction}`
}

const refused = (input: Partial<MediaQueryInput>) =>
  query(input).plan.refused.map((entry) =>
    entry.clause === 'search' ? 'search' : entry.clause.field,
  )

describe('the query every view reads (AGL-3327)', () => {
  it('reads every file newest first, with nothing to filter', () => {
    expect(filters({})).toEqual([])
    expect(order({})).toBe('createdAt desc')
  })

  it('puts the folder, a file in no folder, and subfolders on the query', () => {
    expect(filters({ folder: ['f1'] })).toEqual(['folderId == "f1"'])
    expect(filters({ folder: 'root' })).toEqual(['folderId == null'])
    expect(filters({ folder: ['f1', 'f2'] })).toEqual(['folderId in ["f1","f2"]'])
  })

  it('gives up subfolders, and says so, past thirty disjunctions beside the scope', () => {
    const many = Array.from({ length: 16 }, (_value, index) => `f${index}`)
    const scoped = query({ folder: many, scopeTokens: ['org', 'host:h1'] })
    expect(scoped.subfoldersDropped).toBe(true)
    expect(scoped.plan.filters[0]).toEqual({ path: 'folderId', op: '==', value: 'f0' })
    expect(query({ folder: many }).subfoldersDropped).toBe(false)
  })

  it('serves every equality together: Type, Uploaded by and Alt text', () => {
    expect(
      filters({
        folder: ['f1'],
        clauses: [
          clause('type', 'equals', 'image'),
          clause('uploadedBy', 'isAnyOf', 'u1,u2'),
          clause('alt', 'equals', 'false'),
        ],
      }),
    ).toEqual([
      'folderId == "f1"',
      'kind == "image"',
      'uploadedBy in ["u1","u2"]',
      'hasAlt == false',
    ])
  })

  it('matches a tag whole, and any of several', () => {
    expect(filters({ clauses: [clause('tags', 'contains', 'black friday')] })).toEqual([
      'tags array-contains "black friday"',
    ])
    expect(filters({ clauses: [clause('tags', 'isAnyOf', 'hero,brand')] })).toEqual([
      'tags array-contains-any ["hero","brand"]',
    ])
  })

  it('searches a word of the file name, split at its separators', () => {
    expect(filters({ search: ['Hero-Banner'] })).toEqual(['nameTokens array-contains "hero"'])
    // The token a query asks for is one the writers store.
    expect(mediaFilterKeys({ fileName: 'hero-banner.png' }).nameTokens).toContain('hero')
  })

  it('says a second search word is not searched', () => {
    const { plan } = query({ search: ['hero', 'banner'] })
    expect(plan.searched).toBe('hero')
    expect(plan.notices.join(' ')).toMatch(/one word at a time/)
  })

  it('refuses a Tags filter beside a search rather than matching one over the other', () => {
    const input = { search: ['hero'], clauses: [clause('tags', 'contains', 'brand')] }
    expect(refused(input)).toEqual(['tags'])
    expect(filters(input)).toEqual(['nameTokens array-contains "hero"'])
  })

  it('serves a scoped reader’s search as a name range beside the scope clause', () => {
    // The scope clause is the query's one array filter and the rules prove a
    // scoped list from it, so the search cannot be a token lookup: it is the
    // files whose name starts with what was typed, and the library says so.
    const scoped = { scopeTokens: ['org', 'host:h1'] }
    const input = { ...scoped, search: ['Hero-Ban'] }
    expect(filters(input)).toEqual([
      'visibleTo array-contains-any ["org","host:h1"]',
      'nameLower >= "hero-ban"',
      'nameLower <= "hero-ban\uf8ff"',
    ])
    expect(order(input)).toBe('nameLower asc')
    expect(refused(input)).toEqual([])
    expect(query(input).plan.notices.join(' ')).toMatch(/starts with what you type/)
    // Never a second array clause, and never the folded scoped tokens the
    // rules cannot prove.
    const arrays = query(input).plan.filters.filter((filter) =>
      filter.op.startsWith('array-contains'),
    )
    expect(arrays.map((filter) => filter.path)).toEqual(['visibleTo'])
  })

  it('gives a date range way to a scoped reader’s search, by name', () => {
    const input = {
      scopeTokens: ['org', 'host:h1'],
      search: ['hero'],
      clauses: [clause('uploaded', 'onOrAfter', '2026-09-01')],
    }
    expect(refused(input)).toEqual(['uploaded'])
  })

  it('refuses Tags for a reader limited to some sites, and does not offer it', () => {
    const scoped = { scopeTokens: ['org', 'host:h1'] }
    expect(refused({ ...scoped, clauses: [clause('tags', 'contains', 'hero')] })).toEqual([
      'tags',
    ])
    expect(mediaFilterFields({ typeLocked: false, scoped: true }).map((f) => f.column)).not.toContain(
      'tags',
    )
  })

  it('serves Orientation as an equality beside the others', () => {
    expect(
      filters({
        clauses: [clause('type', 'equals', 'image'), clause('orientation', 'isAnyOf', 'portrait,square')],
      }),
    ).toEqual(['kind == "image"', 'orientation in ["portrait","square"]'])
  })

  it('serves Name starts with as a range, which orders by name', () => {
    const input = { clauses: [clause('fileName', 'startsWith', 'Hero')] }
    expect(filters(input)).toEqual(['nameLower >= "hero"', 'nameLower <= "hero\uf8ff"'])
    expect(order(input)).toBe('nameLower asc')
    expect(mediaSortOf(query(input).plan.orderBy)).toBe('name')
  })

  it('orders by a range filter’s own field', () => {
    const input = { sort: 'name' as const, clauses: [clause('uploaded', 'onOrAfter', '2026-09-01')] }
    expect(filters(input)).toEqual(['createdAt >= date'])
    expect(order(input)).toBe('createdAt desc')
    expect(mediaSortOf(query(input).plan.orderBy)).toBe('newest')
  })

  it('keeps Oldest under an Uploaded filter', () => {
    expect(
      order({ sort: 'oldest', clauses: [clause('uploaded', 'before', '2026-09-01')] }),
    ).toBe('createdAt asc')
  })

  it('asks a size in megabytes as bytes, largest first', () => {
    const input = { clauses: [clause('sizeMb', '>', '5')] }
    expect(filters(input)).toEqual([`sizeBytes > ${5 * 1024 * 1024}`])
    expect(order(input)).toBe('sizeBytes desc')
  })

  it('refuses a second range instead of ranging over two fields', () => {
    expect(
      refused({
        clauses: [clause('uploaded', 'onOrAfter', '2026-09-01'), clause('sizeMb', '>', '5')],
      }),
    ).toEqual(['sizeMb'])
  })

  it('reads a picker’s fixed kind like any Type clause', () => {
    expect(filters({ clauses: [clause('type', 'equals', 'video')] })).toEqual([
      'kind == "video"',
    ])
    expect(
      mediaFilterFields({ typeLocked: true, scoped: false }).map((field) => field.column),
    ).not.toContain('type')
  })
})

describe('including subfolders', () => {
  it('walks every folder under the open one, and survives a cycle', () => {
    const folders = [
      { $id: 'a', parentId: null },
      { $id: 'b', parentId: 'a' },
      { $id: 'c', parentId: 'b' },
      { $id: 'd', parentId: null },
      { $id: 'x', parentId: 'y' },
      { $id: 'y', parentId: 'x' },
    ]
    expect(mediaFolderDescendants('a', folders)).toEqual(['a', 'b', 'c'])
    expect(mediaFolderDescendants('x', folders)).toEqual(['x', 'y'])
  })
})
