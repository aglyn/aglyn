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

import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import { provisionStarterSite } from '../../../../utils/server/provision-host'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Gives a site born for the guided AI start its starter (AGL-3594): the
 * published Home page at `/` and the header and footer layout around it.
 *
 * Called when a person leaves the guided start for a blank site — its skip,
 * its close control and Escape, through the `hostFirstRun` zone's
 * `startBlank` — and when a guided start that did not work out is traded for
 * the starter. `provisionStarterSite` does the work and is a no-op on a site
 * that already has a page or a layout, so a second call, a second tab or a
 * site born with the starter answers `provisioned: false` and changes
 * nothing.
 *
 * The same gate as the site's other setup writes: a site admin or editor, or
 * staff, and the lockdown verdict.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '').trim()
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

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
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const staff = decoded['staff'] === true
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!staff && memberRole !== 'admin' && memberRole !== 'editor') {
      return Response.json({ error: 'Not a site admin or editor' }, { status: 403 })
    }
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    const result = await provisionStarterSite(firestore, hostId)
    if (result.missing) return Response.json({ error: 'Unknown site' }, { status: 404 })
    if (result.provisioned) {
      // The holding page `/` answered until now is cached; the Home page is
      // live the moment it is written.
      await dropPluginSiteCache({ hostIds: [hostId], reason: 'starter site provisioned' })
      await logHostActivity(
        hostId,
        { uid: decoded.uid, email: decoded.email ?? null },
        'Started from the starter site',
        { type: 'screen', id: result.screenId ?? '', name: 'Home' },
      ).catch(() => undefined)
    }
    return Response.json(
      { provisioned: result.provisioned, screenId: result.screenId ?? null },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The starter site could not be added' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
