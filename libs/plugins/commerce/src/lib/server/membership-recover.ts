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
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import { hostPublicOrigin } from '@aglyn/aglyn/server'
import {
  consumeMembershipRecoverAttempt,
  consumeMembershipRecoverSend,
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  isEmailSuppressed,
  meterHostEmail,
  RECOVER_MIN_MEMBER_AGE_MS,
} from '@aglyn/tenant-data-admin'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { mintPasswordResetToken } from './membership'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Password-recovery request (AGL-552). ALWAYS answers `200 {ok:true}` once
 * the input validates and the caller is inside its rate budget — whether or
 * not the email belongs to a member — so the endpoint can't be used to probe
 * account existence. When a member matches, a single-use one-hour token
 * (bound to the current password hash, see membership.ts) is mailed via
 * Resend with a link to the site's `/recover` route.
 *
 * ## Abuse controls (AGL-1966)
 *
 * This is an unauthenticated endpoint that makes us send mail from
 * `noreply@aglyn.com` to an address the caller chose, and it composes with
 * `membership/register` — which admits arbitrary addresses because member
 * accounts are unlimited on every plan (AGL-889) — into a mail relay. The
 * bounces from that land on the sending reputation shared by every customer's
 * transactional mail.
 *
 * Four controls, in the order they run, and the ORDER is part of each:
 *
 * 1. **Attempt caps** — per recipient and per IP, durable
 *    (`membership-recover-throttle.ts`). Consumed BEFORE the member lookup so
 *    a member and a non-member spend the identical budget and receive the
 *    identical answer; a visible 429 from here therefore leaks nothing. The
 *    per-instance `Map` this replaced reset on every cold start and was kept
 *    per instance, which on Vercel is close to no limit at all (AGL-794).
 * 2. **The young-member guard** — a member row created inside
 *    `RECOVER_MIN_MEMBER_AGE_MS` is not worth a reset mail. Register-then-
 *    recover is the whole attack and nobody forgets a password ten minutes
 *    after choosing it. Silent-success exit.
 * 3. **The platform suppression list** — see the note on the call below.
 *    Silent-success exit.
 * 4. **The per-site daily send ceiling** — consumed only when a message is
 *    actually about to go out. Because that branch is reachable only for real
 *    members, its refusal MUST be the silent-success exit rather than an
 *    error, or the ceiling becomes the oracle everything else avoids.
 *
 * What remains unbounded is stated rather than papered over: a genuine botnet
 * still gets `RECOVER_ATTEMPTS_PER_IP` per source, and an attacker who can
 * create many sites gets the per-site ceiling once per site. Host creation is
 * itself rate-limited, and bounding the botnet case needs an edge WAF, not an
 * application limiter — the same conclusion `plugin-api-rate-limit.ts` reaches.
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
  // Null when nothing readable names the caller; the throttle then skips its
  // per-source cap and the per-recipient one carries the control alone.
  const ip = readClientIp(req.headers, {
    remoteAddress: req.socket?.remoteAddress,
  })
  // Control 1. Before the lookup, so both branches spend the same budget.
  // A store failure degrades to the in-process cap rather than refusing
  // (`consumeRateLimit` fails soft on an unreachable store, closed on
  // contention) — a Firestore blip must not lock every site's members out of
  // their own password reset.
  const attempt = await consumeMembershipRecoverAttempt({ email, ip })
  if (!attempt.allowed) {
    res.setHeader('Retry-After', String(attempt.retryAfterSeconds))
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
    // Control 2 — the register-then-recover composition (AGL-1966).
    //
    // `createdAt` is a server timestamp written by `membership-register.ts`.
    // A row that has none is a legacy member, not a fresh one: rows predating
    // the field must NOT be refused, so an unreadable or absent value reads as
    // "old enough". This guard exists to refuse a member created seconds ago,
    // which is a case where the field is always present by construction.
    const createdAtMs = (() => {
      const raw = memberDoc.get('createdAt') as
        | { toMillis?: () => number }
        | undefined
      try {
        return typeof raw?.toMillis === 'function' ? raw.toMillis() : null
      } catch {
        return null
      }
    })()
    if (
      createdAtMs !== null &&
      Date.now() - createdAtMs < RECOVER_MIN_MEMBER_AGE_MS
    ) {
      return res.status(200).json({ ok: true })
    }
    // Control 3 — the platform suppression list (AGL-1918 / AGL-2407).
    //
    // `email-suppression.ts` argues that TRANSACTIONAL mail deliberately does
    // not consult this list, because refusing a password reset over an
    // unrelated old bounce locks a real customer out of their own account.
    // That argument is about mail a signed-in human just asked us for. It does
    // not reach here, and this is the exception it does not cover:
    //
    //  - The address is chosen by an ANONYMOUS caller, not by the account
    //    holder. "The human just did something" is exactly the premise that is
    //    missing on an unauthenticated endpoint.
    //  - The list holds PERMANENT bounces and spam complaints only — transient
    //    bounces are excluded at the webhook. A permanent bounce means the
    //    mailbox does not exist, so the send cannot reach anyone; all it can do
    //    is tell a provider that `aglyn.com` re-mails dead addresses. There is
    //    no locked-out customer on the other side of it to protect.
    //  - The reputational cost is shared by every customer's transactional
    //    mail, which is precisely what AGL-1966 is about.
    //
    // The HOST list (`hosts/{hostId}/suppressions`) is deliberately NOT
    // consulted: it also holds marketing unsubscribes, and unsubscribing from
    // a store's newsletter must never stop that store's password resets.
    //
    // `isEmailSuppressed` fails CLOSED — a read that throws answers "treat as
    // suppressed". That adds no new outage mode here: the member lookup above
    // is a Firestore read on the same database, so a Firestore outage has
    // already taken this handler to its silent-success catch.
    if (await isEmailSuppressed(email)) {
      return res.status(200).json({ ok: true })
    }
    if (!isEmailConfigured()) {
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
    // `hostPublicOrigin`, not a hand-rolled apex (AGL-2195). This URL is
    // minted server-side and mailed out, so a wrong apex is not a display
    // bug — it is a live link on somebody else's domain.
    const siteBase =
      hostPublicOrigin({
        cname: hostSnapshot.get('cname'),
        subdomain: hostSnapshot.get('subdomain'),
      }) ?? ''
    const resetUrl = `${siteBase}/recover?token=${encodeURIComponent(token)}`
    const siteName = String(
      hostSnapshot.get('displayName') ?? hostSnapshot.get('subdomain') ?? 'your site',
    )
    // White-label sender identity (White-Label Phase 3): the store's brand via
    // the one shared resolver (the copy already uses the site name).
    const branding = resolveBrandingProfile(
      (await getOrgForHost(hostId).catch(() => null))?.org as never,
    )
    // Control 4 — the per-site daily ceiling on recovery mail (AGL-1966).
    //
    // Consumed here, as late as possible, because it counts MESSAGES and not
    // requests: everything above this line can refuse without having decided
    // to send, and a counter that ticked for those would exhaust a site's
    // budget on traffic that never cost a message.
    //
    // The refusal is the silent-success exit, NOT a 429. This branch is
    // reachable only for an address that really is a member, so a visible
    // error here would be the existence oracle the whole handler is built to
    // avoid — the one place where the cheap answer is the wrong one.
    //
    // The accepted cost: during an attack on a site, a genuine member can get
    // no mail and no error. The ceiling is sized more than an order of
    // magnitude above any real site's daily resets so that reaching it is
    // evidence of the attack rather than of a busy Tuesday.
    const sendBudget = await consumeMembershipRecoverSend({ hostId })
    if (!sendBudget.allowed) {
      console.error('membership/recover: daily send ceiling reached', {
        hostId,
        retryAfterSeconds: sendBudget.retryAfterSeconds,
      })
      return res.status(200).json({ ok: true })
    }
    await sendEmail({
      to: email,
      subject: `Reset your ${siteName} password`,
      text:
        `Someone asked to reset the password for your ${siteName} ` +
        'account. If that was you, set a new password here:\n\n' +
        `${resetUrl}\n\n` +
        'The link works once and expires in 1 hour. If you did not ' +
        'ask for this, you can safely ignore this email — your ' +
        'password is unchanged.',
      fromName: branding.fromName,
      sendingIdentity: await hostSendingIdentity(hostId),
      audience: 'tenant',
      context: 'membership recovery',
    })
    // Cost meter (AGL-1438). Transactional, and the clearest case for why a
    // quota may not refuse one: this email is how the member gets back into
    // their account.
    await meterHostEmail(hostId)
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    // Even a backend failure stays silent-success: the enumeration
    // contract beats the visitor's error visibility here, and the send is
    // best-effort by design.
    return res.status(200).json({ ok: true })
  }
}
