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
'use client'

import type { AglynOrgMember } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from './firebase/firebase-services'

/** One team member, as much of them as a picker needs. */
export interface OrgMemberOption {
  /** The account uid — what a record's `ownerUid` stores. */
  uid: string
  /** The name a colleague recognizes: display name, else address, else uid. */
  label: string
  email?: string
}

export interface OrgMemberOptions {
  options: OrgMemberOption[]
  /** The read has answered, one way or the other — false while settling or disabled. */
  ready: boolean
  /** Why the roster is empty, when it is empty because the route refused. */
  error: string | null
}

/**
 * The roster as picker options, sorted by how they read.
 *
 * Exported on its own so the mapping has one definition: a bulk "set owner"
 * on the contacts list and an audience rule's owner filter must show the
 * same names for the same people, or a merchant assigning contacts to "Ada"
 * on one screen would be filtering for "ada@example.com" on the other.
 */
export function orgMemberOptions(
  members: ReadonlyArray<Partial<AglynOrgMember> & { $id: string }>,
): OrgMemberOption[] {
  return members
    .map((member) => ({
      uid: String(member.$id),
      label: String(member.displayName || member.email || member.$id),
      email: member.email ? String(member.email) : undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * THE ORG'S TEAM, for an owner picker on some record's page (AGL-2603).
 *
 * ## Through the members route, not the collection
 *
 * `orgs/{orgId}/members` is readable by an org-wide member and by nobody
 * else: the rules evaluate a list against the QUERY, so a collaborator scoped
 * to one site reading the roster gets `permission-denied`, not a shorter
 * roster. `GET /api/orgs/members?orgId=` re-derives membership with the Admin
 * SDK and answers any member of the org, which is who assigns an owner.
 *
 * ## It is OFF unless a caller asks
 *
 * `enabled` defaults to false, the way `useHostCampaigns` does and for the
 * same reason: the picker this feeds sits on surfaces a reader opens for
 * something else, and a roster fetched on every arrival at the contacts list
 * is a request for a control nobody has opened. Callers turn it on when the
 * owner control is actually on screen.
 *
 * ## A refusal is reported, never rendered as an empty team
 *
 * An org with no members is impossible — it has an owner — so an empty list
 * with no error would always be a lie. `authorizedFetch` refuses to send a
 * request it cannot authorize and answers a 401 carrying the reason; that
 * reason, or the route's own, is what `error` holds.
 */
export function useOrgMemberOptions(
  orgId: string | undefined,
  options?: { enabled?: boolean },
): OrgMemberOptions {
  const enabled = options?.enabled ?? false
  const { data: user } = useUser()
  const [state, setState] = useState<{
    orgId: string | null
    members: OrgMemberOption[]
    error: string | null
  }>({ orgId: null, members: [], error: null })

  useEffect(() => {
    if (!enabled || !orgId) return
    let active = true
    void (async () => {
      let members: OrgMemberOption[] = []
      let error: string | null = null
      try {
        const response = await authorizedFetch(
          user,
          `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          error = String(payload?.error ?? 'The team could not be read.')
        } else {
          members = orgMemberOptions(
            Array.isArray(payload?.members) ? payload.members : [],
          )
        }
      } catch {
        error = 'The team could not be read.'
      }
      if (active) setState({ orgId, members, error })
    })()
    return () => {
      active = false
    }
  }, [enabled, orgId, user])

  return useMemo(
    () => ({
      options: state.orgId === orgId ? state.members : [],
      ready: enabled && Boolean(orgId) && state.orgId === orgId,
      error: state.orgId === orgId ? state.error : null,
    }),
    [state, orgId, enabled],
  )
}

export default useOrgMemberOptions
