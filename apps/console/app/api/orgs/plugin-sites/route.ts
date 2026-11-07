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
import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  logOrgActivity,
  memberHasOrgPermission,
  memberHasPermissionOnHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { dropSiteCaches } from '../../../../utils/server/tenant-revalidate'
import {
  isRunsOnPluginId,
  pluginRunsOnChoiceFrom,
  writePluginRunsOn,
} from '../../../../utils/server/plugin-runs-on'

/**
 * Where a plugin runs across the workspace's sites: All sites, or all sites
 * except some (AGL-4047). `POST { orgId, pluginId, choice }`.
 *
 * The choice is written into each site's own `disabledPlugins`, nothing else
 * (`plugin-runs-on.ts`), so a site's own switch can still turn the plugin back
 * on there, as it always could.
 *
 * Gates, both today's: "Organization settings" (`org.settings`), which the
 * workspace switch for the same plugin asks, and "Manage site settings"
 * (`site.manage`) on every site whose entry changes, which the rules ask of
 * that site's own switch. Staff, as on the workspace switch.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(body?.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
  const pluginId = body?.pluginId
  if (!isRunsOnPluginId(pluginId)) {
    return Response.json({ error: 'Unknown plugin' }, { status: 400 })
  }
  const choice = pluginRunsOnChoiceFrom(body?.choice)
  if (!choice) {
    return Response.json({ error: 'Choose All sites or All sites except some.' }, { status: 400 })
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
    const staff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const member = membership?.member
    if (!staff && !(await memberHasOrgPermission(orgId, member, 'org.settings'))) {
      return Response.json({ error: permissionRefusalText('org.settings') }, { status: 403 })
    }

    const org = await getOrgDoc(orgId)
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: org ?? undefined,
    })
    if (locked) return locked
    if (!org) return Response.json({ error: 'No such workspace' }, { status: 404 })

    const firestore = firebaseAdmin.app().firestore()
    const written = await writePluginRunsOn({
      firestore,
      orgId,
      pluginId,
      choice,
      mayChangeSite: async (hostId) =>
        staff || memberHasPermissionOnHost(orgId, hostId, member, 'site.manage'),
      refusedOnSite: (siteName) => `On ${siteName}: ${permissionRefusalText('site.manage')}`,
      now: () => firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    // `in`, not `!written.ok`: without strict null checks a boolean tag doesn't narrow.
    if ('problem' in written) {
      return Response.json(
        { error: written.problem, ...(written.stranded?.length ? { stranded: written.stranded } : {}) },
        { status: written.status },
      )
    }

    const changed = [...written.leftOutHostIds, ...written.broughtBackHostIds]
    if (changed.length) {
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        choice.mode === 'all'
          ? `Set ${pluginId} to run on all sites`
          : `Set ${pluginId} to run on all sites except ${choice.exceptHostIds.length}`,
        { type: 'org', id: orgId },
      )
      // Each site's live pages hold its plugin set with them, so the sites
      // that moved drop theirs, plugin tags included, and a refused drop is
      // staged for the drain (AGL-4121). Awaited, as the workspace switch's.
      await dropSiteCaches(firestore, {
        hostIds: changed,
        reason: `where ${pluginId} runs changed`,
        plugins: 'host',
      })
    }
    return Response.json(
      {
        ok: true,
        leftOutHostIds: written.leftOutHostIds,
        broughtBackHostIds: written.broughtBackHostIds,
      },
      { status: 200 },
    )
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Could not change where the plugin runs' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
