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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useMemo, useState } from 'react'

/** One teammate, as the owner picker and the avatars read them. */
export interface OrgMemberEntry {
  uid: string
  /** `displayName`, else the email, else the uid — never empty. */
  label: string
  email: string
}

interface DirectoryState {
  members: OrgMemberEntry[]
  ready: boolean
}

/**
 * One roster fetch per org per page load, shared by every reader.
 *
 * The board draws an avatar on every card, the table a name on every row,
 * the drawer a picker, the detail page an owner line — and a roster read per
 * component would be five requests for one list. The promise is cached by
 * org so the first reader pays and the rest join it; a later mount of the
 * same org reuses the answer rather than asking again.
 */
const directories = new Map<string, Promise<OrgMemberEntry[]>>()

function memberLabel(entry: Record<string, unknown>): string {
  const displayName = String(entry['displayName'] ?? '').trim()
  const email = String(entry['email'] ?? '').trim()
  return displayName || email || String(entry['$id'] ?? entry['uid'] ?? '')
}

async function loadDirectory(
  user: Parameters<typeof authorizedFetch>[0],
  orgId: string,
): Promise<OrgMemberEntry[]> {
  const response = await authorizedFetch(
    user,
    `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
  )
  if (!response.ok) return []
  const payload = (await response.json().catch(() => ({}))) as {
    members?: Array<Record<string, unknown>>
  }
  return (payload.members ?? [])
    .map((entry) => ({
      uid: String(entry['$id'] ?? entry['uid'] ?? ''),
      label: memberLabel(entry),
      email: String(entry['email'] ?? '').trim(),
    }))
    .filter((entry) => entry.uid)
    .sort((left, right) => left.label.localeCompare(right.label))
}

/**
 * The org's members, for an owner picker and for naming an `ownerUid`.
 *
 * `GET /api/orgs/members` rather than a Firestore listen on the roster: the
 * roster's read rule is evaluated per document and a list query cannot
 * satisfy it, so the route is the one reader that can hand back the whole
 * team. Anybody who is a member of the org may call it, which is everybody
 * who can open the CRM.
 *
 * A failed fetch resolves to an empty roster with `ready: true`, so an owner
 * picker on a workspace whose roster cannot be read shows "nobody to pick"
 * rather than a spinner that never stops — and the uid stays on the deal
 * either way, drawn as its initials.
 */
export function useOrgMemberDirectory(
  orgId: string | null | undefined,
): DirectoryState & {
  /** The label for a uid, or the uid itself when the roster lacks it. */
  labelFor: (uid: string | undefined) => string
} {
  const { data: user } = useUser()
  const [state, setState] = useState<DirectoryState>({
    members: [],
    ready: false,
  })

  useEffect(() => {
    if (!orgId || !user) return
    let active = true
    let pending = directories.get(orgId)
    if (!pending) {
      pending = loadDirectory(user, orgId).catch(() => [])
      directories.set(orgId, pending)
    }
    void pending.then((members) => {
      if (active) setState({ members, ready: true })
    })
    return () => {
      active = false
    }
  }, [orgId, user])

  return useMemo(() => {
    const byUid = new Map(state.members.map((entry) => [entry.uid, entry]))
    return {
      ...state,
      labelFor: (uid: string | undefined) =>
        uid ? (byUid.get(uid)?.label ?? uid) : '',
    }
  }, [state])
}

/** Test seam: forget every cached roster. */
export function resetOrgMemberDirectories(): void {
  directories.clear()
}
