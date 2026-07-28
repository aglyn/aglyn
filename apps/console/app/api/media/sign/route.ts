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

import { memberCanSee, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
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

    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('media')
      .doc(mediaId)
      .get()

    // One 404 for every refusal below — missing, deleted, out of scope, or
    // not private. A caller who cannot have the asset must not be able to
    // tell those apart, or this route becomes an oracle for which ids and
    // scopes exist.
    const refuse = () =>
      Response.json({ error: 'Not found' }, { status: 404 })
    if (!snapshot.exists || snapshot.get('deletedAt')) return refuse()

    if (!isStaff) {
      const membership = await resolveOrgMembership(decoded.uid, orgId)
      const member = membership?.member as any
      if (!member || member.orgSuspended === true) return refuse()
      if (!memberCanSee(member, snapshot.get('visibleTo'))) return refuse()
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
