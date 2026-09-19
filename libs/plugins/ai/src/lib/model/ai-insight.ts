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

import type { PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import type { AiJob, AiJobOutput } from './ai-jobs.types'

/**
 * Insights (AGL-2915): what an `insight` job answers, in the shape the step
 * writes and the console reads. Pure data — no server import — so the answer
 * card and the digest email type what they render from the module the step
 * writes it with.
 *
 * ## A number is read, never written
 *
 * The model never runs a query and never sees a record. Code reads figures —
 * traffic, orders, bookings, forms, campaigns, datasets, experiments — through
 * fixed, typed readers, each answering with one compact table that says where
 * its figures come from. The model picks the readers and phrases what their
 * tables say, and every insight it writes cites the rows its figures come from.
 * An insight whose numbers cannot be found in the rows it cites is left out
 * (`runtime/ai-insight-check.ts`), so each one a person reads can be traced to
 * a number they can open in the console.
 *
 * ## Read-only, and kept apart from the job
 *
 * An insight job writes one document besides its own record: the answer, at
 * `orgs/{orgId}/aiInsights/{jobId}`, which no rule lets a client read. The
 * job's output names it and carries no figure, because a job document is
 * readable by every member of the workspace and the figures are not: a
 * collaborator on one site may not see another site's revenue. The answer is
 * served by `GET /api/ai/insights/{jobId}` to the member who asked and, for a
 * weekly digest, to the members who reach its site.
 */

/**
 * Where an insight was asked: the console page whose Assist panel asked it,
 * or the weekly digest, which no person asked.
 */
export type AiInsightSurface = 'analytics' | 'datasets' | 'crm-reports' | 'digest'

export const AI_INSIGHT_SURFACES: readonly AiInsightSurface[] = [
  'analytics',
  'datasets',
  'crm-reports',
  'digest',
]

/** The surfaces a person asks from. */
export const AI_INSIGHT_ASK_SURFACES: readonly AiInsightSurface[] = ['analytics', 'datasets', 'crm-reports']

/** The surface an insight job's inputs name, or `null` for one no insight job is asked from. */
export function aiInsightSurface(inputs: Readonly<Record<string, unknown>> | null | undefined): AiInsightSurface | null {
  const surface = inputs?.['surface']
  return typeof surface === 'string' && (AI_INSIGHT_SURFACES as readonly string[]).includes(surface)
    ? (surface as AiInsightSurface)
    : null
}

/**
 * The readers a surface may offer, by the first word of a reader's id. The
 * Analytics page answers about the site's traffic and what it sold, took and
 * collected; a Data page about its datasets; CRM Reports about where people
 * came from and what they did.
 */
export const AI_INSIGHT_SURFACE_READERS: Readonly<Record<AiInsightSurface, readonly string[]>> = {
  analytics: ['bookings', 'commerce', 'forms', 'marketing', 'traffic'],
  datasets: ['datasets'],
  'crm-reports': ['bookings', 'commerce', 'forms', 'marketing', 'traffic'],
  digest: ['bookings', 'commerce', 'forms', 'marketing', 'traffic'],
}

/** Whether a surface answers about one site; the Data page may answer about the whole workspace. */
export function aiInsightSurfaceNeedsSite(surface: AiInsightSurface): boolean {
  return surface !== 'datasets'
}

/**
 * The readers a weekly digest reads, in the order the digest names them:
 * the traffic change, the top page, the days that stood out, the forms, the
 * campaigns, and what the site sold and took. Code reads these; no model
 * picks them.
 */
export const AI_INSIGHT_DIGEST_READERS: readonly string[] = [
  'traffic.summary',
  'traffic.pages',
  'traffic.daily',
  'forms.performance',
  'marketing.campaigns',
  'commerce.sales',
  'bookings.services',
]

/** The windows, in days, an insight reads: the Traffic card's own ranges. */
export const AI_INSIGHT_WINDOWS: readonly number[] = [7, 14, 30, 90]

/** The window a question that names none reads: the Traffic card's default. */
export const AI_INSIGHT_DEFAULT_DAYS = 14

/** The window a weekly digest reads. */
export const AI_INSIGHT_DIGEST_DAYS = 7

/** A window an insight's inputs or a read names, held to the readers' own ranges. */
export function aiInsightDays(value: unknown): number {
  const days = typeof value === 'number' ? value : Number(value)
  return AI_INSIGHT_WINDOWS.includes(days) ? days : AI_INSIGHT_DEFAULT_DAYS
}

/** The most insights one answer carries: a person reads them at a glance. */
export const AI_INSIGHT_MAX_INSIGHTS = 5

/** The longest one insight may run, in characters. */
export const AI_INSIGHT_MAX_CHARS = 280

/** The longest the sentence about what the figures could not answer may run. */
export const AI_INSIGHT_GAP_MAX_CHARS = 200

/** The most tables one citation list names. */
export const AI_INSIGHT_MAX_CITES = 3

/** The most rows one citation names. */
export const AI_INSIGHT_MAX_CITED_ROWS = 10

/** The most readers one answer reads. */
export const AI_INSIGHT_MAX_READS = 4

/** The longest question an insight job admits. */
export const AI_INSIGHT_QUESTION_MAX_CHARS = 1_000

/**
 * A table as an insight job keeps it: the figures a reader returned, the
 * handle the model cites them by, and the reader they came from.
 */
export interface AiInsightTable extends PluginFigureTable {
  /** `t1`, `t2`, …, in the order the job read them. */
  ref: string
  /** The reader's id (`commerce.sales`). */
  reader: string
  /** The window the reader was asked for, in days; 0 for a reader of current counts. */
  days: number
  /** Whether the table is about one site (its path under that site) or the workspace. */
  scope: 'site' | 'org'
}

/** The rows of one table an insight's figures come from, by index. */
export interface AiInsightCitation {
  table: string
  rows: number[]
}

export interface AiInsight {
  /** One or two plain sentences. */
  text: string
  cites: AiInsightCitation[]
}

/** What the model answers with. */
export interface AiInsightAnswer {
  insights: AiInsight[]
  /** What the figures could not answer, in one sentence without numbers; `null` when nothing. */
  gap: string | null
}

/** The answer collection under the org: server-written, and read through the insights door alone. */
export const AI_INSIGHTS_COLLECTION = 'aiInsights'

/** An insight job's answer, as the step stores it. */
export interface AiInsightRecord {
  jobId: string
  orgId: string
  hostId: string | null
  surface: AiInsightSurface
  /** The member whose question it answers; for a digest, the member it was made for. */
  createdBy: string
  /** The question, verbatim; a digest's is the digest's own title. */
  question: string
  /** The window the answer was asked about, in days. */
  days: number
  /** The insights that trace to the rows they cite; every other one was left out. */
  insights: AiInsight[]
  gap: string | null
  /** Every table the job read, so each citation opens the figures it names. */
  tables: AiInsightTable[]
  /** How many insights the answer carried that were left out as not traceable. */
  left: number
  /** The ISO week a digest covers (`2026-W38`); `null` on a question. */
  week: string | null
  createdAtMs: number
}

/** The output id an answer is named by. */
export const AI_INSIGHT_OUTPUT_LABEL = 'Answer'

/**
 * The output an insight job records: the answer's address and how many
 * insights it holds, and no figure. The count is a statement about the
 * answer rather than about the site, so every member may read it.
 */
export function aiInsightOutput(
  job: Pick<AiJob, '$id' | 'hostId'>,
  record: Pick<AiInsightRecord, 'insights' | 'surface'>,
  hostSubdomain: string | null,
): AiJobOutput {
  const count = record.insights.length
  return {
    resource: 'insight',
    id: job.$id,
    versionId: null,
    hostId: job.hostId ?? null,
    hostSubdomain,
    label: record.surface === 'digest' ? 'Weekly insights' : AI_INSIGHT_OUTPUT_LABEL,
    note: count
      ? `${count} ${count === 1 ? 'insight' : 'insights'}, each traced to the figures it cites.`
      : 'The figures did not answer this question.',
  }
}

/** The answer on the wire: the stored record, with nothing a client does not render. */
export type AiInsightAnswerWire = AiInsightRecord

/**
 * The Assist panel's insight surface for a console path, or `null` off one.
 * A site's Analytics, Data and CRM Reports pages, and the workspace's Data
 * page; the workspace's CRM Reports reads site figures, so it is not one.
 */
export function aiInsightSurfaceForPath(
  pathname: string | null | undefined,
): { surface: Exclude<AiInsightSurface, 'digest'>; host: string | null } | null {
  const segments = String(pathname ?? '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
  // `/{org}/hosts/{host}/…` on a site, `/{org}/…` on the workspace.
  if (segments[1] === 'hosts' && segments.length >= 4) {
    const host = segments[2]
    const rest = segments.slice(3)
    if (rest[0] === 'analytics') return { surface: 'analytics', host }
    if (rest[0] === 'data') return { surface: 'datasets', host }
    if (rest[0] === 'crm' && rest[1] === 'reports') return { surface: 'crm-reports', host }
    return null
  }
  if (segments.length >= 2 && segments[1] === 'data') return { surface: 'datasets', host: null }
  return null
}

/** The console page a table's figures come from, or `null` when the table names none. */
export function aiInsightSourceHref(
  table: Pick<AiInsightTable, 'source' | 'scope'>,
  where: { orgSlug: string; host: string | null },
): string | null {
  const path = table.source.path
  if (!path || !where.orgSlug) return null
  if (table.scope === 'org') return `/${where.orgSlug}/${path}`
  return where.host ? `/${where.orgSlug}/hosts/${where.host}/${path}` : null
}

/** How a cell reads to a person, by its column's kind; `null` is "—". */
export function aiInsightCellText(
  table: Pick<AiInsightTable, 'columns'>,
  key: string,
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const column = table.columns.find((entry) => entry.key === key)
  if (typeof value === 'string' || !column) return String(value)
  switch (column.kind) {
    case 'money':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: column.currency ?? 'USD',
      }).format(value)
    case 'percent':
      return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
    case 'change':
      return `${value > 0 ? '+' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
    case 'duration': {
      const seconds = Math.round(value)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
      return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
    }
    default:
      return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

/** One cited row as a line a person reads: every column, labeled. */
export function aiInsightRowText(table: Pick<AiInsightTable, 'columns' | 'rows'>, index: number): string {
  const row = table.rows[index]
  if (!row) return ''
  return table.columns
    .map((column) => `${column.label}: ${aiInsightCellText(table, column.key, row[column.key])}`)
    .join(' · ')
}

/** The ISO 8601 week an instant falls in, in UTC (`2026-W38`). */
export function aiInsightIsoWeek(at: Date): string {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  // Thursday decides the week's year.
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
