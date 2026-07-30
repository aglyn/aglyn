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
import { resolveBrandingProfile, validateNewPassword } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  consumePasswordResetSend,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  passwordResetThrottleMessage,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  hashMemberPassword,
  MEMBER_SESSIONS_VALID_FROM_FIELD,
  mintPasswordResetToken,
} from './membership'

/**
 * Console-side password help for a SITE MEMBER (AGL-914) — a visitor account
 * on a published site, not an Aglyn console user.
 *
 * Sibling to `membership-recover`, and deliberately its opposite in tone.
 * That endpoint is public, so it answers `{ok:true}` no matter what to avoid
 * confirming whether an address has an account. This one is driven by a site
 * admin looking straight at the member's record — they already know the
 * account exists, so hiding failures would only leave them guessing whether
 * their click did anything. Every outcome here is reported honestly.
 *
 * Auth is the console id-token check `hosts/members` uses (site admin via
 * the `memberRoles` projection, or an org role carrying manageMembers) — NOT
 * the visitor session cookie the rest of the membership endpoints take.
 */
export const membershipAdminPasswordHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers['authorization'] ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const hostId = String(req.body?.hostId ?? '')
  const memberId = String(req.body?.memberId ?? '')
  const action = String(req.body?.action ?? '')
  if (!hostId || !memberId) {
    return res.status(400).json({ error: 'Missing hostId or memberId' })
  }
  if (action !== 'sendPasswordReset' && action !== 'setPassword') {
    return res.status(400).json({ error: 'Unknown action' })
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      // Same shape as emailUnverifiedResponse (AGL-479), written by hand
      // because that helper returns a fetch `Response` and this is a
      // (req, res) plugin handler.
      return res.status(403).json({
        error: 'Verify your email to continue',
        reason: 'email-unverified',
      })
    }
    const firestore = app.firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    const host = hostSnapshot.data()
    const memberRole = (host?.['memberRoles'] ?? {})[decoded.uid]
    const orgPermissions = await resolveOrgPermissions(decoded.uid, { hostId })
    if (
      !host ||
      (memberRole !== 'admin' && !orgPermissions.permissions.manageMembers)
    ) {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    const memberRef = hostRef.collection('siteMembers').doc(memberId)
    const memberSnapshot = await memberRef.get()
    if (!memberSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown member' })
    }
    const email = String(memberSnapshot.get('email') ?? '')
    if (!email) {
      return res.status(400).json({ error: 'This member has no email address' })
    }

    // Same site-base resolution as membership-recover and campaign links:
    // custom domain first, else the aglyn.app subdomain.
    const subdomain = hostSnapshot.get('subdomain')
    const siteBase = hostSnapshot.get('cname')
      ? `https://${hostSnapshot.get('cname')}`
      : `https://${subdomain}.aglyn.app`
    const siteName = String(
      hostSnapshot.get('displayName') ?? subdomain ?? 'the site',
    )
    // White-label sender identity (White-Label Phase 3): the store's brand via
    // the one shared resolver; the copy already uses the site name.
    const branding = resolveBrandingProfile(
      (await getOrgForHost(hostId).catch(() => null))?.org as never,
    )

    if (action === 'sendPasswordReset') {
      // Throttled per recipient and per actor (AGL-920). Same caps as the
      // console surfaces — a site member's inbox is no less worth protecting
      // than a console user's.
      const throttle = await consumePasswordResetSend({
        actorKey: decoded.uid,
        recipientKey: email,
      })
      if (!throttle.allowed) {
        res.setHeader('Retry-After', String(throttle.retryAfterSeconds))
        return res
          .status(429)
          .json({ error: passwordResetThrottleMessage(throttle) })
      }
      if (!isEmailConfigured()) {
        return res.status(502).json({
          error: 'Email is not configured, so no reset link could be sent',
        })
      }
      // Same single-use, hash-bound token the self-serve flow mints
      // (AGL-552) — completing the reset rewrites `passwordScrypt`, which
      // retires the token without any server-side storage.
      const token = mintPasswordResetToken(
        hostId,
        memberId,
        memberSnapshot.get('passwordScrypt'),
      )
      const resetUrl = `${siteBase}/recover?token=${encodeURIComponent(token)}`
      const result = await sendEmail({
        to: email,
        subject: `Reset your ${siteName} password`,
        text:
          `An administrator of ${siteName} started a password reset for ` +
          'your account. Set a new password here:\n\n' +
          `${resetUrl}\n\n` +
          'The link works once and expires in 1 hour. Your current ' +
          'password keeps working until you use it.',
        fromName: branding.fromName,
        context: 'membership admin recovery',
      })
      if (!result.sent) {
        return res.status(502).json({
          error: 'The reset email could not be delivered',
        })
      }
      return res.status(200).json({ ok: true })
    }

    const validated = validateNewPassword(req.body?.password)
    if (validated.error) {
      return res.status(400).json({ error: validated.error })
    }
    // Rewriting the hash alone would NOT sign the member out: their session
    // is an HMAC cookie that never encodes the password (unlike a reset
    // token, which binds to it on purpose). The cut-off field is what
    // actually revokes the old sessions — see readActiveMemberSession.
    await memberRef.update({
      passwordScrypt: hashMemberPassword(validated.password),
      [MEMBER_SESSIONS_VALID_FROM_FIELD]: Date.now(),
    })
    // Best-effort: the password has already changed, so a mail failure must
    // not fail the request and send the admin round again. Report it so
    // they know to reach the member another way.
    let notified = false
    if (isEmailConfigured()) {
      const result = await sendEmail({
        to: email,
        subject: `Your ${siteName} password was changed`,
        text:
          `An administrator of ${siteName} set a new password on your ` +
          'account. You have been signed out on every device and will need ' +
          `the new password to sign back in at ${siteBase}.\n\n` +
          'If you did not expect this, contact the site owner.',
        fromName: branding.fromName,
        context: 'membership admin password change',
      })
      notified = result.sent
    }
    return res.status(200).json({ ok: true, notified })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Password operation failed' })
  }
}
