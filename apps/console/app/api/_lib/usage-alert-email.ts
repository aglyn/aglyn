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

import { sendEmail, type SendEmailResult } from '@aglyn/shared-util-email'
import { meterPlatformEmail } from '@aglyn/tenant-data-admin'

/**
 * BILLING ALERTS BY EMAIL (AGL-2052, for AGL-1528).
 *
 * ## The defect this closes
 *
 * `usage-alerts` is the platform's only pre-invoice warning, and its header
 * claimed for months that it "emails org admins". It never did. Its one
 * delivery call is `notifyOrgAdmins`, which batch-writes a document per
 * recipient at `users/{uid}/notifications` — and nothing anywhere in this
 * repo turns such a document into mail. There is no Firestore trigger; the
 * console bell menu was the entire delivery surface.
 *
 * So the warning reached only people already signed in and looking at the
 * console. Since AGL-1886/AGL-2033 metered storage past the included band
 * BILLS by default rather than being refused, and `utils/storage-overage.ts`
 * names this notification as the whole of the protection — Zach, verbatim:
 * "*with overage protection + usage alerts, so customers don't get a surprise
 * bill*". The customer who gets the surprise bill is exactly the customer who
 * was not in the console. An in-app-only alert cannot discharge that promise.
 *
 * ## Shape
 *
 * Best-effort, like every other outbound path here: `sendEmail` never throws
 * and this never rethrows, because a bounced warning must not abort the sweep
 * that is warning everybody else. The console notification is written first
 * and independently, so a mail outage degrades to what the platform did
 * before rather than to nothing.
 *
 * Recipients come from the org's own member documents, whose `email` is the
 * denormalized copy the member list already renders — so this costs ONE
 * collection read per alerting org and no auth lookups. Owners and admins
 * only: the same audience `notifyOrgAdmins` writes to, so the two channels
 * cannot address different people.
 */

/**
 * Absolute base for links inside billing mail.
 *
 * A notification document carries a PATH because the console resolves it in
 * the browser; an email has no such context, so every link it carries must be
 * absolute or it is a dead link. Same fallback as `security-alerts` and
 * `render-system-email`, so all system mail points at one origin.
 */
export function consoleOrigin(): string {
  return process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'
}

/** The most admins one org can mail per alert — a runaway bound, not a policy. */
export const USAGE_ALERT_EMAIL_MAX_RECIPIENTS = 25

export interface UsageAlertEmailInput {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  subject: string
  /** Plain-text body. Already includes the console link. */
  text: string
  /** Resend tag / log label, e.g. `usage-alert` or `usage-budget`. */
  context: string
}

/**
 * The org's owner/admin email addresses, deduplicated.
 *
 * Exported for the spec: the recipient set IS the feature, and a fan-out that
 * quietly resolves to zero addresses is the in-app-only failure wearing a
 * different hat.
 */
export async function orgAdminEmails(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<string[]> {
  const members = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .get()
  const addresses = new Set<string>()
  for (const member of members.docs) {
    const role = member.get('role')
    if (role !== 'owner' && role !== 'admin') continue
    const email = String(member.get('email') ?? '').trim()
    // A member document with no denormalized email is skipped rather than
    // chased through the auth pools: this runs inside a per-org sweep, and an
    // admin lookup per member would turn a bounded read into an unbounded one.
    if (email.includes('@')) addresses.add(email.toLowerCase())
  }
  return [...addresses].slice(0, USAGE_ALERT_EMAIL_MAX_RECIPIENTS)
}

/**
 * Emails every owner/admin of an org. Never throws.
 *
 * Returns the send result so a caller can log it; `sent: false` with reason
 * `unconfigured` is the ordinary answer in local and preview environments and
 * is not an error.
 */
export async function emailOrgAdmins(
  input: UsageAlertEmailInput,
): Promise<SendEmailResult> {
  try {
    const to = await orgAdminEmails(input.firestore, input.orgId)
    if (!to.length) return { sent: false, reason: 'no-recipient' }
    const result = await sendEmail({
      to,
      subject: input.subject,
      text: input.text,
      context: input.context,
    })
    // The AGL-1438 cost meter. Platform-scoped rather than charged to the
    // org: billing an org for the email that warns it about its bill would be
    // its own small absurdity.
    if (result.sent) await meterPlatformEmail().catch(() => undefined)
    return result
  } catch (error) {
    console.error('[usage-alert-email] fan-out failed', input.orgId, error)
    return { sent: false, reason: 'network' }
  }
}
