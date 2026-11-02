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
 * What the fidelity report says of a built site beside its scores (AGL-4109),
 * pure so a spec reads it: the look the site wears and what its pages cost.
 *
 * The 11/1 report read `host.theme`, the base an import starts from, and said
 * the site wore the starter's indigo while it rendered the source's blue. The
 * look an import saves is `themeOverride` over that base, with `siteStyle`
 * beside it (`aiSaveSiteTheme`). The credits line printed a mean, while the
 * table a quote is made of (`AI_MEASURED_IMPORT_CREDITS`) is a median and a
 * p90.
 */

import { readThemeOverride, resolveSiteTheme } from '@aglyn/aglyn/app-utils/site-theme'
import type { AiJobItemLedger } from './ai-jobs.types'

type Dict = Record<string, any>

/** The look line's facts, as a site stores them and an import ran them. */
export interface SiteImportLookReport {
  /** The base theme the site was given: `siteStyle.base`, or `null` where it holds no style. */
  base: string | null
  /** Whether a look is saved over the base. */
  override: boolean
  /** The job whose look the site wears: `siteStyle.jobId`. */
  jobId: string | null
  /** The source's brand color the look was drawn from: `siteStyle.brand`. */
  brand: string | null
  /** What the import's look pass came to: `look.theme`. */
  pass: string | null
  primary: string | null
  secondary: string | null
  tertiary: string | null
  fonts: string[]
}

const named = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

/** The look a site wears: its base theme with what was saved over it, and which job saved it. */
export function siteImportLookReport(host: Dict, state: Dict | null | undefined): SiteImportLookReport {
  const theme = (resolveSiteTheme(host) ?? {}) as Dict
  const light = (theme['colorSchemes']?.['light'] ?? {}) as Dict
  const style = (host['siteStyle'] ?? null) as Dict | null
  return {
    base: named(style?.['base']),
    override: !!readThemeOverride(host),
    jobId: named(style?.['jobId']),
    brand: named(style?.['brand']),
    pass: named(state?.['look']?.['theme']),
    primary: named(light['primary']?.['main']),
    secondary: named(light['secondary']?.['main']),
    tertiary: named(light['tertiary']?.['main']),
    fonts: ((theme['fonts'] ?? []) as Dict[]).map((font) => String(font['family'] ?? '')).filter(Boolean),
  }
}

/** The look line of the report: what the site wears, and whether it is this job's. */
export function siteImportLookLine(host: Dict, state: Dict | null | undefined, jobId: string): string {
  const look = siteImportLookReport(host, state)
  const colors = (['primary', 'secondary', 'tertiary'] as const).map((key) => `${key} ${look[key] ?? 'not set'}`).join(', ')
  const brand = look.brand ? `, drawn from ${look.brand}` : ''
  const fonts = look.fonts.join(', ') || 'not set'
  const wearing = look.override ? `an override over the ${look.base ?? 'site'} base` : `the ${look.base ?? 'site'} base, no override`
  const whose = look.jobId ? (look.jobId === jobId ? 'saved by this job' : `saved by job ${look.jobId}, not this one`) : 'saved by no job'
  return `${look.pass ?? 'not run'}; ${colors}${brand}; ${fonts}; ${wearing}; ${whose}`
}

/** One kind of page's cost, as `AI_MEASURED_IMPORT_CREDITS` holds it. */
export interface SiteImportCreditsMeasured {
  count: number
  median: number
  p90: number
  mean: number
}

/** The middle value of what is sorted: the two middle ones' mean, for an even count. */
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

/**
 * What each kind of page cost by the ledger, as the table a quote is read
 * from is measured: over the items that came through and gave nothing back,
 * grouped by how their page was built. The p90 is the nearest rank.
 */
export function siteImportCreditsMeasured(
  state: { pages: ReadonlyArray<{ slot: string; build?: string | null }> },
  items: ReadonlyArray<Pick<AiJobItemLedger, 'slot' | 'status' | 'creditsSpent' | 'creditsRefunded'>>,
): Partial<Record<'arranged' | 'copied', SiteImportCreditsMeasured>> {
  const buildOf = new Map(state.pages.map((page) => [page.slot, page.build ?? null]))
  const out: Partial<Record<'arranged' | 'copied', SiteImportCreditsMeasured>> = {}
  for (const build of ['arranged', 'copied'] as const) {
    const each = items
      .filter((item) => buildOf.get(item.slot) === build && item.status === 'succeeded' && !(Number(item.creditsRefunded) > 0))
      .map((item) => Number(item.creditsSpent ?? 0))
      .sort((a, b) => a - b)
    if (!each.length) continue
    const total = each.reduce((sum, value) => sum + value, 0)
    out[build] = { count: each.length, median: median(each), p90: each[Math.ceil(each.length * 0.9) - 1] as number, mean: total / each.length }
  }
  return out
}

const credits = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

/** The credits line of the report: each kind of page's count, median, p90 and mean. */
export function siteImportCreditsLine(measured: ReturnType<typeof siteImportCreditsMeasured>): string {
  const parts = (['arranged', 'copied'] as const).flatMap((build) => {
    const row = measured[build]
    return row ? [`${row.count} ${build}, median ${credits(row.median)}, p90 ${credits(row.p90)}, mean ${credits(row.mean)}`] : []
  })
  return parts.length ? parts.join('; ') : 'no page in yet'
}
