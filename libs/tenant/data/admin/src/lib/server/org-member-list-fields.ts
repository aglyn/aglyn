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

import { addressSearchWords } from '@aglyn/aglyn/app-utils/activity-search'
import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import type { AglynOrgMember } from '@aglyn/aglyn/server'
import { consoleUserType } from '@aglyn/aglyn/app-utils/organizations'

/*
 * WHAT THE TEAM ROSTER IS FILTERED AND SEARCHED BY (AGL-3321).
 *
 * The organization's member list (`orgs/{orgId}/members`, the Members card
 * in organization settings) filters by Role and by Access, and searches a
 * member's name, address and job title — all on the roster's Firestore query
 * (`GET /api/orgs/members` with `filters` or `search`). Two of those are not
 * stored as such on a member document, so every member carries them:
 *
 *   consoleUserType  `manager` or `collaborator`, as `consoleUserType` reads
 *                    the member's reach. That verdict is DERIVED — a legacy
 *                    member with neither `allHosts` nor `hostAccess` is a
 *                    manager — so a query cannot ask the raw fields for it.
 *   searchTokens     the word-prefix tokens of the display name, the address
 *                    (its halves and its runs, `addressSearchWords`) and the
 *                    job title.
 *
 * Stamped by `syncOrgAuthProjections` — the pass every membership write
 * already reaches, which recomputes the rules projection on the same
 * documents — by `createOrganization` for the owner it creates, and by
 * `backfillMemberIdentity` when it fills a blank name.
 * `tools/scripts/backfill-org-member-list-fields.mjs` stamps the roster
 * written before AGL-3321, through its script-side twin, held to
 * `tools/scripts/lib/org-member-list-fields.fixtures.json`.
 *
 * A list mirror, not an authority: nothing decides access from these.
 */

/** The member fields `orgMemberListFields` derives from. */
export type OrgMemberListSource = Pick<
  Partial<AglynOrgMember>,
  'role' | 'allHosts' | 'hostAccess' | 'displayName' | 'email'
> & {
  /** The job title the members route stores (AGL-364). */
  title?: unknown
}

/** The words the roster's search box finds a member by. */
export function orgMemberSearchTokens(member: OrgMemberListSource | null | undefined): string[] {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return nameSearchTokens(
    [
      text(member?.displayName),
      ...addressSearchWords(member?.email),
      text(member?.title),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

/** Every field the roster's query reads that a member does not store as such. */
export function orgMemberListFields(member: OrgMemberListSource | null | undefined): {
  consoleUserType: 'manager' | 'collaborator'
  searchTokens: string[]
} {
  return {
    consoleUserType: consoleUserType(member),
    searchTokens: orgMemberSearchTokens(member),
  }
}

/** The fields `orgMemberListFields` writes, for a `mergeFields` write. */
export const ORG_MEMBER_LIST_FIELD_NAMES = ['consoleUserType', 'searchTokens'] as const
