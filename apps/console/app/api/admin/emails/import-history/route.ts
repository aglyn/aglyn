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
import { resendDeliveryHistorySource } from '@aglyn/shared-util-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { importEmailDeliveryHistory } from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * IMPORTS ALREADY-SENT MAIL INTO THE DELIVERY LOG.
 *
 * ## The gap this closes
 *
 * The log is written from delivery-webhook events, which only exist for mail
 * sent after the webhook was connected. Every message before that is absent —
 * so the staff Email delivery card answered "no delivery events recorded" for
 * a person the sending dashboard plainly shows two delivered emails to, which
 * is worse than having no card at all: it reads as "we never wrote to them".
 *
 * ## Why a sweep and not a per-person lookup
 *
 * Resend's list endpoint takes `limit`, `after` and `before` and **no
 * recipient filter**. Looking one person up therefore means paging the whole
 * account's history anyway — so it is done once, into our own store, rather
 * than on every render of a staff page. That is also the shape a second
 * provider can implement: `EmailDeliveryHistorySource` is cursor-paged and
 * unfiltered because that is the lowest common denominator.
 *
 * ## The key is separate on purpose
 *
 * `RESEND_API_KEY` is scoped to sending, and answers every read on this
 * endpoint with `401 restricted_api_key`. That is the correct posture for the
 * key that sends mail — a leaked sending key cannot enumerate everyone we have
 * ever emailed — so the import takes its own read-scoped credential in
 * `RESEND_READ_API_KEY` rather than widening the one that already exists.
 * Unset, this route answers 501 and says which variable is missing, on the
 * same reasoning as the webhook endpoint.
 *
 * ## Resumable, and it says so
 *
 * Bounded by pages so a large history cannot hold a request open until it
 * times out — losing every page it had already written. The response carries
 * `nextCursor` and `truncated`; the caller POSTs the cursor back to continue.
 * Re-running is safe: an imported row never overwrites what the live event
 * feed recorded, and invents no open or click counts.
 */
async function handler(request: Request): Promise<Response> {
  const {
    method,
    body: payload,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
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

    const apiKey = String(process.env.RESEND_READ_API_KEY ?? '').trim()
    if (!apiKey) {
      // 501 rather than 500: nothing is broken, a credential is absent, and
      // the operator needs to be told WHICH one rather than reading a log.
      return Response.json(
        {
          error:
            'Set RESEND_READ_API_KEY to a full-access key. The sending key ' +
            'cannot read message history.',
        },
        { status: 501 },
      )
    }

    const cursor = String(payload?.cursor ?? '').trim() || null
    const maxPages = Number(payload?.maxPages)
    const result = await importEmailDeliveryHistory({
      source: resendDeliveryHistorySource(apiKey),
      cursor,
      maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
    })

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'email.history-imported',
        target: 'emailDeliveries',
        note: `${result.recorded} of ${result.scanned} across ${result.pages} page(s)`,
        at: new Date(),
      })
      .catch(() => undefined)

    return Response.json(result, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/emails/import-history] failed', error)
    return Response.json(
      { error: (error as Error)?.message ?? 'Import failed' },
      { status: 502 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
