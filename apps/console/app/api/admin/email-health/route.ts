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
import { checkEmailCredentials, describeEmailConfig } from '@aglyn/shared-util-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/** The sender domain we expect in production (AGL-709/721). */
const EXPECTED_FROM_DOMAIN = 'aglyn.com'

/**
 * Email provisioning health (AGL-709). Answers "can this deployment send
 * mail?" without emailing a real person — the question that otherwise costs
 * an invite to a live inbox and a wait to find out.
 *
 * Reports which of `RESEND_API_KEY` / `USAGE_EMAIL_FROM` this runtime
 * actually sees, which matters because they arrive by different routes: the
 * Vercel Resend integration sets the key on one project, while the sender is
 * set by hand. A key without a sender sends nothing at all, silently, since
 * every call site requires both.
 *
 * `?probe=1` additionally asks Resend whether the key is accepted, using a
 * no-send credential probe. It never creates a message. Domain verification
 * is not observable this way — a sending-scoped key has no read permissions
 * — so a verified-looking report can still bounce until DNS is verified.
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

    const config = describeEmailConfig()
    const credentials =
      String(query?.['probe'] ?? '') === '1'
        ? await checkEmailCredentials()
        : null

    // What an operator should do next, in the order it blocks delivery.
    const blockers: string[] = []
    if (!config.hasApiKey) {
      blockers.push(
        'RESEND_API_KEY is not set on this project — add it in Vercel ' +
          '(the Resend integration sets it per project, not team-wide).',
      )
    }
    if (!config.hasFrom) {
      blockers.push(
        'USAGE_EMAIL_FROM is not set — without it every sender no-ops, ' +
          'even with a valid API key. Set it to "Aglyn <noreply@aglyn.com>".',
      )
    }
    if (config.fromDomain && config.fromDomain !== EXPECTED_FROM_DOMAIN) {
      blockers.push(
        `USAGE_EMAIL_FROM sends from ${config.fromDomain}, but the verified ` +
          `sending domain is ${EXPECTED_FROM_DOMAIN}.`,
      )
    }
    if (credentials?.status === 'invalid-key') {
      blockers.push('Resend rejected RESEND_API_KEY — rotate or re-scope it.')
    }

    return Response.json({
      ...config,
      expectedFromDomain: EXPECTED_FROM_DOMAIN,
      credentials,
      blockers,
      /** True only when nothing known is standing in the way of delivery. */
      healthy: config.configured && !blockers.length,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Email health check failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
