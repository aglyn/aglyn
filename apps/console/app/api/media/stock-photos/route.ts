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
import { answerStockPhotoPickerRequest } from '@aglyn/aglyn/app-utils/stock-photos/stock-photo-picker-server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { resolveMediaScope } from '../../../../utils/server/media-scope'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The media picker's Stock photos tab (AGL-4066): search the deployment's
 * stock photo library and copy a photo into a site's or the workspace's
 * library. Wiring only — the caller's token, and this app's scope check and
 * media read; what each request does is
 * `@aglyn/aglyn/app-utils/stock-photos/stock-photo-picker-server`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    return await answerStockPhotoPickerRequest(body, {
      uid: decoded.uid,
      // lockdown-423: via apps/console/utils/server/media-scope.ts — every
      // request, a search included, is checked as an upload to that library
      // is: the member's rights there and the lockdown's uploads gate.
      authorize: async (target) => {
        const { scope, error } = await resolveMediaScope({ ...target }, {}, decoded.uid, {
          staff: decoded['staff'] === true,
          feature: 'uploads',
        })
        if (scope) return null
        return (
          error?.response ??
          Response.json({ status: 'refused', message: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
        )
      },
      readMedia: async (target, mediaId) => {
        const snapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection(target.orgId ? 'orgs' : 'hosts')
          .doc(target.orgId ?? target.hostId)
          .collection('media')
          .doc(mediaId)
          .get()
        return snapshot.exists ? ((snapshot.data() ?? null) as Record<string, unknown> | null) : null
      },
      signal: request.signal,
    })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Stock photos failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
