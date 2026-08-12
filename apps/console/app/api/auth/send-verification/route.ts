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
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  consumeRateLimit,
  firebaseAdmin,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'
import { generateAuthActionLink } from '../../_lib/auth-action-link'
import { renderSystemEmail } from '../../_lib/render-system-email'

/**
 * Send the address-verification email (AGL-1112).
 *
 * Replaces the client SDK's `sendEmailVerification`, which had Firebase Auth
 * compose it from a template we are locked out of — the subject still carries
 * `[aglyn.io]` and the link lands on `aglyn-main.firebaseapp.com`.
 *
 * Unlike the password-reset endpoint, this one is authenticated and CAN
 * report failure: the caller is the account holder, sitting on a page that
 * says "we sent you an email", and telling them it worked when it did not
 * leaves them waiting for something that is never coming. There is nothing to
 * conceal — they already know their own address has an account.
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
    const auth = firebaseAdmin.app().auth()
    const peek = await auth.verifyIdToken(idToken)
    const tenantId = peek.firebase?.tenant
    const decoded = tenantId
      ? await auth.tenantManager().authForTenant(tenantId).verifyIdToken(idToken)
      : peek

    // The address comes from the TOKEN, never the body. A body-supplied
    // address would let any signed-in account aim a verification mail at
    // someone else's inbox, which is a mailbomb with our return address on it.
    const email = String(decoded.email ?? '').toLowerCase()
    if (!email) {
      return Response.json({ error: 'This account has no email address' }, { status: 400 })
    }
    // Already verified: nothing to do, and saying so is more useful than
    // sending a mail whose link is a no-op.
    if (decoded.email_verified) {
      return Response.json({ ok: true, alreadyVerified: true }, { status: 200 })
    }

    const limited = await consumeRateLimit(`verify-email:${decoded.uid}`, {
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
    if (!limited.allowed) {
      return Response.json(
        { error: 'Too many verification emails — try again in an hour.' },
        { status: 429 },
      )
    }

    if (!isEmailConfigured()) {
      return Response.json({ error: 'Email is not configured' }, { status: 501 })
    }

    // A hint only — see the note in send-password-reset. Resolved server-side,
    // so a missing Origin is no longer a 400 that blocks verification.
    const requestOrigin =
      headers.origin ?? (headers.host ? `https://${headers.host}` : '')
    const verifyUrl = await generateAuthActionLink(
      'verifyEmail',
      email,
      requestOrigin,
    )

    const fallbackText =
      'Confirm this address to finish setting up your Aglyn account:\n\n' +
      `${verifyUrl}\n\n` +
      'If you did not create an Aglyn account, you can ignore this email.'
    const designed = await renderSystemEmail('email-verification', { verifyUrl })
    const result = await sendEmail({
      to: email,
      subject: designed?.subject ?? 'Confirm your email address',
      text: designed?.text || fallbackText,
      ...(designed?.html ? { html: designed.html } : {}),
      context: 'email-verification',
    })
    if (!result.sent) {
      return Response.json({ error: 'Sending the email failed' }, { status: 502 })
    }
    // Cost meter (AGL-1438). Platform-scoped: verification happens before the
    // account belongs to any org.
    await meterPlatformEmail()
    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error('[auth/send-verification] failed', error)
    return Response.json({ error: 'Sending the email failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
