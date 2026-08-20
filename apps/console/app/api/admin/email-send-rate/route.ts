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

/**
 * THE RAMP (AGL-2409). Staff read and set the platform's hourly send ceiling.
 *
 * The whole point of the governor is that a ramp is a value change and not a
 * deploy — a capability nobody can see or turn is half-built. This is the turn.
 *
 * GET (any staff) returns the live ceiling and what the current hour has
 * actually used, so an operator can tell whether the number is biting.
 *
 * PUT is SUPER-STAFF ONLY and audited, the same posture as release flags: this
 * value decides whether every merchant's campaigns go out, and lowering it far
 * enough is indistinguishable from an outage on the marketing product. Every
 * change writes an `adminAudit` row with the before and after, because a ramp
 * that nobody can reconstruct afterwards is not a ramp, it is a mystery.
 *
 * The route is the ONLY writer. `rateLimits` is deny-all to every client
 * including staff, so a console session cannot set the ceiling directly — and
 * the write must be accompanied by the audit row and the cache invalidation,
 * which a bare client write would skip.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  EMAIL_SEND_RATE_MAX_PER_HOUR,
  EMAIL_SEND_RATE_MIN_PER_HOUR,
  EMAIL_SEND_RATE_NOTE_MAX,
  normalizeEmailSendRateConfig,
} from '@aglyn/shared-util-email'
import {
  emailSendRateConfigWrite,
  EMAIL_SEND_RATE_CONFIG_DOC,
  emailUnverifiedResponse,
  firebaseAdmin,
  invalidateEmailSendRateConfigCache,
  isImpersonationSession,
  RATE_LIMIT_COLLECTION,
  readEmailSendRateConfig,
  readEmailSendRateWindow,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'PUT') {
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
    const actorRole = String(decoded['staffRole'] ?? 'support')

    if (method === 'GET') {
      const [config, window] = await Promise.all([
        readEmailSendRateConfig(),
        readEmailSendRateWindow(),
      ])
      return Response.json(
        {
          role: actorRole,
          config,
          window,
          bounds: {
            min: EMAIL_SEND_RATE_MIN_PER_HOUR,
            max: EMAIL_SEND_RATE_MAX_PER_HOUR,
          },
        },
        { status: 200 },
      )
    }

    if (actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }
    const requestedPerHour = Number(body?.perHour)
    if (!Number.isFinite(requestedPerHour)) {
      return Response.json(
        { error: 'perHour must be a number' },
        { status: 400 },
      )
    }
    // Out of bounds is REFUSED, not clamped. `normalizeEmailSendRateConfig`
    // clamps on the READ path, where a bad stored value must still produce a
    // working ceiling; here an operator typed something, and silently storing
    // a different number than they typed is how a ramp step gets believed and
    // is not real.
    if (
      requestedPerHour < EMAIL_SEND_RATE_MIN_PER_HOUR ||
      requestedPerHour > EMAIL_SEND_RATE_MAX_PER_HOUR
    ) {
      return Response.json(
        {
          error:
            `perHour must be between ${EMAIL_SEND_RATE_MIN_PER_HOUR} and ` +
            `${EMAIL_SEND_RATE_MAX_PER_HOUR}`,
        },
        { status: 400 },
      )
    }
    const note = String(body?.note ?? '').slice(0, EMAIL_SEND_RATE_NOTE_MAX)
    const before = await readEmailSendRateConfig()
    const write = emailSendRateConfigWrite({
      perHour: requestedPerHour,
      enabled: body?.enabled !== false,
      actorEmail: decoded.email ?? null,
      note,
    })

    await firebaseAdmin
      .app()
      .firestore()
      .collection(RATE_LIMIT_COLLECTION)
      .doc(EMAIL_SEND_RATE_CONFIG_DOC)
      .set(write, { merge: true })
    // The process that took the action serves the new ceiling immediately;
    // others converge within the config TTL.
    invalidateEmailSendRateConfigCache()

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'emailSendRate.update',
        target: `${RATE_LIMIT_COLLECTION}/${EMAIL_SEND_RATE_CONFIG_DOC}`,
        before: { perHour: before.perHour, enabled: before.enabled },
        after: { perHour: write.perHour, enabled: write.enabled },
        ...(note ? { note } : {}),
        at: FieldValue.serverTimestamp(),
      })

    return Response.json(
      { ok: true, config: normalizeEmailSendRateConfig(write) },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Send-rate operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT }
