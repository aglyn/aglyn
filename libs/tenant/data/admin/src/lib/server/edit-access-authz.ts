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

import {
  type AglynOrgMember,
  hostRoleCanWrite,
  hostRoleFor,
  isOrgWideMember,
} from '@aglyn/aglyn/server'
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
 * 1. `release_edit_bar` for the host's org — on for every site since its
 *    release (AGL-3041), and the kill switch for the whole surface, for
 *    everyone or for one org by staff override;
 * 2. org roster membership — proven against the host the CALLER was already
 *    resolved to, never a caller-supplied orgId;
 * 3. the co-editing edit gate the presence broker applies, for THIS host: a
 *    host role that may write content (admin, editor or author), from the
 *    host's `memberRoles` or the member's own `hostAccess`, or an org role
 *    above viewer held org-wide (AGL-3062). A viewer gets a plain 403 rather
 *    than a read-only bar;
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
  if (!(await isServerReleaseFlagOnForOrg('release_edit_bar', options.orgId))) {
    return Response.json({ error: 'Not available' }, { status: 404 })
  }
  return hostContentEditRefusal(options)
}

/**
 * Steps 2–4 of the gate above, WITHOUT the edit-bar release flag (AGL-3205).
 *
 * "May this uid edit this host's content?" is a question more than one feature
 * asks. The live-site preview of an unpublished entry asks it — the link it
 * mints reveals a post the public cannot see, so the person asking for one has
 * to be someone who could have published it — and it is emphatically NOT the
 * edit bar: `release_edit_bar` is that surface's kill switch, and a preview
 * link has no business disappearing when somebody turns the bar off.
 *
 * Split rather than copied, for the reason this module exists at all: the
 * whole note above is about not growing a second authorization path that
 * drifts from the first. Callers that ARE the edit bar keep calling
 * {@link editAccessMintRefusal} and keep its flag.
 */
export async function hostContentEditRefusal(options: {
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

  const membership = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(uid)
    .get()
  if (!membership.exists) {
    return Response.json({ error: 'Not a member of this site' }, { status: 403 })
  }

  // A roster row proves membership of the ORG, not reach to this host. The
  // roster holds site collaborators too, and one can carry the org role
  // `editor` with `allHosts: false` and a `hostAccess` map naming only their
  // own sites — so the org-role arm counts only when the member is org-wide,
  // exactly as the presence broker asks it (AGL-1881). Otherwise that
  // collaborator would be minted a token for every site in the org, and the
  // bar would show them another site's screens and today's traffic
  // (AGL-3062).
  //
  // `hostRoleFor` reads `hostAccess`/`allHosts` for this host, and
  // `isOrgWideMember` sits beside it for the one shape the two read
  // differently: a pre-`allHosts` row with no `hostAccess` is org-wide, and
  // `hostRoleFor` alone would lock that member out of their own sites.
  const member = (membership.data() ?? {}) as Partial<AglynOrgMember>
  const orgRole = member.role
  const hostRole = ((host.get('memberRoles') ?? {}) as Record<string, string>)[
    uid
  ]
  // `author` (AGL-2334) — the edit-bar entry token. Same reasoning as the
  // presence broker: this buys entry to the editor, and an author's whole
  // purpose is to be in it. What they cannot do once inside is enforced by
  // the rules on the publish fields.
  const canEdit =
    hostRoleCanWrite(hostRole) ||
    hostRoleCanWrite(hostRoleFor(member, host.id)) ||
    (isOrgWideMember(member) &&
      (orgRole === 'owner' || orgRole === 'admin' || orgRole === 'editor'))
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
