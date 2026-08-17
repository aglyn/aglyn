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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isBlockedSubdomain, SUBDOMAIN_PATTERN } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  updateExisting,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Staff host management (AGL-390): retarget a host's subdomain (validated,
 * unique, not reserved) from the staff console. Super-staff only; audited
 * to adminAudit.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '')
  if (!hostId || action !== 'set-subdomain') {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return Response.json({ error: 'Staff only' }, { status: 403 })
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }

    const subdomain = String(body?.subdomain ?? '')
      .trim()
      .toLowerCase()
    if (!SUBDOMAIN_PATTERN.test(subdomain) || isBlockedSubdomain(subdomain)) {
      return Response.json({ error: 'Invalid or reserved subdomain' }, { status: 400 })
    }

    const firestore = firebaseAdmin.app().firestore()
    // Uniqueness: no other host may hold this subdomain.
    const taken = await firestore
      .collection('hosts')
      .where('subdomain', '==', subdomain)
      .limit(1)
      .get()
    if (!taken.empty && taken.docs[0].id !== hostId) {
      return Response.json({ error: 'That subdomain is taken' }, { status: 409 })
    }

    const hostRef = firestore.collection('hosts').doc(hostId)
    // THE EXISTENCE CHECK (AGL-1763). `hostId` is body-supplied and was only
    // ever checked non-empty; this read was already here for the audit's
    // `before` value and simply never asked `.exists` — the same one-line-away
    // shape AGL-1760 fixed. It is the guard now as well, so the cost is
    // unchanged.
    //
    // Refusing is right and nothing is discarded: this is a staff retarget, no
    // money and no prior work hang off it, and the operator fixes a mistyped id
    // by retyping it. Creating instead was actively harmful and SELF-POISONING,
    // which is what makes this worth more than a tidy-up. A merge-set minted
    // `hosts/{typo}` carrying `subdomain` and `updatedAt` and nothing else —
    // no `orgId`, no `displayName`, so invisible to every console list, which
    // scopes by `orgId`. But the uniqueness query above filters on `subdomain`
    // ALONE, so the phantom matches it. The next attempt to give that
    // subdomain to the host that should have had it is refused 409 "That
    // subdomain is taken" by a document no surface can show and no operator
    // can find — a failure that surfaces far from its cause, and only ever
    // for the one subdomain that was fat-fingered.
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'No such site' }, { status: 404 })
    }
    const before = hostSnapshot.get('subdomain') ?? null
    // SECOND LINE OF DEFENCE for the window the check cannot close — a site
    // erased between the read and the write. `update()` rejects on a missing
    // document where a merge-set creates one.
    const applied = await updateExisting(hostRef, {
      subdomain,
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (!applied) {
      return Response.json({ error: 'No such site' }, { status: 404 })
    }
    // Keep the routing mirror in step (AGL-628). `registerOrgHost` seeds
    // hostIndex.subdomain on create and /api/hosts/rename maintains it, but
    // this staff path never did — leaving a stale subdomain behind that
    // cross-org host resolution would then follow to the wrong site.
    //
    // A DELIBERATE, COMPLETE create rather than the `{ subdomain }` merge-set
    // it replaces, and the difference is not the phantom hostId — the guard
    // above already settled that. `hostIndex` is a pure projection of the host
    // doc, so re-deriving it for a host proven to exist is legitimate; a
    // `{ subdomain }`-only row is not. `orgId` is the field every reader wants
    // — `resolveOrgIdForHost` returns null without it, and null is the
    // pre-billing FAIL-OPEN (every feature on), so a subdomain-only index row
    // would hand a paid host an unmetered one. The host snapshot is in hand,
    // so both fields are written together.
    await firestore
      .collection('hostIndex')
      .doc(hostId)
      .set(
        {
          subdomain,
          ...(hostSnapshot.get('orgId')
            ? { orgId: hostSnapshot.get('orgId') }
            : {}),
        },
        { merge: true },
      )
    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: 'host.set-subdomain',
      target: `hosts/${hostId}`,
      before: { subdomain: before },
      after: { subdomain },
      at: FieldValue.serverTimestamp(),
    })
    return Response.json({ ok: true, subdomain }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Host update failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
