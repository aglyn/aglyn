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

import { type CrmMemberOption, findOrgMember } from '@aglyn/aglyn'
import { useCallback } from 'react'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'

/** One team member, as an owner picker lists them. */
export type OrgMemberOption = CrmMemberOption

export interface OrgMembers {
  /** Every member of the workspace, by name. */
  options: OrgMemberOption[]
  /** The roster has answered — an empty list is then a real answer. */
  ready: boolean
  /**
   * The name to show for a stored reference — a uid, or an address the
   * roster has — or the reference itself when the roster does not know it.
   */
  memberName: (ref: string) => string
  /**
   * The member's ADDRESS for a stored reference — what a CSV export writes
   * in the owner column, because the import resolves an owner by email —
   * falling back to the name and then to the reference itself.
   */
  memberEmail: (ref: string) => string
}

/**
 * THE WORKSPACE'S ROSTER, for picking and naming a contact's owner
 * (AGL-2596).
 *
 * The same read the deal and task cards name their owners and assignees
 * with, {@link useOrgMemberDirectory}: `/api/orgs/members`, not Firestore,
 * because a scoped member's read of `orgs/{orgId}/members` is refused for
 * exactly the shape the owner picker needs, every row. One request per
 * workspace for the life of the page, shared by every card that names a
 * teammate.
 *
 * This hook used to make its own request, once per mount, with whatever
 * sign-in it had at that moment, and kept a failed answer as the roster. A
 * contact page whose one request failed (the token not ready yet, a busy
 * route) named its owner by uid until it was reloaded, while the deal page
 * beside it, reading through the directory, named the same person. The
 * directory waits for the signed-in user and asks again after a failure that
 * can clear.
 *
 * Read only when ASKED — `enabled`. The list of contacts does not need the
 * roster until a row carries an owner or the create drawer opens, and a
 * request for a page that may never show a name is a read paid for nothing.
 */
export function useOrgMembers(
  orgId: string | null | undefined,
  options: { enabled?: boolean } = {},
): OrgMembers {
  const enabled = options.enabled ?? false
  const directory = useOrgMemberDirectory(enabled ? orgId : null)
  const { members, nameOf } = directory
  const memberEmail = useCallback(
    (ref: string) => {
      const member = findOrgMember(members, ref)
      return member?.email || member?.label || ref
    },
    [members],
  )
  return {
    options: members,
    // An unanswered roster is an EMPTY picker, not a broken page: the owner
    // column falls back to the uid, and the picker says it has nobody to
    // offer.
    ready: enabled && Boolean(orgId) && !directory.loading,
    memberName: nameOf,
    memberEmail,
  }
}

export default useOrgMembers
