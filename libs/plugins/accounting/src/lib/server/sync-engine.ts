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
 * THE SYNC ENGINE (AGL-3614): from queued items to ledger documents.
 *
 * ## Queue, then post
 *
 * An event — an order paid, refunded or cancelled, a payout landed — only
 * QUEUES: it writes sync items ({@link enqueueOrderPaid} and its siblings)
 * and returns. Posting happens on the console's tick ({@link runSyncPass}),
 * one item at a time, paced to the provider's limits. So a ledger that is
 * down, slow or rate-limited never holds up the event, and an event handler
 * that is delivered twice writes nothing the second time.
 *
 * ## One item, posted once
 *
 * For each item: build the document from its stored snapshot (a snapshot
 * that cannot be posted — totals that do not add up, an unmapped account —
 * goes straight to "needs attention"), ask the ledger whether a document
 * with its external id already exists (and if so, record that one), then
 * create it under an idempotency key stable for the item. A refund waits
 * for its sale.
 *
 * ## Failures
 *
 * - A refused access token is refreshed once and the call repeated.
 * - A refused GRANT marks the connection "reconnect required"; items stay
 *   pending, uncounted, until someone reconnects.
 * - A rate limit or a transient failure counts an attempt and waits
 *   ({@link backoffMs}: 2, 4, 8 … minutes, at most 12 hours); after
 *   {@link SYNC_MAX_ATTEMPTS} the item asks a person.
 * - The ledger refusing the document itself asks a person at once: sending
 *   the same document again cannot change the answer.
 *
 * "Needs attention" items keep their error and wait for the Retry button on
 * the Accounting page, which starts them again with a fresh idempotency key.
 */

import { createHash } from 'node:crypto'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { dateInZone, normalizeCurrency } from '../model/accounting-money'
import type {
  AccountingOrderSnapshot,
  AccountingPayoutSnapshot,
  AccountingRefundSnapshot,
} from '../model/accounting-sources'
import {
  ACCOUNTING_FEE_PAYEE,
  AccountingTransformError,
  buildFeeDoc,
  buildFeeRefundDoc,
  buildPayoutDoc,
  buildRefundDoc,
  buildSaleDoc,
  buildSummaryDoc,
  docAmountCents,
  refundPostings,
  salePostings,
  summaryExternalId,
  type AccountingDoc,
  type AccountingPosting,
} from '../model/accounting-transforms'
import {
  ACCOUNTING_PROVIDER_LABELS,
  missingAccountRoles,
  type AccountingProviderId,
} from '../model/accounting.types'
import {
  AccountingReconnectRequiredError,
  connectionRef,
  connectionSession,
  loadOrgConnection,
  type AccountingConnectionRecord,
} from './connection-store'
import { AccountingProviderError } from './providers/http'
import type { AccountingDocRef, AccountingProvider, AccountingSession } from './providers/provider'
import { XERO_DAILY_CALL_LIMIT } from './providers/xero'
import {
  SYNC_MAX_ATTEMPTS,
  backoffMs,
  readSyncItem,
  syncItemId,
  syncItemsCollection,
  type AccountingSyncItemRecord,
} from './sync-store'

export interface AccountingEngineDeps {
  firestore: () => FirebaseFirestore.Firestore
  /** `null` when `ACCOUNTING_TOKEN_KEY` is unset: nothing can post. */
  keyring: () => SecretBoxKeyring | null
  /**
   * The provider's adapter, or `null` when this deployment has no
   * credentials for it. `onCall` is told of every HTTP call, for the daily
   * budget.
   */
  providerFor: (id: AccountingProviderId, onCall: () => void) => AccountingProvider | null
  now: () => number
  random?: () => number
  sleep?: (ms: number) => Promise<void>
}

// ── Queueing ──────────────────────────────────────────────────────────────

// Queueing lives in `sync-intake.ts`, which the tenant's event drain loads
// and which holds nothing a ledger call needs; re-exported for the tick.
export { enqueueOrderCancelled, enqueueOrderPaid, enqueueOrderRefunded, enqueuePayout } from './sync-intake'

// ── Posting ───────────────────────────────────────────────────────────────

/** The idempotency key for an item's document: stable across retries, fresh after a person's retry. */
export function idempotencyKey(orgId: string, item: Pick<AccountingSyncItemRecord, 'id' | 'generation'>): string {
  return `aglyn-${createHash('sha256').update(`${orgId}\n${item.id}\n${item.generation}`).digest('hex').slice(0, 40)}`
}

/** The document an item posts, from its stored snapshot. `null` = nothing to post. */
export function documentFor(item: AccountingSyncItemRecord, connection: AccountingConnectionRecord): AccountingDoc | null {
  const mapping = connection.mapping
  switch (item.kind) {
    case 'sale':
      if (!item.order) throw new AccountingTransformError('invalid', 'The sale has no order snapshot.')
      return buildSaleDoc(item.order, mapping)
    case 'fee':
      if (!item.order) throw new AccountingTransformError('invalid', 'The fee has no order snapshot.')
      return buildFeeDoc(item.order, mapping)
    case 'refund':
      if (!item.refund) throw new AccountingTransformError('invalid', 'The refund has no snapshot.')
      return buildRefundDoc(item.refund, mapping)
    case 'fee-refund':
      if (!item.refund) throw new AccountingTransformError('invalid', 'The fee return has no snapshot.')
      return buildFeeRefundDoc(item.refund, mapping)
    case 'payout':
      if (!item.payout) throw new AccountingTransformError('invalid', 'The payout has no snapshot.')
      return buildPayoutDoc(item.payout, mapping)
    case 'summary':
      if (!item.summary) throw new AccountingTransformError('invalid', 'The summary has no postings.')
      return buildSummaryDoc(item.summary, mapping)
  }
}

export type AccountingItemOutcome =
  | { status: 'synced'; ref: AccountingDocRef | null }
  | { status: 'waiting'; reason: string }
  | { status: 'retry'; error: string; retryAfterMs: number | null }
  | { status: 'needs_attention'; error: string; code: string }
  | { status: 'reconnect'; error: string }

interface PassContext {
  deps: AccountingEngineDeps
  connection: AccountingConnectionRecord
  provider: AccountingProvider
  keyring: SecretBoxKeyring
  session: AccountingSession | null
}

async function withSession<T>(context: PassContext, call: (session: AccountingSession) => Promise<T>): Promise<T> {
  const tokens = {
    firestore: context.deps.firestore(),
    keyring: context.keyring,
    provider: context.provider,
    now: context.deps.now,
    sleep: context.deps.sleep,
  }
  context.session ??= await connectionSession(tokens, context.connection)
  try {
    return await call(context.session)
  } catch (error) {
    if (!(error instanceof AccountingProviderError) || error.code !== 'auth') throw error
    // The access token was refused before its time: refresh once and repeat.
    context.session = await connectionSession(tokens, context.connection, { force: true })
    return call(context.session)
  }
}

/** Posts one item and answers what happened; never throws for a provider's answer. */
export async function postItem(context: PassContext, item: AccountingSyncItemRecord): Promise<AccountingItemOutcome> {
  const { connection, provider } = context
  try {
    if (item.dependsOn) {
      const sale = await syncItemsCollection(context.deps.firestore(), connection.orgId).doc(item.dependsOn).get()
      const status = sale.exists ? String(sale.get('status')) : 'missing'
      if (status === 'skipped' || status === 'missing') {
        return { status: 'needs_attention', code: 'sale-missing', error: 'The sale this refund reverses was never posted.' }
      }
      if (status !== 'synced') return { status: 'waiting', reason: 'Waiting for the sale to post.' }
    }
    const doc = documentFor(item, connection)
    if (!doc) return { status: 'synced', ref: null }
    const foreign = foreignCurrencyRefusal(connection, doc.currency)
    if (foreign) return { status: 'needs_attention', code: 'currency', error: foreign }
    const existing = await withSession(context, (session) => provider.findByExternalId(session, doc.kind, doc.externalId))
    if (existing) return { status: 'synced', ref: existing }

    const key = idempotencyKey(connection.orgId, item)
    const base = { idempotencyKey: key, extras: connection.extras, homeCurrency: connection.homeCurrency }
    let ref: AccountingDocRef
    switch (doc.kind) {
      case 'sale':
      case 'refund': {
        const customer = await withSession(context, (session) => provider.upsertCustomer(session, doc.customer))
        const write = { ...base, customerId: customer.id }
        ref = await withSession(context, (session) =>
          doc.kind === 'sale' ? provider.createSalesReceipt(session, doc, write) : provider.createRefundReceipt(session, doc, write),
        )
        break
      }
      case 'fee':
      case 'fee-refund': {
        const payee = await feePayeeId(context)
        ref = await withSession(context, (session) => provider.createExpense(session, doc, { ...base, customerId: payee }))
        break
      }
      case 'payout':
        ref = await withSession(context, (session) => provider.createDeposit(session, doc, { ...base, customerId: null }))
        break
      case 'summary':
        ref = await withSession(context, (session) => provider.createJournal(session, doc, { ...base, customerId: null }))
        break
    }
    return { status: 'synced', ref }
  } catch (error) {
    if (error instanceof AccountingTransformError) {
      return { status: 'needs_attention', code: error.code, error: error.message }
    }
    if (error instanceof AccountingReconnectRequiredError) return { status: 'reconnect', error: error.message }
    if (error instanceof AccountingProviderError) {
      if (error.retryable) return { status: 'retry', error: error.message, retryAfterMs: error.retryAfterMs }
      return { status: 'needs_attention', code: error.code, error: error.message }
    }
    return { status: 'retry', error: error instanceof Error ? error.message : String(error), retryAfterMs: null }
  }
}

/**
 * Why a document in `currency` cannot post to these books, or `null` when it
 * can. Books that keep one currency take only their home currency: posting
 * another would be refused by QuickBooks or booked at the wrong value by
 * Xero, so the item waits in "needs attention" saying what to turn on.
 * Books with more than one currency take any, and the ledger converts.
 */
export function foreignCurrencyRefusal(
  connection: Pick<AccountingConnectionRecord, 'provider' | 'homeCurrency' | 'multiCurrency'>,
  currency: string,
): string | null {
  if (!connection.homeCurrency || connection.multiCurrency) return null
  const home = normalizeCurrency(connection.homeCurrency)
  const own = normalizeCurrency(currency)
  if (own === home) return null
  return connection.provider === 'quickbooks'
    ? `This is in ${own}, and the QuickBooks company keeps only ${home}. Turn on Multicurrency in QuickBooks, then retry.`
    : `This is in ${own}, and the Xero organization keeps only ${home}. Add ${own} under Currencies in Xero, then retry.`
}

/** The contact a fee is paid to: made once, then remembered on the connection. */
async function feePayeeId(context: PassContext): Promise<string | null> {
  if (context.provider.id !== 'xero') return null
  if (context.connection.feePayeeId) return context.connection.feePayeeId
  const contact = await withSession(context, (session) =>
    context.provider.upsertCustomer(session, { name: ACCOUNTING_FEE_PAYEE, email: null }),
  )
  context.connection.feePayeeId = contact.id
  await connectionRef(context.deps.firestore(), context.connection.orgId, context.connection.provider).update({
    feePayeeId: contact.id,
  })
  return contact.id
}

/** Applies an outcome to the item's document. */
export async function recordOutcome(
  deps: AccountingEngineDeps,
  connection: AccountingConnectionRecord,
  item: AccountingSyncItemRecord,
  outcome: AccountingItemOutcome,
): Promise<void> {
  const firestore = deps.firestore()
  const ref = syncItemsCollection(firestore, connection.orgId).doc(item.id)
  const nowMs = deps.now()
  switch (outcome.status) {
    case 'synced':
      await ref.update({
        status: 'synced',
        provider: connection.provider,
        providerDocId: outcome.ref?.id ?? null,
        providerDocType: outcome.ref?.type ?? null,
        lastError: null,
        errorCode: null,
        syncedAtMs: nowMs,
        updatedAtMs: nowMs,
      })
      if (item.kind === 'summary' && item.summary) await markMembers(firestore, connection.orgId, item, outcome, nowMs)
      return
    case 'waiting':
      // Not an attempt: look again on a later tick.
      await ref.update({ nextAttemptAtMs: nowMs + 5 * 60 * 1000, lastError: outcome.reason, updatedAtMs: nowMs })
      return
    case 'reconnect':
      await ref.update({ lastError: outcome.error, updatedAtMs: nowMs })
      return
    case 'needs_attention':
      await ref.update({
        status: 'needs_attention',
        attempts: item.attempts + 1,
        lastError: outcome.error,
        errorCode: outcome.code,
        updatedAtMs: nowMs,
      })
      return
    case 'retry': {
      const attempts = item.attempts + 1
      if (attempts >= SYNC_MAX_ATTEMPTS) {
        await ref.update({
          status: 'needs_attention',
          attempts,
          lastError: outcome.error,
          errorCode: 'retries-exhausted',
          updatedAtMs: nowMs,
        })
        return
      }
      const wait = Math.max(backoffMs(attempts, deps.random), outcome.retryAfterMs ?? 0)
      await ref.update({
        attempts,
        nextAttemptAtMs: nowMs + wait,
        lastError: outcome.error,
        errorCode: 'retrying',
        updatedAtMs: nowMs,
      })
    }
  }
}

async function markMembers(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  item: AccountingSyncItemRecord,
  outcome: Extract<AccountingItemOutcome, { status: 'synced' }>,
  nowMs: number,
): Promise<void> {
  const items = syncItemsCollection(firestore, orgId)
  const ids = item.summary?.memberIds ?? []
  for (let start = 0; start < ids.length; start += 400) {
    const batch = firestore.batch()
    for (const id of ids.slice(start, start + 400)) {
      batch.update(items.doc(id), {
        status: 'synced',
        providerDocId: outcome.ref?.id ?? null,
        providerDocType: outcome.ref?.type ?? null,
        syncedAtMs: nowMs,
        updatedAtMs: nowMs,
      })
    }
    await batch.commit()
  }
}

/** Calls an item may spend, for the daily-budget check. */
const CALLS_PER_ITEM = 6

/** What one pass over a connection did. */
export interface AccountingPassReport {
  posted: number
  retried: number
  needsAttention: number
  waiting: number
  stopped: 'done' | 'deadline' | 'budget' | 'reconnect' | 'unmapped' | 'not-configured'
}

/**
 * Posts the connection's due items, oldest first, until none are due, the
 * deadline, or the provider's daily budget.
 */
export async function runSyncPass(
  deps: AccountingEngineDeps,
  connection: AccountingConnectionRecord,
  options: { deadlineMs: number; limit?: number },
): Promise<AccountingPassReport> {
  const report: AccountingPassReport = { posted: 0, retried: 0, needsAttention: 0, waiting: 0, stopped: 'done' }
  if (connection.status !== 'connected') return { ...report, stopped: 'reconnect' }
  if (missingAccountRoles(connection.mapping).length) return { ...report, stopped: 'unmapped' }
  const keyring = deps.keyring()
  const firestore = deps.firestore()
  const day = dateInZone(deps.now(), 'UTC')
  let calls = connection.callDay === day ? connection.callCount : 0
  const provider = deps.providerFor(connection.provider, () => {
    calls += 1
  })
  if (!keyring || !provider) return { ...report, stopped: 'not-configured' }
  const context: PassContext = { deps, connection, provider, keyring, session: null }
  const budget = connection.provider === 'xero' ? XERO_DAILY_CALL_LIMIT - 200 : Number.POSITIVE_INFINITY

  const due = await syncItemsCollection(firestore, connection.orgId)
    .where('status', '==', 'pending')
    .where('nextAttemptAtMs', '<=', deps.now())
    .orderBy('nextAttemptAtMs', 'asc')
    .limit(options.limit ?? 100)
    .get()
  let lastError: string | null = null
  for (const doc of due.docs) {
    if (deps.now() >= options.deadlineMs) {
      report.stopped = 'deadline'
      break
    }
    if (calls + CALLS_PER_ITEM > budget) {
      report.stopped = 'budget'
      break
    }
    const item = readSyncItem(doc.id, doc.data())
    // A summary-mode member is posted by its day's journal, not on its own.
    if (!item || (item.mode === 'summary' && item.kind !== 'summary')) continue
    const outcome = await postItem(context, item)
    await recordOutcome(deps, connection, item, outcome)
    if (outcome.status === 'synced') report.posted += 1
    else if (outcome.status === 'retry') {
      report.retried += 1
      lastError = outcome.error
    } else if (outcome.status === 'needs_attention') {
      report.needsAttention += 1
      lastError = outcome.error
    } else if (outcome.status === 'waiting') report.waiting += 1
    else {
      report.stopped = 'reconnect'
      lastError = outcome.error
      break
    }
  }
  await connectionRef(firestore, connection.orgId, connection.provider).update({
    callDay: day,
    callCount: calls,
    lastSyncAtMs: deps.now(),
    ...(report.posted || lastError ? { lastError } : {}),
    updatedAtMs: deps.now(),
  })
  return report
}

// ── The daily summary ─────────────────────────────────────────────────────

/** Members one journal gathers at most, so its postings stay one document. */
const SUMMARY_MEMBERS_MAX = 400

/**
 * Gathers each finished day's summary-mode sales and refunds into one
 * journal item per day and currency. A day is finished once it has ended in
 * the mapping's zone. A day posted already and then joined by a late event
 * gets a second journal, numbered after the first.
 */
export async function gatherSummaries(
  deps: AccountingEngineDeps,
  connection: AccountingConnectionRecord,
): Promise<number> {
  if (connection.mapping.syncMode !== 'daily-summary') return 0
  const firestore = deps.firestore()
  const items = syncItemsCollection(firestore, connection.orgId)
  const today = dateInZone(deps.now(), connection.mapping.timeZone)
  const pending = await items
    .where('mode', '==', 'summary')
    .where('status', '==', 'pending')
    .where('summaryDate', '<', today)
    .orderBy('summaryDate', 'asc')
    .limit(SUMMARY_MEMBERS_MAX * 2)
    .get()
  const groups = new Map<string, AccountingSyncItemRecord[]>()
  for (const doc of pending.docs) {
    const item = readSyncItem(doc.id, doc.data())
    if (!item || item.kind === 'summary' || item.summaryItemId || !item.summaryDate) continue
    // A refund joins a day's journal only once its sale is in one.
    if (item.dependsOn) {
      const sale = await items.doc(item.dependsOn).get()
      if (!sale.exists || (sale.get('status') !== 'synced' && !sale.get('summaryItemId'))) continue
    }
    const key = `${item.summaryDate}|${item.currency}`
    const group = groups.get(key) ?? []
    if (group.length < SUMMARY_MEMBERS_MAX) group.push(item)
    groups.set(key, group)
  }
  let made = 0
  for (const [key, members] of groups) {
    const [date, currency] = key.split('|')
    const postings: AccountingPosting[] = []
    let orderCount = 0
    const included: AccountingSyncItemRecord[] = []
    for (const member of members) {
      try {
        if (member.kind === 'sale' && member.order) {
          postings.push(...salePostings(member.order))
          orderCount += 1
        } else if (member.kind === 'refund' && member.refund) {
          postings.push(...refundPostings(member.refund))
        } else continue
        included.push(member)
      } catch (error) {
        await recordOutcome(deps, connection, member, {
          status: 'needs_attention',
          code: 'invalid',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (!included.length) continue
    const sequence = (await items.where('kind', '==', 'summary').where('summaryDate', '==', date).get()).docs.filter(
      (doc) => doc.get('currency') === currency,
    ).length
    const suffix = sequence ? `-${sequence + 1}` : ''
    const id = syncItemId('summary', date, currency, String(sequence + 1))
    const nowMs = deps.now()
    const summaryItem: AccountingSyncItemRecord = {
      id,
      orgId: connection.orgId,
      kind: 'summary',
      mode: 'summary',
      sourceId: `${date}-${currency}`,
      externalId: `${summaryExternalId(date, currency)}${suffix}`,
      label: `Sales summary for ${date}${suffix ? ` (${sequence + 1})` : ''}`,
      status: 'pending',
      attempts: 0,
      generation: 0,
      nextAttemptAtMs: nowMs,
      lastError: null,
      errorCode: null,
      provider: null,
      providerDocId: null,
      providerDocType: null,
      amountCents: 0,
      currency,
      occurredAtMs: nowMs,
      summaryDate: date,
      summaryItemId: null,
      dependsOn: null,
      summary: { date, currency, postings, memberIds: included.map((member) => member.id), orderCount },
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      syncedAtMs: null,
    }
    try {
      const doc = buildSummaryDoc(summaryItem.summary!, connection.mapping)
      summaryItem.amountCents = doc ? docAmountCents(doc) : 0
    } catch {
      // Left for the pass to report as needing attention.
    }
    const batch = firestore.batch()
    batch.create(items.doc(id), summaryItem)
    for (const member of included) batch.update(items.doc(member.id), { summaryItemId: id, updatedAtMs: nowMs })
    await batch.commit()
    made += 1
  }
  return made
}

/** Every pending or attention item, counted for the status card. */
export async function syncCounts(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<{ pending: number; synced: number; needsAttention: number }> {
  const items = syncItemsCollection(firestore, orgId)
  const count = async (status: string) => (await items.where('status', '==', status).count().get()).data().count
  const [pending, synced, needsAttention] = await Promise.all([count('pending'), count('synced'), count('needs_attention')])
  return { pending, synced, needsAttention }
}

/** "QuickBooks Online", for a sentence. */
export const providerLabel = (provider: AccountingProviderId) => ACCOUNTING_PROVIDER_LABELS[provider]
