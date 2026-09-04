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

import {
  firebaseAdmin,
  listOrgMembers,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'
/*
 * From the LEAF, not the barrel (AGL-2407), for the reason
 * `usage-alert-email.ts` states: the review route's own spec mocks
 * `@aglyn/tenant-data-admin` wholesale because its graph reaches the admin
 * SDK, and a `jest.mock` factory is a closed world. A gate imported through
 * the barrel is silently replaced by `undefined` or by whatever the factory
 * happens to list, which is a check that reads as present and runs never.
 */
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import { sendEmail } from '@aglyn/shared-util-email'

/**
 * Emails a publisher's owners and admins about a review outcome (AGL-972).
 *
 * In-app notifications alone assume the publisher is sitting in the console
 * — but review is asynchronous by nature: a submission can wait days, and
 * the publisher has no reason to keep checking. Best effort, and never
 * allowed to fail the verdict that triggered it.
 *
 * ## The platform hard-bounce list, and deliberately NOT the marketing gate
 *
 * This is the console's one multi-recipient platform fan-out, and a fan-out
 * is the shape the suppression list exists for: a publisher who submits
 * monthly is mailed monthly, and an address that permanently bounced is
 * re-attempted on every submission forever unless something looks. Repeat
 * delivery to a mailbox that has said it does not exist is what a mailbox
 * provider scores a sending domain on, and `aglyn.com` carries the password
 * resets and receipts on the same key.
 *
 * So it reads {@link filterSuppressedEmails} — the PLATFORM list, which
 * answers "did this mailbox permanently fail, or did its owner report spam,
 * anywhere in the product". It does not read `filterSendableForHost`: that
 * one adds `hosts/{hostId}/suppressions`, whose entries mean "not from this
 * SITE'S campaigns", and a review verdict is sent on no site's behalf. There
 * is no host to key it by, and a publisher opting out of their own site's
 * marketing says nothing about whether they want to hear that their plugin
 * was rejected.
 *
 * It also does not pass the marketing gate. A review verdict is a platform
 * notice to a publisher about their own submission — nearer a receipt than a
 * newsletter — and the gate would apply a topic the publisher never
 * subscribed to and a frequency cap that would silently drop the second
 * verdict of a busy week.
 */
export async function emailPublisher(
  orgId: string,
  subject: string,
  text: string,
  /** Injectable for tests; the list read defaults to the admin Firestore. */
  options?: { firestore?: any },
): Promise<void> {
  try {
    const members = await listOrgMembers(orgId)
    const uids = members
      .filter((member) => member.role === 'owner' || member.role === 'admin')
      .map((member) => member.$id)
    if (!uids.length) return
    const users = await firebaseAdmin
      .app()
      .auth()
      .getUsers(uids.map((uid) => ({ uid })))
    const addresses = users.users
      .map((user) => user.email)
      .filter((email): email is string => Boolean(email))
    // Per address, so one dead mailbox among a publisher's admins does not
    // silence the verdict for the rest of them.
    const recipients = await filterSuppressedEmails(
      addresses,
      options?.firestore,
    )
    if (!recipients.length) return
    const results = await Promise.all(
      recipients.map((to) =>
        sendEmail({ to, subject, text, context: 'plugin review update' }),
      ),
    )
    // Cost meter (AGL-1438). Platform-scoped: marketplace review is Aglyn's
    // own workflow talking to a publisher, not mail the publisher's org sent.
    await meterPlatformEmail(results.filter((result) => result.sent).length)
  } catch (error) {
    console.error('publisher review email failed', error)
  }
}
