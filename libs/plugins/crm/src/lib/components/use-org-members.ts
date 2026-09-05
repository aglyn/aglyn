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

import {
  authorizedFetch,
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { resolveUserName, useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** One team member, as an owner picker lists them. */
export interface OrgMemberOption {
  uid: string
  label: string
}

export interface OrgMembers {
  /** Every member of the workspace, by name. */
  options: OrgMemberOption[]
  /** The roster has answered — an empty list is then a real answer. */
  ready: boolean
  /** The name to show for a uid: the roster's, or the uid when it is unknown. */
  memberName: (uid: string) => string
}

/**
 * A roster row as the picker shows it.
 *
 * The same resolution order `useUserName` uses for the signed-in person:
 * the roster's `displayName` is the profile copy the members surface keeps
 * (SSO accounts carry none on the auth record), the email is what a surface
 * shows when nothing else exists, and the uid is the floor — a row must be
 * NAMED, because an owner picker with a blank entry is a row nobody can pick
 * on purpose.
 */
function rosterOption(member: Record<string, unknown>): OrgMemberOption | null {
  const uid = String(member['$id'] ?? member['uid'] ?? '')
  if (!uid) return null
  const label =
    resolveUserName({
      authDisplayName: member['displayName'] as string | undefined,
      email: member['email'] as string | undefined,
    }) || uid
  return { uid, label }
}

/**
 * THE WORKSPACE'S ROSTER, for picking and naming a contact's owner
 * (AGL-2596).
 *
 * Read through `/api/orgs/members`, not from Firestore: the roster is
 * evaluated against the QUERY by the rules, and a scoped member's read of
 * `orgs/{orgId}/members` is refused for exactly the shape the owner picker
 * needs — every row. The route re-derives membership with the Admin SDK and
 * answers any member of the org, which is who may see who else is on the
 * team.
 *
 * Read only when ASKED — `enabled` — and once per workspace for the life of
 * the mount. The list of contacts does not need the roster until a row
 * carries an owner or the create drawer opens, and a request per mount of a
 * page that may never show a name is a read paid for nothing.
 */
export function useOrgMembers(
  orgId: string | null | undefined,
  options: { enabled?: boolean } = {},
): OrgMembers {
  const enabled = options.enabled ?? false
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [loaded, setLoaded] = useState<{
    orgId: string
    options: OrgMemberOption[]
  } | null>(null)
  const loadedOrgId = loaded?.orgId ?? null

  useEffect(() => {
    if (!enabled || !orgId || loadedOrgId === orgId) return undefined
    let active = true
    void authorizedFetch(
      userRef.current as TokenSource | null | undefined,
      `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
    )
      .then(async (response) =>
        response.ok ? ((await response.json()) as { members?: unknown[] }) : {},
      )
      .then((json) => {
        if (!active) return
        const members = Array.isArray(json?.members) ? json.members : []
        setLoaded({
          orgId,
          options: members
            .map((member) => rosterOption((member ?? {}) as Record<string, unknown>))
            .filter((option): option is OrgMemberOption => option !== null)
            .sort((a, b) => a.label.localeCompare(b.label)),
        })
      })
      .catch(() => {
        // An unanswered roster is an EMPTY picker, not a broken page: the
        // owner column falls back to the uid, and the picker says it has
        // nobody to offer.
        if (active) setLoaded({ orgId, options: [] })
      })
    return () => {
      active = false
    }
  }, [enabled, orgId, loadedOrgId])

  const current = loaded && loaded.orgId === orgId ? loaded : null
  const byUid = useMemo(
    () => new Map((current?.options ?? []).map((option) => [option.uid, option.label])),
    [current],
  )
  const memberName = useCallback(
    (uid: string) => byUid.get(uid) ?? uid,
    [byUid],
  )
  return {
    options: current?.options ?? [],
    ready: current !== null,
    memberName,
  }
}

export default useOrgMembers
