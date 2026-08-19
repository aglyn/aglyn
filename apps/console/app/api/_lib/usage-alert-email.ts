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
import {
  findUserByUidAcrossPools,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'
// From the LEAF, not the barrel (AGL-2407). Route- and cron-level specs mock
// `@aglyn/tenant-data-admin` wholesale — its graph reaches the admin SDK — and
// a `jest.mock` factory is a closed world, so a gate imported through the
// barrel is silently replaced by `undefined` or by whatever stub the factory
// lists. A suppression check that is not actually running is the exact defect
// this issue is about, one level up. Same reasoning as `email-events.ts`.
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'

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
 * collection read per alerting org, and (since AGL-2234) an auth-pool lookup
 * only for an owner or admin whose denormalized copy is MISSING, which is
 * normally none. Owners and admins only: the same audience `notifyOrgAdmins`
 * writes to, so the two channels cannot address different people.
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

/**
 * The most owner/admin uids one alert will chase through the auth pools.
 *
 * `findUserByUidAcrossPools` costs a call per enterprise tenant in the worst
 * case, so the fallback below has to have a ceiling even though it should
 * normally resolve zero uids. Lower than the recipient cap on purpose: this
 * bounds WORK, not audience.
 */
export const USAGE_ALERT_EMAIL_MAX_UID_LOOKUPS = 5

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
  /** Owners/admins whose member document carries no usable email. */
  const unresolved: string[] = []
  for (const member of members.docs) {
    const role = member.get('role')
    if (role !== 'owner' && role !== 'admin') continue
    const email = String(member.get('email') ?? '').trim()
    if (email.includes('@')) addresses.add(email.toLowerCase())
    else unresolved.push(member.id)
  }

  /*==========================================
   * THE AUTH-POOL FALLBACK (AGL-2234).
   *
   * This used to stop at the denormalized copy, on the reasoning that an auth
   * lookup per member turns a bounded read into an unbounded one. The
   * reasoning is right and the scope was wrong: the lookup is not per MEMBER,
   * it is per owner/admin whose denormalized copy is MISSING, which is
   * normally none.
   *
   * And the case is real. `createOrganization` writes `email: ownerEmail ??
   * null`, so an owner created from an identity that carried no address — SSO,
   * phone, a pre-backfill account — leaves the org with **no billing mail at
   * all**, permanently, and with nothing anywhere saying so. That is the
   * in-app-only failure AGL-2052 removed, wearing a different hat: the alert
   * fires, the guard records that it fired, and no person is told.
   *
   * Bounded three ways: owners and admins only, only when the denormalized
   * copy is absent, and hard-capped below so a pathological org cannot turn
   * one alert into an unbounded scan. Best-effort — a pool lookup that fails
   * leaves that admin unreachable, exactly as before.
   *=========================================*/
  const chased = unresolved.slice(0, USAGE_ALERT_EMAIL_MAX_UID_LOOKUPS)
  if (chased.length) {
    const resolved = await Promise.all(
      chased.map((uid) =>
        findUserByUidAcrossPools(uid).catch(() => null),
      ),
    )
    for (const pooled of resolved) {
      const email = String(pooled?.record?.email ?? '').trim()
      if (email.includes('@')) addresses.add(email.toLowerCase())
    }
  }

  return [...addresses].slice(0, USAGE_ALERT_EMAIL_MAX_RECIPIENTS)
}

/**
 * The failure reason, or `null` when the send succeeded.
 *
 * `SendEmailResult` is a discriminated union and this repo's cross-library
 * narrowing does not survive the import — reading `.reason` off the union
 * directly is a `TS2339` even inside a `sent === false` branch. The cast
 * lives here once, next to the reason for it, rather than at each call site
 * where it would read as carelessness.
 */
export function emailFailureReason(result: SendEmailResult): string | null {
  if (result.sent) return null
  return (result as { reason?: string }).reason ?? null
}

/**
 * STAFF ALERTS BY EMAIL (AGL-2234) — the other half of AGL-2052.
 *
 * That issue found that `notifyOrgAdmins` writes a Firestore document nothing
 * turns into mail, and fixed the customer-facing alerts. `notifyStaff` is the
 * same function one audience over and still had the same defect, which
 * matters most on the one alert it carries: the Assist margin guard is the
 * only dollar figure on a meter whose other ceiling is a MESSAGE COUNT, and it
 * is not an alert anyone will be sitting in the console waiting for.
 *
 * `STAFF_ALERT_EMAIL` is the address `admin/audit-archive` already alerts on,
 * so staff have one inbox rather than one per subsystem. Unset is the ordinary
 * answer in local and preview environments and reports `unconfigured`, not an
 * error — like every other sender here, this never throws.
 */
export async function emailStaffAlert(input: {
  subject: string
  text: string
  context: string
}): Promise<SendEmailResult> {
  const to = String(process.env.STAFF_ALERT_EMAIL ?? '').trim()
  if (!to.includes('@')) return { sent: false, reason: 'unconfigured' }
  try {
    const result = await sendEmail({
      to,
      subject: input.subject,
      text: input.text,
      context: input.context,
    })
    // Platform-scoped (AGL-1438): our own staff alert is our own cost, and
    // charging an org for the mail that says we are spending money on it
    // would be its own small absurdity.
    if (result.sent) await meterPlatformEmail().catch(() => undefined)
    return result
  } catch (error) {
    console.error('[usage-alert-email] staff alert failed', error)
    return { sent: false, reason: 'network' }
  }
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
    const resolved = await orgAdminEmails(input.firestore, input.orgId)
    /*
     * The platform suppression list (AGL-2407). THIS is a reader for it, and
     * the reason this fan-out is one of the two:
     *
     * It is a monthly-ish cron over every owner and admin of every org. An
     * address that hard-bounced here bounces again on the next sweep and the
     * one after, forever, because nothing ever looked. Repeat delivery to a
     * mailbox that has permanently said it does not exist is exactly what a
     * mailbox provider scores a sending domain on, and `aglyn.com` carries
     * the password resets and receipts on the same key.
     *
     * The gate is here and NOT in `sendEmail` on purpose. A password reset,
     * a verification or an invite answers something the human just did;
     * refusing one because an address once bounced would lock a real customer
     * out of their own account. AGL-1438 drew the same line for quotas — only
     * discretionary mail may be refused — and this is the same line.
     */
    const to = await filterSuppressedEmails(resolved, input.firestore)
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
