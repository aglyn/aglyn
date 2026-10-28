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

import { isAccountBanLockdownReason, normalizeOrgLockdown } from '@aglyn/aglyn/app-utils/lockdown'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { POS_CELLULAR_EMAIL_KEYS, sendEmail } from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  hostDisplayName,
  listOrgMembers,
  memberHasOrgPermission,
  meterPlatformEmail,
  notifyOrgAdmins,
} from '@aglyn/tenant-data-admin'
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  orgSystemEmailBrand,
  renderSystemEmailContent,
} from '@aglyn/tenant-data-admin/server/render-system-email'
import { posCellularMonthLabel } from '../model/pos-cellular'

/*==========================================
 * TELLING THE WORKSPACE THAT 4G WAS TURNED OFF (AGL-4038).
 *
 * When a month's 4G charge is still unpaid after the grace period and 4G is
 * turned off for the workspace's stores (`pos-cellular-billing.ts`), the
 * members who hold "Manage billing" get the designed system email
 * (`pos-cellular-emails.ts` in the email library): the month, the amount,
 * the stores, and the way back. The console's notification feed says the
 * same, without mailing it twice.
 *
 * Returns whether anyone was told, so the caller records the notice once.
 * Never throws: 4G is already off when this runs, and a lost email must not
 * undo that or stop the daily run.
 *=========================================*/

/** What the notice says. */
export interface PosCellularTurnedOffNotice {
  orgId: string
  month: string
  /** Formatted, e.g. `$21.65`. */
  amount: string
  readers: number
  openedAtMs: number
  turnedOffAtMs: number
  hostIds: string[]
}

const day = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export async function sendPosCellularTurnedOffNotice(notice: PosCellularTurnedOffNotice): Promise<boolean> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const org = await firestore.collection('orgs').doc(notice.orgId).get().catch(() => null)
    // A ban is a ban (AGL-3420): after its notice the account is sent nothing.
    const lock = normalizeOrgLockdown(org?.data() as never)
    if (lock && isAccountBanLockdownReason(lock.reason)) return false
    const slug = String(org?.get('slug') ?? '').trim()
    const billingPath = slug ? `/${slug}/billing` : '/billing'
    const hosts = await Promise.all(
      notice.hostIds.map((hostId) => firestore.collection('hosts').doc(hostId).get().catch(() => null)),
    )
    const stores = hosts
      .map((host, index) =>
        host?.exists ? hostDisplayName(host.data() as Record<string, unknown>, notice.hostIds[index]) : null,
      )
      .filter((name): name is string => Boolean(name))
    const month = posCellularMonthLabel(notice.month)
    const merge: Record<string, string> = {
      'org.name': String(org?.get('name') ?? '').trim() || 'your workspace',
      'cellular.month': month,
      'cellular.amount': notice.amount,
      'cellular.readers': `${notice.readers} Stripe Reader S710${notice.readers === 1 ? '' : 's'}`,
      'cellular.openedOn': day(notice.openedAtMs),
      'cellular.turnedOffOn': day(notice.turnedOffAtMs),
      'cellular.stores': stores.join('\n') || 'Your stores',
      'cellular.billingUrl': `${platformConsoleOrigin()}${billingPath}`,
    }
    const title = `4G is off for your card readers: the ${month} charge is unpaid`
    const body =
      `The 4G charge of ${notice.amount} for ${month} is still unpaid, so 4G was turned off for your stores. ` +
      'Pay it on the Billing page, then turn 4G on again from each store’s POS devices card.'

    // Whoever may pay it: the workspace's "Manage billing" key, not a role.
    const members = await listOrgMembers(notice.orgId)
    const managers = await Promise.all(
      members.map(async (member) =>
        (await memberHasOrgPermission(notice.orgId, member, 'billing.manage').catch(() => false))
          ? String((member as { email?: unknown }).email ?? '').trim()
          : '',
      ),
    )
    const recipients = await filterSuppressedEmails(managers.filter(Boolean))
    let told = false
    if (recipients.length) {
      const brand = await orgSystemEmailBrand(notice.orgId)
      const content = await renderSystemEmailContent(POS_CELLULAR_EMAIL_KEYS.turnedOffUnpaid, merge, brand, {
        subject: title,
        text: `${title}\n\n${body}\n\n${merge['cellular.billingUrl']}`,
      })
      const results = await Promise.all(
        recipients.map((to) =>
          sendEmail({
            to,
            ...content,
            ...(brand.fromName ? { fromName: brand.fromName } : {}),
            context: POS_CELLULAR_EMAIL_KEYS.turnedOffUnpaid,
          }),
        ),
      )
      const sent = results.filter((result) => result.sent).length
      await meterPlatformEmail(sent)
      told = sent > 0
    }
    await notifyOrgAdmins(
      notice.orgId,
      { type: 'billing.paymentFailed', title, body, level: 'warning', link: billingPath },
      // The designed email above is the email; the notification is the feed.
      { skipEmail: true },
    )
    return told || recipients.length === 0
  } catch (error) {
    console.error('[pos-cellular] the turned-off notice failed', notice.orgId, notice.month, error)
    return false
  }
}
