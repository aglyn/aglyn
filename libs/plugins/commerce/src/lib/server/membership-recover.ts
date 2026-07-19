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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { mintPasswordResetToken } from './membership'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Best-effort per-instance damper, mirroring membership-login's — keyed by
// IP + email so one address can't be carpet-bombed with reset mail from a
// single box, and one box can't enumerate the throttle across addresses.
const attemptsByKey = new Map<string, number[]>()
const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 5

/**
 * Password-recovery request (AGL-552). ALWAYS answers `200 {ok:true}` once
 * the input validates — whether or not the email belongs to a member —
 * so the endpoint can't be used to probe account existence. When a member
 * matches, a single-use one-hour token (bound to the current password
 * hash, see membership.ts) is mailed via Resend with a link to the site's
 * `/recover` route.
 */
export const membershipRecoverHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  if (!hostId || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown',
  ).split(',')[0]
  const key = `${ip}|${email}`
  const now = Date.now()
  const attempts = (attemptsByKey.get(key) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  )
  attempts.push(now)
  attemptsByKey.set(key, attempts)
  if (attempts.length > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, membersQuery] = await Promise.all([
      hostRef.get(),
      hostRef
        .collection('siteMembers')
        .where('email', '==', email)
        .limit(1)
        .get(),
    ])
    const memberDoc = membersQuery.docs[0]
    // Unknown site, unknown email, suspended account (AGL-546): all take
    // the same silent-success exit — the response never distinguishes.
    if (
      !hostSnapshot.exists ||
      !memberDoc ||
      memberDoc.get('suspended') === true
    ) {
      return res.status(200).json({ ok: true })
    }
    const resendKey = process.env.RESEND_API_KEY
    const emailFrom = process.env.USAGE_EMAIL_FROM
    if (!resendKey || !emailFrom) {
      // Config gaps must not become an existence oracle either; log for
      // the operator and keep the visitor-facing contract.
      console.error('membership/recover: email is not configured')
      return res.status(200).json({ ok: true })
    }
    const token = mintPasswordResetToken(
      hostId,
      memberDoc.id,
      memberDoc.get('passwordScrypt'),
    )
    // Same site-base resolution as campaign links: custom domain first,
    // else the aglyn.app subdomain.
    const subdomain = hostSnapshot.get('subdomain')
    const siteBase = hostSnapshot.get('cname')
      ? `https://${hostSnapshot.get('cname')}`
      : `https://${subdomain}.aglyn.app`
    const resetUrl = `${siteBase}/recover?token=${encodeURIComponent(token)}`
    const siteName = String(
      hostSnapshot.get('displayName') ?? subdomain ?? 'your site',
    )
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [email],
        subject: `Reset your ${siteName} password`,
        text:
          `Someone asked to reset the password for your ${siteName} ` +
          'account. If that was you, set a new password here:\n\n' +
          `${resetUrl}\n\n` +
          'The link works once and expires in 1 hour. If you did not ' +
          'ask for this, you can safely ignore this email — your ' +
          'password is unchanged.',
      }),
    }).catch((error) => console.error(error))
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    // Even a backend failure stays silent-success: the enumeration
    // contract beats the visitor's error visibility here, and the send is
    // best-effort by design.
    return res.status(200).json({ ok: true })
  }
}
