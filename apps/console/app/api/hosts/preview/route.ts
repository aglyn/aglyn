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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { sitePreviewSwitchPlan } from '@aglyn/aglyn/app-utils/site-preview'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { sendGa4SitePublished } from '@aglyn/tenant-data-admin/server/ga4-measurement-protocol'
import { FieldValue } from 'firebase-admin/firestore'
import { revalidateEntireHost } from '../../../../utils/server/tenant-revalidate'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The Preview switch: put a whole site in preview, or make it public
 * (AGL-4086).
 *
 * While a site is in preview only its team, and Aglyn staff, see it; the
 * public gets the 503 page or a "Coming soon" notice at every address. Making
 * it public is a LAUNCH, which is why this is a server door rather than a
 * client write like the maintenance switch beside it:
 *
 * - `preview` and `publicSinceMs` are Admin-SDK-only in the rules, so the one
 *   way to flip them is through the site-admin check here;
 * - every cached page of the site is dropped in the same request
 *   (`revalidateEntireHost`), in both directions — a public site's cached
 *   pages must stop serving the moment it goes into preview, and the cached
 *   notice must stop the moment it comes out;
 * - `site_published` is reported once, server-side, the first time a site
 *   that was born in preview becomes public. A site that was public before
 *   carries `publicSinceMs` and reports nothing.
 *
 * Who: a site admin ("Manage site settings", `site.manage`), the same people
 * the Admin area and the maintenance switch are for, or staff. Answers
 * `{ preview, dropped }`, where `dropped` says whether the cached pages were
 * dropped (the snackbar says something weaker when they were not).
 *
 * Body: `{ hostId, preview }`. `preview` may be a boolean or the strings
 * `"true"`/`"false"`, which is how a native form's toggle arrives.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  const raw = body?.preview
  const enabled =
    raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (enabled === null) {
    return Response.json({ error: 'Say whether the site is in preview' }, { status: 400 })
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
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const isStaff = decoded['staff'] === true
    if (!isStaff) {
      if (!holdsSiteKey(hostSnapshot, decoded.uid, 'site.manage')) {
        return Response.json({ error: siteKeyRefusal('site.manage') }, { status: 403 })
      }
      // Lockdown (AGL-1501): a write on every leg, like the error-page door.
      const orgId = hostSnapshot.get('orgId') as string | undefined
      const org = orgId
        ? ((await firestore.collection('orgs').doc(orgId).get()).data() ?? undefined)
        : undefined
      const lockdown = await getLockdownVerdict({
        request,
        uid: decoded.uid,
        org,
        host: hostSnapshot.data(),
      })
      if (lockdown) return lockdownJsonResponse(lockdown)
    }

    const plan = sitePreviewSwitchPlan(hostSnapshot.data() as never, enabled)
    if (plan.unchanged) {
      return Response.json({ preview: enabled, dropped: true }, { status: 200 })
    }
    await hostRef.update({
      preview: plan.preview ? true : FieldValue.delete(),
      ...(plan.stampPublicSince ? { publicSinceMs: Date.now() } : {}),
    })
    // Both directions drop every cached page: the site's addresses answer
    // something different now, including the ones no screen holds.
    const dropped = await revalidateEntireHost(firestore, hostId)
    if (plan.firstPublic) {
      // Never throws; a measurement outage must not fail a launch.
      await sendGa4SitePublished({ hostId, firstPublish: true })
    }
    return Response.json(
      { preview: plan.preview, dropped: dropped.reason === 'ok' },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The site could not be changed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
