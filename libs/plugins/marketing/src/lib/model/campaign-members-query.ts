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

import { CAMPAIGN_MEMBERSHIP_FIELD } from '@aglyn/aglyn/app-utils/campaign-membership'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT A CAMPAIGN'S SCREENS AND FORMS LISTS ASK FIRESTORE (AGL-3321).
 *
 * A campaign's page lists the screens and the forms filed under it, each a
 * table paged by its own query over `hosts/{hostId}/screens` or `/forms`.
 * The search box and the soft delete are predicates on that query, so a
 * member on the fourth page is found and a deleted one is never a row.
 *
 * ## The base: the membership, and (for screens) not deleted
 *
 * `campaignIds array-contains {campaign}` is the join — the member's own
 * field, read from the other end — and it is the query's ONE array clause.
 *
 * A screen is soft-deleted: a delete stamps `deletedAt` and leaves the
 * document, with its campaigns, in place. So the screens query also asks
 * `deletedAt == null`, which matches only a document that HOLDS the field:
 * every screen create stamps `deletedAt: null` (`artifactCreateListKeys`),
 * and `tools/scripts/backfill-artifacts-list-keys.mjs` stamps the screens
 * written before it. A form has no soft delete — it is deleted outright —
 * so its base is the membership alone, and a retired form stays a member.
 *
 * Unsearched, both lists walk the document name, which every record has:
 * the equality and the array clause merge on Firestore's single-field
 * indexes, so the default read needs no composite.
 *
 * ## The search is a PREFIX RANGE on `nameLower`
 *
 * A word search is an `array-contains` on `nameTokens`, and the membership
 * has already spent the query's one array clause. So the search matches the
 * START of the name — `nameLower` from the typed text to the text followed
 * by the highest character — which is a range, orders the page by name while
 * it applies, and is said above the table (`CAMPAIGN_MEMBERS_SEARCH_NOTICE`),
 * as a site's campaigns list says it.
 *
 * ## The composites: two
 *
 * A range beside equalities needs a composite. Under index merging this
 * shape would take one `(predicate, nameLower)` pair per predicate — three
 * across the two collections — so each collection instead carries the ONE
 * composite that serves its whole search shape:
 *
 *   screens  campaignIds CONTAINS, deletedAt ASC, nameLower ASC
 *   forms    campaignIds CONTAINS, nameLower ASC
 *
 * Pinned by `list-query-indexes.spec.ts`. Nothing else is offered: a column
 * filter would be one more predicate beside the range, and so one more
 * composite per collection, for lists that hold a campaign's handful of
 * pages and forms.
 */

/** The name field the search ranges over, as the planner reads it. */
const MEMBER_NAME: ListFilterField = {
  column: 'name',
  kind: 'text',
  path: 'displayName',
  lowerPath: 'nameLower',
  operators: ['startsWith'],
}

/** A campaign's screens or forms: the name's start, walked by document name. */
export const CAMPAIGN_MEMBERS_QUERY: ListQueryDeclaration = {
  fields: [MEMBER_NAME],
  sorts: [{ path: LIST_QUERY_ID_PATH, direction: 'asc' }],
}

/** The collections a campaign's members are read from. */
export type CampaignMemberCollection = 'screens' | 'forms'

/** A screen that has not been deleted: `deletedAt` stored as `null`. */
export const SCREEN_NOT_DELETED: ListQueryFilter = {
  path: 'deletedAt',
  op: '==',
  value: null,
}

/**
 * The predicates every read of a campaign's members carries: the
 * membership, and for screens the soft delete.
 */
export function campaignMembersBase(
  collection: CampaignMemberCollection,
  campaignId: string,
): ListQueryFilter[] {
  return [
    { path: CAMPAIGN_MEMBERSHIP_FIELD, op: 'array-contains', value: campaignId },
    ...(collection === 'screens' ? [SCREEN_NOT_DELETED] : []),
  ]
}

/** Said above a member table while its search applies. */
export const CAMPAIGN_MEMBERS_SEARCH_NOTICE =
  'Search here matches the start of a name.'

/**
 * The search box's words as the clause the query serves: "Name starts
 * with", or null when nothing was typed. The table passes it among its
 * clauses and no search words — see the file header for why.
 */
export function campaignMembersSearchClause(
  words: readonly string[],
): ListFilterClause | null {
  const typed = words
    .map((word) => word.trim())
    .filter(Boolean)
    .join(' ')
  return typed ? { field: 'name', op: 'startsWith', value: typed } : null
}
