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

import { PUBLISHER_AGREEMENT_VERSION } from '../model/publisher-agreement'
import {
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'

/** One person who may accept the agreement for the org. */
export interface PublisherAgreementAcceptor {
  uid: string
  /** Their name, else their address, else the uid. */
  label: string
  email?: string
}

/**
 * Record the org's acceptance of the version in force (AGL-1077).
 *
 * The one client path to `accept-agreement`, shared by the Publisher Profile
 * card and the dialog a refused action opens (AGL-3407), so an acceptance made
 * in either place is the same request to the same route — one writer, one
 * record shape, one audit. The version is echoed so the server can refuse an
 * acceptance of anything other than the text in force, including one made on
 * a page left open across a change.
 *
 * @returns null on success, or the message to show when it was refused.
 */
export async function acceptPublisherAgreement(
  user: MaybeTokenSource,
  orgId: string,
): Promise<string | null> {
  const response = await authorizedFetch(
    user,
    '/api/marketplace/publisher-profile',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'accept-agreement',
        orgId,
        version: PUBLISHER_AGREEMENT_VERSION,
      }),
    },
  )
  if (response.ok) return null
  const payload = await response.json().catch(() => null)
  return String(payload?.error ?? 'Could not record the acceptance')
}

/**
 * The org's owners and admins — the people the accept route lets bind it
 * (`canActAsPublisher`) — or null when the roster did not answer.
 *
 * Asked of `/api/orgs/members` as a role query rather than read from
 * Firestore: a list of `orgs/{orgId}/members` is refused by the rules for a
 * scoped member, and the route answers any member of the org, which is who
 * may see who else is on the team. Null is not "nobody": it means this
 * client cannot tell, so the caller leaves the decision to the accept route.
 */
export async function fetchPublisherAgreementAcceptors(
  user: MaybeTokenSource,
  orgId: string,
): Promise<PublisherAgreementAcceptor[] | null> {
  const filters = JSON.stringify([
    { field: 'role', op: 'isAnyOf', value: 'owner,admin' },
  ])
  try {
    const response = await authorizedFetch(
      user,
      `/api/orgs/members?orgId=${encodeURIComponent(orgId)}` +
        `&filters=${encodeURIComponent(filters)}`,
    )
    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as {
      members?: unknown
    } | null
    if (!Array.isArray(payload?.members)) return null
    return payload.members.flatMap((raw) => {
      const member = (raw ?? {}) as Record<string, unknown>
      const uid = String(member['$id'] ?? member['uid'] ?? '').trim()
      // The route answers the query; the role is re-read so a roster that
      // ignored the filter can never widen who is shown as able to accept.
      const role = member['role']
      if (!uid || (role !== 'owner' && role !== 'admin')) return []
      const name = String(member['displayName'] ?? '').trim()
      const email = String(member['email'] ?? '').trim()
      return [{ uid, label: name || email || uid, ...(email ? { email } : {}) }]
    })
  } catch {
    return null
  }
}
