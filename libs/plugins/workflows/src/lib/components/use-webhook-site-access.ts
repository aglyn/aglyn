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

import { resolveSiteRolePresetPermissions } from '@aglyn/aglyn/app-utils/host-permissions'
import { permissionRefusalText, type AglynOrgCustomRole } from '@aglyn/aglyn/app-utils/org-permissions'
import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'

/** "See orders and webhooks": what the rules ask of a site's `webhooks`. */
export const WEBHOOKS_PERMISSION = 'site.sensitive'

/** What a member without it is told, naming the permission. */
export const WEBHOOKS_REFUSAL = permissionRefusalText(WEBHOOKS_PERMISSION)

/** The reader's standing for each site's webhooks. */
export interface WebhookSiteAccess {
  /** True once the answer is in. Until then nothing is opened or refused. */
  known: boolean
  /** The read behind the answer failed, so nothing can be said about any site. */
  errored: boolean
  /** May the reader read this site's webhooks? */
  holds(hostId: string): boolean
}

const HOLDS_NOTHING = () => false
const HOLDS_EVERYTHING = () => true

/**
 * Which sites' webhooks the signed-in member may read (AGL-4047), the rule's
 * `canReadHostSensitive`: the key decided per site, so an editor narrowed on one
 * site and a viewer raised on another each get the answer the rule gives them.
 *
 * Resolved by the function the site's `memberPermissions` stamp is written from,
 * so a workspace of many sites pays for no host document: the membership holds
 * the site roles, the site toggles and the member's overrides. A member of the
 * whole workspace on a custom role pays one more read, of that role. A reader
 * with no membership is staff, whom the rule admits.
 */
export function useWebhookSiteAccess(orgId: string | null | undefined): WebhookSiteAccess {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const member = useFirestoreDoc<AglynOrgMember & { roleId?: string | null }>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  const roleId =
    member.status === 'success' && member.data && isOrgWideMember(member.data) ? (member.data.roleId ?? '') : ''
  const role = useFirestoreDoc<AglynOrgCustomRole>(
    () => (orgId && roleId ? doc(firestore, 'orgs', orgId, 'roles', roleId) : null),
    [firestore, orgId, roleId],
  )
  if (member.status === 'error' || (roleId && role.status === 'error')) {
    return { known: false, errored: true, holds: HOLDS_NOTHING }
  }
  // The cache answers "missing" for a document it has never held; only the
  // server says a reader has no membership.
  const unsettled = member.status !== 'success' || (!member.data && member.fromCache)
  if (unsettled || (roleId && role.status !== 'success')) {
    return { known: false, errored: false, holds: HOLDS_NOTHING }
  }
  const held = member.data
  if (!held) return { known: true, errored: false, holds: HOLDS_EVERYTHING }
  const customRole = roleId ? (role.data ?? null) : null
  return {
    known: true,
    errored: false,
    holds: (hostId) =>
      resolveSiteRolePresetPermissions(held, hostId as never, customRole)[WEBHOOKS_PERMISSION] === true,
  }
}
