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

import { PLATFORM_BRAND_NAME, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  consumeRateLimit,
  consumeVerifyEmailAutoSend,
  firebaseAdmin,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'
import { generateAuthActionLink } from '../../_lib/auth-action-link'
import { renderSystemEmail } from '../../_lib/render-system-email'

// lockdown-423: exempt — account recovery/verification must always work; pre-org, and the
// session mint carries the lockdown gate.

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
  const {
    method,
    headers: rawHeaders,
    body,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  // The page sets this on the send it fires from a mount; the "Resend
  // verification email" button leaves it off. It is the one thing the body is
  // trusted for, and only ever to send LESS — a caller who lies about it gets
  // the cooldown they were entitled to skip, never somebody else's mail.
  const automatic = (body as { auto?: unknown } | undefined)?.auto === true

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

    // Arriving here is a request to know whether the first mail worked, not a
    // request for another one (AGL-2584). Checked BEFORE the hourly budget so
    // a send that is not going to happen spends nothing a deliberate resend
    // would want, and answered 200: a link is already on its way, so the page
    // shows the state it would have shown anyway and nothing is wrong.
    if (automatic) {
      const cooldown = await consumeVerifyEmailAutoSend(decoded.uid)
      if (!cooldown.allowed) {
        return Response.json(
          {
            ok: true,
            alreadySent: true,
            retryAfterSeconds: cooldown.retryAfterSeconds,
          },
          { status: 200 },
        )
      }
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
      'Confirm this address to finish setting up your ' +
      `${PLATFORM_BRAND_NAME} account:\n\n` +
      `${verifyUrl}\n\n` +
      `If you did not create an ${PLATFORM_BRAND_NAME} account, you can ` +
      'ignore this email.'
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
    // Identity Platform throttles link minting on its own, ahead of and
    // independently of the per-uid budget above, and reports it as a 400
    // `auth/internal-error` carrying TOO_MANY_ATTEMPTS_TRY_LATER. Reported as
    // a 500 it read `Sending the email failed` — alarming, and wrong twice
    // over: the previous mail had been sent, and the fix is to wait rather
    // than to retry. This page mints a link on every mount, so returning here
    // is what someone reopening the tab actually meets.
    if (isTooManyAttempts(error)) {
      return Response.json(
        { error: 'Too many requests — wait a moment before requesting another link.' },
        { status: 429 },
      )
    }
    return Response.json({ error: 'Sending the email failed' }, { status: 500 })
  }
}

/**
 * Identity Platform's own throttle, which surfaces as a generic
 * `auth/internal-error` whose upstream body names the real cause. Matched on
 * the token rather than the code, because the code is shared with every other
 * internal failure and only the body distinguishes them.
 */
function isTooManyAttempts(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const probe = error as {
    code?: unknown
    message?: unknown
    cause?: { response?: { text?: unknown } }
  }
  if (probe.code !== 'auth/internal-error') return false
  const body = probe.cause?.response?.text
  const haystack = `${typeof body === 'string' ? body : ''} ${
    typeof probe.message === 'string' ? probe.message : ''
  }`
  return haystack.includes('TOO_MANY_ATTEMPTS_TRY_LATER')
}

export const dynamic = 'force-dynamic'
export { handler as POST }
