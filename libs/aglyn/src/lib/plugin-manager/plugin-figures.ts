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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Figures one plugin publishes for another (AGL-2915).
 *
 * The records behind a figure belong to the plugin that models them: orders
 * to commerce, bookings to bookings, campaigns and experiments to marketing.
 * The owner knows which documents count, which are test data, what a refund
 * does to revenue and which fields could name a person. A different plugin
 * that wants the figure — a weekly report, an export, an assistant answering
 * a question about the numbers — must not read those documents itself,
 * because it would restate the owner's rules and drift from them the day the
 * owner changes one. Nor may it import the owner, which the package map
 * forbids.
 *
 * So the owner registers a READER from its server surfaces, and a caller asks
 * for one by id. A reader answers with one compact table:
 *
 *  - read-only: a reader writes nothing, schedules nothing and sends nothing;
 *  - aggregate: counts, sums, rates and labels, never the records themselves;
 *  - about nobody: no row names a person, and no cell carries a name, an email
 *    address, a phone number or a street address — a customer is counted,
 *    never listed;
 *  - bounded: at most `PLUGIN_FIGURE_MAX_ROWS` rows, each labelled with where
 *    in the console the figures come from.
 *
 * Built on the typed service registry (`plugin-services`): one contract, every
 * reader registered under its id as the service's key.
 *
 * ## The registry carries no authorization of the CALLER
 *
 * Like `plugin-resource-drafts`, a reader is a pre-authorized operation: it
 * reads the site or the workspace it is handed. A caller establishes, in its
 * own terms and before it asks, who is asking, that the org owns the site, that
 * the person may see that site's figures, and that the owning plugin is
 * switched on for it.
 *
 * ## A table is checked on the way out as well as on the way in
 *
 * `normalizePluginFigureTable` holds whatever a reader returned to the shape
 * above — row and cell bounds, column kinds, and personal details masked in
 * every text cell — so a consumer that shows or forwards a table relies on the
 * contract rather than on every reader having kept it.
 */

/** Whether a reader's figures are about one site or about the whole workspace. */
export type PluginFigureScope = 'site' | 'org'

/**
 * How a column's cells read:
 *
 * - `text` — a label: a page path, a form's name, a region;
 * - `count` — a whole number of things;
 * - `number` — any other figure, such as an average per day;
 * - `money` — an amount in major units of the column's `currency`;
 * - `percent` — a share or a rate, from 0 to 100;
 * - `change` — the percent change from the window before; `null` where there
 *   is no earlier window to compare with, never 0 or 100;
 * - `duration` — seconds;
 * - `date` — a calendar day, `YYYY-MM-DD`.
 */
export type PluginFigureColumnKind =
  | 'text'
  | 'count'
  | 'number'
  | 'money'
  | 'percent'
  | 'change'
  | 'duration'
  | 'date'

export const PLUGIN_FIGURE_COLUMN_KINDS: readonly PluginFigureColumnKind[] = [
  'text',
  'count',
  'number',
  'money',
  'percent',
  'change',
  'duration',
  'date',
]

export interface PluginFigureColumn {
  /** The row field the column reads. */
  key: string
  label: string
  kind: PluginFigureColumnKind
  /** The ISO 4217 code of a `money` column. */
  currency?: string
}

export type PluginFigureCell = string | number | null

export type PluginFigureRow = Record<string, PluginFigureCell>

export interface PluginFigureTable {
  title: string
  /**
   * Where the figures come from: the name of the console page, and its path
   * under the site's console root for a site reader, or under the workspace's
   * for an org reader (`commerce/orders`), so a consumer can link to it.
   */
  source: { label: string; path: string | null }
  /** The days the figures cover, inclusive; `null` for a current count. */
  period: { from: string; to: string; days: number } | null
  columns: PluginFigureColumn[]
  rows: PluginFigureRow[]
  /** Rows the reader left out past its bound. */
  omitted: number
  /** Short plain sentences a reader of the figures needs, such as a window with nothing earlier to compare with. */
  notes: string[]
}

export interface PluginFigureRequest {
  orgId: string
  /** The site a `site` reader reads; for an `org` reader, the site the figures are narrowed to, or `null`. */
  hostId: string | null
  /** The window, in days, ending at `now`: one of the reader's `windows`, or 0 for a reader with none. */
  days: number
  now: Date
  /**
   * The member asking. A reader of records a member may see only part of —
   * a dataset shared with some sites — reads what this member may see; with
   * `null`, nobody asked, and it reads only what every member of the site may.
   */
  uid: string | null
  /** The reader's own parameters, by the names its `params` declare; each a string. */
  params: Readonly<Record<string, string>>
}

/** One parameter a reader takes beyond its window. */
export interface PluginFigureParam {
  /** The name a request carries it under: letters, digits and underscores. */
  name: string
  /** What it selects, in one plain sentence. */
  description: string
  required: boolean
}

export type PluginFigureRead =
  | { ok: true; table: PluginFigureTable }
  | {
      ok: false
      status: 400 | 403 | 404
      /** Customer-safe: a caller shows it as it stands. */
      error: string
    }

export interface PluginFigureReader {
  /** Stable and unique across plugins: lowercase words joined by dots (`commerce.orders`). */
  id: string
  /** What a person calls the figures: "Orders". */
  label: string
  /**
   * What the reader answers, in one or two plain sentences. The same bytes for
   * every site, so a list of readers can be shown to anyone who may use them.
   */
  description: string
  scope: PluginFigureScope
  /** The windows the reader covers, in days; empty for a reader of current counts. */
  windows: readonly number[]
  /**
   * The plugin whose records the figures are read from, which must run on the
   * site — or on the workspace, for an `org` reader — before anyone is offered
   * the reader. Absent, the plugin that registered it; `null` for figures the
   * platform itself keeps, such as page views.
   */
  plugin?: string | null
  /** The plan feature the figures are sold under; a workspace without it is not offered the reader. */
  feature?: string
  /** The parameters the reader takes beyond its window; absent for none. */
  params?: readonly PluginFigureParam[]
  read(request: PluginFigureRequest): Promise<PluginFigureRead>
}

export const PLUGIN_FIGURES = definePluginServiceContract<PluginFigureReader>('core.figures', {
  multiple: true,
})

/** The most rows one table carries; the rest are counted in `omitted`. */
export const PLUGIN_FIGURE_MAX_ROWS = 25

/** The most columns one table carries. */
export const PLUGIN_FIGURE_MAX_COLUMNS = 8

/** The longest text cell, title or label a table carries, in characters. */
export const PLUGIN_FIGURE_MAX_TEXT = 120

/** The most notes one table carries. */
export const PLUGIN_FIGURE_MAX_NOTES = 3

const READER_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const COLUMN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const CONSOLE_PATH = /^[a-z0-9][a-z0-9/_-]{0,119}$/
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY = /^[A-Z]{3}$/

/**
 * Registers a reader. The owner is the loader's marker when a register fn is
 * running, else `options.pluginId`; with neither the registration throws. A
 * reader id another plugin already registered throws naming both, and the
 * incumbent keeps serving; the same plugin registering again replaces its own.
 */
export function registerPluginFigureReader(
  reader: PluginFigureReader,
  options?: { pluginId?: string },
): void {
  const key = reader.id.trim()
  if (!READER_ID.test(key)) {
    throw new Error(`a figure reader id is lowercase words joined by dots; refused "${reader.id}"`)
  }
  for (const param of reader.params ?? []) {
    if (!PARAM_NAME.test(param.name)) {
      throw new Error(`figure reader "${key}" declares a parameter named "${param.name}", which is not a name`)
    }
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_FIGURES).find((entry) => entry.key === key)
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `figure reader "${key}" is already registered by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_FIGURES, reader, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

export interface ResolvedPluginFigureReader {
  /** The plugin that owns the records behind the figures. */
  pluginId: string
  reader: PluginFigureReader
}

/** The reader registered under an id, with its owner, or `null`. */
export function pluginFigureReader(id: string): ResolvedPluginFigureReader | null {
  const key = id.trim()
  const entry = resolvePluginServices(PLUGIN_FIGURES).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, reader: entry.impl } : null
}

/** Every registered reader with its owner, ordered by id so a list of them is the same bytes on every call. */
export function listPluginFigureReaders(): ResolvedPluginFigureReader[] {
  return resolvePluginServices(PLUGIN_FIGURES)
    .map((entry) => ({ pluginId: entry.pluginId, reader: entry.impl }))
    .sort((a, b) => a.reader.id.localeCompare(b.reader.id))
}

/** The plugin that must run for a reader to be offered: its own `plugin`, else its owner; `null` for platform figures. */
export function pluginFigureReaderPlugin(resolved: ResolvedPluginFigureReader): string | null {
  return resolved.reader.plugin === undefined ? resolved.pluginId : resolved.reader.plugin
}

/**
 * The parameters a request carries that the reader declares, each trimmed to
 * a short string, or the name of the first required one that is missing.
 */
export function pluginFigureParams(
  reader: Pick<PluginFigureReader, 'params'>,
  raw: Readonly<Record<string, unknown>> | null | undefined,
): { ok: true; params: Record<string, string> } | { ok: false; missing: string } {
  const params: Record<string, string> = {}
  for (const param of reader.params ?? []) {
    const value = raw?.[param.name]
    const text = typeof value === 'string' ? value.trim().slice(0, PLUGIN_FIGURE_MAX_TEXT) : ''
    if (text) params[param.name] = text
    else if (param.required) return { ok: false, missing: param.name }
  }
  return { ok: true, params }
}

// ── Personal details ────────────────────────────────────────────────────

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
/** A run of digits with the separators a phone number is written with; its digits are counted apart. */
const PHONE_LIKE = /(?<![\p{L}\p{N}/_])\+?\(?\d[\d\s().-]{6,}\d(?![\p{L}\p{N}/_])/gu

/** Nine to fifteen digits: a phone number's length anywhere, and longer than any calendar day or year. */
function looksLikePhone(match: string): boolean {
  const digits = match.replace(/\D/g, '').length
  return digits >= 9 && digits <= 15
}

/**
 * The text with every email address and phone number replaced by a marker.
 * A figure's label is never meant to carry either, so a match is masked
 * rather than trusted: a campaign named after a person's address says
 * nothing about the campaign that the marker does not.
 */
export function maskPersonalDetails(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(PHONE_LIKE, (match) => (looksLikePhone(match) ? '[phone]' : match))
}

/** Whether a text carries an email address or a phone number. */
export function hasPersonalDetails(text: string): boolean {
  return maskPersonalDetails(text) !== text
}

// ── The table, held to the contract ─────────────────────────────────────

function cut(value: unknown, max = PLUGIN_FIGURE_MAX_TEXT): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function day(value: unknown): string | null {
  return typeof value === 'string' && CALENDAR_DAY.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null
}

function cellFor(column: PluginFigureColumn, value: unknown): PluginFigureCell {
  switch (column.kind) {
    case 'text':
      return typeof value === 'string' ? maskPersonalDetails(cut(value)) : null
    case 'date':
      return day(value)
    case 'count': {
      const number = finite(value)
      return number === null ? null : Math.round(number)
    }
    default:
      return finite(value)
  }
}

/**
 * A reader's table held to the contract: bounded, typed and masked. Columns
 * with a key, a kind or a currency the contract does not know are dropped, and
 * every cell is read through its column, so a cell of the wrong type is `null`
 * rather than passed on. `null` for a value that is not a table at all.
 */
export function normalizePluginFigureTable(value: unknown): PluginFigureTable | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const table = value as Partial<PluginFigureTable>
  const title = cut(table.title)
  if (!title) return null

  const seen = new Set<string>()
  const columns: PluginFigureColumn[] = []
  for (const raw of Array.isArray(table.columns) ? table.columns : []) {
    if (columns.length === PLUGIN_FIGURE_MAX_COLUMNS) break
    const column = raw as Partial<PluginFigureColumn> | null
    const key = typeof column?.key === 'string' ? column.key : ''
    const kind = column?.kind as PluginFigureColumnKind
    if (!COLUMN_KEY.test(key) || seen.has(key) || !PLUGIN_FIGURE_COLUMN_KINDS.includes(kind)) continue
    if (kind === 'money' && !(typeof column?.currency === 'string' && CURRENCY.test(column.currency))) {
      continue
    }
    seen.add(key)
    columns.push({
      key,
      label: cut(column?.label, 60) || key,
      kind,
      ...(kind === 'money' ? { currency: column?.currency as string } : {}),
    })
  }
  if (!columns.length) return null

  const rawRows = Array.isArray(table.rows) ? table.rows : []
  const rows = rawRows.slice(0, PLUGIN_FIGURE_MAX_ROWS).map((raw) => {
    const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    return Object.fromEntries(columns.map((column) => [column.key, cellFor(column, source[column.key])]))
  })
  const omitted =
    Math.max(0, rawRows.length - PLUGIN_FIGURE_MAX_ROWS) +
    (typeof table.omitted === 'number' && Number.isFinite(table.omitted) && table.omitted > 0
      ? Math.floor(table.omitted)
      : 0)

  const period = table.period
  const from = day(period?.from)
  const to = day(period?.to)
  const days = finite(period?.days)
  const path = typeof table.source?.path === 'string' ? table.source.path.trim() : ''

  return {
    title,
    source: {
      label: cut(table.source?.label, 80) || title,
      path: CONSOLE_PATH.test(path) && !path.includes('..') ? path : null,
    },
    period:
      from && to && days !== null && days >= 1 && days <= 366
        ? { from, to, days: Math.round(days) }
        : null,
    columns,
    rows,
    omitted,
    notes: (Array.isArray(table.notes) ? table.notes : [])
      .map((note) => maskPersonalDetails(cut(note, 200)))
      .filter(Boolean)
      .slice(0, PLUGIN_FIGURE_MAX_NOTES),
  }
}

// ── Windows ─────────────────────────────────────────────────────────────

/** A calendar day in UTC. */
export function pluginFigureDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/**
 * The window of `days` ending on the day of `now`, inclusive, and the window
 * of the same length immediately before it: what every `change` column
 * compares, so a figure from one reader compares like a figure from another.
 */
export function pluginFigureWindows(
  now: Date,
  days: number,
): {
  current: { from: string; to: string; startMs: number; endMs: number }
  previous: { from: string; to: string; startMs: number; endMs: number }
} {
  const span = Math.max(1, Math.floor(days))
  const dayMs = 86_400_000
  const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + dayMs
  const currentStart = endOfToday - span * dayMs
  const previousStart = currentStart - span * dayMs
  return {
    current: {
      from: pluginFigureDay(new Date(currentStart)),
      to: pluginFigureDay(new Date(endOfToday - dayMs)),
      startMs: currentStart,
      endMs: endOfToday,
    },
    previous: {
      from: pluginFigureDay(new Date(previousStart)),
      to: pluginFigureDay(new Date(currentStart - dayMs)),
      startMs: previousStart,
      endMs: currentStart,
    },
  }
}

/**
 * The percent change from `previous` to `current`, to one decimal place.
 * `null` when there is nothing earlier to compare with, so a first window
 * reads as no change figure at all rather than as a rise from zero.
 */
export function pluginFigureChange(current: number, previous: number | null): number | null {
  if (previous === null || !Number.isFinite(previous) || previous <= 0) return null
  if (!Number.isFinite(current)) return null
  return Math.round(((current - previous) / previous) * 1_000) / 10
}
