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

import { resolveAccountAddresses } from './account-addresses'
import {
  emailSuppressionKey,
  HOST_ACCOUNT_LOCK_SUPPRESSION_REASON,
  HOST_SUPPRESSIONS_SUBCOLLECTION,
  isAccountBanSuppression,
  releaseAccountBanSuppressions,
  releaseAccountLockSuppression,
  suppressEmail,
  suppressEmailForAccountLock,
} from './email-suppression'
import firebaseAdmin from './firebase-admin'
import { getOrgForHost } from './organizations'
import { platformMarketingHostId } from './platform-marketing-consent'

/**
 * WHAT AN ACCOUNT LOCK DOES TO MAIL ADDRESSED BY EMAIL (AGL-3420).
 *
 * The uid-keyed fan-outs already skip a locked account
 * (`isAccountMailWithheld`, AGL-3418). What they cannot reach is mail
 * addressed by email alone — a campaign to a list, a sequence to a contact —
 * so the lock is written onto the suppression lists, keyed by every address
 * the account holds:
 *
 *  - **Every lock:** each of the house workspace's sites, `account_lock`, so
 *    Aglyn's own campaigns and sequences stop. Other workspaces are not ours
 *    to speak for.
 *  - **A ban** (`abuse`): the platform list as well, `account_ban`, which
 *    the preflight on `sendEmail` refuses on every send by any sender. The
 *    account is kept only so the address cannot sign up again; after its
 *    notice it is sent nothing.
 *
 * Called after the lock is durable and after its notices have gone, and it
 * never undoes the lock: a failure is reported beside the lock, not instead
 * of it.
 */

export interface AccountLockMailReport {
  /** The addresses the account holds that were written or lifted. */
  addresses: number
  /** A source of addresses failed; the set may be short. */
  incomplete: boolean
  /** Platform ban rows filed (lock) or released (lift). */
  banRows: number
  /** House sites the per-site rows were written on or lifted from. */
  houseSites: number
  /** Per-site rows written (lock) or deleted (lift). */
  houseRows: number
  /** Writes that threw. */
  failed: number
}

interface AccountLockMailInput {
  uid: string
  /** The Auth record, for its addresses. */
  record: {
    email?: string | null
    providerData?: readonly { email?: string | null }[]
  } | null
  firestore?: any
}

/** The house workspace's site ids, or none on an install without one. */
async function houseSiteIds(): Promise<string[]> {
  const houseHostId = platformMarketingHostId()
  if (!houseHostId) return []
  const house = await getOrgForHost(houseHostId)
  const directory = (house?.org as { hosts?: Record<string, unknown> } | undefined)?.hosts ?? {}
  const ids = Object.keys(directory).filter((id) => Boolean(directory[id]))
  return ids.includes(houseHostId) ? ids : [houseHostId, ...ids]
}

async function addressesOf(input: AccountLockMailInput) {
  const set = await resolveAccountAddresses({
    uid: input.uid,
    record: input.record,
    ...(input.firestore ? { firestore: input.firestore } : {}),
  })
  return { emails: set.addresses.map((entry) => entry.address), incomplete: set.incomplete }
}

/** Write a lock onto the lists. `ban` files the platform rows as well. */
export async function applyAccountLockToMail(
  input: AccountLockMailInput & { ban: boolean },
): Promise<AccountLockMailReport> {
  const { emails, incomplete } = await addressesOf(input)
  const sites = await houseSiteIds()
  const report: AccountLockMailReport = {
    addresses: emails.length,
    incomplete,
    banRows: 0,
    houseSites: sites.length,
    houseRows: 0,
    failed: 0,
  }
  for (const email of emails) {
    if (input.ban) {
      try {
        await suppressEmail({
          email,
          reason: 'account_ban',
          subjectUid: input.uid,
          context: 'account-ban',
          stampRecord: false,
          ...(input.firestore ? { firestore: input.firestore } : {}),
        })
        report.banRows += 1
      } catch (error) {
        console.error('[account-lock-mail] ban row failed', input.uid, error)
        report.failed += 1
      }
    }
    for (const hostId of sites) {
      try {
        const wrote = await suppressEmailForAccountLock({
          hostId,
          email,
          uid: input.uid,
          ...(input.firestore ? { firestore: input.firestore } : {}),
        })
        if (wrote) report.houseRows += 1
      } catch (error) {
        console.error('[account-lock-mail] house row failed', input.uid, hostId, error)
        report.failed += 1
      }
    }
  }
  return report
}

/**
 * Take a lift off the lists: the account's ban rows (restoring any
 * suppression a ban was filed over) and its house rows.
 */
export async function liftAccountLockFromMail(
  input: AccountLockMailInput & { releasedByUid?: string | null },
): Promise<AccountLockMailReport> {
  const { emails, incomplete } = await addressesOf(input)
  const sites = await houseSiteIds()
  const report: AccountLockMailReport = {
    addresses: emails.length,
    incomplete,
    banRows: 0,
    houseSites: sites.length,
    houseRows: 0,
    failed: 0,
  }
  try {
    report.banRows = await releaseAccountBanSuppressions({
      uid: input.uid,
      releasedByUid: input.releasedByUid ?? null,
      ...(input.firestore ? { firestore: input.firestore } : {}),
    })
  } catch (error) {
    console.error('[account-lock-mail] ban release failed', input.uid, error)
    report.failed += 1
  }
  for (const email of emails) {
    for (const hostId of sites) {
      try {
        const deleted = await releaseAccountLockSuppression({
          hostId,
          email,
          uid: input.uid,
          ...(input.firestore ? { firestore: input.firestore } : {}),
        })
        if (deleted) report.houseRows += 1
      } catch (error) {
        console.error('[account-lock-mail] house release failed', input.uid, hostId, error)
        report.failed += 1
      }
    }
  }
  return report
}

/**
 * What a lock does to one address, as a house site's record page shows it
 * (AGL-3686): `banned` while a live ban row holds the address, `locked`
 * while the site holds the lock's own row, else `null`.
 *
 * Answered for the house workspace's sites only, and `null` everywhere
 * else: no other workspace learns that an address belongs to a locked
 * Aglyn account. The ban is read off the platform list rather than the
 * site's row because a lock writes no row where one already stood — a
 * banned address that had unsubscribed carries only its unsubscribe there.
 * Fails open, logging: the chip says nothing rather than something wrong.
 */
export async function accountLockStateFor(input: {
  hostId: string
  email: string
  firestore?: any
}): Promise<'banned' | 'locked' | null> {
  const key = emailSuppressionKey(input.email)
  if (!key || !input.hostId) return null
  try {
    if (!(await houseSiteIds()).includes(input.hostId)) return null
    if (await isAccountBanSuppression(input.email, input.firestore)) return 'banned'
    const db = input.firestore ?? firebaseAdmin.app().firestore()
    const row = await db
      .collection('hosts')
      .doc(input.hostId)
      .collection(HOST_SUPPRESSIONS_SUBCOLLECTION)
      .doc(key)
      .get()
    return row?.exists && row.get('reason') === HOST_ACCOUNT_LOCK_SUPPRESSION_REASON ? 'locked' : null
  } catch (error) {
    console.error('[account-lock-mail] lock state lookup failed', input.hostId, error)
    return null
  }
}
