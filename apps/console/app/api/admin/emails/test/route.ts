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
  getSystemEmailTemplate,
  isEmailConfigured,
  isSystemEmailEditable,
  sendEmail,
} from '@aglyn/shared-util-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { renderEffectiveSystemEmail } from '../../../_lib/render-system-email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Staff test-send for a system email (AGL-766). Renders the email exactly as
 * it would go out right now — the designed version if one is published
 * (AGL-750/765), otherwise the catalog default (AGL-764) — substitutes the
 * merge values the drawer collected from a chosen org/host/user, and sends a
 * `[Test]`-subjected copy to the recipient.
 *
 * Staff-gated like every other admin route. The rendered subject and a text
 * preview come back on every path, including when delivery is not configured,
 * so the drawer can confirm what WOULD be sent rather than failing blind.
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

  const templateKey = String(payload?.templateKey ?? '')
  const to = String(payload?.to ?? '')
    .trim()
    .toLowerCase()
  const rawMerge = payload?.mergeValues
  const mergeValues: Record<string, string> = {}
  if (rawMerge && typeof rawMerge === 'object') {
    for (const [key, value] of Object.entries(
      rawMerge as Record<string, unknown>,
    )) {
      mergeValues[key] = String(value ?? '')
    }
  }

  const definition = getSystemEmailTemplate(templateKey)
  if (!definition || !isSystemEmailEditable(definition)) {
    // Firebase-delivered and unknown keys have no body we can render or send.
    return Response.json(
      { error: 'Unknown or non-editable template' },
      { status: 400 },
    )
  }
  if (!EMAIL_RE.test(to)) {
    return Response.json(
      { error: 'A valid recipient email is required' },
      { status: 400 },
    )
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const rendered = await renderEffectiveSystemEmail(templateKey, mergeValues)
    if (!rendered) {
      return Response.json(
        { error: 'Nothing to render for this template' },
        { status: 400 },
      )
    }
    const subject = `[Test] ${rendered.subject}`
    const preview = rendered.text.slice(0, 240)

    if (!isEmailConfigured()) {
      // Delivery is off in this environment; still return what was rendered.
      return Response.json(
        { sent: false, reason: 'unconfigured', subject, preview },
        { status: 200 },
      )
    }

    const result = await sendEmail({
      to,
      subject,
      html: rendered.html,
      text: rendered.text,
      context: 'system-email-test',
    })

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'systemEmail.test',
        target: `systemEmailTemplates/${templateKey}`,
        before: null,
        after: { to, sent: result.sent },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })

    if (result.sent) {
      return Response.json(
        { sent: true, id: result.id, subject, preview },
        { status: 200 },
      )
    }
    // The failure shape, read directly: the native tsc doesn't narrow the
    // discriminated union across the audit `await` above.
    const failure = result as { reason?: string; detail?: string }
    return Response.json(
      {
        sent: false,
        reason: failure.reason ?? null,
        detail: failure.detail ?? null,
        subject,
        preview,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('system email test send failed', error)
    return Response.json({ error: 'Test send failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
