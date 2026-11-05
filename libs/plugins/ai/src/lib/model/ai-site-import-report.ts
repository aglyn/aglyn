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

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { readThemeOverride, resolveSiteTheme } from '@aglyn/aglyn/app-utils/site-theme'
import type { AiJobItemLedger } from './ai-jobs.types'
import type { AiSiteImportFinish, AiSiteImportWords } from './ai-site-import'
import { SITE_IMPORT_GROUND_DELTA, siteImportFidelityThemeOf, siteImportOklabDelta, siteImportOutlinedColorOf, type SiteImportFidelityTheme } from './ai-site-import-fidelity'
import { aiSiteTheme, type AiSiteStyle } from './ai-site-look'

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
  /** What Keep my site pins of the source's look (AGL-4152), source beside theme; absent where the import read no look of its source. */
  pins?: SiteImportLookPins
}

const named = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

/** The look a site wears: its base theme with what was saved over it, and which job saved it. */
export function siteImportLookReport(host: Dict, state: Dict | null | undefined): SiteImportLookReport {
  const theme = (resolveSiteTheme(host) ?? {}) as Dict
  const light = (theme['colorSchemes']?.['light'] ?? {}) as Dict
  const style = (host['siteStyle'] ?? null) as Dict | null
  const pins = siteImportLookPins(host, state)
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
    ...(pins ? { pins } : {}),
  }
}

/** The look line of the report: what the site wears, and whether it is this job's; and what Keep my site pins, source → theme, where the import read its source's look (AGL-4152). */
export function siteImportLookLine(host: Dict, state: Dict | null | undefined, jobId: string): string {
  const look = siteImportLookReport(host, state)
  const colors = (['primary', 'secondary', 'tertiary'] as const).map((key) => `${key} ${look[key] ?? 'not set'}`).join(', ')
  const brand = look.brand ? `, drawn from ${look.brand}` : ''
  const fonts = look.fonts.join(', ') || 'not set'
  const wearing = look.override ? `an override over the ${look.base ?? 'site'} base` : `the ${look.base ?? 'site'} base, no override`
  const whose = look.jobId ? (look.jobId === jobId ? 'saved by this job' : `saved by job ${look.jobId}, not this one`) : 'saved by no job'
  return `${look.pass ?? 'not run'}; ${colors}${brand}; ${fonts}; ${wearing}; ${whose}${look.pins ? `; ${siteImportLookPinsLine(look.pins)}` : ''}`
}

/*------------------------------------------
 * What Keep my site pins (AGL-4152)
 *-----------------------------------------*/

/** One pin of the look: the source's, the theme's, and how far apart (OKLab ΔE, for a color). */
export interface SiteImportLookPin {
  source: string | null
  theme: string | null
  delta: number | null
}

/** The look's pins, the source's beside the theme's: its grounds, its filled buttons' fill, label and case. */
export interface SiteImportLookPins {
  ground: SiteImportLookPin
  darkGround: SiteImportLookPin
  buttonFill: SiteImportLookPin
  buttonText: SiteImportLookPin
  buttonCase: SiteImportLookPin
  /** The soft bands' fill, in the light and the dark scheme; the dark's source `null` where its stylesheets say none. */
  paper: SiteImportLookPin
  darkPaper: SiteImportLookPin
  /** An outlined button's words' color. */
  buttonOutline: SiteImportLookPin
  /** The case its text buttons, and the links drawn as them, are set in. */
  textCase: SiteImportLookPin
  /** Where the theme's side was read: the site's theme as stored, or computed from its site style. */
  from: SiteImportFidelityTheme['from'] | null
}

/** Whether a stored site style holds what its colors are drawn from. */
function isStyle(value: unknown): value is AiSiteStyle {
  const style = value as Partial<AiSiteStyle> | null
  return !!style && typeof style === 'object' && typeof style.seed === 'number' && typeof style.ground === 'string' && typeof style.chroma === 'string' && typeof style.hue === 'number'
}

/**
 * The theme a built site's pages are drawn in, for the fidelity (AGL-4152):
 * the theme it stores, its override resolved; else, where it stores none,
 * one computed from its site style (`siteStyle`) over the starter theme, and
 * marked so. `null` for a site with neither.
 */
export function siteImportFidelityThemeFor(host: Dict): SiteImportFidelityTheme | null {
  const stored = siteImportFidelityThemeOf(resolveSiteTheme(host), 'theme')
  if (stored) return stored
  const style = host['siteStyle']
  return isStyle(style) ? siteImportFidelityThemeOf(aiSiteTheme(style, DEFAULT_SITE_THEME), 'style') : null
}

const hexOrNull = (value: unknown): string | null => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null)

/** A color pin: the two colors and how far apart. */
function colorPin(source: unknown, theme: string | null): SiteImportLookPin {
  const from = hexOrNull(source)
  const to = hexOrNull(theme)
  return { source: from, theme: to, delta: from && to ? Math.round(siteImportOklabDelta(from, to) * 1000) / 1000 : null }
}

/**
 * What Keep my site pins of the source's look (AGL-4152), the source's as
 * the reader read it (`home.look`) beside the theme's: the page ground, the
 * dark ground, a filled button's fill and label, and its case. `null` where
 * the import read no look of its source.
 */
export function siteImportLookPins(host: Dict, state: Dict | null | undefined): SiteImportLookPins | null {
  const facts = state?.['home']?.['look'] as Dict | null | undefined
  if (!facts || typeof facts !== 'object') return null
  const theme = siteImportFidelityThemeFor(host)
  const wanted = facts['buttonCase'] === 'upper' || facts['buttonCase'] === 'none' ? (facts['buttonCase'] as string) : null
  const drawn = theme?.button.case ?? null
  return {
    ground: colorPin(facts['background'], theme?.light.ground ?? null),
    darkGround: colorPin(facts['darkBackground'], theme?.dark?.ground ?? null),
    buttonFill: colorPin(facts['buttonFill'], theme ? (theme.button.fill ?? theme.light.brand) : null),
    buttonText: colorPin(facts['buttonText'], theme ? (theme.button.label ?? theme.light.onBrand) : null),
    buttonCase: { source: wanted, theme: drawn, delta: null },
    paper: colorPin(facts['paperBackground'], theme?.light.paper ?? null),
    darkPaper: colorPin(facts['darkPaper'], theme?.dark?.paper ?? null),
    buttonOutline: colorPin(facts['buttonOutline'], theme ? siteImportOutlinedColorOf(theme) : null),
    textCase: { source: facts['textCase'] === 'upper' || facts['textCase'] === 'none' ? (facts['textCase'] as string) : null, theme: theme?.button.text?.case ?? drawn, delta: null },
    from: theme?.from ?? null,
  }
}

/** The pins as the look line prints them: each source → theme, a color with its ΔE and whether it moved past 0.05. */
export function siteImportLookPinsLine(pins: SiteImportLookPins): string {
  const one = (name: string, pin: SiteImportLookPin) => {
    const said = `${name} ${pin.source ?? 'not read'} → ${pin.theme ?? 'not set'}`
    if (pin.delta !== null) return `${said} (ΔE ${pin.delta.toFixed(3)}, ${pin.delta <= SITE_IMPORT_GROUND_DELTA ? 'kept' : 'moved'})`
    return pin.source && pin.theme ? `${said} (${pin.source === pin.theme ? 'kept' : 'moved'})` : said
  }
  const where = pins.from === 'style' ? ', the theme computed from the site style' : pins.from === null ? ', no theme to read' : ''
  return `pins ${[one('ground', pins.ground), one('darkGround', pins.darkGround), one('buttonFill', pins.buttonFill), one('buttonText', pins.buttonText), one('buttonCase', pins.buttonCase), one('paper', pins.paper), one('darkPaper', pins.darkPaper), one('buttonOutline', pins.buttonOutline), one('textCase', pins.textCase)].join(', ')}${where}`
}

/**
 * How a page of an import was finished (AGL-4152), as the report scores it:
 * what was asked for on the command line, else what its wave was stamped
 * with at its start, else the import's own; an import that names none reads
 * as Keep my site. Its words are improved where the page says so, else where
 * its wave (or the import) improved them under Improve it.
 */
export function siteImportPageFinish(
  state: Dict,
  page: Dict,
  asked: { finish?: AiSiteImportFinish | null; words?: AiSiteImportWords | null } = {},
): { finish: AiSiteImportFinish; words: AiSiteImportWords; from: 'asked' | 'wave' | 'import' | 'default' } {
  const finishOf = (value: unknown): AiSiteImportFinish | null => (value === 'keep' || value === 'improve' ? value : null)
  const wave = ((state['waves'] ?? []) as Dict[]).find((entry) => entry['index'] === page['wave']) ?? null
  const stamped = finishOf(wave?.['finish'])
  const own = finishOf(state['finish'])
  const finish = asked.finish ?? stamped ?? own ?? 'keep'
  const from = asked.finish ? 'asked' : stamped ? 'wave' : own ? 'import' : 'default'
  const pageWords = page['wording'] === 'kept' || page['wording'] === 'improved' ? (page['wording'] as AiSiteImportWords) : null
  const switched = (wave?.['wording'] ?? state['wording']) === true
  const words = asked.words ?? pageWords ?? (finish === 'improve' && switched ? 'improved' : 'kept')
  return { finish, words, from }
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
