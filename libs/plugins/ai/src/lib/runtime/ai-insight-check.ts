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

import { hasPersonalDetails } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  AI_INSIGHT_GAP_MAX_CHARS,
  AI_INSIGHT_MAX_CHARS,
  AI_INSIGHT_MAX_CITED_ROWS,
  AI_INSIGHT_MAX_CITES,
  AI_INSIGHT_MAX_INSIGHTS,
  type AiInsight,
  type AiInsightAnswer,
  type AiInsightCitation,
  type AiInsightTable,
} from '../model/ai-insight'

/**
 * THE TRACE (AGL-2915): whether an insight's words agree with the rows it
 * cites.
 *
 * An insight job hands the model tables that code computed, and the model
 * writes sentences about them. Nothing about a sentence makes it true, so each
 * one is read back against the figures before a person sees it:
 *
 *  - it cites at least one row, of a table this job actually read;
 *  - every number it writes is a figure in a row it cites — as the table has
 *    it, or rounded to the decimals written, in the unit written — or the
 *    length of a cited window, a date in it, or a count of the rows cited;
 *  - a rise or a fall it names agrees with the sign of the change it quotes;
 *  - it names nobody: no email address and no phone number.
 *
 * An insight that fails any of these is LEFT OUT, never repaired: a sentence
 * whose number cannot be found is exactly the sentence a person must not act
 * on, and rewriting it would be the model's guess again. The rest of the
 * answer stands. What is left out is counted, so the console can say so.
 */

/** Why an insight was left out, as a finding code. */
export type AiInsightFinding =
  | 'insight-empty'
  | 'insight-too-long'
  | 'insight-markup'
  | 'insight-personal-details'
  | 'insight-no-citation'
  | 'insight-unknown-table'
  | 'insight-unknown-row'
  | 'insight-number-untraced'
  | 'insight-direction'
  | 'insight-too-many'

export interface AiInsightVerdict {
  insight: AiInsight
  findings: string[]
}

export interface AiInsightCheck {
  /** The insights a person may read, in the order written. */
  kept: AiInsight[]
  /** The insights left out, each with why. */
  left: AiInsightVerdict[]
  /** The gap sentence, when it is one a person may read. */
  gap: string | null
  /** Every finding, in order, for the eval harness and the logs. */
  findings: string[]
}

const MARKUP = /<\/?[a-z][^>]*>|```|^#{1,6}\s|\*\*/im

/**
 * A number as a sentence writes it: an optional sign and currency symbol, the
 * digits with their thousands separators, the decimals, and a unit.
 */
const NUMBER = /(?<![\p{L}\p{N}_.])([+\-−]?)([$€£¥]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(%|percent\b|k\b|thousand\b|m\b|million\b|seconds?\b|secs?\b|s\b|minutes?\b|mins?\b|hours?\b|hrs?\b|h\b))?/giu

/** Minutes and seconds written together (`2m 04s`), read as one figure in seconds. */
const DURATION = /(?<![\p{L}\p{N}_.])(?:(\d+)\s?h(?:ours?|rs?)?\s+)?(\d+)\s?m(?:in(?:utes?)?)?\s+(\d{1,2})\s?s(?:ec(?:onds?)?)?\b/giu

const RISING = /\b(?:rose|rise[sn]?|rising|grew|grow(?:s|n|ing)?|increas(?:e|ed|es|ing)|up|higher|gain(?:ed|s)?|jump(?:ed|s)?|climb(?:ed|s)?|more)\b/i
const FALLING = /\b(?:fell|fall(?:s|en|ing)?|drop(?:ped|s)?|declin(?:e|ed|es|ing)|decreas(?:e|ed|es|ing)|down|lower|lost|shr[au]nk|less|fewer)\b/i

interface WrittenNumber {
  /** The figure as written, unsigned, in the unit's base (a percent, seconds, a plain count). */
  value: number
  decimals: number
  negative: boolean
  unit: 'percent' | 'thousand' | 'million' | 'seconds' | 'minutes' | 'hours' | 'currency' | null
  /** Where in the text it starts, for the words before it. */
  at: number
  raw: string
}

function unitOf(symbol: string, unit: string | undefined): WrittenNumber['unit'] {
  const word = (unit ?? '').toLowerCase()
  if (word === '%' || word === 'percent') return 'percent'
  if (word === 'k' || word === 'thousand') return 'thousand'
  if (word === 'm' || word === 'million') return 'million'
  if (/^(?:seconds?|secs?|s)$/.test(word)) return 'seconds'
  if (/^(?:minutes?|mins?)$/.test(word)) return 'minutes'
  if (/^(?:hours?|hrs?|h)$/.test(word)) return 'hours'
  return symbol ? 'currency' : null
}

/** Every figure a sentence writes, durations written as minutes and seconds read as one. */
export function aiInsightNumbers(text: string): WrittenNumber[] {
  const found: WrittenNumber[] = []
  const covered: Array<[number, number]> = []
  for (const match of text.matchAll(DURATION)) {
    const hours = Number(match[1] ?? 0)
    const seconds = hours * 3_600 + Number(match[2]) * 60 + Number(match[3])
    const at = match.index ?? 0
    covered.push([at, at + match[0].length])
    found.push({ value: seconds, decimals: 0, negative: false, unit: 'seconds', at, raw: match[0] })
  }
  for (const match of text.matchAll(NUMBER)) {
    const at = match.index ?? 0
    if (covered.some(([start, end]) => at >= start && at < end)) continue
    const whole = match[3].replace(/,/g, '')
    const decimals = match[4] ?? ''
    found.push({
      value: Number(decimals ? `${whole}.${decimals}` : whole),
      decimals: decimals.length,
      negative: match[1] === '-' || match[1] === '−',
      unit: unitOf(match[2], match[5]),
      at,
      raw: match[0],
    })
  }
  return found.sort((a, b) => a.at - b.at)
}

const round = (value: number, decimals: number) => {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

const truncate = (value: number, decimals: number) => {
  const scale = 10 ** decimals
  return Math.trunc(value * scale) / scale
}

/** Whether a written figure reads a cell's value, at the decimals written, rounded or cut. */
function reads(written: WrittenNumber, cell: number, scale: number): boolean {
  const base = Math.abs(cell) / scale
  const value = Math.abs(written.value)
  return round(base, written.decimals) === value || truncate(base, written.decimals) === value
}

/** The scales a unit may read a column's cells at: a percent is not a count, and seconds are not dollars. */
function scalesFor(written: WrittenNumber, kind: AiInsightTable['columns'][number]['kind']): number[] {
  switch (written.unit) {
    case 'percent':
      return kind === 'percent' || kind === 'change' || kind === 'number' ? [1] : []
    case 'currency':
      return kind === 'money' ? [1] : []
    case 'thousand':
      return kind === 'count' || kind === 'number' || kind === 'money' ? [1_000] : []
    case 'million':
      return kind === 'count' || kind === 'number' || kind === 'money'
        ? [1_000_000]
        : kind === 'duration'
          ? [60]
          : []
    case 'seconds':
      return kind === 'duration' ? [1] : []
    case 'minutes':
      return kind === 'duration' ? [60] : []
    case 'hours':
      return kind === 'duration' ? [3_600] : []
    default:
      return kind === 'date' || kind === 'text' ? [] : kind === 'duration' ? [1, 60] : [1]
  }
}

interface CitedCell {
  table: AiInsightTable
  kind: AiInsightTable['columns'][number]['kind']
  value: number
}

/** The numbers a citation vouches for beyond its cells: the window, its dates, and how many rows. */
function framingNumbers(tables: readonly AiInsightTable[], cites: readonly AiInsightCitation[]): Set<number> {
  const numbers = new Set<number>()
  for (const table of tables) {
    if (table.period) {
      numbers.add(table.period.days)
      for (const day of [table.period.from, table.period.to]) {
        const [year, month, date] = day.split('-').map(Number)
        numbers.add(year).add(month).add(date)
      }
    }
    numbers.add(table.rows.length)
  }
  for (const cite of cites) numbers.add(cite.rows.length)
  numbers.add(cites.reduce((total, cite) => total + cite.rows.length, 0))
  return numbers
}

/** Whether a figure's digits are written inside a cited label: a year in a campaign's name, a path's number. */
function inLabel(written: WrittenNumber, labels: readonly string[]): boolean {
  if (written.unit !== null || written.negative) return false
  const digits = written.raw.replace(/[^\d.]/g, '')
  return labels.some((label) => new RegExp(`(?<![\\d.])${digits.replace('.', '\\.')}(?![\\d.])`).test(label))
}

/** The sign the words just before a figure give it, or `null` when they give none. */
function directionBefore(text: string, at: number): 'rise' | 'fall' | null {
  const before = text.slice(Math.max(0, at - 40), at)
  const words = before.split(/\s+/).slice(-4).join(' ')
  const rise = RISING.test(words)
  const fall = FALLING.test(words)
  if (rise === fall) return null
  return rise ? 'rise' : 'fall'
}

/** One insight's findings against the tables the job read; empty when it traces. */
export function checkAiInsight(insight: AiInsight, tables: readonly AiInsightTable[]): string[] {
  const text = typeof insight?.text === 'string' ? insight.text.trim() : ''
  if (!text) return ['insight-empty']
  const findings: string[] = []
  if (text.length > AI_INSIGHT_MAX_CHARS) findings.push('insight-too-long')
  if (MARKUP.test(text)) findings.push('insight-markup')
  if (hasPersonalDetails(text)) findings.push('insight-personal-details')

  const cites = Array.isArray(insight.cites) ? insight.cites.slice(0, AI_INSIGHT_MAX_CITES) : []
  if (!cites.length || cites.every((cite) => !Array.isArray(cite?.rows) || !cite.rows.length)) {
    return [...findings, 'insight-no-citation']
  }
  const cells: CitedCell[] = []
  const labels: string[] = []
  const cited: AiInsightTable[] = []
  for (const cite of cites) {
    const table = tables.find((entry) => entry.ref === cite?.table)
    if (!table) {
      findings.push(`insight-unknown-table:${String(cite?.table)}`)
      continue
    }
    cited.push(table)
    for (const index of (cite.rows ?? []).slice(0, AI_INSIGHT_MAX_CITED_ROWS)) {
      const row = Number.isInteger(index) ? table.rows[index] : undefined
      if (!row) {
        findings.push(`insight-unknown-row:${table.ref}:${String(index)}`)
        continue
      }
      for (const column of table.columns) {
        const value = row[column.key]
        if (typeof value === 'number' && Number.isFinite(value)) {
          cells.push({ table, kind: column.kind, value })
        } else if (typeof value === 'string') {
          labels.push(value)
          if (column.kind === 'date') {
            for (const part of value.split('-').map(Number)) {
              cells.push({ table, kind: 'count', value: part })
            }
          }
        }
      }
    }
  }
  if (findings.some((finding) => finding.startsWith('insight-unknown-'))) return findings

  const framing = framingNumbers(cited, cites)
  for (const written of aiInsightNumbers(text)) {
    const matched = cells.filter((cell) =>
      scalesFor(written, cell.kind).some((scale) => reads(written, cell.value, scale)),
    )
    const framed =
      written.unit === null && written.decimals === 0 && !written.negative && framing.has(written.value)
    if (!matched.length && !framed && !inLabel(written, labels)) {
      findings.push(`insight-number-untraced:${written.raw.trim()}`)
      continue
    }
    // A rise or a fall is checked against the change it quotes, and only then:
    // "down" beside a count is not a claim about a sign.
    const changes = matched.filter((cell) => cell.kind === 'change' && cell.value !== 0)
    if (!changes.length || changes.length !== matched.length) continue
    const direction = directionBefore(text, written.at)
    if (!direction) continue
    const agrees = changes.some((cell) => (direction === 'rise' ? cell.value > 0 : cell.value < 0))
    if (!agrees) findings.push(`insight-direction:${written.raw.trim()}`)
  }
  return findings
}

/** The gap sentence a person may read: short, without figures and naming nobody; `null` otherwise. */
export function aiInsightGap(gap: unknown): string | null {
  if (typeof gap !== 'string') return null
  const text = gap.replace(/\s+/g, ' ').trim()
  if (!text || text.length > AI_INSIGHT_GAP_MAX_CHARS || /\d/.test(text) || MARKUP.test(text)) return null
  return hasPersonalDetails(text) ? null : text
}

/**
 * An answer held to the trace: the insights that trace kept in the order
 * written, the rest left out with why, and past `AI_INSIGHT_MAX_INSIGHTS`
 * nothing more is read.
 */
export function checkAiInsightAnswer(
  answer: Partial<AiInsightAnswer> | null | undefined,
  tables: readonly AiInsightTable[],
): AiInsightCheck {
  const insights = Array.isArray(answer?.insights) ? answer.insights : []
  const kept: AiInsight[] = []
  const left: AiInsightVerdict[] = []
  const findings: string[] = []
  insights.forEach((insight, index) => {
    const own =
      index >= AI_INSIGHT_MAX_INSIGHTS ? ['insight-too-many'] : checkAiInsight(insight, tables)
    if (own.length) {
      left.push({ insight, findings: own })
      findings.push(...own)
    } else {
      kept.push({
        text: insight.text.trim(),
        cites: insight.cites.slice(0, AI_INSIGHT_MAX_CITES).map((cite) => ({
          table: cite.table,
          rows: cite.rows.slice(0, AI_INSIGHT_MAX_CITED_ROWS),
        })),
      })
    }
  })
  const gap = aiInsightGap(answer?.gap)
  if (answer?.gap && !gap) findings.push('insight-gap-unreadable')
  return { kept, left, gap, findings }
}
