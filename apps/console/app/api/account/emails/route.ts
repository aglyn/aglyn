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
  addAccountEmail,
  confirmAccountEmail,
  consumeRateLimit,
  firebaseAdmin,
  issueVerificationToken,
  listAccountEmails,
  meterPlatformEmail,
  removeAccountEmail,
  setPrimaryAccountEmail,
} from '@aglyn/tenant-data-admin'
import { renderSystemEmail } from '../../_lib/render-system-email'

// lockdown-423: exempt — account recovery/verification must always work, and
// this is the surface that keeps an account reachable. Every write here is
// scoped to the caller's own uid and grants nothing outside it.

/**
 * Several email addresses per account (AGL-2486) — the management surface.
 *
 * GitHub's model: an account
 * holds a handful of independently verified addresses, exactly one of them
 * primary, and any verified one may be used to sign in. See
 * `@aglyn/aglyn/app-utils/account-emails` for the policy and, more
 * importantly, for the rule this whole feature is shaped around —
 * **adding an address NEVER grants organization access.**
 *
 * ## Why every write is here rather than client-direct
 *
 * `users/{uid}` is `allow read, write` for its owner with no field
 * validation, so a row stored on that document would be a row its owner could
 * forge. `verified` is the entire security property — a verified address is a
 * sign-in identifier and can be promoted to primary, and the primary is the
 * Firebase Auth record's email that `decoded.email` carries. So the rows live
 * in a server-write-only subcollection and every transition runs here, behind
 * the caller's own token.
 *
 * ## The uid is the TOKEN'S uid, always
 *
 * There is no uid parameter on any method. That is the whole access control:
 * a uid in the request would turn "manage my addresses" into "manage
 * anyone's".
 *
 * ## Verification mail
 *
 * NOT Firebase's `generateAuthActionLink('verifyEmail', …)`. That link
 * verifies the AUTH RECORD's address, and a secondary address is by
 * definition not that — pointing it at one would either do nothing or, worse,
 * be interpreted against the primary. So this issues its own single-use,
 * digest-stored token and lands on `/account-recovery`-style confirmation
 * handled by the `confirm` action below.
 */

const CONFIRM_PATH = '/manage/user'

interface DecodedCaller {
  uid: string
  email: string | null
  emailVerified: boolean
  tenantId: string | null
}

/**
 * Verify the bearer token in whichever pool it belongs to.
 *
 * An SSO account lives in its org's GCIP tenant and is invisible to
 * project-level verification (AGL-1122), so peeking at the tenant claim and
 * re-verifying against THAT tenant is what makes this route work at all for
 * enterprise users — and re-verifying rather than trusting the peek is what
 * stops a forged tenant claim slipping through.
 */
async function verifyCaller(idToken: string): Promise<DecodedCaller> {
  const auth = firebaseAdmin.app().auth()
  const peek = await auth.verifyIdToken(idToken)
  const tenantId = peek.firebase?.tenant
  const decoded = tenantId
    ? await auth.tenantManager().authForTenant(tenantId).verifyIdToken(idToken)
    : peek
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    emailVerified: decoded.email_verified === true,
    tenantId: tenantId ?? null,
  }
}

function bearer(headers: Partial<Record<string, string>>): string | undefined {
  const authorization = headers.authorization ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
}

/**
 * Send the confirmation link for one address.
 *
 * Rate-limited per uid AND per destination address. Per uid alone would let
 * one account walk a list of addresses; per address alone would let many
 * accounts gang up on one mailbox. Both, because this endpoint puts our
 * return address on mail aimed at an inbox its owner has not agreed to hear
 * from — the mailbomb shape `send-verification` names.
 */
async function sendConfirmation(
  uid: string,
  address: string,
  secret: string,
  origin: string,
): Promise<{ sent: boolean; status: number; error: string | null }> {
  const perUser = await consumeRateLimit(`account-email-verify:${uid}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (!perUser.allowed) {
    return {
      sent: false,
      status: 429,
      error: 'Too many confirmation emails — try again in an hour.',
    }
  }
  const perAddress = await consumeRateLimit(`account-email-target:${address}`, {
    limit: 3,
    windowMs: 60 * 60 * 1000,
  })
  if (!perAddress.allowed) {
    return {
      sent: false,
      status: 429,
      error: 'Too many confirmation emails for that address — try again later.',
    }
  }
  if (!isEmailConfigured()) {
    return { sent: false, status: 501, error: 'Email is not configured' }
  }

  const confirmUrl = `${origin}${CONFIRM_PATH}?confirmEmail=${encodeURIComponent(secret)}`
  const fallbackText =
    `Confirm this address so you can use it with your ${PLATFORM_BRAND_NAME} ` +
    'account:\n\n' +
    `${confirmUrl}\n\n` +
    'If you did not ask to add this address, you can ignore this email — ' +
    'nothing has changed and the address has not been added to any account.'
  const designed = await renderSystemEmail('email-verification', {
    verifyUrl: confirmUrl,
  })
  const result = await sendEmail({
    to: address,
    subject: designed?.subject ?? 'Confirm your email address',
    text: designed?.text || fallbackText,
    ...(designed?.html ? { html: designed.html } : {}),
    context: 'email-verification',
  })
  if (!result.sent) {
    return { sent: false, status: 502, error: 'Sending the email failed' }
  }
  void meterPlatformEmail()
  return { sent: true, status: 200, error: null }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const idToken = bearer(headers)

  // The confirmation link is the ONE unauthenticated path, deliberately: the
  // person who opened the mailbox may not be signed in on that device, and
  // requiring a session first is how confirmation links strand people. The
  // token carries the uid and can do exactly one thing.
  if (method === 'POST' && (body as any)?.action === 'confirm') {
    const outcome = await confirmAccountEmail((body as any)?.token)
    if (!outcome.ok) {
      return Response.json(
        { error: outcome.message, reason: outcome.refusal },
        { status: outcome.refusal === 'claimed-by-another-account' ? 409 : 400 },
      )
    }
    return Response.json({ ok: true, address: outcome.address }, { status: 200 })
  }

  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const caller = await verifyCaller(idToken)
    const requestOrigin =
      headers.origin ?? (headers.host ? `https://${headers.host}` : '')

    if (method === 'GET') {
      const emails = await listAccountEmails(
        caller.uid,
        caller.email,
        caller.emailVerified,
      )
      return Response.json({ emails }, { status: 200 })
    }

    if (method === 'DELETE') {
      const outcome = await removeAccountEmail(caller.uid, (body as any)?.address)
      if (!outcome.ok) {
        return Response.json(
          { error: outcome.message, reason: outcome.refusal },
          { status: 400 },
        )
      }
      return Response.json({ ok: true }, { status: 200 })
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const action = String((body as any)?.action ?? 'add')

    if (action === 'add') {
      const outcome = await addAccountEmail(caller.uid, (body as any)?.address)
      if (!outcome.ok) {
        return Response.json(
          { error: outcome.message, reason: outcome.refusal },
          { status: outcome.refusal === 'claimed-by-another-account' ? 409 : 400 },
        )
      }
      const mail = await sendConfirmation(
        caller.uid,
        String(outcome.address),
        String(outcome.secret),
        requestOrigin,
      )
      // The row is staged either way — it is unverified, so it does nothing,
      // and leaving it lets the card offer "resend" instead of making the
      // person retype the address into a form that just failed.
      if (!mail.sent) {
        return Response.json(
          { ok: true, address: outcome.address, sent: false, error: mail.error },
          { status: mail.status === 429 ? 429 : 202 },
        )
      }
      return Response.json(
        { ok: true, address: outcome.address, sent: true },
        { status: 200 },
      )
    }

    if (action === 'resend') {
      const emails = await listAccountEmails(
        caller.uid,
        caller.email,
        caller.emailVerified,
      )
      const address = String((body as any)?.address ?? '').trim().toLowerCase()
      const row = emails.find((entry) => entry.address === address)
      // Only an address ALREADY on this account, and only an unverified one.
      // Without both checks this action would be an open relay pointed at any
      // address the caller cared to name.
      if (row === undefined) {
        return Response.json(
          { error: 'That address is not on this account.' },
          { status: 404 },
        )
      }
      if (row.verified === true) {
        return Response.json({ ok: true, alreadyVerified: true }, { status: 200 })
      }
      const secret = await issueVerificationToken(caller.uid, address)
      const mail = await sendConfirmation(caller.uid, address, secret, requestOrigin)
      if (!mail.sent) {
        return Response.json({ error: mail.error }, { status: mail.status })
      }
      return Response.json({ ok: true, sent: true }, { status: 200 })
    }

    if (action === 'primary') {
      const outcome = await setPrimaryAccountEmail(
        caller.uid,
        (body as any)?.address,
        { tenantId: caller.tenantId },
      )
      if (!outcome.ok) {
        // 403 for the two SSO refusals — they are policy, not a malformed
        // request, and the card renders them as an explanation rather than a
        // validation error.
        const forbidden =
          outcome.refusal === 'sso-governed-escape' ||
          outcome.refusal === 'sso-governed-lockout'
        return Response.json(
          { error: outcome.message, reason: outcome.refusal },
          { status: forbidden ? 403 : 400 },
        )
      }
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[account/emails] failed', error)
    return Response.json({ error: 'Could not update your email addresses' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST, handler as DELETE }
