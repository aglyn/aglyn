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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'

/** One person a task can be assigned to. */
export interface OrgMemberOption {
  uid: string
  /** Display name, else email, else the uid — never blank. */
  label: string
  email: string
  role: string
}

/**
 * The org's roster, read once per org per page and shared by every mount.
 *
 * The roster is what the assignee picker offers and what the assignee
 * column prints — a uid is not a name anybody recognizes. It comes from
 * `GET /api/orgs/members`, which re-derives membership with the Admin SDK
 * (the client-side rules cannot evaluate a list query against the member's
 * own-document clause, so a direct read is refused for the very people who
 * may assign tasks). A roster changes on the order of days; the promise is
 * kept so a second card on the same page shares the request rather than
 * repeating it.
 */
const rosterCache = new Map<string, Promise<OrgMemberOption[]>>()

/** Test seam. */
export function resetOrgMemberDirectoryCache(): void {
  rosterCache.clear()
}

function memberOption(member: Record<string, unknown>): OrgMemberOption {
  const uid = String(member['$id'] ?? '')
  const email = String(member['email'] ?? '')
  const displayName = String(member['displayName'] ?? '').trim()
  return {
    uid,
    label: displayName || email || uid,
    email,
    role: String(member['role'] ?? ''),
  }
}

export interface OrgMemberDirectory {
  members: OrgMemberOption[]
  /** The read has not settled — the picker disables rather than offers nobody. */
  loading: boolean
  /** Why the roster could not be read, when it could not. */
  error: string | null
  /** A uid as a person, or the uid itself for someone no longer on the roster. */
  nameOf: (uid: string | null | undefined) => string
}

export function useOrgMemberDirectory(
  orgId: string | null | undefined,
): OrgMemberDirectory {
  const { data: user } = useUser()
  const [state, setState] = useState<{
    orgId: string | null
    members: OrgMemberOption[]
    loading: boolean
    error: string | null
  }>({ orgId: null, members: [], loading: false, error: null })

  useEffect(() => {
    if (!orgId || !user) return
    let active = true
    let roster = rosterCache.get(orgId)
    if (!roster) {
      roster = authorizedFetch(
        user,
        `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
      ).then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          members?: Array<Record<string, unknown>>
          error?: string
        }
        if (!response.ok) {
          throw new Error(payload.error || 'The team could not be loaded.')
        }
        return (payload.members ?? [])
          .map(memberOption)
          .filter((member) => Boolean(member.uid))
          .sort((a, b) => a.label.localeCompare(b.label))
      })
      rosterCache.set(orgId, roster)
      // A failed read is not kept: the next mount asks again rather than
      // remembering an outage for the life of the page.
      roster.catch(() => rosterCache.delete(orgId))
    }
    setState({ orgId, members: [], loading: true, error: null })
    roster.then(
      (members) => {
        if (active) setState({ orgId, members, loading: false, error: null })
      },
      (error: unknown) => {
        if (active) {
          setState({
            orgId,
            members: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [orgId, user])

  const members = state.orgId === orgId ? state.members : []
  const nameOf = useCallback(
    (uid: string | null | undefined) => {
      if (!uid) return ''
      return members.find((member) => member.uid === uid)?.label ?? uid
    },
    [members],
  )
  return {
    members,
    loading: Boolean(orgId) && (state.orgId !== orgId || state.loading),
    error: state.orgId === orgId ? state.error : null,
    nameOf,
  }
}
