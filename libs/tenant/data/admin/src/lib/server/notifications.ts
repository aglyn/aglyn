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
  buildRoute,
  NOTIFICATION_SELF_SENT_EMAIL_TYPES,
  NOTIFICATION_SETTINGS_FIELD,
  notificationChannelEnabled,
  type AglynNotification,
  Route,
  type NotificationSettings,
} from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import { findUserByUidAcrossPools, listStaffUidsAcrossPools } from './auth-pools'
import { filterSuppressedEmails } from './email-suppression'
import { meterOrgEmail, meterPlatformEmail } from './email-metering'
import firebaseAdmin from './firebase-admin'
import { listOrgMembers } from './organizations'

const firestore = () => firebaseAdmin.app().firestore()

export type NotificationPayload = Omit<
  AglynNotification,
  '$id' | 'createdAt' | 'readAt'
>

export interface NotifyUsersOptions {
  /**
   * Addresses the caller already holds, by uid (AGL-3224).
   *
   * Purely an optimization, and one worth taking where it is free: a caller
   * that read the roster — `notifyOrgAdmins` does — has every address in hand
   * already, and without this the email half would look each one up again in
   * the directory. Absent uids fall back to that lookup, so passing a partial
   * map is fine and passing none is correct.
   */
  emails?: Readonly<Record<string, string | null | undefined>>
}

/** The console's absolute origin for an email link, or `''` when unset. */
function consoleOrigin(): string {
  return (process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim().replace(/\/+$/, '')
}

/**
 * At most this many directory lookups per fan-out, and at most this many
 * notification emails.
 *
 * Both ceilings only ever bite on a fan-out where many recipients have
 * OPTED IN — the email channel defaults off, so the ordinary notification
 * costs exactly what it cost before this existed. They are here because a
 * fan-out takes up to 400 uids and `notifyUsers` runs inside the mutation
 * that emitted it: a notification must not be able to turn one write into
 * four hundred directory reads and four hundred sends.
 */
const NOTIFY_EMAIL_MAX_LOOKUPS = 25
const NOTIFY_EMAIL_MAX_SENDS = 50

/**
 * The email beside the console notification (AGL-3224).
 *
 * One send per recipient, never a shared `to:` list — two people who manage
 * the same site have not agreed to be shown each other's addresses, and the
 * settings link in the footer belongs to one person.
 *
 * `List-Unsubscribe` points at the settings page rather than at a one-click
 * endpoint: this is not marketing mail and RFC 8058's POST form would be
 * claiming a capability that does not exist. What it does do is put the way
 * out in the headers as well as the body, so a client that surfaces it shows
 * the person the page where the switch they want actually is.
 *
 * Never throws, like everything else on this path.
 */
async function emailNotification(
  uids: string[],
  payload: NotificationPayload,
  known: Readonly<Record<string, string | null | undefined>>,
): Promise<void> {
  const origin = consoleOrigin()
  const settingsUrl = `${origin}${buildRoute(Route.MANAGE_NOTIFICATION_SETTINGS)}`
  let lookups = 0
  let sent = 0
  for (const uid of uids) {
    if (sent >= NOTIFY_EMAIL_MAX_SENDS) break
    let address = String(known[uid] ?? '').trim().toLowerCase()
    if (!address.includes('@')) {
      if (lookups >= NOTIFY_EMAIL_MAX_LOOKUPS) continue
      lookups += 1
      const pooled = await findUserByUidAcrossPools(uid).catch(() => null)
      address = String(pooled?.record?.email ?? '').trim().toLowerCase()
    }
    if (!address.includes('@')) continue
    const recipients = await filterSuppressedEmails([address])
    if (!recipients.length) continue
    const link = payload.link && origin ? `${origin}${payload.link}` : ''
    const body = [
      payload.title,
      payload.body ?? '',
      link,
      origin ? `Change what you are emailed about: ${settingsUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const result = await sendEmail({
      to: recipients,
      subject: payload.title,
      text: body,
      context: 'notification',
      ...(origin
        ? { headers: { 'List-Unsubscribe': `<${settingsUrl}>` } }
        : {}),
    })
    if (!result.sent) continue
    sent += 1
    // Whose cost it is: a notification about a workspace is that workspace's
    // mail, and a staff alert or an account-level notice is the platform's.
    await (payload.orgId ? meterOrgEmail(payload.orgId) : meterPlatformEmail())
      .catch(() => undefined)
  }
}

/**
 * Notification fan-out (AGL-259): batch-writes one doc per recipient at
 * `users/{uid}/notifications`, and — for recipients who asked for it
 * (AGL-3224) — sends one email beside it. Never throws: a notification miss,
 * or a send that failed, must not break the mutation that emitted it.
 */
export async function notifyUsers(
  uids: Iterable<string>,
  payload: NotificationPayload,
  options: NotifyUsersOptions = {},
): Promise<void> {
  try {
    const db = firestore()
    const targets = [...new Set(uids)].filter(Boolean).slice(0, 400)
    if (!targets.length) return
    // Per-user preferences (AGL-267, AGL-3223): one getAll over the user
    // docs, which now answers for both channels and for all three scopes —
    // the settings live on this document precisely so that stays one read.
    const userDocs = await db.getAll(
      ...targets.map((uid) => db.collection('users').doc(uid)),
    )
    const scope = { orgId: payload.orgId, hostId: payload.hostId }
    const batch = db.batch()
    let count = 0
    const mailTo: string[] = []
    for (const userDoc of userDocs) {
      const settings = userDoc.get(NOTIFICATION_SETTINGS_FIELD) as
        | NotificationSettings
        | undefined
      const legacy = userDoc.get('notificationPrefs') as
        | Record<string, boolean>
        | undefined
      if (
        notificationChannelEnabled(
          settings,
          'console',
          payload.type,
          scope,
          legacy,
        )
      ) {
        batch.set(
          db
            .collection('users')
            .doc(userDoc.id)
            .collection('notifications')
            .doc(),
          // `read: false` on create, so the feed can ask for unread and read
          // alike by equality (AGL-3321; see `AglynNotification.read`).
          { ...payload, read: false, createdAt: FieldValue.serverTimestamp() },
        )
        count += 1
      }
      if (
        notificationChannelEnabled(settings, 'email', payload.type, scope, legacy)
      ) {
        mailTo.push(userDoc.id)
      }
    }
    if (count > 0) await batch.commit()
    /*
     * THE EMAIL AFTER THE COMMIT, and not inside its `try`.
     *
     * The console notification is the durable record and the send is a
     * courtesy on top of it, so the order is the one where a failing network
     * call cannot lose the record. The two channels are independent by
     * design — a person may have muted the feed and asked for mail, or the
     * reverse — so neither is gated on the other having happened.
     *
     * Digests are excluded: they compose and send their own mail, under
     * their own switches, and the generic channel would send a second
     * message announcing that the first one had been sent.
     */
    if (
      mailTo.length &&
      isEmailConfigured() &&
      !NOTIFICATION_SELF_SENT_EMAIL_TYPES.has(payload.type)
    ) {
      await emailNotification(mailTo, payload, options.emails ?? {})
    }
  } catch (error) {
    console.error('notification fan-out failed', error)
  }
}

// Staff are identified by a Firebase Auth custom claim (`staff`), which is not
// a Firestore query — so the roster comes from paginating the auth users. A
// burst of ticket activity shouldn't rescan every time, so the (small) result
// is cached briefly. Fails soft to an empty list.
let staffUidCache: { uids: string[]; at: number } | null = null
const STAFF_CACHE_MS = 60_000

async function listStaffUids(): Promise<string[]> {
  const now = Date.now()
  if (staffUidCache && now - staffUidCache.at < STAFF_CACHE_MS) {
    return staffUidCache.uids
  }
  // Across ALL auth pools (AGL-1122). This scanned only the project pool, so
  // a staff member who signs in through enterprise SSO — whose account lives
  // in a GCIP tenant pool — was never in the fan-out. Nothing errored; the
  // notification simply never arrived, which is the worst shape a miss can
  // take on an alerting path.
  const uids = await listStaffUidsAcrossPools()
  staffUidCache = { uids, at: now }
  return uids
}

/**
 * Notifies every staff-claim holder (AGL-850) — the support-desk audience.
 * Staff are not org members, so `notifyOrgAdmins`/`notifyHostManagers` never
 * reach them; this enumerates the `staff` custom claim instead. The docs land
 * at `users/{uid}/notifications`, which the console notifications menu already
 * renders, so no separate staff inbox is needed. Never throws.
 */
export async function notifyStaff(payload: NotificationPayload): Promise<void> {
  try {
    await notifyUsers(await listStaffUids(), payload)
  } catch (error) {
    console.error('staff notification failed', error)
  }
}

/** Notifies the org's owner + admins (billing, membership, org events). */
export async function notifyOrgAdmins(
  orgId: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const members = await listOrgMembers(orgId)
    const admins = members.filter(
      (member) => member.role === 'owner' || member.role === 'admin',
    )
    // The roster rows carry addresses, so the email channel (AGL-3224) needs
    // no directory lookup for anyone reached this way.
    const emails: Record<string, string | undefined> = {}
    for (const member of admins) {
      if (member.email) emails[member.$id] = member.email
    }
    await notifyUsers(
      admins.map((member) => member.$id),
      { ...payload, orgId },
      { emails },
    )
  } catch (error) {
    console.error('org admin notification failed', error)
  }
}

/**
 * Notifies everyone who manages a host (admin/editor in the host doc's
 * `memberRoles` projection) — the audience for form submissions and
 * bookings on that site.
 *
 * The OWNING ORG travels with the notification (AGL-1773). Host links are
 * stored in the legacy `/{hostDocId}/rest` shape and rewritten to
 * `/{orgSlug}/hosts/{subdomain}/rest` when they are FOLLOWED
 * (`normalizeNotificationLink`, AGL-644) — a rewrite that needs an org slug.
 * With no `orgId` on the doc the console had nothing to key on and fell back
 * to whichever org the reader happens to have OPEN, so a manager who belongs
 * to more than one workspace was routed to `/{other-org}/hosts/{subdomain}/…`
 * and got a designed 404: `HostGuard` only resolves subdomains belonging to
 * the current org. `notifyOrgAdmins` has always stamped it; the host fan-out
 * — every form submission, booking, order and stock alert — never did.
 *
 * The host doc already carries `orgId` (AGL-233), so this costs no extra
 * read. Spread conditionally: the field is optional on the host model and
 * Firestore rejects `undefined`.
 */
export async function notifyHostManagers(
  hostId: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const host = await firestore().collection('hosts').doc(hostId).get()
    const memberRoles =
      (host.get('memberRoles') as Record<string, string> | undefined) ?? {}
    const managers = Object.entries(memberRoles)
      .filter(([, role]) => role === 'admin' || role === 'editor')
      .map(([uid]) => uid)
    const orgId = payload.orgId ?? (host.get('orgId') as string | undefined)
    await notifyUsers(managers, {
      ...payload,
      hostId,
      ...(orgId ? { orgId } : {}),
    })
  } catch (error) {
    console.error('host manager notification failed', error)
  }
}
