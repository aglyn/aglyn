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
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  mintEditHintToken,
} from '@aglyn/tenant-data-admin'

/**
 * Mints the BOUNCE half of the `*.aglyn.app` editor-presence hint
 * (AGL-1842).
 *
 * The console client calls this right after sign-in (throttled — see
 * `EditHintBounce`), then top-level-navigates to the tenant app's
 * `/api/edit-hint/set?sig=<blob>&return=<here>`, which is the only moment a
 * `Domain=.aglyn.app` cookie can be planted from a browser whose session
 * lives on `.aglyn.com`. The blob is a real credential riding a URL, so it
 * carries nothing but `{uid, exp}` and lives for seconds — long enough for
 * one redirect, useless in a log line read tomorrow.
 *
 * Deliberately NO host, NO org, NO membership check here: a hint names a
 * person, not a permission. Which sites that person may edit is decided
 * per-host at the tenant's `/api/edit-access/exchange`, with the same
 * membership gate `/api/edit-access/token` applies — one authorization
 * path, evaluated where the answer is needed.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
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
    const { token, expiresAtMs } = mintEditHintToken('bounce', decoded.uid)
    return Response.json(
      { blob: token, expiresAtMs },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Could not mint edit hint' }, { status: 500 })
  }
}

export const POST = handler
