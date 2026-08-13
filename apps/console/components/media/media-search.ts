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

import { Fuse } from '@aglyn/shared-util-vendor'

/**
 * DAM search (AGL-1460): the reading of the query, and the honest account of
 * what it was run over.
 *
 * ## Why this is client-side, deliberately, and why that is not a cop-out
 *
 * It already was — `buildConstraints` never saw the search text, so every
 * result the box gave was a filter over whichever pages happened to be
 * loaded. The wiring spec pins that down. The defect was never the filter; it
 * was that the SET was partial and the caption did not say by how much.
 *
 * Four of the six things the issue asks for cannot be query-side at any
 * price. Firestore has no `LIKE`, so `mock-*-noshadow.png` has no server
 * expression; it has no full-text index, so a typo has no server expression;
 * it cannot range over a map value, so `meta.campaign:spring` over the
 * author's own `+ ADD FIELD` keys has no server expression; and a term that
 * may land in the name, the alt text, the description, a tag or a custom
 * value is five queries the client would have to union anyway.
 *
 * "Scalable switchers" (`nameSearchKey` + `nameLower` + `startAt`/`endAt`)
 * is the right answer to the problem it solved — a PREFIX on ONE field over
 * a collection nobody wants in memory. It buys none of the four above, and
 * it costs a schema field, a backfill and an index. Against a media library
 * the honest move is the other one: read the rest of the current query,
 * once, and then answer over all of it.
 *
 * So the rule this module exists to enforce is: rich matching is allowed
 * only over a set the UI can truthfully describe. `mediaSearchScopeMessage`
 * is that description, and it is tested, because it is the part that stops
 * this from being a nicer-looking version of the same lie.
 */

/** The fields a query can be aimed at. `any` is a bare term. */
export type MediaSearchField =
  | 'any'
  | 'name'
  | 'alt'
  | 'description'
  | 'tag'
  | 'folder'
  | 'meta'

/** How the current result set was arrived at. */
export type MediaSearchMode = 'all' | 'exact' | 'fuzzy'

export interface MediaSearchClause {
  field: MediaSearchField
  /** The custom-metadata key for `meta.<key>:`, else null. */
  metaKey: string | null
  /** What the author typed, lowercased. */
  value: string
  /** Contains `*` or `?`, so it is an anchored pattern, not a substring. */
  wildcard: boolean
}

export interface MediaSearchQuery {
  raw: string
  clauses: MediaSearchClause[]
  /** Nothing to filter by — every item matches. */
  isEmpty: boolean
  /** Bare, wildcard-free terms: the only ones fuzzy is allowed to loosen. */
  fuzzyTerms: string[]
}

export interface MediaSearchContext {
  /** Folder id -> name, so `folder:brand` and a bare term can reach it. */
  folderNameById?: Record<string, string>
}

export interface MediaSearchResult<T> {
  items: T[]
  mode: MediaSearchMode
}

/**
 * Field names an author can type. Aliases are the words people reach for,
 * not a schema dump — `desc` because nobody types `description`.
 */
const FIELD_ALIASES: Record<string, MediaSearchField> = {
  name: 'name',
  filename: 'name',
  file: 'name',
  alt: 'alt',
  desc: 'description',
  description: 'description',
  tag: 'tag',
  tags: 'tag',
  folder: 'folder',
  meta: 'meta',
  custom: 'meta',
}

/**
 * `field:value`, `meta.key:value`. The prefix is deliberately narrow: a
 * token that does not name a known field stays a literal, so a URL or a file
 * called `v1:final.png` is searched for rather than silently reinterpreted.
 */
const FIELD_TOKEN = /^([a-zA-Z][a-zA-Z0-9_-]*)(?:\.([^:]+))?:([\s\S]*)$/

/**
 * Split on whitespace, honouring double quotes so `"landing page"` and
 * `tag:"black friday"` are single terms. Quotes are consumed, not kept.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseMediaQuery(input: string): MediaSearchQuery {
  const raw = String(input ?? '')
  const clauses: MediaSearchClause[] = []
  for (const token of tokenize(raw)) {
    const match = FIELD_TOKEN.exec(token)
    const field = match ? FIELD_ALIASES[match[1].toLowerCase()] : undefined
    if (match && field) {
      const value = match[3].trim().toLowerCase()
      // `tag:` with nothing after it is a half-typed filter, not "matches
      // nothing" — emptying the grid under the cursor mid-keystroke is the
      // same class of surprise this issue is about.
      if (!value) continue
      clauses.push({
        field,
        metaKey: match[2] ? match[2].toLowerCase() : null,
        value,
        wildcard: /[*?]/.test(value),
      })
      continue
    }
    const value = token.toLowerCase()
    clauses.push({
      field: 'any',
      metaKey: null,
      value,
      wildcard: /[*?]/.test(value),
    })
  }
  return {
    raw,
    clauses,
    isEmpty: clauses.length === 0,
    fuzzyTerms: clauses
      .filter((clause) => clause.field === 'any' && !clause.wildcard)
      .map((clause) => clause.value),
  }
}

/** `*` -> any run, `?` -> one character; everything else literal. */
function wildcardPattern(value: string): RegExp {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

const asText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value)

function customValues(item: any, key: string | null): string[] {
  const meta = item?.customMetadata
  if (!meta || typeof meta !== 'object') return []
  if (!key) return Object.values(meta).map(asText)
  const hit = Object.entries(meta).find(
    ([name]) => String(name).toLowerCase() === key,
  )
  return hit ? [asText(hit[1])] : []
}

function folderNames(item: any, context: MediaSearchContext): string[] {
  const names: string[] = []
  const mapped = item?.folderId
    ? context.folderNameById?.[String(item.folderId)]
    : undefined
  if (mapped) names.push(asText(mapped))
  // Unmigrated documents still carry the AGL-124 free-text string.
  if (item?.folder) names.push(asText(item.folder))
  return names
}

/**
 * The candidate strings one clause is measured against — a LIST, never a
 * joined blob. Joining is what let a term straddle two fields in the old
 * matcher, and it is what would make `mock-*-noshadow.png` meaningless,
 * because the pattern would be anchored to a sentence rather than a name.
 */
function candidates(
  item: any,
  clause: MediaSearchClause,
  context: MediaSearchContext,
): string[] {
  switch (clause.field) {
    case 'name':
      return [asText(item?.fileName)]
    case 'alt':
      return [asText(item?.alt)]
    case 'description':
      return [asText(item?.description)]
    case 'tag':
      return (Array.isArray(item?.tags) ? item.tags : []).map(asText)
    case 'folder':
      return folderNames(item, context)
    case 'meta':
      return customValues(item, clause.metaKey)
    default:
      return [
        asText(item?.fileName),
        asText(item?.alt),
        asText(item?.description),
        ...(Array.isArray(item?.tags) ? item.tags : []).map(asText),
        ...folderNames(item, context),
        ...customValues(item, null),
      ]
  }
}

function clauseMatches(
  item: any,
  clause: MediaSearchClause,
  context: MediaSearchContext,
): boolean {
  const haystacks = candidates(item, clause, context).filter(Boolean)
  if (!haystacks.length) return false
  if (clause.wildcard) {
    const pattern = wildcardPattern(clause.value)
    return haystacks.some((text) => pattern.test(text.toLowerCase()))
  }
  return haystacks.some((text) => text.toLowerCase().includes(clause.value))
}

/** Every clause must match — the reading the grid and the drawer share. */
export function matchesMediaQuery(
  item: any,
  query: MediaSearchQuery,
  context: MediaSearchContext = {},
): boolean {
  return query.clauses.every((clause) => clauseMatches(item, clause, context))
}

/**
 * Weights borrowed from `useMdiIconsFuzzy` — the icon picker's shape, so the
 * two search boxes in this product answer a typo the same way. `threshold`
 * and `ignoreLocation` are set here because a file name is not an icon name:
 * matches land anywhere in `mock-hero-noshadow.png`, and the default 0.6 is
 * loose enough to return the whole library for a three-letter term.
 */
const FUZZY_KEYS = [
  { name: 'name', weight: 0.5 },
  { name: 'tags', weight: 0.2 },
  { name: 'alt', weight: 0.15 },
  { name: 'description', weight: 0.1 },
  { name: 'folder', weight: 0.03 },
  { name: 'meta', weight: 0.02 },
]

function fuzzyRank<T>(
  items: T[],
  terms: string[],
  context: MediaSearchContext,
): T[] {
  const rows = items.map((item: any, index) => ({
    index,
    name: asText(item?.fileName),
    tags: (Array.isArray(item?.tags) ? item.tags : []).map(asText),
    alt: asText(item?.alt),
    description: asText(item?.description),
    folder: folderNames(item, context).join(' '),
    meta: customValues(item, null).join(' '),
  }))
  const fuse = new Fuse(rows, {
    keys: FUZZY_KEYS,
    includeScore: true,
    shouldSort: true,
    ignoreLocation: true,
    threshold: 0.4,
    minMatchCharLength: 2,
  })
  return fuse
    .search(terms.join(' '))
    .map((hit: any) => items[hit.item.index])
    .filter(Boolean)
}

/**
 * Run a query over a set of media documents.
 *
 * The literal reading wins whenever it finds anything, and it preserves the
 * incoming order — which is the order the grid's Sort control produced. Only
 * when it finds NOTHING does the fuzzy pass run, and then the order is Fuse's
 * relevance, which `mode: 'fuzzy'` tells the caption to disclose. Ranking
 * every search by relevance would silently override the author's chosen sort
 * on every keystroke.
 *
 * Wildcards and field filters are never loosened. `mock-*-noshadow.png` is a
 * precise statement about a family of names; answering it with near misses
 * would mean the pattern matched things it does not describe.
 */
export function searchMedia<T>(
  items: T[],
  query: MediaSearchQuery,
  context: MediaSearchContext = {},
): MediaSearchResult<T> {
  if (query.isEmpty) return { items, mode: 'all' }

  const strict = items.filter((item) => matchesMediaQuery(item, query, context))
  if (strict.length || !query.fuzzyTerms.length) {
    return { items: strict, mode: 'exact' }
  }

  // The hard clauses stay hard; only the bare terms are loosened.
  const gated = items.filter((item) =>
    query.clauses
      .filter((clause) => clause.field !== 'any' || clause.wildcard)
      .every((clause) => clauseMatches(item, clause, context)),
  )
  const ranked = fuzzyRank(gated, query.fuzzyTerms, context)
  return ranked.length
    ? { items: ranked, mode: 'fuzzy' }
    : { items: [], mode: 'exact' }
}

export interface MediaSearchScopeState {
  /** There is a query in the box. */
  active: boolean
  /** Documents in the loaded window. */
  loaded: number
  /** Documents in the library, from the counter doc; 0 when unknown. */
  total: number
  /** The window holds every document of the current query. */
  complete: boolean
  /** A completion pass is in flight. */
  completing: boolean
  /** The completion pass stopped at the read cap. */
  truncated: boolean
  mode: MediaSearchMode
  /** How many items the current query returned. */
  matches: number
}

const count = (value: number) => value.toLocaleString('en-US')

/**
 * What the field says underneath itself.
 *
 * This is the honest part of the feature and it is why it is a tested pure
 * function rather than a ternary in the JSX. The caption it replaces —
 * "Searches loaded files — Load more to widen" — was true and unusable: it
 * never said how much of the library that was, and it vanished the moment
 * `hasMore` went false, including when `hasMore` went false because a folder
 * filter had narrowed the query rather than because anything had been read.
 */
export function mediaSearchScopeMessage(state: MediaSearchScopeState): string {
  if (!state.active) {
    return 'Name, tag, alt, description, custom fields — try tag:hero or mock-*.png'
  }
  if (state.completing) return 'Loading the rest of the library to search it…'
  if (state.truncated) {
    return `Searched the first ${count(state.loaded)} files — narrow by folder, type or date to reach the rest`
  }
  if (!state.complete) {
    return state.total > state.loaded
      ? `Searching ${count(state.loaded)} of ${count(state.total)} loaded files`
      : `Searching ${count(state.loaded)} loaded files`
  }
  if (state.mode === 'fuzzy') {
    return `No exact match in ${count(state.loaded)} files — showing ${count(state.matches)} close ${state.matches === 1 ? 'match' : 'matches'}`
  }
  // "Searched all 70 files" is ambiguous when the library holds 174 and a
  // folder or type facet narrowed the query to 70 — it reads as a claim
  // about the library. The claim is only ever about the current query.
  const noun = state.loaded === 1 ? 'file' : 'files'
  return state.total > state.loaded
    ? `Searched all ${count(state.loaded)} ${noun} in this view`
    : `Searched all ${count(state.loaded)} ${noun}`
}

export default searchMedia
