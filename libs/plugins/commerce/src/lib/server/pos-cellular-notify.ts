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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { isAccountBanLockdownReason, normalizeOrgLockdown } from '@aglyn/aglyn/app-utils/lockdown'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { POS_CELLULAR_EMAIL_KEYS, sendEmail } from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  hostDisplayName,
  listOrgMembers,
  memberHasOrgPermission,
  meterPlatformEmail,
  notifyUsers,
} from '@aglyn/tenant-data-admin'
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  orgSystemEmailBrand,
  renderSystemEmailContent,
} from '@aglyn/tenant-data-admin/server/render-system-email'
import { posCellularDayLabel, posCellularMonthLabel } from '../model/pos-cellular'

/*==========================================
 * TELLING THE WORKSPACE ABOUT AN UNPAID 4G CHARGE (AGL-4038).
 *
 * Twice, from the daily run (`pos-cellular-billing.ts`), to the members who
 * hold "Manage billing" (the key, never a role): the designed system email
 * (`pos-cellular-emails.ts` in the email library), and the same words in
 * their console notification feed, without mailing them twice.
 *
 * 1. PAYMENT DUE, the day a month's charge doesn't go through: the amount,
 *    the month, and the day 4G turns off for the workspace's stores unless
 *    the open invoice is paid, in the workspace's time zone.
 * 2. TURNED OFF, when that day comes and it is still unpaid: the month, the
 *    amount, the stores, and the way back.
 *
 * Each returns whether anyone was told (or there was nobody to tell), so the
 * caller records it once. Neither throws: a lost email must not undo the
 * step it reports on or stop the daily run.
 *=========================================*/

/** What the warning, the day a charge is left open, says. */
export interface PosCellularPaymentDueNotice {
  orgId: string
  month: string
  /** Formatted, e.g. `$21.65`. */
  amount: string
  readers: number
  openedAtMs: number
  /** When the grace runs out: 4G turns off for the workspace's stores then, unless it is paid. */
  turnsOffAtMs: number
  /** The stores with 4G on now, which lose it then. */
  hostIds: string[]
}

/** What the notice that 4G was turned off says. */
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

type Firestore = ReturnType<ReturnType<typeof firebaseAdmin.app>['firestore']>

interface Workspace {
  name: string
  billingPath: string
  timeZone: string
}

/** The workspace as the notices name it; null for a banned account, which is sent nothing (AGL-3420). */
async function readWorkspace(firestore: Firestore, orgId: string): Promise<Workspace | null> {
  const org = await firestore.collection('orgs').doc(orgId).get().catch(() => null)
  const data = (org?.data() ?? null) as Record<string, unknown> | null
  const lock = normalizeOrgLockdown(data as never)
  if (lock && isAccountBanLockdownReason(lock.reason)) return null
  const slug = String(data?.['slug'] ?? '').trim()
  return {
    name: String(data?.['name'] ?? '').trim() || 'your workspace',
    billingPath: slug ? `/${slug}/billing` : '/billing',
    timeZone: resolveSiteTimeZone(data as { timeZone?: string } | null, null),
  }
}

/** The stores' names, one per line, or `fallback` when none is left. */
async function storeNames(firestore: Firestore, hostIds: readonly string[], fallback: string): Promise<string> {
  const hosts = await Promise.all(
    hostIds.map((hostId) => firestore.collection('hosts').doc(hostId).get().catch(() => null)),
  )
  const names = hosts
    .map((host, index) =>
      host?.exists ? hostDisplayName(host.data() as Record<string, unknown>, hostIds[index]) : null,
    )
    .filter((name): name is string => Boolean(name))
  return names.join('\n') || fallback
}

/**
 * Emails the members who hold "Manage billing" and puts the same words in
 * their console feed. True once someone was emailed, or nobody can be.
 */
async function tellBillingManagers(
  orgId: string,
  workspace: Workspace,
  message: {
    key: string
    merge: Record<string, string>
    title: string
    body: string
  },
): Promise<boolean> {
  // Whoever may pay it: the workspace's "Manage billing" key, not a role.
  const members = await listOrgMembers(orgId)
  const managers = (
    await Promise.all(
      members.map(async (member) =>
        (await memberHasOrgPermission(orgId, member, 'billing.manage').catch(() => false)) ? member : null,
      ),
    )
  ).filter((member): member is (typeof members)[number] => member !== null)
  const addresses = managers.map((member) => String((member as { email?: unknown }).email ?? '').trim()).filter(Boolean)
  const recipients = await filterSuppressedEmails(addresses)
  let told = false
  if (recipients.length) {
    const brand = await orgSystemEmailBrand(orgId)
    const content = await renderSystemEmailContent(message.key, message.merge, brand, {
      subject: message.title,
      text: `${message.title}\n\n${message.body}\n\n${message.merge['cellular.billingUrl']}`,
    })
    const results = await Promise.all(
      recipients.map((to) =>
        sendEmail({
          to,
          ...content,
          ...(brand.fromName ? { fromName: brand.fromName } : {}),
          context: message.key,
        }),
      ),
    )
    const sent = results.filter((result) => result.sent).length
    await meterPlatformEmail(sent)
    told = sent > 0
  }
  await notifyUsers(
    managers.map((member) => String((member as { $id?: unknown }).$id ?? '')).filter(Boolean),
    {
      type: 'billing.paymentFailed',
      title: message.title,
      body: message.body,
      level: 'warning',
      link: workspace.billingPath,
      orgId,
    },
    // The designed email above is the email; the notification is the feed.
    { skipEmail: true },
  )
  return told || recipients.length === 0
}

const readersText = (readers: number) => `${readers} Stripe Reader S710${readers === 1 ? '' : 's'}`

/**
 * The day a month's charge is left open: it is due, and 4G turns off for the
 * workspace's stores on the day its grace runs out unless it is paid.
 */
export async function sendPosCellularPaymentDueNotice(notice: PosCellularPaymentDueNotice): Promise<boolean> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const workspace = await readWorkspace(firestore, notice.orgId)
    if (!workspace) return false
    const month = posCellularMonthLabel(notice.month)
    const turnsOffOn = posCellularDayLabel(notice.turnsOffAtMs, workspace.timeZone)
    const merge: Record<string, string> = {
      'org.name': workspace.name,
      'cellular.month': month,
      'cellular.amount': notice.amount,
      'cellular.readers': readersText(notice.readers),
      'cellular.openedOn': posCellularDayLabel(notice.openedAtMs, workspace.timeZone),
      'cellular.turnsOffOn': turnsOffOn,
      // Blank when no store has 4G now: the email then leaves the row out.
      'cellular.stores': await storeNames(firestore, notice.hostIds, ''),
      'cellular.billingUrl': `${platformConsoleOrigin()}${workspace.billingPath}`,
    }
    return await tellBillingManagers(notice.orgId, workspace, {
      key: POS_CELLULAR_EMAIL_KEYS.paymentDue,
      merge,
      title: `4G turns off on ${turnsOffOn} unless the ${month} charge is paid`,
      body:
        `The 4G charge of ${notice.amount} for ${month} didn’t go through. ` +
        `Pay it on the Billing page before ${turnsOffOn} to keep 4G on for your stores.`,
    })
  } catch (error) {
    console.error('[pos-cellular] the payment-due notice failed', notice.orgId, notice.month, error)
    return false
  }
}

/** The day 4G was turned off for the workspace's stores because a month's charge stayed unpaid. */
export async function sendPosCellularTurnedOffNotice(notice: PosCellularTurnedOffNotice): Promise<boolean> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const workspace = await readWorkspace(firestore, notice.orgId)
    if (!workspace) return false
    const month = posCellularMonthLabel(notice.month)
    const merge: Record<string, string> = {
      'org.name': workspace.name,
      'cellular.month': month,
      'cellular.amount': notice.amount,
      'cellular.readers': readersText(notice.readers),
      'cellular.openedOn': posCellularDayLabel(notice.openedAtMs, workspace.timeZone),
      'cellular.turnedOffOn': posCellularDayLabel(notice.turnedOffAtMs, workspace.timeZone),
      'cellular.stores': await storeNames(firestore, notice.hostIds, 'Your stores'),
      'cellular.billingUrl': `${platformConsoleOrigin()}${workspace.billingPath}`,
    }
    return await tellBillingManagers(notice.orgId, workspace, {
      key: POS_CELLULAR_EMAIL_KEYS.turnedOffUnpaid,
      merge,
      title: `4G is off for your card readers: the ${month} charge is unpaid`,
      body:
        `The 4G charge of ${notice.amount} for ${month} is still unpaid, so 4G was turned off for your stores. ` +
        'Pay it on the Billing page, then turn 4G on again from each store’s POS devices card.',
    })
  } catch (error) {
    console.error('[pos-cellular] the turned-off notice failed', notice.orgId, notice.month, error)
    return false
  }
}
