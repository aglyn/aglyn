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

import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { generateAuthActionLink } from './auth-action-link'
import { resolveAuthActionOrigin } from './auth-action-url'
import { renderSystemEmail } from './render-system-email'

// The password rules live in @aglyn/aglyn/server so the commerce plugin's
// site-member handler enforces exactly the same ones (AGL-914).
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
  type PasswordValidation,
} from '@aglyn/aglyn/server'

/**
 * Admin-initiated password help (AGL-910): the shared rules behind
 * "send a password reset" and "set a password" wherever an admin can act on
 * somebody else's account — staff on any user, org admins on a teammate,
 * site admins on a site member.
 *
 * **Passwords never leave this module.** Callers pass a candidate in and get
 * back a validated string or an error; nothing here writes one to an audit
 * entry, an activity log, or a console line, and neither may the callers.
 */

export interface OrgSetPasswordSubject {
  firestore: FirebaseFirestore.Firestore
  target: { uid: string; customClaims?: Record<string, unknown> | undefined }
  orgId: string
  ownerUid: unknown
  actorUid: string
}

/**
 * Whether an org admin may set this member's password — phrased as a reason
 * it is refused, or null when it is allowed (AGL-913).
 *
 * The question exists at all because Aglyn console accounts are GLOBAL
 * Firebase Auth identities rather than per-org records. One person has one
 * account no matter how many organizations they work with, so "set my
 * teammate's password" and "take over an account that also has access to
 * somebody else's workspace" can be the same action. These four checks
 * narrow it to the case where the org genuinely owns the whole account.
 *
 * Read by the GET so the console can explain the restriction up front, and
 * re-run by the POST — the GET answer is advice to the UI, never the
 * authority.
 */
export async function blockedReasonForOrgSetPassword(
  options: OrgSetPasswordSubject,
): Promise<string | null> {
  const { firestore, target, orgId, ownerUid, actorUid } = options
  if (target.uid === actorUid) {
    return 'Change your own password from your account settings.'
  }
  if (target.uid === ownerUid) {
    return "The organization owner's password can't be set here."
  }
  if (target.customClaims?.['staff'] === true) {
    return 'This account belongs to Aglyn staff — send a reset email instead.'
  }
  // The reverse index (users/{uid}/orgs) is the cheap way to ask "does this
  // account live anywhere but here?". A second org means setting the
  // password would hand this admin access to a workspace that is none of
  // their business, so they get the reset email instead.
  const otherOrgs = await firestore
    .collection('users')
    .doc(target.uid)
    .collection('orgs')
    .select()
    .get()
  if (otherOrgs.docs.some((entry) => entry.id !== orgId)) {
    return (
      'This account belongs to other organizations too, so its password ' +
      'can only be reset by email.'
    )
  }
  return null
}

/**
 * Console origin for links in the mail.
 *
 * The request headers are a hint; the answer comes from server config unless
 * the hint is allowlisted. These links go to someone who is about to be asked
 * to trust them with a password, so the host in them is not the caller's to
 * choose — even on a staff-authenticated route.
 */
export function originFromHeaders(
  headers: Partial<Record<string, string>>,
): string {
  return resolveAuthActionOrigin(
    headers.origin ?? (headers.host ? `https://${headers.host}` : ''),
  )
}

export interface PasswordMailOptions {
  email: string
  /** Console origin, from {@link originFromHeaders}. */
  origin: string
  /**
   * Who acted, as the recipient should see it. Staff act under a generic
   * label rather than a named individual; an org admin is named, because
   * "someone at your company" is what makes the mail make sense.
   */
  actorName: string
}

/**
 * Mails a password reset link for a **Firebase Auth** account (staff users
 * and org team members — site members have their own token scheme).
 *
 * The link itself is minted by the Admin SDK, so it is the same one-time
 * `oobCode` the self-serve flow uses and it lands on `/reset-password`. Only
 * the message around it is ours, which is what makes it designable: Firebase
 * sends `password-reset` from its own template, this sends
 * `admin-password-reset` from Resend.
 *
 * Returns false when mail is unconfigured or the send failed, so the caller
 * can tell the admin the mail did not go out. That is the opposite of the
 * visitor-facing recovery endpoint, which stays silent to avoid confirming
 * whether an account exists — an admin already knows the account exists, and
 * needs to know whether their action worked.
 */
export async function sendAuthPasswordResetEmail(
  options: PasswordMailOptions,
): Promise<boolean> {
  const { email, origin, actorName } = options
  if (!isEmailConfigured()) return false
  try {
    // Was the raw Admin-SDK link, which lands on
    // `aglyn-main.firebaseapp.com/__/auth/action` — the locked handler whose
    // template still reads `[aglyn.io]`. The comment above already claimed
    // this landed on `/reset-password`; going through the shared minter is
    // what makes that true, and it is the same one-time code either way.
    const resetUrl = await generateAuthActionLink('resetPassword', email, origin)
    const fallbackText =
      `${actorName} started a password reset for your Aglyn account. ` +
      'Choose a new password here:\n\n' +
      `${resetUrl}\n\n` +
      'The link expires shortly. If you were not expecting this, you can ' +
      'ignore this email — your password stays as it is.'
    const designed = await renderSystemEmail('admin-password-reset', {
      resetUrl,
      'actor.name': actorName,
    })
    const result = await sendEmail({
      to: email,
      subject: designed?.subject ?? 'Reset your Aglyn password',
      text: designed?.text || fallbackText,
      ...(designed?.html ? { html: designed.html } : {}),
      context: 'admin-password-reset',
    })
    return result.sent
  } catch (error) {
    console.error('admin password reset email failed', error)
    return false
  }
}

/**
 * Tells the account holder their password was set by somebody else.
 *
 * Best-effort on purpose: the password has already been changed by the time
 * this runs, so a mail failure must not fail the request or the admin will
 * retry an operation that already succeeded. Callers report the send result
 * to the admin instead, so they know to reach the person another way.
 */
export async function sendPasswordChangedNotice(
  options: PasswordMailOptions,
): Promise<boolean> {
  const { email, origin, actorName } = options
  if (!isEmailConfigured()) return false
  try {
    const fallbackText =
      `${actorName} set a new password on your Aglyn account. You have ` +
      'been signed out everywhere and will need the new password to sign ' +
      `back in at ${origin}.\n\n` +
      'If you did not expect this, contact whoever administers your ' +
      'account straight away.'
    const designed = await renderSystemEmail('password-changed-by-admin', {
      'actor.name': actorName,
      signInUrl: origin,
    })
    const result = await sendEmail({
      to: email,
      subject: designed?.subject ?? 'Your Aglyn password was changed',
      text: designed?.text || fallbackText,
      ...(designed?.html ? { html: designed.html } : {}),
      context: 'password-changed-by-admin',
    })
    return result.sent
  } catch (error) {
    console.error('password changed notice failed', error)
    return false
  }
}
