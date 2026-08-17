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
  isLockdownActive,
  memberCanSee,
  normalizeOrgLockdown,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  mediaSignatureQuery,
  mintMediaSignature,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/**
 * Mints a short-lived signed URL for a PRIVATE media asset (AGL-1051).
 *
 * This is the authenticated half of the private-asset model. The CDN route
 * stays unauthenticated — it has to, it serves images to anonymous
 * visitors — so the gate lives here: prove membership and visibility once,
 * receive a URL that stops working in fifteen minutes.
 *
 * Read-level on purpose. `resolveMediaScope` refuses `viewer`, which is
 * right for the routes that MUTATE the library and wrong here: a viewer
 * who may see an asset in the picker must be able to preview it, and
 * refusing would push people toward marking assets public to make them
 * usable — the opposite of what this feature is for.
 *
 * Only private assets are signed. A public asset already has a `cdnPath`
 * that works, and minting for it would imply a guarantee this gives no one.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const orgId = String(body?.orgId ?? '')
  const mediaId = String(body?.mediaId ?? '')
  if (!orgId || !mediaId) {
    return Response.json({ error: 'Missing orgId or mediaId' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true

    // One 404 for every refusal below — missing, deleted, out of scope, or
    // not private. A caller who cannot have the asset must not be able to
    // tell those apart, or this route becomes an oracle for which ids and
    // scopes exist.
    const refuse = () =>
      Response.json({ error: 'Not found' }, { status: 404 })

    let member: any
    if (!isStaff) {
      const membership = await resolveOrgMembership(decoded.uid, orgId)
      member = membership?.member as any
      if (!member) return refuse()
      // lockdown-423, projection kept (AGL-1506): this route signs every
      // private-asset preview, so the cheap `orgSuspended` member
      // projection stays its per-request org signal — the happy path adds
      // NO reads (the platform scope is TTL-cached in-process, and the
      // user scope is deliberately omitted: a user lock disables the
      // account and revokes tokens at lock time, so the token this route
      // verifies dies on its own). Only when the projection trips is the
      // org doc read — locked callers are rare — to build the distinct
      // 423 body. Runs BEFORE the asset read so a locked member's 423
      // reveals nothing about which asset ids exist. If the doc lock is
      // inactive while the projection still says locked, the
      // pre-AGL-1506 refusal stands — a disagreement never loosens.
      //
      // Held in a const since AGL-1790: the verdict gets the same carrier
      // the line below reads, so the two cannot disagree about which
      // document they judged, and the read still happens only when the
      // projection trips.
      const org =
        member.orgSuspended === true ? ((await getOrgDoc(orgId)) ?? {}) : undefined
      const locked = await lockdownRefusal({
        request,
        // POST-shaped READ (AGL-1511): this mints a short-lived URL for
        // VIEWING a private asset. Refusing it under a read-only lock would
        // blank every private image on a site that is still serving.
        intent: 'read',
        org,
      })
      if (locked) return locked
      // The pre-AGL-1506 refusal, now asking the question its comment above
      // always claimed it asked (AGL-1790).
      //
      // `applyOrgLockdown` stamps `orgSuspended: true` onto every member doc
      // for EVERY mode, read-only included, so a bare projection test is a
      // mode-BLIND gate standing beside a mode-aware one — and the blind one
      // won: under a read-only lock the verdict passed this read (correctly,
      // per the declaration above) and this line 404'd it anyway, blanking
      // every private image in a console the mode table promises still works.
      //
      // What the line was actually for survives unchanged. Reaching here with
      // the projection set means the verdict declined to refuse, which is one
      // of exactly two situations: the carrier holds an ACTIVE lock that
      // passed on intent — agreement, and a read-only lock passing a read is
      // the entire feature — or the carrier holds no active lock at all,
      // which is the stale projection the refusal was written for. A full
      // lock never arrives here; it 423s above. So the test is activeness,
      // not the mode: asking about the mode a second time would be a copy of
      // `lockdownBlocks` that could drift away from the verdict's.
      //
      // Its own `Date.now()`, a hair later than the verdict's: a lock that
      // expires between the two refuses, which is the safe direction.
      if (
        member.orgSuspended === true &&
        !isLockdownActive(normalizeOrgLockdown(org), Date.now())
      ) {
        return refuse()
      }
    }

    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('media')
      .doc(mediaId)
      .get()

    if (!snapshot.exists || snapshot.get('deletedAt')) return refuse()

    if (!isStaff && !memberCanSee(member, snapshot.get('visibleTo'))) {
      return refuse()
    }

    if (snapshot.get('private') !== true) return refuse()

    const scope = `org:${orgId}`
    const signature = mintMediaSignature(scope, mediaId)
    return Response.json(
      {
        url:
          `/api/media/cdn/${scope}/${mediaId}` +
          `?${mediaSignatureQuery(signature)}`,
        expiresAtMs: signature.exp,
      },
      {
        status: 200,
        // The response carries a bearer capability; it is per-caller and
        // time-boxed, so nothing between here and the browser may keep it.
        headers: { 'Cache-Control': 'private, no-store' },
      },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Could not sign media' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
