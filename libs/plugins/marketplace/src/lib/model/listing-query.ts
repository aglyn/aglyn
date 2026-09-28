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
  displayNameSearchFields,
  scopedSearch,
  scopedSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'
import {
  isListingBrowsable,
  isListingDeleted,
  isPrivateListing,
} from '@aglyn/aglyn/app-utils/marketplace-listing-visibility'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * EVERY MARKETPLACE LIST ON ITS QUERY (AGL-3321).
 *
 * Browse, the licenses tab, the staff review queue and the abuse-report queue
 * each matched their filters and search over the rows they had loaded — a
 * window of ninety listings, two hundred reports, a hundred plugins. A match
 * on the next page was answered "no match". Each list now declares what its
 * query can hold, and the fields below are what the listing writers stamp so
 * the query has something to ask.
 *
 * ## What a listing carries for its lists
 *
 *   - `nameLower`/`nameTokens`/`nameReversed` — the display name's search
 *     keys (`displayNameSearchFields`), for the staff queue's search and for
 *     the licenses tab's listing-name lookup.
 *   - `browseAudience` — who browse shows the listing to, as scope tokens:
 *     `*` for everyone, the publisher's org id for the owner's own view of a
 *     listing still in review or taken down, and each again joined to the
 *     publisher (`*|<org>`) so a publisher page asks the same question
 *     narrowed to one publisher without a second equality. Empty for a
 *     deleted or private listing, which browse never shows anyone.
 *   - `browseTokens` — the name tokens under each audience scope
 *     (`scopedSearchTokens`), so browse's search folds into its audience
 *     clause: one `array-contains-any` answers both.
 *   - `takenDown` — `hiddenAt` as a boolean, for the staff queue's Taken down
 *     status by equality rather than by a range that would lead the order.
 *
 * All five follow from fields other writers own (`displayName`, `deletedAt`,
 * `visibility`, `hiddenAt`, `reviewStatus`, the artifact discriminators,
 * `profileId`), so no writer computes them from its own patch: each calls
 * `refreshListingQueryFields` after it writes, which re-derives them from the
 * document as stored. `tools/scripts/lib/listing-query-fields.mjs`
 * restates the derivation for the seeds and the backfill, held to
 * `listing-query-fields.fixtures.json` beside it by both sides.
 */

/** Everyone, as a browse audience scope. */
export const BROWSE_EVERYONE = '*'
/** Joins an audience scope to the publisher it is narrowed to. */
export const BROWSE_PUBLISHER_JOIN = '|'

export const LISTING_BROWSE_AUDIENCE = 'browseAudience'
export const LISTING_BROWSE_TOKENS = 'browseTokens'
export const LISTING_NAME_TOKENS = 'nameTokens'
export const LISTING_TAKEN_DOWN = 'takenDown'

/** The fields a listing's lists query by, all derived. */
export interface ListingQueryFields {
  nameLower: string
  nameTokens: string[]
  nameReversed: string
  browseAudience: string[]
  browseTokens: string[]
  takenDown: boolean
}

/** What the derivation reads off a listing. */
export interface ListingQuerySource {
  displayName?: unknown
  profileId?: unknown
  deletedAt?: unknown
  hiddenAt?: unknown
  visibility?: string
  reviewStatus?: string
  artifactType?: string
  type?: string
  kind?: string
}

/**
 * Who browse shows a listing to — the same rule the grid applied in memory:
 * never a deleted or private listing; a browsable one to everyone; one that
 * is not browsable (in review, rejected, taken down) to its own publisher
 * only, so a publisher can watch a submission move through review.
 */
export function listingBrowseAudience(listing: ListingQuerySource): string[] {
  if (isListingDeleted(listing) || isPrivateListing(listing)) return []
  const publisher = typeof listing.profileId === 'string' ? listing.profileId : ''
  const scope = isListingBrowsable(listing) ? BROWSE_EVERYONE : publisher
  if (!scope) return []
  return publisher
    ? [scope, `${scope}${BROWSE_PUBLISHER_JOIN}${publisher}`]
    : [scope]
}

/** Every derived field, from the listing as stored. */
export function listingQueryFields(listing: ListingQuerySource): ListingQueryFields {
  const name = displayNameSearchFields(listing.displayName)
  const browseAudience = listingBrowseAudience(listing)
  return {
    ...name,
    browseAudience,
    browseTokens: scopedSearchTokens(browseAudience, name.nameTokens),
    takenDown: Boolean(listing.hiddenAt),
  }
}

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

/**
 * What a listing that never had one holds in each field browse ORDERS by. An
 * `orderBy` drops a document missing its field, so a listing nobody has
 * installed or rated would vanish from Most installed and Highest rated
 * rather than sort last. `null` sorts after every number in a descending
 * order, which is where "not yet rated" belongs; the reviews route writes a
 * number over it on the first rating. Only ever stamped where the field is
 * ABSENT — the install and review routes own the values.
 */
export const LISTING_SORT_DEFAULTS: Readonly<Record<string, number | null>> = {
  installCount: 0,
  ratingAverage: null,
}

/**
 * The derived fields a stored listing is missing or holds stale, plus any
 * sort field it lacks, or null when it is current — what a writer's refresh
 * and the backfill write.
 */
export function listingQueryFieldsPatch(
  listing: ListingQuerySource & Record<string, unknown>,
): Record<string, unknown> | null {
  const computed = listingQueryFields(listing)
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(computed)) {
    if (!same(listing[key], value)) patch[key] = value
  }
  for (const [key, value] of Object.entries(LISTING_SORT_DEFAULTS)) {
    if (listing[key] === undefined) patch[key] = value
  }
  return Object.keys(patch).length ? patch : null
}

/*==========================================
 * Browse (public, web SDK).
 *=========================================*/

export type BrowseSort = 'newest' | 'installed' | 'rated'

export const BROWSE_SORTS: Readonly<Record<BrowseSort, ListQuerySort>> = {
  newest: { path: 'createdAt', direction: 'desc' },
  installed: { path: 'installCount', direction: 'desc' },
  rated: { path: 'ratingAverage', direction: 'desc' },
}

/**
 * The browse shelf: a category chip, the search box and three orders, every
 * one on the query. The audience clause is its base (`browseBase`), and the
 * search folds into it.
 */
export const MARKETPLACE_BROWSE_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'category', kind: 'exact', path: 'category', operators: ['equals'] },
  ] satisfies ListFilterField[],
  sorts: [BROWSE_SORTS.newest, BROWSE_SORTS.installed, BROWSE_SORTS.rated],
  search: {
    tokensPath: LISTING_BROWSE_TOKENS,
    scoped: scopedSearch(LISTING_BROWSE_TOKENS),
  },
}

/** The base clause's path, for the index enumeration. */
export const MARKETPLACE_BROWSE_BASE_PATHS = [
  { path: LISTING_BROWSE_AUDIENCE, array: true },
] as const

/**
 * What a reader may see on browse: everything public, plus their own org's
 * listings still in review — narrowed to one publisher on a publisher page.
 */
export function browseBase(
  viewerOrgId: string | null | undefined,
  publisherId?: string | null,
): ListQueryFilter[] {
  const scopes = [BROWSE_EVERYONE, ...(viewerOrgId ? [viewerOrgId] : [])]
  return [
    {
      path: LISTING_BROWSE_AUDIENCE,
      op: 'array-contains-any',
      value: publisherId
        ? scopes.map((scope) => `${scope}${BROWSE_PUBLISHER_JOIN}${publisherId}`)
        : scopes,
    },
  ]
}

/*==========================================
 * Licenses (`marketplacePurchases`, web SDK, buyer/org-gated).
 *=========================================*/

/**
 * Both license tables keep the order they always had — Firestore's, by
 * document id — which index merging serves with no composite at all.
 */
const BY_ID: ListQuerySort = { path: LIST_QUERY_ID_PATH, direction: 'asc' }

/** "This workspace": who on the team bought it. */
export const HELD_LICENCE_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'buyerUid', kind: 'exact', path: 'buyerUid', operators: ['equals'] },
  ] satisfies ListFilterField[],
  sorts: [BY_ID],
}

/**
 * "Bought by you": which workspace a license landed in. A purchase that
 * names none (before AGL-2331) is stored with `buyerOrgId: null` and is
 * asked for as empty.
 */
export const MINE_LICENCE_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'buyerOrgId',
      kind: 'exact',
      path: 'buyerOrgId',
      presence: 'nullable',
      operators: ['equals', 'isEmpty'],
    },
  ] satisfies ListFilterField[],
  sorts: [BY_ID],
}

/** The picked value that means "every workspace" — a purchase naming none. */
export const EVERY_WORKSPACE = 'every'

/**
 * The Licensed-to select's "every workspace" as the query reads it: a
 * purchase whose `buyerOrgId` is null.
 */
export function mineLicenceClauses(
  clauses: readonly ListFilterClause[],
): ListFilterClause[] {
  return clauses.map((clause) =>
    clause.field === 'buyerOrgId' && clause.op === 'equals' && clause.value === EVERY_WORKSPACE
      ? { ...clause, op: 'isEmpty', value: '' }
      : clause,
  )
}

/**
 * At most this many listings are named by one license search: they go on the
 * purchases query as `listingId in [...]`, which Firestore caps at thirty.
 */
export const LICENCE_LISTING_MATCH_CAP = 30

/**
 * The listing-name lookup a license search runs first: the listings whose
 * name has the typed word, by the same token array the staff queue searches.
 */
export const LISTING_NAME_LOOKUP: ListQueryDeclaration = {
  fields: [],
  sorts: [BY_ID],
  search: { tokensPath: LISTING_NAME_TOKENS },
}

/**
 * A license table's scope: its owner clause, live purchases only (a refunded
 * purchase is not a license, AGL-1546), and the listings a search named.
 */
export function licenceBase(
  owner: { path: 'buyerOrgId' | 'buyerUid'; value: string },
  listingIds: readonly string[] | null,
): ListQueryFilter[] {
  return [
    { path: owner.path, op: '==', value: owner.value },
    { path: 'refundedAt', op: '==', value: null },
    ...(listingIds ? [{ path: 'listingId', op: 'in' as const, value: [...listingIds] }] : []),
  ]
}

/*==========================================
 * The staff review queue (Admin SDK, staff route).
 *=========================================*/

/** The queue's Status select, as clauses the query serves. */
export const REVIEW_QUEUE_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'reviewStatus', kind: 'exact', path: 'reviewStatus', operators: ['equals'] },
    { column: LISTING_TAKEN_DOWN, kind: 'boolean', path: LISTING_TAKEN_DOWN },
  ] satisfies ListFilterField[],
  sorts: [BY_ID],
  search: { tokensPath: LISTING_NAME_TOKENS },
}

/** The three sections the queue reads, each its own query. */
export type ReviewQueueSection = 'queue' | 'listed' | 'verification'

/** A listing's newest bytes have no approval: the `latestVersionReviewState` values that mean it. */
export const AWAITING_REVIEW_STATES = ['pending', 'rejected'] as const
export const LISTED_REVIEW_STATUSES = ['listed', 'verified'] as const

/**
 * One section's scope: live plugin listings, narrowed to the section. The
 * Listed section's own `reviewStatus in [...]` steps aside for a Status
 * clause that names one of its two values, and a clause naming any other
 * value leaves the section empty by definition — `null`, never queried.
 */
export function reviewQueueBase(
  section: ReviewQueueSection,
  clauses: readonly ListFilterClause[],
): ListQueryFilter[] | null {
  const base: ListQueryFilter[] = [
    { path: 'type', op: '==', value: 'plugin' },
    { path: 'deletedAt', op: '==', value: null },
  ]
  if (section === 'queue') {
    base.push({
      path: 'latestVersionReviewState',
      op: 'in',
      value: [...AWAITING_REVIEW_STATES],
    })
  } else if (section === 'verification') {
    base.push({ path: 'verificationRequest.state', op: '==', value: 'pending' })
  } else {
    const status = clauses.find(
      (clause) => clause.field === 'reviewStatus' && clause.op === 'equals' && clause.value,
    )
    if (status) {
      if (!(LISTED_REVIEW_STATUSES as readonly string[]).includes(status.value)) return null
    } else {
      base.push({ path: 'reviewStatus', op: 'in', value: [...LISTED_REVIEW_STATUSES] })
    }
  }
  return base
}

/** The queue's Status select as the clause it asks for, or none for "All". */
export function reviewQueueStatusClauses(status: string): ListFilterClause[] {
  if (!status || status === 'all') return []
  if (status === 'hidden') return [{ field: LISTING_TAKEN_DOWN, op: 'is', value: 'true' }]
  return [{ field: 'reviewStatus', op: 'equals', value: status }]
}

/*==========================================
 * The abuse-report queue (Admin SDK, staff route).
 *=========================================*/

export const MARKETPLACE_REPORTS_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'status', kind: 'exact', path: 'status', operators: ['equals'] },
  ] satisfies ListFilterField[],
  sorts: [{ path: 'updatedAt', direction: 'desc' }],
}
