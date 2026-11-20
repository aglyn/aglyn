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
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import {
  PAGE_ROUTE_ACTIONS,
  applyPageRouteAction,
  type PageRouteAction,
} from '@aglyn/tenant-data-admin/server/page-route-actions'
import { PUBLISH_OUTBOX_COLLECTION } from '../../../../constants/publish-outbox'
import { announceLivePaths } from '../../../../utils/server/announce-live-paths'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/*
 * THE PAGES HUB'S ROUTING WRITES, FOR THE NATIVE APPS (AGL-3668).
 *
 * The console's Pages hub and a page's details make these writes from the
 * browser in one batch: the host's routing map, the page, the placeholder
 * home page it may replace, and the publish outbox entry. The derived parts
 * (the composed address, the conflict check, the placeholder release, the
 * addresses to announce) are the console's own pure code
 * (`screen-route.ts`, `screen-route-plan.ts`), and this route runs that same
 * code over the Admin SDK so an app publishes, unpublishes, moves and
 * deletes a page exactly as the console does, under the same gate: "Publish
 * site content" (`site.publish`, AGL-4047, whose preset is the site's
 * publishing roles), a verified email, and the lockdown verdict.
 *
 * The reads, the refusals and the batch are `applyPageRouteAction`
 * (`@aglyn/tenant-data-admin`, AGL-4235), which the public API's page writes
 * share; this route is the door (who is asking, may they, is the site locked)
 * and the cache announcement after.
 *
 *   POST /api/hosts/pages  { hostId, action, id, … }
 *     publish        { slug }                 → { ok, path }
 *     unpublish      {}                       → { ok }
 *     delete         {}                       → { ok }   (a page; soft delete + unpublish)
 *     move           { parentId|null, index } → { ok, moved }
 *     delete-group   {}                       → { ok }   (its pages move up, addresses unchanged)
 */

type Action = PageRouteAction
const ACTIONS = PAGE_ROUTE_ACTIONS

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '') as Action
  const screenId = String(body?.id ?? '')
  if (!hostId) return json({ error: 'Missing hostId' }, 400)
  if (!ACTIONS.includes(action)) return json({ error: 'Unknown action' }, 400)
  if (!screenId) return json({ error: 'Missing id' }, 400)

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) return json({ error: 'Unknown site' }, 404)
    const isStaff = decoded['staff'] === true
    if (!isStaff) {
      if (!holdsSiteKey(hostSnapshot, decoded.uid, 'site.publish')) {
        return json({ error: siteKeyRefusal('site.publish') }, 403)
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      const org = orgId ? (await firestore.collection('orgs').doc(orgId).get()).data() : undefined
      const lockdown = await getLockdownVerdict({ request, uid: decoded.uid, org, host: hostSnapshot.data() })
      if (lockdown) return lockdownJsonResponse(lockdown)
    }

    const result = await applyPageRouteAction(firestore, {
      hostId,
      hostSnapshot,
      action,
      pageId: screenId,
      slug: body?.slug,
      parentId: body?.parentId,
      index: body?.index,
      actor: { uid: decoded.uid, email: (decoded.email as string | undefined) ?? null },
    })
    if (result.ok === false) return json({ error: result.error }, result.status)

    if (result.outboxId) {
      // The announcement is best effort; a refused one stays in the outbox for the drain.
      const announced = await announceLivePaths({ hostSnapshot, hostId, paths: result.livePaths }).catch(() => false)
      if (announced) await firestore.collection(PUBLISH_OUTBOX_COLLECTION).doc(result.outboxId).delete().catch(() => undefined)
    }
    return json(result.answer)
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return json({ error: 'That page change did not go through' }, 500)
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
