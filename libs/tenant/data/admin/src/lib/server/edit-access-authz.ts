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

import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore'
import { lockdownRefusal } from './lockdown'
import { getOrgDoc } from './organizations'
import { isServerReleaseFlagOnForOrg } from './release-flags'

/**
 * THE authorization gate for minting an edit-access token — extracted
 * verbatim from the console's `/api/edit-access/token` (AGL-1302 follow-on)
 * so the tenant's `/api/edit-access/exchange` (AGL-1842) evaluates the SAME
 * question the same way, rather than growing a second authorization path
 * that would drift from the first.
 *
 * The gate, in order:
 *
 * 1. `release_edit_bar` for the host's org — dark until released, and the
 *    kill switch for the whole surface;
 * 2. org roster membership — proven against the host the CALLER was already
 *    resolved to, never a caller-supplied orgId;
 * 3. the co-editing edit gate, verbatim from the presence broker: host
 *    `memberRoles` admin/editor, or an org roster role above viewer. A
 *    viewer gets a plain 403 rather than a read-only bar;
 * 4. the lockdown verdict (AGL-1506) at `intent: 'write'` — the reasoning
 *    for `write` on a stateless mint is recorded at length where this code
 *    came from and holds unchanged: the token buys entry to an editor whose
 *    saves a read-only lock denies, and it outlives this check by its TTL.
 *
 * Returns the refusal Response to send, or `null` when the uid may edit the
 * host. Callers verify WHO the uid is first (a Firebase ID token at the
 * console, a signed hint at the tenant exchange) — identity is the caller's
 * business; permission is this function's.
 */
export async function editAccessMintRefusal(options: {
  request: Request
  firestore: Firestore
  /** The `hosts/{hostId}` snapshot, already confirmed to exist. */
  host: DocumentSnapshot
  orgId: string
  uid: string
  /** From verified ID-token claims; a hint carries none, so it stays false. */
  staff?: boolean
}): Promise<Response | null> {
  const { request, firestore, host, orgId, uid, staff = false } = options

  if (!(await isServerReleaseFlagOnForOrg('release_edit_bar', orgId))) {
    return Response.json({ error: 'Not available' }, { status: 404 })
  }

  const membership = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(uid)
    .get()
  if (!membership.exists) {
    return Response.json({ error: 'Not a member of this site' }, { status: 403 })
  }

  const hostRole = ((host.get('memberRoles') ?? {}) as Record<string, string>)[
    uid
  ]
  const orgRole = membership.get('role') as string | undefined
  const canEdit =
    hostRole === 'admin' ||
    hostRole === 'editor' ||
    orgRole === 'owner' ||
    orgRole === 'admin' ||
    orgRole === 'editor'
  if (!canEdit) {
    return Response.json({ error: 'No edit access' }, { status: 403 })
  }

  // Host doc already in hand; the org scope rides the member doc's
  // `orgSuspended` projection (also already read) — the org doc is fetched
  // only when the projection trips, so the happy path adds no org read.
  return lockdownRefusal({
    request,
    intent: 'write',
    staff,
    uid,
    org:
      membership.get('orgSuspended') === true
        ? ((await getOrgDoc(orgId)) ?? {})
        : undefined,
    host: host.data(),
  })
}
