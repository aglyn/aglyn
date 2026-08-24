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
import { meteredBackfillMode } from '../../../../utils/server/metered-backfill'
import { buildServerConfigReport } from '../../../../utils/server-config-report'

/**
 * What this deployment actually resolved (AGL-2069).
 *
 * An env flip is verifiable from outside to four links — the key is on the
 * deployment, the value reads back, no shared-scope twin shadows it, the code
 * path is real — and the fifth link, that the configured text arrives
 * byte-for-byte in this function's `process.env`, was Vercel's contract
 * rather than a reading. On 2026-08-19 a var was set on the PROJECT while the
 * DEPLOYMENT serving traffic still lacked it, and the only way to notice was
 * diffing deployment env key lists by hand.
 *
 * This route is the runtime answering for itself. It is a config REPORT, and
 * emphatically not an env dump: see `utils/server-config-report.ts` for why
 * "never echo a value" is a property of the shape rather than a rule.
 *
 * Gated exactly like `admin/flags`: a verified Bearer ID token carrying the
 * `staff` claim. It FAILS CLOSED — an unreadable, expired or unverifiable
 * token is a refusal, never a report, and the catch below cannot turn into
 * one either (it answers 500, not a body).
 *
 * Read-only by construction: GET only, and nothing here writes.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
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
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    /*==========================================
     * THE RESOLVERS ARE CALLED, NOT COPIED.
     *
     * `meteredBackfillMode()` reads `process.env` itself, and its answer is
     * what production uses. Re-deriving the mode here would make this a
     * second transcription of the rule — and a report that agrees with the
     * intent while production disagrees is worse than no report, because it
     * closes the question.
     *=========================================*/
    const report = buildServerConfigReport(process.env, {
      meteredBackfillMode: meteredBackfillMode(),
    })

    return Response.json(report, {
      status: 200,
      // Never cached, anywhere. A cached answer would describe whichever
      // deployment happened to warm the edge, which is precisely the
      // deployment-identity confusion this endpoint exists to end.
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/server-config]', error)
    return Response.json({ error: 'Config report failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
