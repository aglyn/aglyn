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
 * THE SALES A PLUGIN MADE THROUGH THE PLATFORM, ON THE OPERATOR'S RETURN
 * (AGL-3080).
 *
 * The operator — whoever runs this deployment — files a sales tax return for
 * the sales it FACILITATED, not only for its own. Its own subscription
 * invoices are platform billing and the return sums them itself. A plugin
 * that sells through the platform's account — a storefront checkout whose tax
 * Stripe computes against the operator's registrations, a marketplace charge
 * whose tax stays platform-side — holds records the return cannot read
 * without knowing that plugin's storage, and a classification of them the
 * return has no business restating.
 *
 * So the division is: the FILING is the platform's — the period, the
 * jurisdiction and registration, the verdict, the working-papers export and
 * the Texas Webfile lines. What a plugin sold, how each of its rows
 * classifies and who is liable for it, and the words a preparer reads about
 * it, are the plugin's. A source answers one period with a
 * {@link TaxReturnSourceAnswer}: its findings, its lines for the filing
 * figures, its tables and figures for the screen, its blocks for the export,
 * and its own summary and rows carried whole for the audit.
 *
 * ## ⛔ AN UNREAD SOURCE REFUSES, IT NEVER READS AS ZERO
 *
 * Decided before anything else, because this is a legal filing. A source
 * that answered nothing is indistinguishable, on a total, from a source that
 * sold nothing — and a return signed on that total understates what the
 * operator collected and holds. So:
 *
 * - **Declared and not registered** — every plugin whose sales belong on the
 *   return says so with `"taxReturnSource": true` in `plugins.config.json`,
 *   compiled into {@link PLUGIN_TAX_RETURN_SOURCES}. A declared plugin that
 *   registered no source in this process answers `outcome: 'refused'`. A
 *   runtime registry alone could not say this: an empty registry looks
 *   exactly like a deployment where nothing sells.
 * - **Threw, or answered a malformed section** — `outcome: 'refused'`, with
 *   the sentence the return prints.
 * - **Truncated, or holding rows no period can reach** — answered, and the
 *   platform raises each as a BLOCKING finding itself; a source cannot word
 *   its way out of either.
 *
 * The return turns every refusal into a blocking "do not file from this"
 * finding. {@link readTaxReturnSources} never throws and never drops a
 * declared source.
 *
 * The reader is the staff tax-return route, which awaits `ensureAll` on the
 * `consoleApi` surface before it asks, so a runtime registry is filled before
 * the question; the compiled declaration is what makes a MISSING
 * registration a refusal rather than an absence.
 *
 * ⚑ The discriminant is a string: this repo compiles with
 * `strictNullChecks: false`, under which a boolean-literal union does not
 * narrow (see `plugin-artifact-inventory.ts`).
 */

import { PLUGIN_TAX_RETURN_SOURCES } from './first-party-plugins.generated'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

export { PLUGIN_TAX_RETURN_SOURCES }

/** Which exporter the filing jurisdiction gets. */
export type TaxReturnFilingForm = 'tx-webfile' | 'breakdown'

/**
 * The jurisdiction the operator files in, as the platform resolved it from
 * its own configuration. A source words its lines and findings for THIS
 * jurisdiction and never assumes one.
 */
export interface TaxReturnFiling {
  /** The bucket key: `US-TX`, `US-CA`, `GB`. */
  code: string
  /** How a sentence names it: `Texas`, or the code itself. */
  label: string
  /** Which exporter the filing lines are for. */
  form: TaxReturnFilingForm
  /** How a sentence names the filing figures: `Items 1–3`, `the breakdown`. */
  figuresName: string
}

/** What the return asks every source, once per period. */
export interface TaxReturnSourceRequest {
  /** `2026-Q3` or `2026-09`, echoed for the record. */
  period: string
  /** Half-open UTC bounds of the period. */
  start: Date
  end: Date
  filing: TaxReturnFiling
  /**
   * The most documents the operator will read for one source. Past it the
   * answer is `truncated`, and a truncated source blocks the return: the
   * ceiling is the operator's policy, so a source is TOLD it.
   */
  rowCap: number
}

export type TaxReturnFindingSeverity = 'blocking' | 'review'

/**
 * One finding, in the words a preparer reads. `blocking` means the return
 * must not be filed until it is resolved; `review` means a figure is
 * qualified. A zero count is not raised.
 */
export interface TaxReturnFinding {
  /** Stable, and unique on the return. */
  id: string
  severity: TaxReturnFindingSeverity
  /** Rows, or cents where the label says so. */
  count: number
  label: string
  /** What it means for the return, and what to do — not a restatement. */
  detail: string
}

/** A line printed beneath the platform's own filing figures. */
export interface TaxReturnFilingLine {
  /** The form's item number where the figure maps to one, else `—`. */
  item: string
  label: string
  /** Dollars, or null when the figure is not computed. */
  dollars: string | null
  note: string
}

/** One cell of a source's table on the screen. */
export interface TaxReturnSectionCell {
  text: string
  /** A second, quieter line under the text. */
  caption?: string
  /**
   * A short tag beside the text. `attention` marks the figure that needs a
   * decision; `neutral` qualifies one.
   */
  tag?: { label: string; tone: 'attention' | 'neutral' }
  /** The figure a reader must not miss. */
  strong?: boolean
}

export interface TaxReturnSectionColumn {
  label: string
  /** Right-aligned. */
  numeric?: boolean
  /** Money: set in a fixed-width face so columns of cents line up. */
  money?: boolean
}

/** A table on the source's card. */
export interface TaxReturnSectionTable {
  /** A subheading above the table; the first table sits under the card's own. */
  heading?: string
  /** A sentence between the heading and the table. */
  description?: string
  columns: TaxReturnSectionColumn[]
  rows: Array<{ key: string; cells: TaxReturnSectionCell[] }>
  /** What the table says when it has no rows. */
  empty: string
  /** A caption under the table. */
  footnote?: string
}

/** One label/value line of a source's figures. */
export interface TaxReturnSectionFigure {
  label: string
  value: string
  note: string
}

/**
 * One block of the working-papers export, as the CSV's own rows.
 *
 * `jurisdictions` places it beside the operator's own sales by jurisdiction,
 * before the working papers; `sections` places it after them, where each
 * source's figures sit. The platform separates blocks with a blank row.
 */
export interface TaxReturnExportBlock {
  placement: 'jurisdictions' | 'sections'
  rows: string[][]
}

/** What a source answers for one period. */
export interface TaxReturnSourceAnswer {
  /** Stable key for the source's findings and its card, unique on the return. */
  id: string
  /** The noun for its rows: `Storefront`, `Marketplace`. */
  name: string
  /** The card's heading. */
  title: string
  /** The card's help, as a documentation excerpt. */
  help: string
  /** The paragraph under the heading. */
  intro: string
  /** Documents past the request's `rowCap` were not read. */
  truncated: boolean
  /** Rows no period query can reach — in this return and every other. */
  undatedRows: number
  /** The source's own findings. Truncation and undated rows are raised by the platform. */
  findings: TaxReturnFinding[]
  /** Lines beneath the filing figures, for the request's `filing.form`. */
  filingLines: TaxReturnFilingLine[]
  tables: TaxReturnSectionTable[]
  figures: TaxReturnSectionFigure[]
  exports: TaxReturnExportBlock[]
  /** The source's own figures, carried whole for the audit. */
  summary: unknown
  /** The rows behind them, as the source projects them for the working papers. */
  rows: unknown[]
}

/** One source on the return: its answer, or why there is none. */
export type TaxReturnSection =
  | ({ outcome: 'answered'; pluginId: string } & TaxReturnSourceAnswer)
  | {
      outcome: 'refused'
      pluginId: string
      /** The plugin id: a refused source never said what it calls itself. */
      id: string
      /** Why nothing from this source is on the return, as the return prints it. */
      reason: string
    }

export interface TaxReturnSource {
  /**
   * This plugin's sales for one period. May throw: the return refuses the
   * source rather than read a throw as nothing sold.
   */
  read(request: TaxReturnSourceRequest): Promise<TaxReturnSourceAnswer>
}

/** Every source answers; one per plugin. */
export const TAX_RETURN_SOURCES = definePluginServiceContract<TaxReturnSource>(
  'core.tax-return-sources',
  { multiple: true },
)

/**
 * Installs a plugin's source. Owner = the loader's marker inside a register
 * fn, else `options.pluginId`. Registering again replaces the plugin's
 * earlier source, so a module evaluated twice does not answer twice.
 */
export function registerTaxReturnSource(
  source: TaxReturnSource,
  options?: { pluginId?: string },
): void {
  if (typeof source?.read !== 'function') {
    throw new Error('a tax return source needs a read function')
  }
  registerPluginService(TAX_RETURN_SOURCES, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The plugins with a registered source, in the order they answer. */
export function listTaxReturnSources(): string[] {
  return resolvePluginServices(TAX_RETURN_SOURCES).map((entry) => entry.pluginId)
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * What is wrong with an answer, or null when it can be printed.
 *
 * Checked because the answer crosses a package boundary into a legal
 * document: a finding with a NaN count sums to NaN and the verdict reads
 * clean, and a missing array is a section that silently shows nothing.
 */
function malformed(answer: TaxReturnSourceAnswer): string | null {
  if (!answer || typeof answer !== 'object') return 'no section'
  if (!isText(answer.id) || !isText(answer.name) || !isText(answer.title)) {
    return 'a section with no id, name or title'
  }
  if (typeof answer.truncated !== 'boolean') return 'no truncation flag'
  if (!isCount(answer.undatedRows)) return 'no count of undated rows'
  for (const key of ['findings', 'filingLines', 'tables', 'figures', 'exports', 'rows'] as const) {
    if (!Array.isArray(answer[key])) return `no ${key}`
  }
  const badFinding = answer.findings.find(
    (finding) =>
      !isText(finding?.id) ||
      (finding.severity !== 'blocking' && finding.severity !== 'review') ||
      !isCount(finding.count),
  )
  if (badFinding) return 'a finding with no id, severity or count'
  return null
}

/**
 * Every source's answer for one period — declared sources first, in the
 * compiled order, then any other registered source in registration order.
 *
 * NEVER THROWS and never drops a declared source: a declared plugin with no
 * registration, a source that threw, and a malformed or duplicate answer
 * each come back as `outcome: 'refused'` with the sentence the return prints.
 * `declared` is the compiled {@link PLUGIN_TAX_RETURN_SOURCES} unless a spec
 * passes its own.
 */
export async function readTaxReturnSources(
  request: TaxReturnSourceRequest,
  declared: readonly string[] = PLUGIN_TAX_RETURN_SOURCES,
): Promise<TaxReturnSection[]> {
  const registered = resolvePluginServices(TAX_RETURN_SOURCES)
  const order = [
    ...declared,
    ...registered
      .map((entry) => entry.pluginId)
      .filter((pluginId) => !declared.includes(pluginId)),
  ].filter((pluginId, index, all) => all.indexOf(pluginId) === index)

  const answers = await Promise.all(
    order.map(async (pluginId): Promise<TaxReturnSection> => {
      const source = registered.find((entry) => entry.pluginId === pluginId)?.impl
      if (!source) {
        console.error(
          `[tax-return] "${pluginId}" declares a tax return source and none is ` +
            'registered in this process; its sales cannot be read.',
        )
        return {
          outcome: 'refused',
          pluginId,
          id: pluginId,
          reason:
            `The “${pluginId}” plugin sells through the platform and registered ` +
            'nothing to read its sales with.',
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
        console.error(`[tax-return] "${pluginId}" failed to read its sales`, error)
        return {
          outcome: 'refused',
          pluginId,
          id: pluginId,
          reason: `The “${pluginId}” plugin could not read its sales for this period.`,
        }
      }
    }),
  )

  // Two sources under one id would print two cards and one set of findings
  // under the same key, and a finding that names the wrong source's rows is
  // worse than none. The later one is refused, visibly.
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
