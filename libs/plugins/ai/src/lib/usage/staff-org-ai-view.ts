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

// Imported by the staff card (client) and by the App Route that serves it, so it
// imports neither entry barrel (see `staff-org-ai.ts`).
import { aiUsageMonthLabel } from './ai-usage-wire'
import {
  aiCreditsCell,
  aiOverageCell,
  assistCostCell,
  assistPoolSentence,
  type StaffAssistPool,
  type StaffOrgUsageAiMonth,
} from './staff-org-usage-ai'
import type {
  StaffAiAccountAllowance,
  StaffOrgAiMargin,
  StaffOrgAiOverage,
  StaffOrgAiPool,
  StaffOrgAiRefusals,
  StaffOrgAiResponse,
} from './staff-org-ai'

/*
 * THE STAFF AI CARD, AS IT PRINTS (AGL-3667).
 *
 * `/admin/orgs/:orgId` draws the card in the browser: whole credits, dollars to
 * four places under a dollar, the pool as the parts that make it up, the
 * overage's state in one sentence, a red or amber or green margin. The staff
 * apps read the same figures through `/api/ai/admin/org?view=prepared`, which
 * sends each sentence the card prints, so a figure or a sentence on the card is
 * decided once. The card imports the helpers below for the same reason.
 */

export const credits = (value: number | null | undefined): string =>
  value == null ? '—' : Math.round(value).toLocaleString('en-US')

/**
 * Four decimals under a dollar, two above (the assist-signals page's rule):
 * a month that really cost eight cents must not read as `$0.00`.
 */
export const usd = (value: number | null | undefined): string => {
  if (value == null) return '—'
  const amount = Number(value) || 0
  return `$${amount.toFixed(Math.abs(amount) < 1 ? 4 : 2)}`
}

export const tokenCount = (value: number): string => Math.round(value).toLocaleString('en-US')

export const rate = (value: number | null): string => (value == null ? '—' : `${Math.round(value * 100)}%`)

/** The pool as one sentence naming every part that is non-zero. */
export function poolPartsSentence(pool: StaffOrgAiPool, addonName: string): string {
  const parts: string[] = []
  if (pool.overrideCredits !== null) {
    parts.push(`${credits(pool.overrideCredits)} staff override`)
  } else {
    parts.push(`${credits(pool.planCredits)} plan band`)
  }
  if (pool.addonCredits > 0) {
    parts.push(`${credits(pool.addonCredits)} ${addonName} add-on`)
  }
  return parts.join(' + ')
}

/**
 * The overage's state as one line: sold, walled, or capped — or, for an
 * uncapped staff comp (AGL-3049), nothing to sell past at all.
 */
export function overageStateSentence(overage: StaffOrgAiOverage, uncapped = false): string {
  if (uncapped) {
    return 'Nothing is sold past a band: an uncapped staff comp has none, and bills nothing.'
  }
  if (overage.hardCap) return 'Stopped at the band — the org’s band switch is on.'
  if (!overage.sellsOverage) return 'Not sold past the band on this plan.'
  const per = overage.rateUsdPer1k === null ? '' : ` at ${usd(overage.rateUsdPer1k)} per 1,000`
  if (overage.capUsd !== null) {
    return overage.capReached
      ? `Stopped — the org’s ${usd(overage.capUsd)} overage ceiling is reached.`
      : `Sold${per}, up to the org’s ${usd(overage.capUsd)} ceiling.`
  }
  return `Sold${per}, no ceiling set.`
}

/** Whether the margin section renders red. */
export function marginTone(margin: StaffOrgAiMargin): 'error' | 'warning' | 'success' {
  if (margin.underwater) return 'error'
  if (margin.multiple >= 1) return 'warning'
  return 'success'
}

/** The words for each reason the gate refused, in the order the card lists them. */
export const REFUSAL_LABELS: Record<keyof Omit<StaffOrgAiRefusals, 'total'>, string> = {
  band: 'band',
  cap: 'ceiling',
  messages: 'messages',
  budget: 'operator backstop',
  // A hard allotment a manager set on a member, a collaborator or a site
  // (AGL-2942).
  allotment: 'allotments',
  // The Free taste's rungs (AGL-2925): only a Free workspace collects these.
  account: 'free account',
  requests: 'free requests/day',
  refusals: 'free refusals/day',
  platform: 'platform ceiling',
}

/**
 * Each reason as the chip the card draws: `band 3`. A reason the answering
 * server does not yet count reads as zero.
 */
export function refusalChips(refusals: StaffOrgAiRefusals): Array<{ label: string; count: number }> {
  return (Object.keys(REFUSAL_LABELS) as Array<keyof typeof REFUSAL_LABELS>).map((reason) => ({
    label: REFUSAL_LABELS[reason],
    count: Number(refusals[reason] ?? 0),
  }))
}

/** The statuses the jobs row names, and the ones that turn it amber or red. */
export const JOB_CHIP_STATUSES = ['queued', 'running', 'needs_input', 'needs_review', 'failed'] as const

/** What the add-on row says about when it was bought. */
export function addonSinceNote(addon: StaffOrgAiResponse['addon']): string {
  if (addon.since) return ''
  return addon.sinceSource === 'unavailable' ? 'Stripe not reachable' : 'no subscription item'
}

/** Which meters a give-back may go to, as the dialog offers them, and the one it starts on. */
export function creditReturnMeters(
  hasWorkspace: boolean,
  hasAccount: boolean,
): Array<{ value: 'both' | 'workspace' | 'account'; label: string }> {
  const labels = { both: 'Both', workspace: 'Workspace band', account: 'Owner’s Free allowance' } as const
  return (['both', 'workspace', 'account'] as const)
    .filter((meter) => (meter === 'both' ? hasWorkspace && hasAccount : meter === 'workspace' ? hasWorkspace : hasAccount))
    .map((value) => ({ value, label: labels[value] }))
}

/** The most one give-back may return to the meter(s) chosen: the lower of the two for both. */
export function creditReturnable(
  meter: 'both' | 'workspace' | 'account',
  workspaceUsed: number | null,
  accountUsed: number | null,
): number {
  const figures = meter === 'both' ? [workspaceUsed, accountUsed] : meter === 'workspace' ? [workspaceUsed] : [accountUsed]
  if (figures.some((figure) => figure == null)) return 0
  return Math.max(0, Math.min(...figures.map((figure) => Math.floor(figure ?? 0))))
}

/** The sentence under the give-back form: what each meter used, which is all it can return. */
export function creditReturnSummary(workspaceUsed: number | null, accountUsed: number | null): string {
  const parts: string[] = []
  if (workspaceUsed != null) parts.push(`workspace band ${credits(workspaceUsed)}`)
  if (accountUsed != null) parts.push(`owner’s Free allowance ${credits(accountUsed)}`)
  return parts.length ? `Used this month, and so the most to give back: ${parts.join(', ')}.` : 'Nothing is metered here.'
}

/** One line of the allowance, as the org card and the user card print it. */
export function allowanceSentence(account: StaffAiAccountAllowance, scope: 'org' | 'user'): string {
  const given = account.returnedCredits ? ` (${credits(account.returnedCredits)} given back)` : ''
  return scope === 'org'
    ? `Owner’s Free allowance: ${credits(account.usedCredits)} of ${credits(account.limitCredits)} used across their free workspaces${given}`
    : `Free AI allowance this month: ${credits(account.usedCredits)} of ${credits(account.limitCredits)} credits used across the free workspaces this account owns${given}.`
}

export interface StaffOrgAiView {
  month: string
  addon: { status: string; price: string; since: string | null; sinceNote: string; on: boolean }
  pool: {
    band: string
    used: string
    returned: string
    allowance: string
    projected: string
  }
  overage: { line: string; state: string }
  refusals: { heading: string; chips: string[] }
  jobs: {
    failedRead: boolean
    empty: boolean
    chips: string[]
    floor: string
    recent: Array<{
      id: string
      kind: string
      status: string
      credits: string
      startedAt: string | null
      startedBy: string | null
      giveBack: number
    }>
  }
  tokens: {
    totals: string
    cacheHit: string
    empty: boolean
    kinds: Array<{ kind: string; headline: string; detail: string }>
  } | null
  users: Array<{ uid: string; name: string; headline: string; detail: string }>
  margin: { tone: 'error' | 'warning' | 'success'; text: string; contribution: string }
  giveBack: {
    meters: Array<{ value: string; label: string }>
    defaultMeter: string
    summary: string
    returnable: number
  }
  /**
   * The AI columns of the org page's monthly usage table, and the pool line it draws above them
   * (`staffOrgUsageColumn`); null where the reader did not hand the rollups over.
   */
  usage: { pool: string; months: Array<{ month: string; headline: string; detail: string }> } | null
}

/** The AI fields of one monthly rollup, with the month they belong to. */
export type StaffOrgAiUsageRollup = StaffOrgUsageAiMonth & { month: string }

/** The card's figures as the sentences it prints. */
export function staffOrgAiView(
  data: StaffOrgAiResponse,
  addonName: string,
  usage?: { pool: StaffAssistPool; months: readonly StaffOrgAiUsageRollup[] },
): StaffOrgAiView {
  const { addon, pool, overage, refusals, jobs, margin } = data
  const uncapped = pool.uncapped === true
  const sentence =
    pool.totalCredits === null && uncapped
      ? 'Uncapped staff comp — no AI credit band. Bounded only by the message cap and an operator’s explicit spend ceiling.'
      : pool.totalCredits === null
        ? 'No AI credit band on this plan — bounded by the message cap and the operator backstop.'
        : `${credits(pool.totalCredits)} credits = ${poolPartsSentence(pool, addonName)}`

  const hasAccount = Boolean(data.account)
  const meters = creditReturnMeters(true, hasAccount)
  const defaultMeter = meters[0]?.value ?? 'workspace'
  const returnable = creditReturnable(defaultMeter, pool.usedCredits, data.account?.usedCredits ?? null)

  return {
    month: data.month,
    addon: {
      on: addon.on,
      status: addon.on ? `${addonName} on` : `${addonName} off`,
      price: addon.priceUsd !== null ? `${usd(addon.priceUsd)}/mo on this plan` : 'Not sold on this plan',
      since: addon.on ? addon.since : null,
      sinceNote: addon.on ? addonSinceNote(addon) : '',
    },
    pool: {
      band: sentence,
      used:
        `Used ${credits(pool.usedCredits)} credits (${usd(pool.providerUsd)} provider spend)` +
        (pool.remainingCredits !== null ? ` · ${credits(pool.remainingCredits)} remaining` : ''),
      returned: pool.returnedCredits
        ? `${credits(pool.returnedCredits)} credits given back this month — already taken off the figure above.`
        : '',
      allowance: data.account ? allowanceSentence(data.account, 'org') : '',
      projected: `Projected month-end at this pace: ${credits(pool.projectedCredits)} credits (${usd(pool.projectedUsd)}) · ${pool.messages.toLocaleString('en-US')} model turns, ${pool.deflected.toLocaleString('en-US')} answered from the docs`,
    },
    overage: {
      line: `${credits(overage.overageCredits)} credits over the band · ${usd(overage.accruedUsd)} accrued`,
      state: overageStateSentence(overage, uncapped),
    },
    refusals: {
      heading: `Refusals this month · ${refusals.total.toLocaleString('en-US')}`,
      chips: refusalChips(refusals).map((chip) => `${chip.label} ${chip.count.toLocaleString('en-US')}`),
    },
    jobs: {
      failedRead: jobs === null,
      empty: jobs !== null && Object.values(jobs.counts).reduce((sum, n) => sum + n, 0) === 0,
      chips: jobs
        ? [
            ...JOB_CHIP_STATUSES.map((status) => `${status.replace('_', ' ')} ${jobs.counts[status]}`),
            `done ${jobs.counts.done}`,
          ]
        : [],
      floor: jobs?.truncated ? 'Counted from the newest jobs only — these counts are a floor.' : '',
      recent: (jobs?.recent ?? []).map((job) => ({
        id: job.id,
        kind: job.kind || '—',
        status: String(job.status ?? '').replace('_', ' '),
        credits: `${credits(job.creditsSpent)} / ${credits(job.creditsReserved)}`,
        startedAt: job.createdAt,
        startedBy: job.createdBy,
        // What a give-back of this job starts at: its spend, never more than the month used.
        giveBack: job.creditsSpent > 0 ? Math.min(Math.ceil(job.creditsSpent), returnable) : 0,
      })),
    },
    tokens: data.tokens
      ? {
          totals: `${tokenCount(data.tokens.total.input)} sent · ${tokenCount(data.tokens.total.cached)} read from cache · ${tokenCount(data.tokens.total.cacheWrite)} written to cache · ${tokenCount(data.tokens.total.output)} generated`,
          cacheHit: `cache hit rate ${rate(data.tokens.cacheHitRate)}`,
          empty: data.tokens.kinds.length === 0,
          kinds: data.tokens.kinds.map((row) => ({
            kind: row.kind,
            headline: `${row.requests.toLocaleString('en-US')} requests · ${usd(row.costPerRequestUsd)} per request`,
            detail: `${tokenCount(row.tokens.input)} sent · ${tokenCount(row.tokens.cached)} from cache · ${tokenCount(row.tokens.output)} generated · cache hit ${rate(row.cacheHitRate)}`,
          })),
        }
      : null,
    users: data.users.map((user) => ({
      uid: user.uid,
      name: user.name,
      headline: `${credits(user.credits)} credits · ${Math.round(user.share * 100)}% · ${usd(user.estCostUsd)} provider`,
      detail: `${user.requests.toLocaleString('en-US')} requests · ${user.refusals.toLocaleString('en-US')} refusals`,
    })),
    margin: {
      tone: marginTone(margin),
      text:
        `Spend ${usd(margin.spendUsd)} against ${usd(margin.revenueUsd)} in — ` +
        `${usd(margin.addonRevenueUsd)} add-on, ${usd(margin.planAssistShareUsd)} plan assist share, ` +
        `${usd(margin.overageRevenueUsd)} overage.` +
        (margin.underwater ? ' Spend exceeds the add-on plus the plan’s assist share.' : '') +
        (margin.multiple >= 1 ? ` ${margin.multiple}× the ${usd(margin.thresholdUsd)} staff review threshold.` : ''),
      contribution:
        margin.contribution.marginPct !== null
          ? `Whole-org contribution margin ${Math.round(margin.contribution.marginPct * 100)}% on the ${margin.contribution.month} rollup with this month’s AI spend.`
          : '',
    },
    giveBack: {
      meters,
      defaultMeter,
      summary: creditReturnSummary(pool.usedCredits, data.account?.usedCredits ?? null),
      returnable,
    },
    usage: usage
      ? {
          pool: assistPoolSentence(usage.pool),
          months: usage.months.map((row) => ({
            month: row.month,
            headline: `Assist ${assistCostCell(row.assistCostUsd)}`,
            detail: `AI credits used ${aiCreditsCell(row.assistCredits)} \u00b7 AI overage billed ${aiOverageCell(row.assistOverageUsd)}`,
          })),
        }
      : null,
  }
}

/** One row of `/api/ai/admin/user`: a workspace's month for the account. */
export interface StaffUserAiRow {
  orgId: string
  orgName: string | null
  slug: string | null
  month: string
  credits: number
  requests: number
  refusals: number
}

export interface StaffUserAiView {
  allowance: string
  giveBack: { summary: string; returnable: number }
  empty: string
  rows: Array<{ orgId: string; workspace: string; month: string; headline: string; detail: string }>
}

/** The account card as it prints: the Free allowance, and a row per workspace per month kept. */
export function staffUserAiView(data: {
  rows: StaffUserAiRow[]
  allowance: StaffAiAccountAllowance | null
}): StaffUserAiView {
  const used = data.allowance?.usedCredits ?? null
  return {
    allowance: data.allowance ? allowanceSentence(data.allowance, 'user') : '',
    giveBack: {
      summary: creditReturnSummary(null, used),
      returnable: creditReturnable('account', null, used),
    },
    empty: data.rows.length ? '' : 'No AI usage attributed to this account in any workspace it belongs to.',
    rows: data.rows.map((row) => ({
      orgId: row.orgId,
      workspace: row.orgName ?? row.orgId,
      month: aiUsageMonthLabel(row.month, 'en-US'),
      headline: `${credits(row.credits)} credits`,
      detail: `${row.requests.toLocaleString('en-US')} requests \u00b7 ${row.refusals.toLocaleString('en-US')} refusals`,
    })),
  }
}
