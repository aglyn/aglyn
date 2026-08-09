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
import { consumeRateLimit } from '@aglyn/tenant-data-admin'
import { generateAuthActionLink } from '../../_lib/auth-action-link'
import { renderSystemEmail } from '../../_lib/render-system-email'

/**
 * Self-serve "forgot password" (AGL-1112).
 *
 * Replaces the client SDK's `sendPasswordResetEmail`, which had Firebase Auth
 * compose and send the message from a template we cannot edit — the subject
 * still says `[aglyn.io]`, a domain the company no longer uses, and the link
 * lands on `aglyn-main.firebaseapp.com`. Both are locked: every write under
 * `notification.sendEmail` is refused with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`.
 *
 * Now Aglyn composes it, Resend delivers it, and the link points at our own
 * `/reset-password`. Firebase still mints the one-time code, which is the
 * part that must stay Firebase's.
 *
 * ALWAYS answers 200. Whether an address has an account is not something a
 * stranger gets to learn by watching this endpoint, and the response must not
 * differ by so much as a status code between "sent" and "no such account".
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const email = String(body?.email ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 320)
  // The generic answer, returned from every path below.
  const ok = () => Response.json({ ok: true }, { status: 200 })
  if (!email || !email.includes('@')) return ok()

  // Rate limit on the ADDRESS, not just the IP: the abuse worth stopping is
  // mailbombing one person, which a single caller can do from anywhere.
  // Fails soft by design (`consumeRateLimit`), so an outage of the limiter
  // does not take password recovery down with it.
  const ip = headers['x-forwarded-for']?.split(',')[0]?.trim() ?? 'unknown'
  const perAddress = await consumeRateLimit(`password-reset:${email}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  })
  const perIp = await consumeRateLimit(`password-reset-ip:${ip}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  })
  // `.allowed`, not the result object — a truthiness check on the result
  // would be permanently true and the limit would never bite.
  if (!perAddress.allowed || !perIp.allowed) return ok()

  if (!isEmailConfigured()) {
    console.error('[auth/send-password-reset] email is not configured')
    return ok()
  }

  try {
    // A hint only. `generateAuthActionLink` decides the real origin from
    // server config — these headers are attacker-supplied on this endpoint,
    // and the link they end up in carries a live reset code. Absent headers
    // are fine now: the resolver falls back to the canonical console, so a
    // request without an Origin still gets a working email instead of the
    // silent no-send this used to be.
    const requestOrigin =
      headers.origin ?? (headers.host ? `https://${headers.host}` : '')
    const resetUrl = await generateAuthActionLink(
      'resetPassword',
      email,
      requestOrigin,
    )

    const fallbackText =
      'Someone asked to reset the password for your Aglyn account. ' +
      'Choose a new one here:\n\n' +
      `${resetUrl}\n\n` +
      'The link expires shortly. If this was not you, you can ignore this ' +
      'email — your password stays as it is.'
    const designed = await renderSystemEmail('password-reset', { resetUrl })
    await sendEmail({
      to: email,
      subject: designed?.subject ?? 'Reset your Aglyn password',
      text: designed?.text || fallbackText,
      ...(designed?.html ? { html: designed.html } : {}),
      context: 'password-reset',
    })
  } catch (error) {
    // Includes `auth/user-not-found`, which is the ordinary case for a typo
    // and the one this endpoint most needs to stay quiet about. Logged, never
    // surfaced.
    console.error('[auth/send-password-reset] failed', error)
  }
  return ok()
}

export const dynamic = 'force-dynamic'
export { handler as POST }
