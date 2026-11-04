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

import { type CrmMemberOption, crmMemberOption, findOrgMember } from '@aglyn/aglyn'
import { authorizedFetch, type TokenSource } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'

/** One person a task can be assigned to. */
export interface OrgMemberOption extends CrmMemberOption {
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

/** The one empty roster, so a caller's memo does not change on every render while it loads. */
const NO_MEMBERS: OrgMemberOption[] = []

/** Tries per roster read, and the wait before each retry. */
const ROSTER_ATTEMPTS = 3
const ROSTER_RETRY_MS = 1_000

/**
 * A failure that may answer differently a moment later: the request never
 * went out because the sign-in token was not ready in time (`authorizedFetch`
 * answers that `401` itself), the route timed out, was busy, or failed. A
 * `403` (not a member), `400` or `423` (locked) will not change by asking
 * again.
 */
const RETRYABLE_STATUSES = new Set([401, 408, 429])

class RosterReadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

function memberOption(member: Record<string, unknown>): OrgMemberOption | null {
  const option = crmMemberOption(member)
  return option ? { ...option, role: String(member['role'] ?? '') } : null
}

async function readRosterOnce(user: TokenSource, orgId: string): Promise<OrgMemberOption[]> {
  const response = await authorizedFetch(
    user,
    `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
  )
  const payload = (await response.json().catch(() => ({}))) as {
    members?: Array<Record<string, unknown>>
    error?: string
  }
  if (!response.ok) {
    throw new RosterReadError(
      payload.error || 'The team could not be loaded.',
      RETRYABLE_STATUSES.has(response.status) || response.status >= 500,
    )
  }
  return (payload.members ?? [])
    .map(memberOption)
    .filter((member): member is OrgMemberOption => member !== null)
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The roster, asked again when the first answer was a failure that can
 * clear. A page that loses the read keeps naming owners by their uid until
 * it is reloaded, so one late token or one busy moment on the route must not
 * be the final answer.
 */
async function readRoster(user: TokenSource, orgId: string): Promise<OrgMemberOption[]> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await readRosterOnce(user, orgId)
    } catch (error) {
      const retryable = !(error instanceof RosterReadError) || error.retryable
      if (!retryable || attempt >= ROSTER_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, ROSTER_RETRY_MS * attempt))
    }
  }
}

export interface OrgMemberDirectory {
  members: OrgMemberOption[]
  /** The read has not settled — the picker disables rather than offers nobody. */
  loading: boolean
  /** Why the roster could not be read, when it could not. */
  error: string | null
  /**
   * A stored reference — a uid, or an address the roster has — as a person,
   * or the reference itself for someone no longer on the roster.
   */
  nameOf: (ref: string | null | undefined) => string
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
  }>({ orgId: null, members: NO_MEMBERS, loading: false, error: null })

  useEffect(() => {
    if (!orgId || !user) return
    let active = true
    let roster = rosterCache.get(orgId)
    if (!roster) {
      roster = readRoster(user, orgId)
      rosterCache.set(orgId, roster)
      // A failed read is not kept: the next mount asks again rather than
      // remembering an outage for the life of the page.
      roster.catch(() => rosterCache.delete(orgId))
    }
    setState({ orgId, members: NO_MEMBERS, loading: true, error: null })
    roster.then(
      (members) => {
        if (active) setState({ orgId, members, loading: false, error: null })
      },
      (error: unknown) => {
        if (active) {
          setState({
            orgId,
            members: NO_MEMBERS,
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

  const members = state.orgId === orgId ? state.members : NO_MEMBERS
  const nameOf = useCallback(
    (ref: string | null | undefined) => {
      if (!ref) return ''
      return findOrgMember(members, ref)?.label ?? ref
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
