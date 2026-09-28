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

import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT THE SEQUENCES LIST ASKS FIRESTORE (AGL-3321).
 *
 * Every clause the list's Filters panel offers, and its search box, is a
 * predicate on ONE query over `orgs/{orgId}/outreachSequences`, newest
 * first, paged by that query — never a match over the sequences a read
 * happened to hold. Each field is here because a query can serve it:
 *
 *   name     `contains` a word (the `nameTokens` array) or `equals` the
 *            whole name (`nameLower`), both stamped by the save route —
 *            the one write that sets a name — through `nameSearchFields`,
 *            and by `tools/scripts/backfill-outreach-list-search.mjs` for
 *            the sequences saved before them;
 *   mailbox  the sequence's `mailboxId`, picked from the org's mailboxes —
 *            the column shows the address, the query asks by id;
 *   status   the stored status, which every sequence carries;
 *   created  the list's ONE range: when the sequence was first saved.
 *
 * The one order is `createdAtMs` descending, which the save route stamps on
 * every sequence, and the range is over that same field — a range leads the
 * order, and here it already does, so it costs no index of its own. A range
 * on any other field would reorder the list by it and need a composite per
 * field above under that order as well.
 */

/** The array `contains` and the search box read: every word's prefixes. */
export const OUTREACH_SEQUENCE_NAME_TOKENS = 'nameTokens'
/** The lower-cased whole name `equals` reads. */
export const OUTREACH_SEQUENCE_NAME_LOWER = 'nameLower'

export const OUTREACH_SEQUENCE_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'name',
      kind: 'text',
      path: 'name',
      lowerPath: OUTREACH_SEQUENCE_NAME_LOWER,
      tokensPath: OUTREACH_SEQUENCE_NAME_TOKENS,
      operators: ['contains', 'equals'],
    },
    { column: 'mailbox', kind: 'exact', path: 'mailboxId', operators: ['equals', 'isAnyOf'] },
    { column: 'status', kind: 'exact', path: 'status', presence: 'always', operators: ['equals', 'isAnyOf'] },
    {
      column: 'created',
      kind: 'date',
      path: 'createdAtMs',
      storedAs: 'millis',
      presence: 'always',
      operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
    },
  ],
  sorts: [{ path: 'createdAtMs', direction: 'desc' }],
  search: { tokensPath: OUTREACH_SEQUENCE_NAME_TOKENS },
}
