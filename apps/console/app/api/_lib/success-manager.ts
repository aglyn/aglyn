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
import { firebaseAdmin, meterPlatformEmail } from '@aglyn/tenant-data-admin'

/**
 * The named success manager an Enterprise org is promised (AGL-2332).
 *
 * `support-tiers.md` and the console both say a named success manager is
 * copied on every ticket. Behind that sentence there was a bare
 * `namedManager: true` boolean, **no field naming anyone**, and nothing
 * reading it at ticket creation — `notifyStaff` raised one generic staff
 * alert and that was the whole mechanism. Of every support promise audited
 * it was the only straight product claim with no implementation.
 *
 * ## Where it is stored, and why not on the org doc
 *
 * `orgs/{orgId}/support/manager`, written only through the Admin SDK.
 *
 * The obvious home was `org.support.successManagerEmail`, but the org doc's
 * `allow update` rules are three DENY-lists, not allowlists — so a key not
 * named in them is writable by any org owner or admin. An org admin could
 * therefore appoint their own success manager and have the platform email an
 * address of their choosing, and the console would then render "your success
 * manager is copied on every ticket" as *true* about someone we never
 * assigned. That defeats the point of making the sentence honest.
 *
 * There is no `match` for `orgs/{orgId}/support/**` and no `{document=**}`
 * wildcard inside the org block, so this path is **default-deny** for every
 * client. That needs no rules edit and therefore has no deploy-ordering
 * window in which the field exists but the guard does not.
 */
export interface OrgSuccessManager {
  /** The human's name, as the customer should know them. */
  name: string
  /** Where the cc goes. */
  email: string
}

/** `orgs/{orgId}/support/manager` — staff-written, client-unreadable. */
const SUPPORT_COLLECTION = 'support'
const MANAGER_DOC = 'manager'

const managerRef = (orgId: string) =>
  firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection(SUPPORT_COLLECTION)
    .doc(MANAGER_DOC)

const trimmed = (value: unknown, max: number) =>
  String(value ?? '')
    .trim()
    .slice(0, max)

/**
 * A plausible address. Deliberately loose — this is staff-entered, and the
 * real check is that a typo fails visibly at send time rather than being
 * rejected here for the shape of somebody's corporate address.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * The org's named manager, or `null`.
 *
 * `null` for a failed read as much as for an unset one — this is decoration
 * on a support ticket, and a Firestore hiccup must not stop a customer
 * opening one. The caller's job is to say nothing rather than to claim
 * something.
 */
export async function readSuccessManager(
  orgId: string | null | undefined,
): Promise<OrgSuccessManager | null> {
  if (!orgId) return null
  try {
    const snapshot = await managerRef(orgId).get()
    if (!snapshot.exists) return null
    const email = trimmed(snapshot.get('email'), 200)
    if (!email) return null
    return { name: trimmed(snapshot.get('name'), 120) || email, email }
  } catch {
    return null
  }
}

/** Assigns or clears the manager. Staff only — enforced by the caller. */
export async function writeSuccessManager(
  orgId: string,
  manager: OrgSuccessManager | null,
  actorUid: string,
): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  if (!manager) {
    await managerRef(orgId).delete()
  } else {
    await managerRef(orgId).set(
      {
        name: manager.name,
        email: manager.email,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      },
      { merge: true },
    )
  }
  await firestore
    .collection('adminAudit')
    .add({
      actorUid,
      action: manager ? 'org.successManagerSet' : 'org.successManagerCleared',
      target: `orgs/${orgId}/support/manager`,
      before: null,
      after: manager ? { name: manager.name, email: manager.email } : null,
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
}

export interface TicketCopyDetails {
  orgId: string
  orgName?: string | null
  ticketId: string
  subject: string
  fromEmail?: string | null
  body: string
  /** `reply` for a customer follow-up on an existing thread. */
  kind: 'opened' | 'reply'
}

/**
 * Copies the named manager on a ticket. **Returns the send result** — it is
 * never thrown away.
 *
 * `sendEmail` resolves `{ sent: false, reason: 'unconfigured' }` rather than
 * throwing when Resend has no key, and a cc that silently resolves false
 * recreates precisely the defect this whole change is repairing: a sentence
 * in the console with nothing behind it. The ticket route records the
 * outcome on the ticket, so "was the manager actually copied" is a fact on
 * the document rather than an assumption.
 *
 * Metered as a PLATFORM email, not against the org. This is Aglyn keeping
 * its own commitment; billing the customer's email allowance for it would be
 * charging them to be told what they were promised.
 */
export async function copyManagerOnTicket(
  manager: OrgSuccessManager,
  details: TicketCopyDetails,
): Promise<SendEmailResult> {
  const origin = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'
  const link = `${origin}/admin/support?ticketId=${details.ticketId}`
  const opened = details.kind === 'opened'
  const who = details.orgName || details.orgId
  const result = await sendEmail({
    to: manager.email,
    subject: `${opened ? 'New ticket' : 'Ticket reply'} — ${who}: ${details.subject}`,
    text: [
      `${manager.name},`,
      '',
      opened
        ? `${who} opened a support ticket.`
        : `${who} replied on a support ticket.`,
      details.fromEmail ? `From: ${details.fromEmail}` : '',
      '',
      details.subject,
      '',
      details.body,
      '',
      link,
    ]
      .filter((line) => line !== '')
      .join('\n'),
    context: `support-manager-${details.kind}`,
  })
  if (result.sent) await meterPlatformEmail()
  return result
}
