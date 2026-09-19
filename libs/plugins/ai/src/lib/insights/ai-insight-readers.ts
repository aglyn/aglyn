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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isHostPluginEnabled, isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  listPluginFigureReaders,
  normalizePluginFigureTable,
  pluginFigureParams,
  pluginFigureReaderPlugin,
  type ResolvedPluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  AI_INSIGHT_MAX_READS,
  AI_INSIGHT_SURFACE_READERS,
  aiInsightCellText,
  type AiInsightSurface,
  type AiInsightTable,
} from '../model/ai-insight'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import type { AiInsightReadRequest } from '../tools/ai-insight-tool'
import type { AiDatasetCatalogEntry } from './ai-figure-readers'

/**
 * Which figure readers an insight job may read, and reading them (AGL-2915).
 *
 * The caller's half of the `plugin-figures` contract: the seam carries no
 * authorization, so before a reader is offered to the model — let alone read
 * — this establishes that the surface asks about its kind of figures, that
 * the workspace's plan includes the feature the figures are sold under, and
 * that the plugin whose records they are runs here: past its release flag,
 * on for the workspace and not switched off for the site. The site belonging
 * to the job's workspace, and the member's reach, are the job's own checks.
 */

/** Which of a set of plugins are past their release flags for an org; the platform's flags by default. */
export type AiReleasedPlugins = (pluginIds: string[], orgId: string) => Promise<string[]>

const releasedByFlags: AiReleasedPlugins = (pluginIds, orgId) =>
  filterEnabledPluginsByReleaseFlags(pluginIds, { orgId, authorization: null })

export interface AiInsightReaderContext {
  orgId: string
  /** The site the figures are about; `null` for a workspace-level question. */
  hostId: string | null
  /** The org document the machine or the door read. */
  org: object | null
  /** The site's host document, already checked to belong to the org; `null` with no site. */
  host: Record<string, unknown> | null
  surface: AiInsightSurface
  released?: AiReleasedPlugins
}

/** The readers a job on this surface may read, ordered by id so a prompt lists them in the same order every time. */
export async function aiInsightReaders(context: AiInsightReaderContext): Promise<ResolvedPluginFigureReader[]> {
  const prefixes = AI_INSIGHT_SURFACE_READERS[context.surface]
  const org = context.org as { enabledPlugins?: string[] } | null
  const candidates = listPluginFigureReaders().filter(({ reader }) => {
    if (!prefixes.includes(reader.id.split('.')[0])) return false
    // A site reader needs a site; a workspace reader reads with or without one.
    if (reader.scope === 'site' && !context.hostId) return false
    return !reader.feature || checkEntitlement(org as never, reader.feature)
  })
  const plugins = [...new Set(candidates.map(pluginFigureReaderPlugin).filter((id): id is string => Boolean(id)))]
  const released = new Set(plugins.length ? await (context.released ?? releasedByFlags)(plugins, context.orgId) : [])
  return candidates.filter((resolved) => {
    const plugin = pluginFigureReaderPlugin(resolved)
    if (!plugin) return true
    if (!released.has(plugin)) return false
    return context.hostId
      ? isHostPluginEnabled(org, context.host as { disabledPlugins?: string[] } | null, plugin)
      : isPluginEnabled(org, plugin)
  })
}

/** The window a reader is read over: the one asked for when it covers it, else the nearest it does. */
export function aiInsightReaderDays(windows: readonly number[], asked: number): number {
  if (!windows.length) return 0
  if (windows.includes(asked)) return asked
  return [...windows].sort((a, b) => Math.abs(a - asked) - Math.abs(b - asked) || a - b)[0]
}

/** The readers as the read prompt lists them: id, what each answers, its windows and its parameters. */
export function aiInsightReaderCatalog(readers: readonly ResolvedPluginFigureReader[]): string {
  return readers
    .map(({ reader }) => {
      const windows = reader.windows.length
        ? ` Windows: ${reader.windows.join(', ')} days.`
        : ' Current totals, with no window: days 0.'
      const params = (reader.params ?? []).length
        ? ` Parameters: ${(reader.params ?? [])
            .map((param) => `${param.name} (${param.required ? 'required' : 'optional'}) — ${param.description}`)
            .join('; ')}`
        : ''
      return `- ${reader.id} — ${reader.label}: ${reader.description}${windows}${params}`
    })
    .join('\n')
}

/** The datasets a datasets question may name, as the read prompt lists them. */
export function aiInsightDatasetCatalog(datasets: readonly AiDatasetCatalogEntry[]): string {
  if (!datasets.length) return 'There are no datasets you may read here.'
  return datasets
    .map(
      (dataset) =>
        `- ${dataset.name} (id ${dataset.id}): ${dataset.fields.map((field) => `${field.name} [${field.type}]`).join(', ') || 'no fields'}`,
    )
    .join('\n')
}

export interface AiInsightReadResult {
  tables: AiInsightTable[]
  /** Why a request that named a real reader was not read, in its owner's words, for the log. */
  refusals: string[]
}

/**
 * The tables for the reads a job asked for: each request held to the readers
 * this job may read, its window to that reader's, its parameters to those it
 * declares; each table held to the contract by `normalizePluginFigureTable`.
 * A reader asked for twice with the same window and parameters is read once.
 */
export async function readAiInsightTables(
  readers: readonly ResolvedPluginFigureReader[],
  requests: readonly AiInsightReadRequest[],
  base: { orgId: string; hostId: string | null; uid: string | null; now: Date },
  maxTables: number = AI_INSIGHT_MAX_READS,
): Promise<AiInsightReadResult> {
  const tables: AiInsightTable[] = []
  const refusals: string[] = []
  const seen = new Set<string>()
  for (const request of requests) {
    if (tables.length === maxTables) break
    const resolved = readers.find(({ reader }) => reader.id === request.reader)
    if (!resolved) continue
    const { reader } = resolved
    const days = aiInsightReaderDays(reader.windows, request.days)
    const params = pluginFigureParams(reader, request.params)
    if (params.ok === false) {
      refusals.push(`${reader.id}: missing ${params.missing}`)
      continue
    }
    const key = JSON.stringify([reader.id, days, params.params])
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const read = await reader.read({ ...base, days, params: params.params })
      if (read.ok === false) {
        refusals.push(`${reader.id}: ${read.error}`)
        continue
      }
      const table = normalizePluginFigureTable(read.table)
      if (!table) {
        refusals.push(`${reader.id}: not a table`)
        continue
      }
      tables.push({ ...table, ref: `t${tables.length + 1}`, reader: reader.id, days, scope: reader.scope })
    } catch (error) {
      // One reader's fault is not the answer's: the rest are still read.
      console.error('ai insight reader failed', { reader: reader.id, orgId: base.orgId, error })
      refusals.push(`${reader.id}: failed`)
    }
  }
  return { tables, refusals }
}

/** One table as the answer prompt shows it: a heading, the columns, numbered rows, and its notes. */
export function aiInsightTableText(table: AiInsightTable): string {
  const period = table.period ? ` · ${table.period.from} to ${table.period.to} (${table.period.days} days)` : ''
  const lines = [
    `${table.ref} · ${table.title} (${table.source.label})${period}`,
    `Columns: ${table.columns.map((column) => column.label).join(' | ')}`,
    ...table.rows.map(
      (row, index) =>
        `${index}: ${table.columns.map((column) => aiInsightCellText(table, column.key, row[column.key])).join(' | ')}`,
    ),
  ]
  if (!table.rows.length) lines.push('(no rows)')
  if (table.omitted) lines.push(`${table.omitted} more rows were left out of this table.`)
  for (const note of table.notes) lines.push(`Note: ${note}`)
  return lines.join('\n')
}
