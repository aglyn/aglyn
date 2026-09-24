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
  type ListFilterField,
  type ListFilterRequest,
  listFilterDay,
  listFilterOperators,
} from './list-filter'

/*
 * EVERY CLAUSE ON THE QUERY (AGL-3321).
 *
 * The AGL-2501 contract turned ONE filter into a Firestore query — the list
 * put the first servable clause on its query and matched the rest over the
 * rows it had loaded, and search the same way. A clause matched over a loaded
 * page answers "no match" for a record on the next one, which is the one
 * answer a list must never give wrongly.
 *
 * This composes them all. A list declares its fields (the same
 * `ListFilterField` grammar), the sorts it offers and the token array its
 * quick search reads; `planListQuery` turns the clauses in force and the
 * search words into ONE query — every predicate, one order — and says which
 * it could not put there and why. Nothing is matched in memory afterwards:
 * a clause the plan refuses is not applied, and the list says so, rather
 * than being applied to some rows and not others.
 *
 * The plan is SDK-free and model-free: the text normalizers the written
 * search fields were stamped with come in as `ListQueryNormalizers` — the
 * platform's are `nameSearchNormalizers` (`@aglyn/aglyn/app-utils/name-search`)
 * — so the query asks for exactly the keys the writers stored. The web twin (`listQueryConstraints` in the instance
 * library) and the Admin twin (`applyListQuery` in the console) turn it into
 * their SDK's query, so the two cannot disagree about what a clause means.
 *
 * ## What one Firestore query can hold
 *
 *   - any number of equalities (`==`, `in`), composed through INDEX MERGING:
 *     one `(field, sort)` composite per equality field serves every
 *     combination of them, measured against production (AGL-3321);
 *   - ONE array clause — `array-contains` or `array-contains-any` — which a
 *     search token, a `contains` filter and a scope clause all compete for;
 *   - ONE inequality field (a range, `!=`, a prefix range), which must then
 *     lead the order — so a range orders the list by the field it ranges over;
 *   - at most thirty disjunctions, which an `in` and an
 *     `array-contains-any` multiply.
 *
 * The declaration's `listQueryIndexes` enumerates the composites those
 * shapes need, and each list's spec holds the index file to it.
 */

/**
 * How the written search fields were normalized, so a typed value becomes the
 * key the query can match: the lower-cased key (`equals`, `startsWith`), the
 * one word-prefix token (`contains`, search), and the reversed key
 * (`endsWith`). `maxPrefix` is the longest token a writer stores.
 */
export interface ListQueryNormalizers {
  key(value: string): string
  token(value: string): string
  reversed(value: string): string
  maxPrefix: number
}

/** A predicate on the query, SDK-free. `path` `__name__` is the document id. */
export type ListQueryOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'array-contains'
  | 'array-contains-any'

export type ListQueryValue = string | number | boolean | null | Date | readonly (string | number)[]

export interface ListQueryFilter {
  path: string
  op: ListQueryOp
  value: ListQueryValue
}

export interface ListQuerySort {
  path: string
  direction: 'asc' | 'desc'
  /** The grid column this order sorts, when the list lets the grid sort by it. */
  column?: string
}

/** The document id, as a path. */
export const LIST_QUERY_ID_PATH = '__name__'

/** Firestore's cap on disjunctions — `in` values times `array-contains-any` values. */
export const LIST_QUERY_DISJUNCTIONS = 30

/** A very high private-use codepoint: `[p, p + HIGH]` spans every string starting `p`. */
const HIGH = '\uf8ff'

export interface ListQueryDeclaration {
  /** Every field the Filters panel may name. */
  fields: readonly ListFilterField[]
  /**
   * The orders the list offers, its default FIRST. The query takes no other:
   * each is a composite the index file carries for every filterable field.
   */
  sorts: readonly ListQuerySort[]
  /**
   * The quick search: the token array every write stamps (see
   * `nameSearchTokens`), queried with `array-contains` on one typed word.
   * Absent, the list offers no search box.
   */
  search?: {
    tokensPath: string
    /**
     * Under a scope clause the search cannot be a SECOND array clause, so a
     * scoped list writes `<scopeToken><join><prefix>` tokens and the query
     * asks `array-contains-any` over the scope's tokens joined to the word —
     * one array clause that answers both.
     */
    scoped?: { tokensPath: string; join: string }
  }
  /**
   * Keys a presence-map field (`keysOf`) is filtered by, for the index
   * enumeration: `sources.form`, `sources.order`, …
   */
  keys?: Readonly<Record<string, readonly string[]>>
}

/** What the list asks this time. */
export interface ListQueryRequest {
  clauses: readonly ListFilterRequest[]
  /** The quick search's words. */
  search?: readonly string[]
  /** The order asked for; a sort the declaration does not offer is ignored. */
  sort?: ListQuerySort | null
  /**
   * Predicates the list always applies — its scope — which count against
   * the same limits. An `array-contains-any` scope is what a scoped search
   * folds into (`declaration.search.scoped`).
   */
  base?: readonly ListQueryFilter[]
}

export interface ListQueryRefusal {
  /** The clause refused, or `search`. */
  clause: ListFilterRequest | 'search'
  reason: string
}

export interface ListQueryPlan {
  /** Every predicate, base included, in the order the SDK should add them. */
  filters: ListQueryFilter[]
  /** The one order: the range field's when there is one, else the sort. */
  orderBy: ListQuerySort
  /** The clauses on the query. */
  served: ListFilterRequest[]
  /** The search word on the query, or null. */
  searched: string | null
  /** What was asked and could not be put on the query, with why. */
  refused: ListQueryRefusal[]
  /** Said to the reader about what WAS served — e.g. one search word of two. */
  notices: string[]
}

/** How one clause lands on a query, before it is composed with the others. */
interface ClauseShape {
  filters: ListQueryFilter[]
  /** The inequality field the clause needs to lead the order, if any. */
  inequality?: string
  /** The clause is the query's array clause. */
  array?: boolean
  /** `in` values, for the disjunction budget. */
  disjunctions?: number
}

const csv = (raw: string): string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const dayBounds = (raw: string): { start: Date; end: Date } | null => {
  const start = listFilterDay(raw)
  if (Number.isNaN(start.getTime())) return null
  const day = new Date(start)
  day.setHours(0, 0, 0, 0)
  const end = new Date(day)
  end.setDate(end.getDate() + 1)
  return { start: day, end }
}

/** The order a range over `path` puts the list in. */
const rangeOrder = (
  declaration: ListQueryDeclaration,
  field: ListFilterField | undefined,
  path: string,
): ListQuerySort => {
  const offered = declaration.sorts.find((sort) => sort.path === path)
  if (offered) return offered
  return { path, direction: field?.kind === 'date' ? 'desc' : 'asc' }
}

/**
 * One clause as predicates, or the reason it has none. The same operator
 * meanings as the AGL-2501 twins (`applyListFilter`, `listFilterConstraints`),
 * which this replaces for a list that composes clauses.
 */
function shapeClause(
  field: ListFilterField,
  input: ListFilterRequest,
  names: ListQueryNormalizers,
): ClauseShape | string {
  if (field.windowOnly) return 'this field is not stored where a query can reach it'
  if (!listFilterOperators(field).includes(input.op)) {
    return `${input.op} is not something this list can ask of ${field.column}`
  }
  const raw = (input.value ?? '').trim()
  const op = input.op

  if (op === 'isEmpty') {
    if (field.presence !== 'nullable') return 'only a field stored as null can be asked for empty'
    return { filters: [{ path: field.path, op: '==', value: null }] }
  }
  if (op === 'isNotEmpty') {
    if (field.presence === 'always') return 'this field is never empty'
    return { filters: [{ path: field.path, op: '!=', value: null }], inequality: field.path }
  }
  if (field.kind === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return 'pick true or false'
    return { filters: [{ path: field.path, op: '==', value: raw === 'true' }] }
  }
  if (!raw) return 'no value yet'

  if (field.keysOf) {
    if (op !== 'equals' || !/^[A-Za-z0-9_]+$/.test(raw)) return 'pick one of the choices'
    return { filters: [{ path: `${field.path}.${raw}`, op: '==', value: true }] }
  }

  if (field.kind === 'text') {
    if (op === 'contains' && field.tokensPath) {
      const token = field.verbatimTokens ? raw : names.token(raw)
      if (!token) return 'no value yet'
      return {
        filters: [{ path: field.tokensPath, op: 'array-contains', value: token }],
        array: true,
      }
    }
    if (op === 'equals' && field.lowerPath) {
      return { filters: [{ path: field.lowerPath, op: '==', value: names.key(raw) }] }
    }
    if (op === 'equals' && field.presence === 'always' && !field.lowerPath) {
      return { filters: [{ path: field.path, op: '==', value: raw }] }
    }
    if (op === 'startsWith' && field.lowerPath) {
      const key = names.key(raw)
      return {
        filters: [
          { path: field.lowerPath, op: '>=', value: key },
          { path: field.lowerPath, op: '<=', value: `${key}${HIGH}` },
        ],
        inequality: field.lowerPath,
      }
    }
    if (op === 'endsWith' && field.reversedPath) {
      const key = names.reversed(raw)
      return {
        filters: [
          { path: field.reversedPath, op: '>=', value: key },
          { path: field.reversedPath, op: '<=', value: `${key}${HIGH}` },
        ],
        inequality: field.reversedPath,
      }
    }
    if (op === 'isAnyOf' && field.lowerPath) {
      const values = csv(raw).map((value) => names.key(value))
      if (values.length > LIST_QUERY_DISJUNCTIONS) return `at most ${LIST_QUERY_DISJUNCTIONS} values`
      return {
        filters: [{ path: field.lowerPath, op: 'in', value: values }],
        disjunctions: values.length,
      }
    }
    return `${op} is not something this list can ask of ${field.column}`
  }

  if (field.kind === 'id') {
    if (op === 'equals') return { filters: [{ path: LIST_QUERY_ID_PATH, op: '==', value: raw }] }
    if (op === 'isAnyOf') {
      const values = csv(raw)
      if (values.length > LIST_QUERY_DISJUNCTIONS) return `at most ${LIST_QUERY_DISJUNCTIONS} values`
      return {
        filters: [{ path: LIST_QUERY_ID_PATH, op: 'in', value: values }],
        disjunctions: values.length,
      }
    }
    if (op === 'startsWith') {
      return {
        filters: [
          { path: LIST_QUERY_ID_PATH, op: '>=', value: raw },
          { path: LIST_QUERY_ID_PATH, op: '<=', value: `${raw}${HIGH}` },
        ],
        inequality: LIST_QUERY_ID_PATH,
      }
    }
    return `${op} is not something this list can ask of ${field.column}`
  }

  if (field.kind === 'exact') {
    if (op === 'equals') return { filters: [{ path: field.path, op: '==', value: raw }] }
    if (op === 'isAnyOf') {
      const values = csv(raw)
      if (values.length > LIST_QUERY_DISJUNCTIONS) return `at most ${LIST_QUERY_DISJUNCTIONS} values`
      if (field.tokensPath) {
        // An array field asked "any of these": one array clause.
        return {
          filters: [{ path: field.tokensPath, op: 'array-contains-any', value: values }],
          array: true,
          disjunctions: values.length,
        }
      }
      return {
        filters: [{ path: field.path, op: 'in', value: values }],
        disjunctions: values.length,
      }
    }
    if (op === 'contains' && field.tokensPath) {
      return {
        filters: [{ path: field.tokensPath, op: 'array-contains', value: raw }],
        array: true,
      }
    }
    return `${op} is not something this list can ask of ${field.column}`
  }

  if (field.kind === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) return 'type a number'
    if (op === '=') return { filters: [{ path: field.path, op: '==', value }] }
    const comparison: Record<string, ListQueryOp> = {
      '!=': '!=',
      '>': '>',
      '>=': '>=',
      '<': '<',
      '<=': '<=',
    }
    const found = comparison[op]
    if (!found) return `${op} is not something this list can ask of ${field.column}`
    return { filters: [{ path: field.path, op: found, value }], inequality: field.path }
  }

  if (field.kind === 'date') {
    const day = dayBounds(raw)
    if (!day) return 'pick a date'
    // A `…AtMs` field is compared as the number it is stored as.
    const at = (date: Date): Date | number =>
      field.storedAs === 'millis' ? date.getTime() : date
    if (op === 'is') {
      return {
        filters: [
          { path: field.path, op: '>=', value: at(day.start) },
          { path: field.path, op: '<', value: at(day.end) },
        ],
        inequality: field.path,
      }
    }
    const bound: Record<string, [ListQueryOp, Date]> = {
      after: ['>=', day.end],
      onOrAfter: ['>=', day.start],
      before: ['<', day.start],
      onOrBefore: ['<', day.end],
    }
    const found = bound[op]
    if (!found) return `${op} is not something this list can ask of ${field.column}`
    return { filters: [{ path: field.path, op: found[0], value: at(found[1]) }], inequality: field.path }
  }

  return `${op} is not something this list can ask of ${field.column}`
}

const disjunctionsOf = (filter: ListQueryFilter): number =>
  filter.op === 'in' || filter.op === 'array-contains-any'
    ? Math.max(1, Array.isArray(filter.value) ? filter.value.length : 1)
    : 1

/**
 * Every clause and the search, as ONE query — or as much of it as one query
 * can hold, with the rest refused by name.
 *
 * Order of claim: the base (the list's scope) first, then the search, then
 * the clauses in the order they were added. A clause that would be a second
 * array clause, a second inequality field or push the disjunctions past
 * thirty is refused, and the list shows the refusal beside its chip; the
 * clauses before it stand. The search is claimed before the clauses because
 * it is the thing a reader typed last and looks at.
 */
export function planListQuery(
  declaration: ListQueryDeclaration,
  request: ListQueryRequest,
  names: ListQueryNormalizers,
): ListQueryPlan {
  const filters: ListQueryFilter[] = [...(request.base ?? [])]
  const served: ListFilterRequest[] = []
  const refused: ListQueryRefusal[] = []
  const notices: string[] = []
  let arrayTaken = filters.some(
    (filter) => filter.op === 'array-contains' || filter.op === 'array-contains-any',
  )
  let inequality: string | null =
    filters.find((filter) => ['!=', '<', '<=', '>', '>='].includes(filter.op))?.path ?? null
  let disjunctions = filters.reduce((product, filter) => product * disjunctionsOf(filter), 1)

  // The search.
  let searched: string | null = null
  const words = (request.search ?? []).map((word) => word.trim()).filter(Boolean)
  if (words.length) {
    const search = declaration.search
    const token = names.token(words.join(' '))
    if (!search) {
      refused.push({ clause: 'search', reason: 'this list has no search' })
    } else if (!token) {
      // Nothing searchable was typed.
    } else {
      const scopeAt = filters.findIndex(
        (filter) => filter.op === 'array-contains-any' || filter.op === 'array-contains',
      )
      if (scopeAt === -1) {
        filters.push({ path: search.tokensPath, op: 'array-contains', value: token })
        arrayTaken = true
        searched = token
      } else if (search.scoped) {
        // Fold the search into the scope: one array clause answers both.
        const scope = filters[scopeAt]
        const scopes = Array.isArray(scope.value) ? scope.value : [scope.value]
        filters.splice(scopeAt, 1, {
          path: search.scoped.tokensPath,
          op: 'array-contains-any',
          value: scopes.map((entry) => `${String(entry)}${search.scoped?.join}${token}`),
        })
        searched = token
      } else {
        refused.push({
          clause: 'search',
          reason: 'this list is already narrowed to what you can see, which search cannot combine with',
        })
      }
      if (searched && words.length > 1) {
        notices.push(
          `Search matches one word at a time: showing results for "${token}".`,
        )
      }
      if (searched && names.key(words[0]).length > names.maxPrefix) {
        notices.push(`Search reads the first ${names.maxPrefix} letters of a word.`)
      }
    }
  }

  // The clauses.
  for (const clause of request.clauses) {
    const field = declaration.fields.find((entry) => entry.column === clause.field)
    if (!field) {
      refused.push({ clause, reason: 'this list does not filter by that' })
      continue
    }
    const shape = shapeClause(field, clause, names)
    if (typeof shape === 'string') {
      refused.push({ clause, reason: shape })
      continue
    }
    if (shape.array && arrayTaken) {
      refused.push({
        clause,
        reason: searched
          ? 'cannot be combined with the search — clear the search to use it'
          : 'cannot be combined with another "contains" or "any of" filter on a list',
      })
      continue
    }
    if (shape.inequality && inequality && shape.inequality !== inequality) {
      refused.push({
        clause,
        reason: 'only one range (dates, numbers, starts with) can apply at a time',
      })
      continue
    }
    const product =
      disjunctions * shape.filters.reduce((total, filter) => total * disjunctionsOf(filter), 1)
    if (product > LIST_QUERY_DISJUNCTIONS) {
      refused.push({ clause, reason: `too many values at once (the limit is ${LIST_QUERY_DISJUNCTIONS})` })
      continue
    }
    filters.push(...shape.filters)
    served.push(clause)
    if (shape.array) arrayTaken = true
    if (shape.inequality) inequality = shape.inequality
    disjunctions = product
  }

  // The order.
  const asked = request.sort
    ? declaration.sorts.find(
        (sort) => sort.path === request.sort?.path && sort.direction === request.sort?.direction,
      )
    : undefined
  const orderBy = inequality
    ? rangeOrder(
        declaration,
        declaration.fields.find(
          (field) =>
            field.path === inequality ||
            field.lowerPath === inequality ||
            field.reversedPath === inequality,
        ),
        inequality,
      )
    : (asked ?? declaration.sorts[0] ?? { path: LIST_QUERY_ID_PATH, direction: 'asc' })

  return { filters, orderBy, served, searched, refused, notices }
}

/** A composite the plan's shapes need, in the index file's own terms. */
export interface ListQueryIndex {
  fields: Array<{ fieldPath: string; order?: 'ASCENDING' | 'DESCENDING'; arrayConfig?: 'CONTAINS' }>
}

const ORDER = { asc: 'ASCENDING', desc: 'DESCENDING' } as const

/**
 * Every composite a declaration's queries can need, under index merging:
 * one `(predicate field, order)` index per equality or array field and per
 * order the list can take — its sorts, and the order each range imposes.
 *
 * `base` names the scope predicates the list always applies (their paths
 * and whether they are array clauses), which need their own index per order
 * like any other equality. Pinned by each list's spec against
 * `cloud/firebase-firestore.indexes.json`.
 */
export function listQueryIndexes(
  declaration: ListQueryDeclaration,
  base: readonly { path: string; array?: boolean }[] = [],
): ListQueryIndex[] {
  const equalities = new Map<string, boolean>() // path → is array clause
  const orders: ListQuerySort[] = [...declaration.sorts]
  const addOrder = (sort: ListQuerySort) => {
    if (!orders.some((entry) => entry.path === sort.path && entry.direction === sort.direction)) {
      orders.push(sort)
    }
  }
  for (const entry of base) equalities.set(entry.path, Boolean(entry.array))
  if (declaration.search) {
    equalities.set(declaration.search.tokensPath, true)
    if (declaration.search.scoped) equalities.set(declaration.search.scoped.tokensPath, true)
  }
  for (const field of declaration.fields) {
    if (field.windowOnly) continue
    const ops = listFilterOperators(field)
    const has = (...names: string[]) => names.some((name) => ops.includes(name))
    if (field.keysOf) {
      for (const key of declaration.keys?.[field.column] ?? []) {
        equalities.set(`${field.path}.${key}`, false)
      }
      continue
    }
    if (field.kind === 'text') {
      if (has('contains') && field.tokensPath) equalities.set(field.tokensPath, true)
      if (has('equals', 'isAnyOf') && field.lowerPath) equalities.set(field.lowerPath, false)
      if (has('equals') && !field.lowerPath && field.presence === 'always') equalities.set(field.path, false)
      if (has('startsWith') && field.lowerPath) addOrder(rangeOrder(declaration, field, field.lowerPath))
      if (has('endsWith') && field.reversedPath) addOrder(rangeOrder(declaration, field, field.reversedPath))
    } else if (field.kind === 'exact') {
      if (has('equals', 'isAnyOf')) equalities.set(field.path, false)
      if (has('contains', 'isAnyOf') && field.tokensPath) equalities.set(field.tokensPath, true)
    } else if (field.kind === 'boolean') {
      equalities.set(field.path, false)
    } else if (field.kind === 'number') {
      if (has('=')) equalities.set(field.path, false)
      if (has('!=', '>', '>=', '<', '<=')) addOrder(rangeOrder(declaration, field, field.path))
    } else if (field.kind === 'date') {
      if (has('is', 'after', 'onOrAfter', 'before', 'onOrBefore')) {
        addOrder(rangeOrder(declaration, field, field.path))
      }
    }
    if (has('isEmpty')) equalities.set(field.path, false)
    if (has('isNotEmpty')) addOrder(rangeOrder(declaration, field, field.path))
  }
  const indexes: ListQueryIndex[] = []
  const seen = new Set<string>()
  for (const [path, array] of equalities) {
    for (const order of orders) {
      if (order.path === path || order.path === LIST_QUERY_ID_PATH) continue
      const index: ListQueryIndex = {
        fields: [
          array ? { fieldPath: path, arrayConfig: 'CONTAINS' } : { fieldPath: path, order: 'ASCENDING' },
          { fieldPath: order.path, order: ORDER[order.direction] },
        ],
      }
      const key = JSON.stringify(index)
      if (!seen.has(key)) {
        seen.add(key)
        indexes.push(index)
      }
    }
  }
  return indexes
}

/** An index entry as `cloud/firebase-firestore.indexes.json` stores it. */
interface IndexFileEntry {
  collectionGroup: string
  queryScope: string
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>
}

/**
 * The composites a declaration needs that an index file does not hold — what
 * a list's spec asserts is empty, so a declared filter cannot ship without
 * the index that serves it.
 */
export function missingListQueryIndexes(
  file: { indexes: readonly IndexFileEntry[] },
  collectionGroup: string,
  needed: readonly ListQueryIndex[],
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP' = 'COLLECTION',
): ListQueryIndex[] {
  const shape = (fields: IndexFileEntry['fields']) =>
    fields
      .filter((field) => field.fieldPath !== LIST_QUERY_ID_PATH)
      .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`)
      .join(',')
  const present = new Set(
    file.indexes
      .filter((index) => index.collectionGroup === collectionGroup && index.queryScope === queryScope)
      .map((index) => shape(index.fields)),
  )
  return needed.filter((index) => !present.has(shape(index.fields)))
}
