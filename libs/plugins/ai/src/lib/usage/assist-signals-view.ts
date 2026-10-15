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

import { aiAddonName } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  costSplitRows,
  freeTasteRefusals,
  kindTokenRows,
  type AssistMiningReport,
  type AssistSpendRow,
} from './assist-signal-mining'

/*
 * THE ASSIST SIGNAL BOARD, AS THE STAFF PAGE PRINTS IT (AGL-3667).
 *
 * `/admin/assist-signals` draws the mining report in the browser: money to the
 * cent (four places under a dollar), shares as whole percents, the cost split
 * by tier, model and kind. The staff apps read the same report through
 * `/api/ai/admin/signals?view=prepared`, which sends each table as the lines
 * the page prints, so a figure or a sentence on the board is decided once.
 */

export const money = (value: number): string =>
  `$${(Number(value) || 0).toFixed(Math.abs(Number(value) || 0) < 1 ? 4 : 2)}`

export const percent = (value: number | null): string => (value == null ? '\u2014' : `${Math.round(value * 100)}%`)

/** The line under a ranking, which is a cut and not a page. */
export function rankingFootnote(shown: number, total: number, noun: { one: string; many: string }): string {
  if (!total) return ''
  const counted = `${total.toLocaleString('en-US')} ${total === 1 ? noun.one : noun.many}`
  return shown >= total
    ? `Showing all ${counted}.`
    : `Showing the top ${shown.toLocaleString('en-US')} of ${counted}. This is a ranking, not a page \u2014 what is past the cut is what it ranked lowest.`
}

type SpendBoard = {
  month: string
  rows: AssistSpendRow[]
  ranked: number
  truncated: boolean
  failed: boolean
}

type ProseRow = {
  orgId: string
  orgLabel?: string | null
  exchangeId: string
  route: string
  feedback: 'up' | 'down' | null
  expired?: boolean
  question?: string | null
  answer?: string | null
  answerTruncated?: boolean
}

export interface AssistSignalsView {
  truncatedNote: string
  fleet: { chips: string[]; empty: string }
  freeSpend: { line: string; tone: 'error' | 'warning' | 'neutral' } | null
  spend: {
    heading: string
    note: string
    addonName: string
    rows: Array<{ orgId: string; workspace: string; plan: string; addon: string; credits: string; cost: string; refusals: string; refusalDetail: string }>
    footnote: string
  }
  split: {
    note: string
    empty: string
    tier: Array<{ key: string; detail: string }>
    model: Array<{ key: string; detail: string }>
  }
  kinds: Array<{ kind: string; headline: string; detail: string }>
  docsGaps: { footnote: string; rows: Array<{ path: string; headline: string; detail: string }> }
  ungrounded: { note: string; footnote: string; rows: Array<{ route: string; detail: string }> }
  prose: Array<{ flag: string; flagTone: string; where: string; text: string; answer: string }>
  orgs: { footnote: string; rows: Array<{ orgId: string; workspace: string; headline: string; detail: string }> }
}

const count = (value: number) => (Number(value) || 0).toLocaleString('en-US')

export function assistSignalsView(report: AssistMiningReport & { spend?: SpendBoard | null; prose?: ProseRow[] }): AssistSignalsView {
  const totals = report.totals
  const spend = report.spend ?? null
  const shareOf = (cost: number, total: number) => percent(total > 0 ? cost / total : null)
  const splitRows = (split: Record<string, { messages: number; providerCostUsd: number }>) =>
    costSplitRows(split as never).map((row) => ({
      key: row.key,
      detail: `${count(row.messages)} turns \u00b7 ${money(row.providerCostUsd)} \u00b7 ${shareOf(row.providerCostUsd, totals?.providerCostUsd ?? 0)}`,
    }))
  const free = report.freeSpend
  const chips = totals
    ? [
        `${count(totals.messages)} turns`,
        `${money(totals.providerCostUsd)} estimated`,
        `answered free ${percent(totals.deflectionRate)} (${count(totals.deflected ?? 0)})`,
        `${count(totals.inputTokens)} in / ${count(totals.outputTokens)} out`,
        `cache reads ${percent(totals.cacheReadRate)}`,
        `cache writes ${count(totals.cacheWriteTokens)}`,
        `up ${totals.feedback.up} \u00b7 down ${totals.feedback.down} \u00b7 unrated ${totals.feedback.none}`,
        ...Object.entries(totals.stopReasons).map(([reason, total]) => `${reason}: ${total}`),
      ]
    : []
  return {
    truncatedNote: report.truncated
      ? `Ranked the first ${count(report.scanned)} signals only; there are more. Every number below describes that sample, not the fleet.`
      : '',
    fleet: { chips, empty: totals ? '' : 'No assist turns recorded yet.' },
    freeSpend: free
      ? {
          line:
            `free tier today ${money(free.estCostUsd)} of ${money(free.ceilingUsd)} ceiling \u00b7 ${count(free.requests)} requests` +
            (free.paused ? ' \u00b7 PAUSED until tomorrow' : ''),
          tone: free.paused ? 'error' : free.alerted ? 'warning' : 'neutral',
        }
      : null,
    spend: {
      heading: `AI spend this month, by workspace${spend ? ` \u00b7 ${spend.month}` : ''}`,
      note: spend?.failed
        ? 'Could not read this month\u2019s spend documents: a failed read, not a month in which nobody spent.'
        : spend?.truncated
          ? 'Ranked over a sample of the month documents; there are more. This is not the whole fleet.'
          : '',
      addonName: aiAddonName(),
      rows: (spend?.rows ?? []).map((row) => ({
        orgId: row.orgId,
        workspace: row.orgLabel ?? row.orgId,
        plan: row.plan,
        addon: row.aiAddon ? 'on' : 'off',
        credits: count(row.credits),
        cost: money(row.providerCostUsd),
        refusals: count(row.refusals.total),
        refusalDetail:
          row.refusals.total > 0
            ? `band ${row.refusals.band} \u00b7 ceiling ${row.refusals.cap} \u00b7 messages ${row.refusals.messages} \u00b7 backstop ${row.refusals.budget}` +
              (row.refusals.allotment > 0 ? ` \u00b7 allotments ${row.refusals.allotment}` : '') +
              (freeTasteRefusals(row.refusals) > 0 ? ` \u00b7 free taste ${freeTasteRefusals(row.refusals)}` : '')
            : '',
      })),
      footnote: rankingFootnote(spend?.rows?.length ?? 0, spend?.ranked ?? 0, { one: 'workspace', many: 'workspaces' }),
    },
    split: {
      note: 'The same spend split two ways. By tier answers whether the free cap or the paid price is the lever; by model answers whether a cheaper model on the common path would do, the one lever that never reaches the customer.',
      empty: !totals
        ? 'No assist turns recorded yet.'
        : totals.providerCostUsd === 0
          ? totals.deflected >= totals.messages
            ? `Nothing spent on these ${count(totals.messages)} turns: every one was answered from the docs index or the answer cache, with no model call. There is no split to show until a turn reaches a provider.`
            : `${count(totals.messages - totals.deflected)} of ${count(totals.messages)} turns reached a model and every one priced at $0. That is a gap in the rate table, not a saving: the serving model has no entry in the cost model, so its spend is landing nowhere.`
          : '',
      tier: totals && totals.providerCostUsd !== 0 ? splitRows(totals.byTier) : [],
      model: totals && totals.providerCostUsd !== 0 ? splitRows(totals.byModel) : [],
    },
    kinds: (totals?.byKind ? kindTokenRows(totals.byKind) : []).map((row) => ({
      kind: row.kind,
      headline: `${count(row.messages)} requests \u00b7 ${money(row.messages ? row.providerCostUsd / row.messages : 0)} per request \u00b7 cache hit ${percent(row.cacheHitRate)}`,
      detail: `in ${count(row.inputTokens)} \u00b7 cache reads ${count(row.cacheReadTokens)} \u00b7 cache writes ${count(row.cacheWriteTokens)} \u00b7 out ${count(row.outputTokens)} \u00b7 p95 out ${count(row.outputP95)}`,
    })),
    docsGaps: {
      footnote: rankingFootnote(report.docsGaps?.length ?? 0, report.ranked?.docsGaps ?? 0, { one: 'cited page', many: 'cited pages' }),
      rows: (report.docsGaps ?? []).map((row) => ({
        path: row.path,
        headline: `${row.questions} questions \u00b7 down rate ${percent(row.downRate)} \u00b7 ${row.orgs} workspaces`,
        detail: `up ${row.up} \u00b7 down ${row.down} \u00b7 cost ${money(row.providerCostUsd)}`,
      })),
    },
    ungrounded: {
      note: `${count(report.ungrounded?.questions ?? 0)} turns matched no documentation at all, ${report.ungrounded?.down ?? 0} of them rated down. These cite no page, so they cannot appear in the ranking above: a missing page is invisible to anything keyed on paths.`,
      footnote: rankingFootnote(report.ungrounded?.routes?.length ?? 0, report.ranked?.ungroundedRoutes ?? 0, { one: 'console page', many: 'console pages' }),
      rows: (report.ungrounded?.routes ?? []).map((row) => ({ route: row.route, detail: `${row.questions} questions \u00b7 ${row.down} rated down` })),
    },
    prose: (report.prose ?? []).map((row) => ({
      flag: row.feedback === 'down' ? 'rated down' : 'no documentation matched',
      flagTone: row.feedback === 'down' ? 'error' : 'neutral',
      where: `${row.route} \u00b7 ${row.orgLabel ?? row.orgId}`,
      text: row.expired
        ? 'The words are past their 180-day retention and have been deleted. The counts still include this turn.'
        : row.question || '(no question recorded)',
      answer: !row.expired && row.answer ? `We said: ${row.answer}${row.answerTruncated ? '\u2026' : ''}` : '',
    })),
    orgs: {
      footnote: rankingFootnote(report.orgs?.length ?? 0, report.ranked?.orgs ?? 0, { one: 'workspace', many: 'workspaces' }),
      rows: (report.orgs ?? []).map((row) => ({
        orgId: row.orgId,
        workspace: row.orgLabel ?? row.orgId,
        headline: `${count(row.messages)} turns \u00b7 cost ${money(row.providerCostUsd)} \u00b7 down ${row.down}`,
        detail: `in ${count(row.inputTokens)} \u00b7 out ${count(row.outputTokens)} \u00b7 cache reads ${count(row.cacheReadTokens)}`,
      })),
    },
  }
}
