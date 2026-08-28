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
import { resendDeliveryMessageSource } from '@aglyn/shared-util-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * ONE SENT MESSAGE, FOR THE STAFF PREVIEW.
 *
 * The delivery log records what happened to a message and deliberately does
 * not keep the message: storing every body would put an unbounded copy of
 * every email we have ever sent — reset links, receipts, invites — into our
 * own database to duplicate what the provider already holds. So the body is
 * fetched on the one click that opens it.
 *
 * That is not the per-render fan-out the delivery card refuses. It is one
 * message, by id, when a staffer asks for it.
 *
 * ## What a staffer is being shown, and why it is audited
 *
 * The rendered body of somebody's mail — which for a password reset or a
 * verification contains a live action link. Reading one is a legitimate
 * support action and a sensitive one, so it is recorded in `adminAudit` with
 * the message id, the same as impersonation and the erase path. The record is
 * what makes the access reviewable; nothing here is hidden from the person
 * whose mail it is.
 *
 * A 404 from the provider is an ANSWER, not a failure: the message aged out
 * of their retention and we can say so exactly, rather than presenting an
 * outage as an empty inbox.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
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
  const messageId = String((query as Record<string, unknown>)?.id ?? '').trim()
  if (!messageId) {
    return Response.json({ error: 'Missing message id' }, { status: 400 })
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
      return Response.json(
        {
          error:
            'Set RESEND_READ_API_KEY to a full-access key. The sending key ' +
            'cannot read message content.',
        },
        { status: 501 },
      )
    }

    const message = await resendDeliveryMessageSource(apiKey)(messageId)
    if (!message) {
      return Response.json(
        { error: 'The provider no longer holds this message.' },
        { status: 404 },
      )
    }

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'email.message-viewed',
        target: `emailDeliveries/${messageId}`,
        note: message.to.join(', '),
        at: new Date(),
      })
      .catch(() => undefined)

    return Response.json(message, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/emails/message] failed', error)
    return Response.json(
      { error: (error as Error)?.message ?? 'Lookup failed' },
      { status: 502 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
