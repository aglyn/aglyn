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
  CRM_SCOPED_SEARCH_TOKENS_FIELD,
  CRM_SEARCH_TOKENS_FIELD,
  type CrmListCollection,
  type CrmListFieldsContext,
  crmListFields,
} from '@aglyn/aglyn/app-utils/crm'
import { nameSearchNormalizers, scopedSearch } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterField, ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'
import type { ListFilterOption } from '@aglyn/shared-util-tools/list-query/list-filter-codecs'
import { listQueryRefusals } from '@aglyn/shared-util-tools/list-query/list-query-refusals'
import {
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryPlan,
  type ListQueryRequest,
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'

/*
 * THE CRM LISTS ON THEIR QUERIES (AGL-3321).
 *
 * Every CRM list — Leads, Contacts, Companies, Deals, Tasks — declares its
 * filterable fields, its one order and its search as a
 * `ListQueryDeclaration`, and `planListQuery` puts every clause and the
 * search word on ONE Firestore query paged by `useListQuery`. What a query
 * cannot hold is refused by name (`ListQueryNotices`), never matched over
 * the rows a page happened to load.
 *
 * This module is what the five share: the search every CRM record carries
 * (`searchTokens`, and `scopedSearchTokens` under a site — see
 * `crmListFields` in `@aglyn/aglyn`), the scope clause as the plan's base,
 * a stored clause translated to the one its query asks, and the refusals
 * read back through the clause the reader set.
 */

/** Every CRM list's quick search: the tokens every writer stamps. */
export const CRM_LIST_SEARCH: NonNullable<ListQueryDeclaration['search']> = {
  tokensPath: CRM_SEARCH_TOKENS_FIELD,
  scoped: scopedSearch(CRM_SCOPED_SEARCH_TOKENS_FIELD),
}

/**
 * The scope clause as the plan's base: `visibleTo array-contains-any` over
 * the reader's tokens under a site, nothing at the organization level
 * (`null` tokens), where an org-wide member's listeners carry none.
 */
export function crmListBase(visibleTo: readonly string[] | null): ListQueryFilter[] {
  return visibleTo ? [{ path: 'visibleTo', op: 'array-contains-any', value: [...visibleTo] }] : []
}

/** The base's shape, for `listQueryIndexes`: the scope clause is an array clause. */
export const CRM_LIST_BASE_INDEX = [{ path: 'visibleTo', array: true }] as const

/**
 * The declaration a reader may run.
 *
 * Under a site the search folds into the scope clause (`search.scoped`),
 * and a query without `visibleTo` is one the rules can prove only for an
 * ORG-WIDE member — `canReadScoped()` short-circuits on it, and for anybody
 * else inspects `visibleTo`, which the folded query no longer constrains.
 * A member whose reach is some sites keeps the scope clause, and the plan
 * refuses their search by name rather than sending a query the rules deny.
 */
export function crmListDeclarationFor(
  declaration: ListQueryDeclaration,
  foldsScope: boolean,
): ListQueryDeclaration {
  if (foldsScope || !declaration.search?.scoped) return declaration
  return { ...declaration, search: { tokensPath: declaration.search.tokensPath } }
}

/** What a CRM list is asked to show, before it is planned — see {@link crmListAsk}. */
export interface CrmListAskInput {
  /** The reader's scope tokens, or `null` at the organization level. */
  visibleTo: readonly string[] | null
  /** Whether the reader may run queries without the scope clause (`useCrmFoldsScope`). */
  foldsScope: boolean
  declaration: ListQueryDeclaration
  clauses: readonly ListFilterRequest[]
  search?: readonly string[]
  sort?: ListQuerySort | null
  /** Predicates beside the scope the list always applies (a task view, a pipeline). */
  base?: readonly ListQueryFilter[]
  /** A clause no record outside the reader's scope can answer; see `useCrmListQuery`. */
  impliesScope?: (clause: ListFilterRequest) => boolean
  /** A collaborator's search as a prefix of one text field; see `useCrmListQuery`. */
  prefixSearch?: { field: ListFilterField; notice: string }
  /** A clause that stands alone beside the scope; see `useCrmListQuery`. */
  soloClause?: (clause: ListFilterRequest) => boolean
}

/** A CRM list's ask: the declaration the reader runs, the request, and what was refused first. */
export interface CrmListAsk {
  reader: ListQueryDeclaration
  request: ListQueryRequest
  /** Solo clauses refused before planning. */
  refused: Array<{ clause: ListFilterRequest; reason: string }>
  /** The collaborator's search as the prefix clause it is asked as, or null. */
  prefixClause: ListFilterRequest | null
  /** The collaborator's prefix search it stands for — its notice is said when served — or null. */
  prefix: CrmListAskInput['prefixSearch'] | null
}

/**
 * Every CRM list's ask, on the web and in the app alike (AGL-3321): the
 * scope clause as the plan's base, the reader's declaration
 * (`crmListDeclarationFor`), a collaborator's search as the prefix their
 * rules can prove, a solo clause refused beside others, and a clause that
 * implies the scope standing in for it only when the plan serves it.
 */
export function crmListAsk(input: CrmListAskInput): CrmListAsk {
  const { visibleTo, foldsScope, search = [], sort = null, base = [], impliesScope, prefixSearch } = input
  const word = search.find((typed) => typed.trim())
  // A collaborator's search, as the prefix range their rules can prove.
  const collaboratorPrefix = visibleTo && !foldsScope && prefixSearch && word ? prefixSearch : null
  const own = crmListDeclarationFor(input.declaration, foldsScope)
  const reader = collaboratorPrefix
    ? { ...own, fields: [...own.fields, collaboratorPrefix.field] }
    : own
  const prefixClause: ListFilterRequest | null =
    collaboratorPrefix && word
      ? { field: collaboratorPrefix.field.column, op: 'startsWith', value: word.trim() }
      : null
  const all = [...input.clauses, ...(prefixClause ? [prefixClause] : [])]
  // Searching beside it, unless the search is the prefix clause itself.
  const alone = (clause: ListFilterRequest) =>
    Boolean(input.soloClause?.(clause) && (all.length > 1 || (!prefixClause && word)))
  const kept = all.filter((clause) => !alone(clause))
  const words = prefixClause ? [] : search
  const refused = all.filter(alone).map((clause) => ({
    clause,
    reason:
      'it orders the list by its own field, so it stands alone — clear the other filters and the search to use it',
  }))
  const scoped = { clauses: kept, search: words, sort, base: [...crmListBase(visibleTo), ...base] }
  // Planned without the scope clause first; kept only if a clause standing
  // in for the scope is on the query.
  const unscoped = { clauses: kept, search: words, sort, base: [...base] }
  const request: ListQueryRequest =
    visibleTo &&
    foldsScope &&
    impliesScope &&
    kept.some(impliesScope) &&
    planListQuery(reader, unscoped, nameSearchNormalizers).served.some(impliesScope)
      ? unscoped
      : scoped
  return { reader, request, refused, prefixClause, prefix: collaboratorPrefix }
}

/**
 * The plan as the list reads it back: the solo clauses refused before
 * planning, and the collaborator's prefix named as the search it stands for.
 */
export function crmListPlanReadBack(plan: ListQueryPlan, ask: CrmListAsk): ListQueryPlan {
  const prefix = ask.prefixClause
  const isPrefix = (clause: ListFilterRequest | 'search') =>
    clause !== 'search' &&
    clause.field === prefix?.field &&
    clause.op === prefix?.op &&
    clause.value === prefix?.value
  const refused = [...ask.refused, ...plan.refused].map((entry) =>
    isPrefix(entry.clause) ? { clause: 'search' as const, reason: entry.reason } : entry,
  )
  const notices =
    ask.prefix && plan.served.some(isPrefix) ? [...plan.notices, ask.prefix.notice] : plan.notices
  return !prefix && !ask.refused.length ? plan : { ...plan, refused, notices }
}

/*------------------------------------------
 * WHAT A LIST STORES, AND WHAT IT ASKS.
 *
 * A saved view stores clauses in the grid's grammar — "Status is Open",
 * "Owner is Dana", "Lead source is none" — and some of them name no stored
 * field one query can ask as it is: Open is two statuses, an owner under a
 * site is that holder's facet key, a lead source is compared by its key. A
 * list translates each stored clause into the clause its query asks, plans
 * those, and reads the plan's refusals back through the stored clause, so
 * the notice names what the reader set ("Status is Open is not applied")
 * and never the field it was translated to.
 *-----------------------------------------*/

/** How one stored clause is asked: a query clause, or why it cannot be. */
export type CrmClauseAsked = ListFilterRequest | { refused: string }

export interface CrmAskedClauses {
  /** What the plan is asked, in the order the reader set them. */
  clauses: ListFilterRequest[]
  /** The stored clause each asked one stands for, index for index. */
  origins: ListFilterRequest[]
  /** Stored clauses refused before the plan saw them, with why. */
  refused: Array<{ clause: ListFilterRequest; reason: string }>
}

/** Every stored clause through `ask`, keeping where each came from. */
export function crmAskClauses(
  stored: readonly ListFilterRequest[],
  ask: (clause: ListFilterRequest) => CrmClauseAsked,
): CrmAskedClauses {
  const clauses: ListFilterRequest[] = []
  const origins: ListFilterRequest[] = []
  const refused: CrmAskedClauses['refused'] = []
  for (const clause of stored) {
    const asked = ask(clause)
    if ('refused' in asked) {
      refused.push({ clause, reason: asked.refused })
    } else {
      clauses.push(asked)
      origins.push(clause)
    }
  }
  return { clauses, origins, refused }
}

const sameClause = (a: ListFilterRequest, b: ListFilterRequest): boolean =>
  a.field === b.field && a.op === b.op && a.value === b.value

/**
 * The plan's refusals and the translation's, each named by the clause the
 * reader SET, as `ListQueryNotices` takes them — through the platform's one
 * wording (`listQueryRefusals`), so a notice and its chip read alike.
 */
export function crmQueryRefusals(
  plan: Pick<ListQueryPlan, 'refused'>,
  asked: CrmAskedClauses,
  context: {
    fields: readonly ListFilterField[]
    headers?: Readonly<Record<string, string>>
    options?: Readonly<Record<string, readonly ListFilterOption[]>>
  },
): Array<{ label: string; reason: string }> {
  const planned = plan.refused.map((entry) => {
    if (entry.clause === 'search') return entry
    const clause = entry.clause
    const at = asked.clauses.findIndex((candidate) => sameClause(candidate, clause))
    return { clause: at >= 0 ? asked.origins[at] : clause, reason: entry.reason }
  })
  return listQueryRefusals([...asked.refused, ...planned], context)
}

/** The comma-separated values of an `isAnyOf`, or the one value of anything else. */
export function crmClauseValues(clause: Pick<ListFilterRequest, 'op' | 'value'>): string[] {
  const raw = clause.op === 'isAnyOf' ? clause.value.split(',') : [clause.value]
  return [...new Set(raw.map((value) => value.trim()).filter(Boolean))]
}

/** One value as `equals`, several as `isAnyOf` — the shape the plan takes a list in. */
export function crmAnyOf(field: string, values: readonly string[]): CrmClauseAsked {
  const unique = [...new Set(values)]
  if (!unique.length) return { refused: 'no value yet' }
  return unique.length === 1
    ? { field, op: 'equals', value: unique[0] }
    : { field, op: 'isAnyOf', value: unique.join(',') }
}

/** A `select` field: equality and "any of" over stored values, nothing else. */
export function crmSelectField(column: string, path: string = column): ListFilterField {
  return { column, kind: 'exact', path, operators: ['equals', 'isAnyOf'] }
}

/**
 * The list fields a CLIENT edit writes beside its patch (AGL-3321): the
 * record as the listener holds it with the patch laid over — a `null` or a
 * sentinel in the patch reads as the field removed — through
 * `crmListFields`, narrowed to `fields`. A client never writes a field the
 * rules keep for the server (a lead's `emailStatus`), which is why the
 * caller names the ones it may. A lead's direction is read off the org's
 * lead source list, which the caller passes in `context` once it has it.
 */
export function crmClientListFields(
  collection: CrmListCollection,
  record: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  context: CrmListFieldsContext = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...record }
  for (const [key, value] of Object.entries(patch)) {
    // A dotted path is a map entry (`custom.tier`), never a searched field.
    if (key.includes('.')) continue
    merged[key] = value === null || isSentinel(value) ? undefined : value
  }
  const computed = crmListFields(collection, merged, context)
  return Object.fromEntries(fields.filter((field) => field in computed).map((field) => [field, computed[field]]))
}

/** A web-SDK `FieldValue` — `deleteField()`, the one a client edit of these fields sends. */
const isSentinel = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  typeof (value as { isEqual?: unknown }).isEqual === 'function'

/** The search fields every CRM record carries — what a client edit of searched text rewrites. */
export const CRM_CLIENT_SEARCH_FIELDS = ['searchTokens', 'scopedSearchTokens'] as const


/**
 * The list fields a deal's contact roles are found by (AGL-3521) — what a
 * client write of `contactRoles` or `contactId` rewrites beside them.
 */
export const CRM_DEAL_CONTACT_ROLE_LIST_FIELDS = [
  'contactRoleContactIds',
  'scopedContactRoleContactIds',
  'contactRoleKeys',
] as const
