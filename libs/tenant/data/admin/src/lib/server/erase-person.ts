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

import { FieldValue } from 'firebase-admin/firestore'
// The leaves, not the barrel — see `email-suppression.ts` for why: a spec
// of this sweep substitutes a store, not the pure helpers it leans on.
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  missingRequiredPersonErasersAfterRepair,
  runPluginPersonErasure,
  type PluginPersonErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { eraseEmailDeliveriesForAddresses } from './email-delivery-log'
import { suppressEmailForHostErasure } from './email-suppression'
import firebaseAdmin from './firebase-admin'
import { addAdminAudit } from './admin-audit-write'

const defaultFirestore = () => firebaseAdmin.app().firestore()

export interface ErasePersonOptions {
  orgId: string
  /** Any spelling; normalized before anything is looked up. */
  email: unknown
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
  /** Injectable for tests; defaults to `Date.now()`. */
  now?: number
}

/**
 * Counts, never identities: this is what the request document and the audit
 * row record, and both are read by people who must not learn the address
 * from them.
 */
export interface ErasePersonCounts {
  /** Sites in the workspace the sweep walked. */
  hosts: number
  /** Suppression rows written, one per site. */
  hostsSuppressed: number
  /** The person's records the record system named, by count. */
  records: number
  /** Delivery-log messages deleted under the address. */
  emailDeliveries: number
  /**
   * Each plugin's share (AGL-2981, AGL-3080), by plugin id: its eraser's own
   * counts — the record system's people, a shop's orders, a calendar's
   * bookings, an audience's members — or `null` for an eraser that failed:
   * its data may remain.
   */
  plugins: Record<string, PluginPersonErasureReport | null>
}

export type ErasePersonResult =
  | ({ ok: true } & ErasePersonCounts)
  | { ok: false; skippedReason: 'invalid-email' }

/**
 * Remove one person from one workspace (AGL-2623).
 *
 * The platform's part is the door and the log; everything the workspace keeps
 * ABOUT the person is a plugin's, erased through `plugin-person-erasure`.
 *
 * ## Order
 *
 *   1. **Suppress first.** One row per site on the per-site suppression list,
 *      before any delete: a form filled in while the sweep runs must already
 *      find the door closed, or the sweep deletes a row that the capture
 *      re-creates a moment later.
 *   2. **The plugins' shares** (`runPluginPersonErasure`): the plugin that
 *      keeps people names the person's records; every other plugin erases
 *      what it keeps — keyed by those records or by the address — and the
 *      record system erases the records themselves last. A share the
 *      erasure promises is REQUIRED: a missing one refuses the erasure before
 *      anything is erased, and a failed one fails it after the rest ran, so
 *      the job retries rather than reporting a person erased who is not.
 *   3. **The delivery log**, last: it is filed under the address alone, and
 *      the tombstone it leaves is what keeps a later import from refilling it.
 *
 * ## What is anonymized rather than deleted
 *
 * Each plugin's own business: an order is the merchant's record of a sale
 * and a booking of an appointment, and the law expects them kept, so the
 * person is taken OFF them; a deal is the team's pipeline record and is
 * unlinked. Everything else that names the person is about the person and is
 * deleted. `PERSON_ERASURE_REMOVES` / `RETAINS` say so to the admin.
 *
 * ## What is not reached, and why
 *
 * A form submission keeps the address inside `fields`, under whatever the
 * form called it — there is no key to query by and a scan of every
 * submission on every site is unbounded. A site member's login is their own
 * account. Each is named to the admin by the dialog so they can finish by
 * hand.
 *
 * The suppression and the log are best-effort against each other: a failure
 * in one is logged and counted as zero, and the counts say what happened.
 */
export async function erasePerson(options: ErasePersonOptions): Promise<ErasePersonResult> {
  const email = normalizeContactEmail(options.email)
  const key = email ? personKey(email) : null
  if (!email || !key) return { ok: false, skippedReason: 'invalid-email' }
  const db = options.firestore ?? defaultFirestore()
  /*
   * A share the erasure promises that this process cannot run — even after
   * its boot step has run once more — refuses the whole erasure BEFORE it
   * writes anything: the request stays queued for a process whose boot
   * registered it, rather than reporting a person erased who is still on file.
   */
  const missing = await missingRequiredPersonErasersAfterRepair()
  if (missing.length) {
    throw new Error(
      `erasePerson refused: ${missing.join(', ')} declared a required person eraser ` +
        'and none is registered in this process',
    )
  }

  const counts: ErasePersonCounts = {
    hosts: 0,
    hostsSuppressed: 0,
    records: 0,
    emailDeliveries: 0,
    plugins: {},
  }

  const hosts = await db.collection('hosts').where('orgId', '==', options.orgId).get()
  const hostIds: string[] = hosts.docs.map((doc: any) => String(doc.id))
  counts.hosts = hostIds.length

  for (const hostId of hostIds) {
    try {
      const written = await suppressEmailForHostErasure({ hostId, email, firestore: db })
      if (written) counts.hostsSuppressed += 1
    } catch (error) {
      console.error(`erasePerson: suppression write failed for ${hostId}`, error)
    }
  }

  // Every site's door is already closed above. This erasure has no plan of
  // its own, so it is never a dry run. A required share that is missing or
  // failed THROWS here, and the request stays queued for the next run.
  const shares = await runPluginPersonErasure({
    orgId: options.orgId,
    email,
    key,
    dryRun: false,
    atMs: options.now ?? Date.now(),
  })
  counts.records = shares.contactIds.length
  counts.plugins = shares.reports

  try {
    const sweep = await eraseEmailDeliveriesForAddresses([{ address: email }], db)
    counts.emailDeliveries = sweep.removed
  } catch (error) {
    console.error('erasePerson: delivery log sweep failed', error)
  }

  await addAdminAudit(db, {
    actorUid: 'system:erase-person',
    action: 'person.erased',
    target: `orgs/${options.orgId}/people/${key}`,
    before: null,
    after: counts,
    at: FieldValue.serverTimestamp(),
  }).catch(() => undefined)

  return { ok: true, ...counts }
}
