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

import type { AglynOrgMember } from '@aglyn/aglyn/server'
import {
  describeScope,
  hostScopeToken,
  isOrgWideMember,
  isOrgWideScope,
  projectMemberScopeTokens,
  visibleToTokens,
} from '@aglyn/aglyn/server'

/**
 * Whether a caller may recursively delete an org-scoped resource, and
 * whether this is the right place to do it (AGL-1046).
 *
 * Lives beside the route rather than inside it for two reasons: `route.ts`
 * may only export handlers, and a destructive decision that cannot be
 * unit-tested is the shape of control this project exists to avoid
 * (`feedback_verify_control_is_wired`). Pure — the route does the reads.
 */
export interface EraseScopeInput {
  /** The target's `visibleTo`; undefined means the legacy org-wide case. */
  visibleTo: readonly string[] | undefined
  /** The caller's org member doc. */
  member: Partial<AglynOrgMember> | undefined
  /** Site the delete was issued from, if any. A hint, not a credential. */
  fromHostId?: string
  /** Human label for messages — "Dataset", "List". */
  label: string
  /** False when the target document does not exist. */
  exists: boolean
}

export interface EraseScopeDenial {
  error: string
  status: 404 | 409
}

/**
 * Null when the erase may proceed; otherwise the response to return.
 *
 * Two independent checks, in order of severity:
 *
 * 1. **The boundary.** A site collaborator is an org member doc with role
 *    `editor`, so the route's role gate admits them. Without this they
 *    could `recursiveDelete` any dataset or list in the org — including
 *    ones AGL-1041 forbids them to READ. The Admin SDK evaluates no rules,
 *    so the check `canWriteScopedOrgData()` performs for a client delete
 *    has to be repeated here. Denials are reported as 404, not 403: a
 *    scoped member should not learn that an id they cannot see resolves to
 *    something real.
 *
 * 2. **The shared-resource rail.** Deleting from a SITE page reads as
 *    "remove this from my site", but a resource shared org-wide or with
 *    several sites is not one site's to destroy, and the cascade takes
 *    every record with it. The wanted operation is narrowing the scope.
 *    An org-wide delete is still available from the workspace Data page,
 *    which sends no `fromHostId`.
 */
export function eraseScopeDenial(
  input: EraseScopeInput,
): EraseScopeDenial | null {
  const { visibleTo, member, fromHostId, label, exists } = input
  if (!exists) return null

  if (!isOrgWideMember(member)) {
    const tokens = member?.scopeTokens?.length
      ? member.scopeTokens
      : projectMemberScopeTokens(member)
    if (!visibleToTokens(visibleTo, tokens)) {
      return { error: `${label} not found`, status: 404 }
    }
  }

  if (!fromHostId) return null
  const thisSiteOnly =
    visibleTo?.length === 1 && visibleTo[0] === hostScopeToken(fromHostId)
  if (thisSiteOnly) return null

  const noun = label.toLowerCase()
  return {
    status: 409,
    error: isOrgWideScope(visibleTo)
      ? `This ${noun} is shared with every site in the workspace. Delete it from the workspace Data page, or change its sharing to this site only first.`
      : `This ${noun} is shared with ${describeScope(visibleTo)}. Remove this site from its sharing instead of deleting it.`,
  }
}

export default eraseScopeDenial
