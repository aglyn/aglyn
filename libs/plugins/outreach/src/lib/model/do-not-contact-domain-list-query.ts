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

import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { OutreachDoNotContactDomainEntry } from './outreach.types'

/*
 * WHAT THE DO-NOT-CONTACT DOMAINS LIST ASKS FIRESTORE (AGL-3321).
 *
 * One query over `orgs/{orgId}/outreachDoNotContactDomains`, alphabetical —
 * the document id IS the domain — paged by that query:
 *
 *   domain  `equals` one domain, on the `domain` field every entry carries
 *           beside its id, lower-cased the way every domain is written; a
 *           prefix is the search box's job, which reads every label;
 *   reason  the stored reason, which every entry carries;
 *   added   the list's ONE range: when the entry was added, which every
 *           entry carries; a range leads the order, so while it applies
 *           the list is newest added first;
 *   search  `searchTokens`: the domain, each shorter domain inside it and
 *           each of its labels, and the words of its detail, stamped when
 *           the entry is created.
 *
 * Without the range every shape is equalities and the one array clause,
 * ordered by the document id, which Firestore serves by merging
 * single-field indexes. The range's order needs one composite per
 * equality field beside it: `reason` and `searchTokens`.
 */

/** The array the search box reads, stamped by the one writer that adds a domain. */
export const OUTREACH_DOMAIN_SEARCH_TOKENS = 'searchTokens'

export const OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'domain', kind: 'text', path: 'domain', lowerPath: 'domain', operators: ['equals'] },
    { column: 'reason', kind: 'exact', path: 'reason', presence: 'always', operators: ['equals', 'isAnyOf'] },
    {
      column: 'addedAtMs',
      kind: 'date',
      path: 'addedAtMs',
      storedAs: 'millis',
      presence: 'always',
      operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
    },
  ],
  /*
   * The headers (AGL-3680). A domain IS its document id, so Domain orders by
   * the id, alphabetical first as the list always was. Why, Added and Detail
   * are on every entry — the one writer stamps `reason`, `addedAtMs` and
   * `detail` (null when none) — and order the query `alone`: on this
   * unscoped collection that costs no composite. Added newest first is also
   * the order its date range imposes.
   */
  sorts: [
    { path: LIST_QUERY_ID_PATH, direction: 'asc', column: 'domain', label: 'Domain' },
    { path: LIST_QUERY_ID_PATH, direction: 'desc', column: 'domain', label: 'Domain', alone: true },
    { path: 'reason', direction: 'asc', column: 'reason', label: 'Why', alone: true },
    { path: 'reason', direction: 'desc', column: 'reason', label: 'Why', alone: true },
    { path: 'addedAtMs', direction: 'desc', column: 'addedAtMs', label: 'Added', alone: true },
    { path: 'addedAtMs', direction: 'asc', column: 'addedAtMs', label: 'Added', alone: true },
    { path: 'detail', direction: 'asc', column: 'detail', label: 'Detail', alone: true },
    { path: 'detail', direction: 'desc', column: 'detail', label: 'Detail', alone: true },
  ],
  search: { tokensPath: OUTREACH_DOMAIN_SEARCH_TOKENS },
}

/**
 * What the domains list searches an entry by: every prefix of the domain
 * whole and of each shorter domain inside it, of each of its labels, and of
 * each word of its detail — so "acme", "acme.com" and "mail.ac" all find
 * `mail.acme.com`, and "barracuda" finds the domain a gateway block filed.
 * An entry is created once and never edited, so its one writer stamps this
 * and `tools/scripts/backfill-outreach-list-search.mjs` restates it for the
 * entries made before it; both are held to
 * `tools/scripts/lib/outreach-search-tokens.fixtures.json`.
 */
export function outreachDomainSearchTokens(
  entry: Pick<OutreachDoNotContactDomainEntry, 'domain' | 'detail'>,
): string[] {
  const domain = String(entry.domain ?? '')
  const labels = domain.split('.')
  const within = labels.map((_, at) => labels.slice(at).join('.'))
  return nameSearchTokens([...within, ...domain.split(/[.-]+/), entry.detail ?? ''].join(' '))
}
