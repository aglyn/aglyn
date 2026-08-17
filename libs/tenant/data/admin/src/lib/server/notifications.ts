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

import { notificationMuted, type AglynNotification } from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { listStaffUidsAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'
import { listOrgMembers } from './organizations'

const firestore = () => firebaseAdmin.app().firestore()

export type NotificationPayload = Omit<
  AglynNotification,
  '$id' | 'createdAt' | 'readAt'
>

/**
 * Notification fan-out (AGL-259): batch-writes one doc per recipient at
 * `users/{uid}/notifications`. Never throws — a notification miss must
 * not break the mutation that emitted it.
 */
export async function notifyUsers(
  uids: Iterable<string>,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const db = firestore()
    const targets = [...new Set(uids)].filter(Boolean).slice(0, 400)
    if (!targets.length) return
    // Per-user category mutes (AGL-267): one getAll over the user docs.
    const userDocs = await db.getAll(
      ...targets.map((uid) => db.collection('users').doc(uid)),
    )
    const batch = db.batch()
    let count = 0
    for (const userDoc of userDocs) {
      const prefs = userDoc.get('notificationPrefs') as
        | Record<string, boolean>
        | undefined
      if (notificationMuted(prefs, payload.type)) continue
      batch.set(
        db
          .collection('users')
          .doc(userDoc.id)
          .collection('notifications')
          .doc(),
        { ...payload, createdAt: FieldValue.serverTimestamp() },
      )
      count += 1
    }
    if (count > 0) await batch.commit()
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
    const admins = members
      .filter((member) => member.role === 'owner' || member.role === 'admin')
      .map((member) => member.$id)
    await notifyUsers(admins, { ...payload, orgId })
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
