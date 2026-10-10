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

import { aiCustomerSafeItem } from './ai-job-failure-copy'
import { AI_JOB_PLAN_STEP, type AiJobItemLedger, type AiJobSummary } from './ai-jobs.types'
import { aiBuildCreditRange, aiBuildRetryLedger, aiBuildUnits, aiLedgerUnits } from './ai-build-job'
import {
  AI_CREDIT_RANGE_ZERO,
  aiCreditRangeAdd,
  aiCreditRangeOf,
  aiCreditRangeOrdered,
  type AiCreditRange,
} from './ai-credit-estimate'
import {
  AI_SITE_NOMINAL_SECTIONS,
  AI_SITE_PASS_CREDITS,
  aiCreationMeasuredCredits,
  aiStandaloneScreenCreditRange,
} from './ai-site-job'

/**
 * What a `build` job shows of each item (AGL-3616), wherever it is shown —
 * the AI jobs drawer, the job's own page, the chat card: the item, where it
 * stands, what it cost, and what became of its credits when it failed.
 *
 * Pure: no React, no request.
 */

/** Where one item stands, as a row's icon reads it. */
export type AiBuildItemRowState = 'done' | 'active' | 'waiting' | 'failed' | 'skipped'

export interface AiBuildItemRow {
  slot: string
  /** "Page: About", "Form: Contact". */
  label: string
  state: AiBuildItemRowState
  /** What the person should know: the failure, the note, what was given back. */
  detail: string | null
  /** When the active item started, for the elapsed time beside it; absent on every other row. */
  startedAt?: string | null
}

const OP_NOUNS: Readonly<Record<string, string>> = {
  page: 'Page',
  layout: 'Layout',
  form: 'Form',
  component: 'Component',
  email: 'Email design',
  template: 'Page template',
  campaign: 'Email campaign',
  workflow: 'Automation',
  // A guided start's first posts and products (AGL-3676).
  posts: 'Blog',
  products: 'Store',
  // A store's own account, cart and policy pages (AGL-3676).
  store: 'Store',
}

/** What an operation is called at the start of a row: its own noun, or the op spelled as words. */
export function aiBuildOpNoun(op: string): string {
  const known = OP_NOUNS[op]
  if (known) return known
  const words = op.replace(/[-_]+/g, ' ').trim()
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : 'Item'
}

/**
 * What became of a failed item's credits (AGL-3616), in the words every
 * surface uses for a failure on our side: "This one’s on us — you weren’t
 * charged." A failure that was not ours — the model declining, a site at its
 * allowance — says what it used, which was charged. `null` for an item that
 * did not fail.
 */
export function aiBuildItemRefundCopy(
  row: Pick<AiJobItemLedger, 'status' | 'failure' | 'creditsRefunded' | 'creditsSpent'>,
): string | null {
  if (row.status !== 'failed') return null
  if (row.failure?.ours) {
    const refunded = Math.max(0, Math.floor(row.creditsRefunded ?? 0))
    if (refunded > 0) {
      return `This one’s on us — you weren’t charged. The ${refunded} ${refunded === 1 ? 'credit' : 'credits'} it used ${refunded === 1 ? 'is' : 'are'} back in your AI credits.`
    }
    return 'This one’s on us — you weren’t charged.'
  }
  const spent = Math.max(0, Math.floor(row.creditsSpent ?? 0))
  return spent > 0 ? `It used ${spent} ${spent === 1 ? 'credit' : 'credits'}.` : null
}

const STATES: Readonly<Record<AiJobItemLedger['status'], AiBuildItemRowState>> = {
  pending: 'waiting',
  running: 'active',
  succeeded: 'done',
  degraded: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

/**
 * The item the build is on (AGL-3596): the one its ledger marks running, else
 * — while the job moves — the first still pending, which is the one its runner
 * builds next. The runner settles an item in the write that records its pass,
 * so the item it is writing reads `pending` until it is done; read as such,
 * every row waited and the build looked stalled. `null` when the job is not
 * moving or nothing is left.
 */
export function aiBuildActiveSlot(
  job: Pick<AiJobSummary, 'items'> & Partial<Pick<AiJobSummary, 'status'>>,
): string | null {
  const items = job.items ?? []
  const running = items.find((row) => row.status === 'running')
  if (running) return running.slot
  if (job.status !== 'queued' && job.status !== 'running') return null
  return items.find((row) => row.status === 'pending')?.slot ?? null
}

/**
 * When the active item started: when the last item before it settled, which
 * the ledger records, else when the build step started — the first item's
 * start, and the best a ledger written before settling was recorded has.
 */
export function aiBuildActiveStartedAt(
  job: Pick<AiJobSummary, 'items'> & Partial<Pick<AiJobSummary, 'steps'>>,
): string | null {
  let latest: { at: number; iso: string } | null = null
  for (const row of job.items ?? []) {
    const at = row.settledAt ? Date.parse(row.settledAt) : NaN
    if (Number.isFinite(at) && (!latest || at > latest.at)) latest = { at, iso: row.settledAt as string }
  }
  if (latest) return latest.iso
  const step = (job.steps ?? []).find((one) => one.name !== AI_JOB_PLAN_STEP && one.startedAt)
  return step?.startedAt ?? null
}

/** One row an item, in the order the build planned them; the item it is on is the active one. */
export function aiBuildItemRows(
  job: Pick<AiJobSummary, 'items'> & Partial<Pick<AiJobSummary, 'status' | 'steps'>>,
): AiBuildItemRow[] {
  const active = aiBuildActiveSlot(job)
  return (job.items ?? []).map((ledger) => {
    // A building rule's own words never reach a customer (AGL-3596).
    const row = aiCustomerSafeItem(ledger)
    const parts: string[] = []
    if (row.status === 'failed' && row.failure?.message) parts.push(row.failure.message)
    if (row.note) parts.push(row.note)
    const refund = aiBuildItemRefundCopy(row)
    if (refund) parts.push(refund)
    return {
      slot: row.slot,
      label: `${aiBuildOpNoun(row.op)}: ${row.label}`,
      state: row.slot === active ? 'active' : (STATES[row.status] ?? 'waiting'),
      detail: parts.length ? parts.join(' ') : null,
      ...(row.slot === active ? { startedAt: aiBuildActiveStartedAt(job) } : {}),
    }
  })
}

/** How a build came out, in one line: "4 of 5 built; 1 failed." `null` while it runs. */
export function aiBuildOutcomeLine(job: Pick<AiJobSummary, 'items' | 'status'>): string | null {
  const items = job.items ?? []
  if (!items.length || (job.status !== 'done' && job.status !== 'failed')) return null
  const built = items.filter((row) => row.status === 'succeeded' || row.status === 'degraded').length
  const failed = items.filter((row) => row.status === 'failed').length
  const skipped = items.filter((row) => row.status === 'skipped').length
  const tail = [failed ? `${failed} failed` : '', skipped ? `${skipped} not built` : ''].filter(Boolean)
  return `${built} of ${items.length} built${tail.length ? `; ${tail.join(', ')}` : ''}.`
}

/** Whether a finished build — or a site that built part of itself — has failed items to try again. */
export function aiBuildCanRetry(job: Pick<AiJobSummary, 'kind' | 'status' | 'items'>): boolean {
  // A site that built nothing starts over from its own answers instead.
  const finished = job.kind === 'build' ? job.status === 'done' || job.status === 'failed' : job.kind === 'site' && job.status === 'done'
  return (
    finished &&
    (job.items ?? []).some((row) => row.status === 'failed' || (row.status === 'skipped' && !row.degradedBy?.length))
  )
}

/**
 * What Try again is likely to cost (AGL-3722), quoted beside its button: a
 * build's retried items by `aiBuildCreditRange`; a site's retried rows each
 * at what its kind measured — a page at the nominal sections, written on its
 * own as a retry is — held at the reserve a row is retried at. `null` when nothing would run.
 */
export function aiBuildRetryCreditRange(
  job: Pick<AiJobSummary, 'kind' | 'items' | 'plan'>,
): AiCreditRange | null {
  const items = job.items ?? []
  if (!items.length) return null
  if (job.kind === 'build') {
    if (!job.plan) return null
    const plan = job.plan as unknown as Parameters<typeof aiBuildUnits>[0]
    const { retried } = aiBuildRetryLedger(items, aiBuildUnits(plan))
    return retried.length ? aiBuildCreditRange(plan, { slots: new Set(retried) }) : null
  }
  const { retried } = aiBuildRetryLedger(items, aiLedgerUnits(items))
  if (!retried.length) return null
  const ops = new Map(items.map((row) => [row.slot, row.op]))
  return aiCreditRangeOrdered(
    retried.reduce((total, slot) => {
      const op = ops.get(slot) ?? ''
      const row =
        op === 'page'
          ? aiStandaloneScreenCreditRange(AI_SITE_NOMINAL_SECTIONS)
          : aiCreditRangeOf(aiCreationMeasuredCredits(op, { standalone: true }), AI_SITE_PASS_CREDITS)
      return aiCreditRangeAdd(total, row)
    }, AI_CREDIT_RANGE_ZERO),
  )
}

/**
 * What a guided start that built part of its site says (AGL-3616), in the
 * words every surface uses: "Built 1 of 2 pages. Home couldn’t be built —
 * that one’s on us…". `null` when every page was built, or none was.
 */
export function aiSitePartialCopy(job: Pick<AiJobSummary, 'items' | 'status'>): string | null {
  const pages = (job.items ?? []).filter((row) => row.op === 'page')
  const built = pages.filter((row) => row.status === 'succeeded' || row.status === 'degraded')
  const unbuilt = (job.items ?? []).filter((row) => row.status === 'failed' || row.status === 'skipped')
  if (job.status !== 'done' || !unbuilt.length || !built.length) return null
  const names = unbuilt.map((row) => (row.op === 'page' ? row.label : `The ${aiBuildOpNoun(row.op).toLowerCase()} “${row.label}”`))
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const refunded = unbuilt.reduce((total, row) => total + Math.max(0, Math.floor(row.creditsRefunded ?? 0)), 0)
  const back = refunded > 0 ? ` The ${refunded} ${refunded === 1 ? 'credit' : 'credits'} it used ${refunded === 1 ? 'is' : 'are'} back in your AI credits.` : ''
  // Only a failure on our side says so; a part the AI declined or an allowance
  // stopped was charged for what it used, and the row says that.
  const ours = unbuilt.every((row) => row.status === 'skipped' || row.failure?.ours === true)
  const why = ours ? ` — that one’s on us, you weren’t charged for ${unbuilt.length === 1 ? 'it' : 'them'}.` : '.'
  return `Built ${built.length} of ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}. ${list} couldn’t be built${why}${back} Try again builds only what failed.`
}
