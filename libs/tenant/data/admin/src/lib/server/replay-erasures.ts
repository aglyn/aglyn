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

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'
import { eraseOrg, eraseUser } from './erase'

/**
 * How long `adminAudit` rows stay queryable before `/api/admin/audit-archive`
 * moves them to Storage. A replay window older than this cannot be answered
 * from Firestore at all, which is the one failure mode that must not look
 * like "nothing to replay".
 */
export const AUDIT_HOT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/** What happened to one erasure that had to be re-applied. */
export interface ReplayedErasure {
  kind: 'org' | 'user'
  /** The org id or uid the original erasure destroyed. */
  id: string
  /**
   * - `replayed` — it had come back and has been erased again.
   * - `absent` — nothing was resurrected; the restore did not reach it.
   * - `blocked` — it came back and could NOT be erased again. The reason is
   *   on `detail`, and this is the outcome a human has to act on.
   */
  outcome: 'replayed' | 'absent' | 'blocked'
  detail?: string
}

export interface ReplayErasuresResult {
  /** Snapshot instant the restore was taken from — the replay's lower bound. */
  sinceMs: number
  /** True when nothing was written: a plan, not a replay. */
  dryRun: boolean
  /**
   * Set when the answer cannot be trusted. Today the only value is
   * `'audit-window'`: `sinceMs` predates the hot `adminAudit` window, so rows
   * naming erasures inside the restored span may already be in the Storage
   * archive and this run cannot see them. **An empty list under this warning
   * is not evidence that there was nothing to replay.**
   */
  incomplete?: 'audit-window'
  /** Audit rows examined. */
  examined: number
  entries: ReplayedErasure[]
  /** Convenience for the exit code — any `blocked` entry, or `incomplete`. */
  ok: boolean
}

/**
 * Re-apply every erasure a restore resurrected (AGL-1975).
 *
 * Live DPA §11 promises, in terms: *"a deletion instruction survives any
 * restoration — data deleted at Customer's instruction and later restored from
 * a backup will be deleted again."* Nothing implemented it. This does.
 *
 * **The reason it is needed is specific, not theoretical.** A Firestore import
 * is **merge-by-id, not replace** (`docs/DISASTER_RECOVERY.md` Procedures C
 * and D both say so), so importing a pre-erasure export into `(default)`
 * silently reinstates every document an erasure deleted — the whole org tree,
 * the profile, the support threads — alongside the recovery it was actually
 * run for. It happens during an incident, when nobody is reading a DPA, and
 * nothing anywhere says it happened.
 *
 * **It calls `eraseOrg`/`eraseUser` and implements no cascade of its own.**
 * That is the AGL-1481 rule and this is exactly the shape it was written for:
 * a replay tool with its own copy of the sweep list would be a second
 * implementation of a cascade delete, and the last one drifted within a week —
 * so a replay would faithfully re-erase the six collections somebody
 * remembered and quietly leave the four they did not.
 *
 * ## The two things that make a naive replay fail
 *
 *   1. **`eraseOrg` refuses without a live request.** It re-reads
 *      `erasureRequestedAt` and the 7-day hold, deliberately, so a stale or
 *      cancelled request can never delete. A restored org may carry no request
 *      at all: if the customer asked AFTER the snapshot was taken, the
 *      resurrected document predates the ask. The audit row is what closes
 *      that — `after.requestedAt` records which request the original run
 *      fulfilled — so the request is reinstated at its original instant before
 *      the erasure is re-run. The hold is satisfied by construction: that
 *      instant is in the past by at least the hold, or the first erasure would
 *      not have executed either.
 *   2. **`eraseUser` refuses an org owner.** A restore can bring back both a
 *      person and the workspace they owned, and `userErasureBlockers` then
 *      correctly refuses to cascade. That is reported as `blocked`, never
 *      forced: cascading here would delete a workspace as a side effect of
 *      replaying a personal-account erasure, which is precisely the consent
 *      boundary `eraseUser` exists to hold. Erase the org first — usually it
 *      has its own audit row in the same list — and run this again.
 *
 * ## Why the audit window is a first-class result and not a log line
 *
 * The rows this reads are hot for 90 days before the archiver moves them to
 * Storage. That comfortably covers the 7-day PITR window and the ≤7-day usable
 * managed backup. It does **not** cover a 90-day-old GCS export, where the
 * erasure record and the export can age out within days of each other. A
 * replay over a window that old returns an empty list for two
 * indistinguishable reasons — nothing was erased, or nothing is left to read —
 * so it says `incomplete: 'audit-window'` and reports `ok: false`. An empty
 * list is not the same as a clean bill, and this is the one place that
 * distinction decides whether a published promise was kept.
 *
 * The query is a range on `at` alone, with the action filtered in memory
 * rather than in the query. `where('action','in',[…]).where('at','>=',…)`
 * needs a composite index that does not exist, and an erasure replay is not
 * where anybody should discover a `FAILED_PRECONDITION` — a single-field range
 * is auto-indexed everywhere, including a freshly restored database whose
 * composite indexes are still building.
 */
export async function replayErasuresSince(options: {
  /** The instant the restored snapshot was taken. */
  sinceMs: number
  /** Report what WOULD be re-erased and change nothing. Default true. */
  dryRun?: boolean
  /** Who is answerable, for the new audit rows. */
  actorUid?: string
  now?: number
}): Promise<ReplayErasuresResult> {
  const {
    sinceMs,
    dryRun = true,
    actorUid = 'script:replay-erasures',
    now = Date.now(),
  } = options
  const firestore = firebaseAdmin.app().firestore()

  const incomplete =
    now - sinceMs > AUDIT_HOT_WINDOW_MS ? ('audit-window' as const) : undefined

  const rows = await firestore
    .collection('adminAudit')
    .where('at', '>=', Timestamp.fromMillis(sinceMs))
    .orderBy('at', 'asc')
    .get()

  const entries: ReplayedErasure[] = []
  for (const row of rows.docs) {
    const action = row.get('action') as string | undefined
    if (action !== 'org.erased' && action !== 'user.erased') continue
    const target = String(row.get('target') ?? '')
    const kind = action === 'org.erased' ? 'org' : 'user'
    const id = target.split('/')[1] ?? ''
    if (!id) continue

    if (kind === 'org') {
      const orgRef = firestore.collection('orgs').doc(id)
      const org = await orgRef.get()
      if (!org.exists) {
        entries.push({ kind, id, outcome: 'absent' })
        continue
      }
      // Which request the original run fulfilled. Without it a restored org
      // that was never asked to be erased before the snapshot is refused with
      // `no-request` — the erasure would silently not replay.
      const requestedAt = Number(row.get('after')?.requestedAt ?? 0)
      if (dryRun) {
        entries.push({
          kind,
          id,
          outcome: 'replayed',
          detail: 'would re-erase (plan)',
        })
        continue
      }
      if (requestedAt) {
        await orgRef.set(
          { erasureRequestedAt: Timestamp.fromMillis(requestedAt) },
          { merge: true },
        )
      }
      const result = await eraseOrg(id, { actorUid })
      entries.push(
        result.ok
          ? { kind, id, outcome: 'replayed' }
          : { kind, id, outcome: 'blocked', detail: result.skippedReason },
      )
      continue
    }

    // A person. `profiles/{uid}` is checked as well as `users/{uid}`: the
    // public identity is a separate top-level document (AGL-1970), so a
    // restore can bring it back on its own.
    const [user, profile] = await Promise.all([
      firestore.collection('users').doc(id).get(),
      firestore.collection('profiles').doc(id).get(),
    ])
    if (!user.exists && !profile.exists) {
      entries.push({ kind, id, outcome: 'absent' })
      continue
    }
    if (dryRun) {
      entries.push({
        kind,
        id,
        outcome: 'replayed',
        detail: 'would re-erase (plan)',
      })
      continue
    }
    const result = await eraseUser(id)
    entries.push(
      result.ok
        ? { kind, id, outcome: 'replayed' }
        : {
            kind,
            id,
            outcome: 'blocked',
            // `owns-orgs` is the one a human has to act on: erase the
            // workspace first, then run this again.
            detail:
              result.skippedReason === 'owns-orgs'
                ? `owns-orgs (${(result.blockers ?? [])
                    .map((blocker) => blocker.orgId)
                    .join(', ')})`
                : result.skippedReason,
          },
    )
  }

  const blocked = entries.some((entry) => entry.outcome === 'blocked')

  // A record that the promise was kept — or that it could not be. Written on
  // a real run only: a plan did not replay anything, and an audit row saying
  // it did is the mistake this shape has to make impossible.
  if (!dryRun) {
    await firestore
      .collection('adminAudit')
      .add({
        actorUid,
        action: 'erasures.replayed',
        target: `restore/${new Date(sinceMs).toISOString()}`,
        before: { examined: rows.size },
        after: {
          sinceMs,
          incomplete: incomplete ?? null,
          replayed: entries.filter((e) => e.outcome === 'replayed').length,
          absent: entries.filter((e) => e.outcome === 'absent').length,
          blocked: entries.filter((e) => e.outcome === 'blocked').length,
        },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)
  }

  return {
    sinceMs,
    dryRun,
    incomplete,
    examined: rows.size,
    entries,
    ok: !blocked && !incomplete,
  }
}
