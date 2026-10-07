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

/**
 * THE ACCOUNTING TICK (AGL-3614): run on the console's fifteen-minute
 * `plugin-console-crons` beat, never on the tenant's, because it opens
 * sealed grants with `ACCOUNTING_TOKEN_KEY`, which only the console holds.
 *
 * For every connected workspace, in order:
 *
 * 1. Keep the grant alive: a grant not refreshed for a week is refreshed
 *    now, so a quiet store never lets Xero's 60-day or Intuit's 100-day
 *    refresh token lapse.
 * 2. Read one page of a running backfill.
 * 3. Read new payouts from the merchant's Stripe account, at most every six
 *    hours.
 * 4. Gather each finished day into its journal, in daily-summary mode.
 * 5. Post what is due.
 *
 * A workspace under a lockdown is passed over, untouched, and picked up on
 * the first tick after the lift. A failure in one workspace is logged and the
 * next runs.
 */

import { dateInZone } from '../model/accounting-money'
import { ACCOUNTING_CONNECTIONS_COLLECTION } from '../model/accounting.types'
import { runBackfillStep, type AccountingBackfillState } from './backfill'
import {
  PROACTIVE_REFRESH_AGE_MS,
  connectionRef,
  readConnection,
  refreshConnection,
  type AccountingConnectionRecord,
} from './connection-store'
import { listPaidPayouts, otherConnectedOrgsOfOwner, readConnectedAccount } from './payouts'
import { enqueuePayout, gatherSummaries, runSyncPass, type AccountingEngineDeps } from './sync-engine'
import { payoutItemId, syncItemsCollection } from './sync-store'

export interface AccountingJobDeps extends AccountingEngineDeps {
  /** Whether a lockdown covers the workspace now. */
  orgLocked: (orgId: string) => Promise<boolean>
  /** The platform's Stripe secret key, or `null` when payments are not configured. */
  stripeKey: () => string | null
  fetch?: typeof fetch
}

/** How often payouts are read per workspace. */
export const PAYOUT_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface AccountingJobReport {
  [key: string]: number
  connections: number
  posted: number
  needsAttention: number
  refreshed: number
  payoutsQueued: number
  backfillQueued: number
  summaries: number
  failed: number
  skippedLocked: number
}

export async function runAccountingSyncJob(
  deps: AccountingJobDeps,
  context: { nowMs: number; deadlineMs: number },
): Promise<AccountingJobReport> {
  const report: AccountingJobReport = {
    connections: 0,
    posted: 0,
    needsAttention: 0,
    refreshed: 0,
    payoutsQueued: 0,
    backfillQueued: 0,
    summaries: 0,
    failed: 0,
    skippedLocked: 0,
  }
  const keyring = deps.keyring()
  if (!keyring) return report
  const firestore = deps.firestore()
  // Every connection there is: a handful per deployment, read whole rather
  // than through a collection-group index on a field.
  const snapshot = await firestore.collectionGroup(ACCOUNTING_CONNECTIONS_COLLECTION).get()
  for (const doc of snapshot.docs) {
    if (deps.now() >= context.deadlineMs) break
    const connection = readConnection(doc.data()) as
      | (AccountingConnectionRecord & { backfill?: AccountingBackfillState; payoutPolledAtMs?: number })
      | null
    if (!connection || connection.status !== 'connected') continue
    report.connections += 1
    try {
      if (await deps.orgLocked(connection.orgId)) {
        report.skippedLocked += 1
        continue
      }
      const provider = deps.providerFor(connection.provider, () => undefined)
      if (!provider) continue

      if (deps.now() - connection.refreshedAtMs >= PROACTIVE_REFRESH_AGE_MS) {
        const result = await refreshConnection(
          { firestore, keyring, provider, now: deps.now, sleep: deps.sleep },
          connection,
        )
        if (result.refreshed) report.refreshed += 1
        const reread = readConnection((await connectionRef(firestore, connection.orgId, connection.provider).get()).data())
        if (reread) Object.assign(connection, reread)
      }

      if (connection.backfill && !connection.backfill.done) {
        report.backfillQueued += await runBackfillStep(deps, connection)
      }

      if (deps.now() - Number(connection.payoutPolledAtMs ?? 0) >= PAYOUT_POLL_INTERVAL_MS) {
        report.payoutsQueued += await pollPayouts(deps, connection)
      }

      report.summaries += await gatherSummaries(deps, connection)

      const pass = await runSyncPass(deps, connection, { deadlineMs: context.deadlineMs })
      report.posted += pass.posted
      report.needsAttention += pass.needsAttention
    } catch (error) {
      report.failed += 1
      console.error(`[accounting] sync failed for org ${connection.orgId}`, error)
    }
  }
  return report
}

/**
 * Queues the payouts that reached the bank since the last read. A payout of
 * an account shared with another connected workspace asks a person instead.
 */
export async function pollPayouts(
  deps: AccountingJobDeps,
  connection: AccountingConnectionRecord,
): Promise<number> {
  const firestore = deps.firestore()
  const ref = connectionRef(firestore, connection.orgId, connection.provider)
  const stripeKey = deps.stripeKey()
  const account = stripeKey ? await readConnectedAccount(firestore, connection.orgId) : null
  if (!stripeKey || !account) {
    await ref.update({ payoutPolledAtMs: deps.now() })
    return 0
  }
  const payouts = await listPaidPayouts({
    stripeKey,
    accountId: account.accountId,
    orgId: connection.orgId,
    sinceMs: connection.payoutCursorMs,
    fetch: deps.fetch,
  })
  const shared = payouts.length ? await otherConnectedOrgsOfOwner(firestore, connection.orgId, account.ownerUid) : []
  let queued = 0
  let cursor = connection.payoutCursorMs
  for (const payout of payouts) {
    const created = await enqueuePayout(deps, payout)
    queued += created
    if (created && shared.length) {
      await syncItemsCollection(firestore, connection.orgId).doc(payoutItemId(payout)).update({
        status: 'needs_attention',
        errorCode: 'shared-stripe-account',
        lastError:
          'This payout is from a Stripe account another of your workspaces also sells through, and that workspace ' +
          'has its own books connected. Post it in the books it belongs to, then retry it here only if it belongs in these.',
        updatedAtMs: deps.now(),
      })
    }
    cursor = Math.max(cursor, payout.arrivedAtMs)
  }
  await ref.update({ payoutCursorMs: cursor, payoutPolledAtMs: deps.now(), payoutDay: dateInZone(deps.now(), 'UTC') })
  return queued
}
