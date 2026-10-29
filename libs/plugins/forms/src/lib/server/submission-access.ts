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

import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'

/**
 * Whether a member may read a site's form submissions on the server, asked
 * the way the security rules ask it of the Inbox's own reads (AGL-4098): a
 * verified staff caller; a member of the site (`memberRoles`, the rules'
 * `isHostMember`); or, for a submission filed under an organization, a
 * member of that whole organization (the org Inbox's collection-group read,
 * `isOrgWideMemberOf(resource.data.orgId)`).
 *
 * Reading is all it grants: the Inbox's own reads are site membership, so a
 * submission's files are downloaded on the same terms as its fields are read.
 */
export async function memberMayReadSubmissions(input: {
  uid: string
  staff: boolean
  host: { get(field: string): unknown }
  /** The organization the submission is filed under, when it names one. */
  orgId: string | null
  /** The member's record in that organization, read only when site membership does not answer. */
  orgMember: (orgId: string, uid: string) => Promise<Record<string, unknown> | null>
}): Promise<boolean> {
  if (input.staff) return true
  const roles = (input.host.get('memberRoles') ?? {}) as Record<string, unknown>
  if (roles[input.uid]) return true
  if (!input.orgId) return false
  const member = await input.orgMember(input.orgId, input.uid).catch(() => null)
  return isOrgWideMember(member as never)
}
