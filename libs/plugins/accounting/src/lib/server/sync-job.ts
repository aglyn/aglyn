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
 * the first tick after the lift. A failure in one step is logged and counted,
 * and the workspace's later steps still run: a payout read Stripe refuses, or
 * a backfill page that cannot be read, never keeps what is queued from
 * posting. A failure in one workspace is logged and the next runs.
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
import { AccountingProviderError, listPaidPayouts, otherConnectedOrgsOfOwner, readConnectedAccount } from './payouts'
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
    const connection = readConnection(doc.data(), keyring) as
      | (AccountingConnectionRecord & { backfill?: AccountingBackfillState; payoutPolledAtMs?: number })
      | null
    if (!connection || connection.status !== 'connected') continue
    report.connections += 1
    const orgId = connection.orgId
    /** Runs one step; a throw is logged and counted, and the next step runs. */
    const step = async (name: string, run: () => Promise<void>) => {
      try {
        await run()
      } catch (error) {
        report.failed += 1
        console.error(`[accounting] ${name} failed for org ${orgId}`, error)
      }
    }
    try {
      if (await deps.orgLocked(orgId)) {
        report.skippedLocked += 1
        continue
      }
      const provider = deps.providerFor(connection.provider, () => undefined)
      if (!provider) continue

      if (deps.now() - connection.refreshedAtMs >= PROACTIVE_REFRESH_AGE_MS) {
        await step('grant refresh', async () => {
          const result = await refreshConnection(
            { firestore, keyring, provider, now: deps.now, sleep: deps.sleep },
            connection,
          )
          if (result.refreshed) report.refreshed += 1
        })
        // Read back whatever the refresh left, a failed one included: a
        // refused grant is now `reconnect-required`, and the pass stops on it.
        const reread = readConnection((await connectionRef(firestore, orgId, connection.provider).get()).data(), keyring)
        if (reread) Object.assign(connection, reread)
      }

      if (connection.backfill && !connection.backfill.done) {
        await step('backfill', async () => {
          report.backfillQueued += await runBackfillStep(deps, connection)
        })
      }

      if (deps.now() - Number(connection.payoutPolledAtMs ?? 0) >= PAYOUT_POLL_INTERVAL_MS) {
        await step('payout read', async () => {
          report.payoutsQueued += await pollPayouts(deps, connection)
        })
      }

      await step('daily summary', async () => {
        report.summaries += await gatherSummaries(deps, connection)
      })

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
 * What the Accounting page says while payouts cannot be read: Stripe's own
 * reason, and that everything else still posts.
 */
export function payoutReadError(error: unknown): string {
  const reason =
    error instanceof AccountingProviderError && error.message.trim()
      ? error.message.trim().replace(/[.\s]+$/, '')
      : 'Stripe did not answer'
  return (
    `Payouts couldn't be read from Stripe: ${reason}. ` +
    'Sales, refunds and fees still post; payouts will be tried again in a few hours.'
  )
}

/**
 * Queues the payouts that reached the bank since the last read. A payout of
 * an account shared with another connected workspace asks a person instead.
 *
 * When Stripe refuses the read, the poll time still moves on, so the next
 * read waits the usual {@link PAYOUT_POLL_INTERVAL_MS} rather than failing
 * every tick, and `payoutError` tells the merchant why until a read succeeds.
 * The error is thrown on for the tick to log and count.
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
    await ref.update({ payoutPolledAtMs: deps.now(), payoutError: null })
    return 0
  }
  let payouts: Awaited<ReturnType<typeof listPaidPayouts>>
  try {
    payouts = await listPaidPayouts({
      stripeKey,
      accountId: account.accountId,
      orgId: connection.orgId,
      sinceMs: connection.payoutCursorMs,
      fetch: deps.fetch,
    })
  } catch (error) {
    await ref.update({ payoutPolledAtMs: deps.now(), payoutError: payoutReadError(error), updatedAtMs: deps.now() })
    throw error
  }
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
  await ref.update({
    payoutCursorMs: cursor,
    payoutPolledAtMs: deps.now(),
    payoutDay: dateInZone(deps.now(), 'UTC'),
    payoutError: null,
  })
  return queued
}
