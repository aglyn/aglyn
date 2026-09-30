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
 * WHAT A PLUGIN EARNED THE OPERATOR, ON THE STAFF REVENUE REPORT (AGL-3080).
 *
 * The operator's revenue report states what the deployment actually kept in a
 * period. Its own subscription invoices are platform billing and the report
 * folds them itself. A plugin that sells through the platform's account — a
 * storefront's application fee, a marketplace's commission — earns the
 * operator a take the report cannot compute without knowing that plugin's
 * storage and its fee rules, and it has no business restating either.
 *
 * So the division is: the REPORT is the platform's — the period, the two
 * bases, the gap, the sweep ceiling, the read budget for names and the page.
 * What a plugin's sales earned, net of what is not the operator's, and who
 * produced it, are the plugin's. A source answers one period with a
 * {@link RevenueSourceAnswer}: its earned line, its gross-to-net lines, its
 * qualifications, its attribution tables and its own settled figures.
 *
 * ## ⛔ AN UNREAD SOURCE IS NEVER A ZERO
 *
 * A source that answered nothing reads, on a total, exactly like one that
 * earned nothing, and a revenue total quoted short is a figure somebody
 * repeats. So, as the tax return's sources do:
 *
 * - every plugin that earns through the platform declares
 *   `"revenueSource": true` in `plugins.config.json`, compiled into
 *   {@link PLUGIN_REVENUE_SOURCES}; a declared plugin with no registration, a
 *   source that threw and a malformed answer each come back
 *   `outcome: 'refused'`, and the page says whose earnings are missing;
 * - a source whose own read could not run answers with `failure` and figures
 *   it does NOT claim, and one whose sweep stopped at the ceiling answers
 *   `truncated` — the page names both rather than quoting the total.
 *
 * {@link readRevenueSources} never throws and never drops a declared source.
 * The reader is the staff revenue route, which awaits `ensureAll` on the
 * `consoleApi` surface before it asks.
 */

import { PLUGIN_REVENUE_SOURCES } from './first-party-plugins.generated'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

export { PLUGIN_REVENUE_SOURCES }

/**
 * Pages a query to exhaustion under the operator's ceiling. The ceiling is the
 * platform's policy about its own request, so a source is handed the sweep
 * rather than choosing one; `truncated` means the ceiling stopped it.
 */
export type RevenueSweep = <Doc>(
  query: unknown,
  orderField: unknown,
) => Promise<{ docs: Doc[]; truncated: boolean }>

/** One attributed row: who produced a gain, and the loss beside it. */
export interface RevenueAttributionRow {
  key: string
  /** Display name, filled in by a bounded lookup; the id until then. */
  name: string
  /** Secondary identity — plugin id, publisher, subdomain. */
  detail: string
  /** Revenue earned, net of its own reversals. */
  gainCents: number
  /** Money handed back. Already deducted from `gainCents`. */
  lossCents: number
  count: number
}

/** A capped attribution: shown rows plus the remainder, as figures. */
export interface RevenueAttribution {
  rows: RevenueAttributionRow[]
  omittedRows: number
  omittedGainCents: number
  omittedLossCents: number
}

/** What the report asks every source, once per period. */
export interface RevenueSourceRequest {
  /** `2026-08` or `2026-Q3`, echoed for the record. */
  period: string
  /** Half-open UTC bounds of the period. */
  start: Date
  end: Date
  /** Rows per attribution table the page shows; the rest is carried as figures. */
  attributionLimit: number
  sweep: RevenueSweep
  /**
   * Display names for organizations — which the report has already read, so
   * naming a publisher costs nothing.
   */
  orgNames(orgIds: readonly string[]): Promise<ReadonlyMap<string, string>>
  /**
   * Names the rows a source will SHOW from a collection's documents, in place:
   * `name` from `nameField`, `detail` from `detailField`, and `(deleted)` for a
   * document that is gone. Called AFTER capping, so the read is bounded by what
   * is displayed rather than by how many sales the period holds.
   */
  nameRows(
    rows: RevenueAttributionRow[],
    from: { collection: string; nameField: string; detailField: string },
  ): Promise<void>
}

/** A line of the report's gross-versus-net reconciliation. */
export interface RevenueSourceLine {
  label: string
  cents: number
  /** Subtracted on the way from gross to what the operator kept. */
  deduction: boolean
  /** Whose money it is — the sentence that says why it is or is not revenue. */
  note: string
}

/** A table of who produced a source's earnings. */
export interface RevenueAttributionTable extends RevenueAttribution {
  id: string
  heading: string
  /** The column naming what a row is: `Listing`, `Storefront`. */
  unit: string
  /** The column counting what was summed: `Sales`, `Orders`. */
  countLabel: string
  empty: string
  /** Draw the rows as ranked bars above the table, saying this when there are none. */
  chartEmpty?: string
}

/** What a source answers for one period. */
export interface RevenueSourceAnswer {
  /** Stable key, unique on the report. */
  id: string
  /** How the report names it when its read stopped short: `marketplace`. */
  name: string
  /** Its line of "where the money came from", net of everything not the operator's. */
  earned: { label: string; cents: number; note: string }
  grossToNet: RevenueSourceLine[]
  /** Qualifications worth stating beside the figures. Only those that apply. */
  notes: Array<{ label: string; tone: 'warning' | 'neutral' }>
  /** Each sums to `earned`. */
  attribution: RevenueAttributionTable[]
  /** A sentence under the source's attribution tables. */
  attributionNote?: string
  /** The sweep stopped at the ceiling: every figure is a LOWER BOUND. */
  truncated: boolean
  /**
   * The source's read could not run at all, so its figures are not counted —
   * never a cap, which is a different state with a different remedy.
   */
  failure: { title: string; detail: string } | null
  /** The source's own settled figures, carried whole for the audit. */
  summary: unknown
}

/** One source on the report: its answer, or why there is none. */
export type RevenueSection =
  | ({ outcome: 'answered'; pluginId: string } & RevenueSourceAnswer)
  | {
      outcome: 'refused'
      pluginId: string
      /** The plugin id: a refused source never said what it calls itself. */
      id: string
      reason: string
    }

export interface RevenueSource {
  /** This plugin's earnings for one period. May throw: the report refuses it. */
  read(request: RevenueSourceRequest): Promise<RevenueSourceAnswer>
}

/** Every source answers; one per plugin. */
export const REVENUE_SOURCES = definePluginServiceContract<RevenueSource>(
  'core.revenue-sources',
  { multiple: true },
)

/** Installs a plugin's source; registering again replaces it. */
export function registerRevenueSource(
  source: RevenueSource,
  options?: { pluginId?: string },
): void {
  if (typeof source?.read !== 'function') {
    throw new Error('a revenue source needs a read function')
  }
  registerPluginService(REVENUE_SOURCES, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The plugins with a registered source, in the order they answer. */
export function listRevenueSources(): string[] {
  return resolvePluginServices(REVENUE_SOURCES).map((entry) => entry.pluginId)
}

/**
 * Group, sort and cap — every attribution table's shared half.
 *
 * A row whose key is missing is NOT dropped. It is grouped under an explicit
 * unattributed key, because a sale nobody can attribute still happened and
 * dropping it would make the rows sum below the total — the one property that
 * makes any of these tables worth reading. The cap carries its remainder as
 * FIGURES, so the table stays a complete accounting even when it is not a
 * complete list.
 */
export function groupRevenueAttribution(
  entries: ReadonlyArray<{ key: string; detail: string; gain: number; loss: number }>,
  limit: number,
  unattributedLabel: string,
): RevenueAttribution {
  const byKey = new Map<string, RevenueAttributionRow>()
  for (const entry of entries ?? []) {
    const key = entry.key || unattributedLabel
    const row = byKey.get(key) ?? {
      key,
      name: key === unattributedLabel ? unattributedLabel : key,
      detail: entry.detail ?? '',
      gainCents: 0,
      lossCents: 0,
      count: 0,
    }
    row.gainCents += entry.gain
    row.lossCents += entry.loss
    row.count += 1
    if (!row.detail && entry.detail) row.detail = entry.detail
    byKey.set(key, row)
  }
  const rows = [...byKey.values()].sort(
    (a, b) =>
      b.gainCents - a.gainCents ||
      b.lossCents - a.lossCents ||
      a.key.localeCompare(b.key),
  )
  const kept = rows.slice(0, Math.max(0, limit))
  const dropped = rows.slice(Math.max(0, limit))
  return {
    rows: kept,
    omittedRows: dropped.length,
    omittedGainCents: dropped.reduce((sum, row) => sum + row.gainCents, 0),
    omittedLossCents: dropped.reduce((sum, row) => sum + row.lossCents, 0),
  }
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** What is wrong with an answer, or null when it can be printed. */
function malformed(answer: RevenueSourceAnswer): string | null {
  if (!answer || typeof answer !== 'object') return 'no report'
  if (!isText(answer.id) || !isText(answer.name)) return 'a report with no id or name'
  const cents = answer.earned?.cents
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return 'no earned figure'
  if (!isText(answer.earned?.label)) return 'an earned figure with no label'
  if (typeof answer.truncated !== 'boolean') return 'no truncation flag'
  for (const key of ['grossToNet', 'notes', 'attribution'] as const) {
    if (!Array.isArray(answer[key])) return `no ${key}`
  }
  const badLine = answer.grossToNet.find(
    (line) => typeof line?.cents !== 'number' || !Number.isFinite(line.cents),
  )
  if (badLine) return 'a gross-to-net line with no figure'
  return null
}

/**
 * Every source's answer for one period — declared sources first, in the
 * compiled order, then any other registered source.
 *
 * NEVER THROWS and never drops a declared source. `declared` is the compiled
 * {@link PLUGIN_REVENUE_SOURCES} unless a spec passes its own.
 */
export async function readRevenueSources(
  request: RevenueSourceRequest,
  declared: readonly string[] = PLUGIN_REVENUE_SOURCES,
): Promise<RevenueSection[]> {
  const registered = resolvePluginServices(REVENUE_SOURCES)
  const order = [
    ...declared,
    ...registered
      .map((entry) => entry.pluginId)
      .filter((pluginId) => !declared.includes(pluginId)),
  ].filter((pluginId, index, all) => all.indexOf(pluginId) === index)

  const answers = await Promise.all(
    order.map(async (pluginId): Promise<RevenueSection> => {
      const source = registered.find((entry) => entry.pluginId === pluginId)?.impl
      if (!source) {
        console.error(
          `[revenue] "${pluginId}" declares a revenue source and none is ` +
            'registered in this process; its earnings cannot be read.',
        )
        return {
          outcome: 'refused',
          pluginId,
          id: pluginId,
          reason:
            `The “${pluginId}” plugin earns through the platform and registered ` +
            'nothing to read its earnings with.',
        }
      }
      try {
        const answer = await source.read(request)
        const problem = malformed(answer)
        if (problem) {
          return {
            outcome: 'refused',
            pluginId,
            id: pluginId,
            reason: `The “${pluginId}” plugin answered ${problem}.`,
          }
        }
        return { ...answer, outcome: 'answered', pluginId }
      } catch (error) {
        console.error(`[revenue] "${pluginId}" failed to read its earnings`, error)
        return {
          outcome: 'refused',
          pluginId,
          id: pluginId,
          reason: `The “${pluginId}” plugin could not read its earnings for this period.`,
        }
      }
    }),
  )

  const seen = new Set<string>()
  return answers.map((section) => {
    if (section.outcome !== 'answered') return section
    if (!seen.has(section.id)) {
      seen.add(section.id)
      return section
    }
    return {
      outcome: 'refused',
      pluginId: section.pluginId,
      id: section.pluginId,
      reason:
        `The “${section.pluginId}” plugin answered as “${section.id}”, which ` +
        'another source already is.',
    }
  })
}
