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
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { evaluateEmailHealth } from '../../../../utils/server/email-health'

/**
 * Email provisioning health (AGL-709). Answers "can this deployment send
 * mail?" without emailing a real person — the question that otherwise costs
 * an invite to a live inbox and a wait to find out.
 *
 * Reports which mail provider this runtime hands mail to, which of its
 * settings it still lacks, and whether `USAGE_EMAIL_FROM` is set — which
 * matters because they arrive by different routes: a provider integration
 * sets its key on one project, while the sender is set by hand. A key
 * without a sender sends nothing at all, silently, since every call site
 * requires both.
 *
 * `?probe=1` additionally asks the provider whether its credential is
 * accepted, using its no-send credential probe. It never creates a message.
 * Domain verification is not observable this way — a sending-scoped key has
 * no read permissions — so a verified-looking report can still bounce until
 * DNS is verified.
 *
 * Staff-claim gated, same trust anchor as the Firestore rules. The API key
 * is never returned.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    return Response.json(
      await evaluateEmailHealth({ probe: String(query?.['probe'] ?? '') === '1' }),
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Email health check failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
