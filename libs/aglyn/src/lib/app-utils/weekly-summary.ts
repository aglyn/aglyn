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

import {
  pluginFigureCellText,
  pluginFigureIsoWeek,
  pluginFigureWindows,
  type PluginFigureCell,
  type PluginFigureRow,
  type PluginFigureSummaryPart,
  type PluginFigureSummaryStat,
  type PluginFigureTable,
} from '../plugin-manager/plugin-figures'

/**
 * THE WEEKLY SUMMARY (AGL-3867): the free Monday emails that say how a
 * workspace did the week before — one for each site that had something to
 * report, and an overview of the workspace that adds the sites up.
 *
 * They spend nothing. Every figure comes from a `plugin-figures` reader that
 * declares a `weeklySummary`, and that reader's owner says what its table
 * means as tiles and ranked rows, so each plugin's counting rules decide what
 * a figure is and nothing here names one. AI weekly insights (AGL-2915) are
 * the paid version that explains the figures, and stay opt-in because each
 * one spends the workspace's AI credits.
 *
 * This module is the period, the wording helpers the readers use, and both
 * emails' words and layout; the reads and the sends are
 * `@aglyn/tenant-data-admin/server/weekly-summary`. The layout is drawn as
 * email-safe tables with inline styles, in colors the caller resolves from
 * the email theme.
 */

/** The key a person's switch is stored under in `users/{uid}.digestPrefs`; on until turned off. */
export const WEEKLY_SUMMARY_DIGEST_KEY = 'weeklySummary'

/** The window every figure is read over. */
export const WEEKLY_SUMMARY_DAYS = 7

/** Rows a ranked list names. */
export const WEEKLY_SUMMARY_TOP_ROWS = 5

/** Counts a subject line or the overview's tiles lead with, at most. */
export const WEEKLY_SUMMARY_HEADLINE_COUNTS = 3

/** Tiles in one row of an email. */
const TILES_PER_ROW = 3

/**
 * The week a run reports on: the seven whole UTC days before the day it runs,
 * so a Monday run covers Monday to Sunday and never a part-day of today.
 * `now` is what each reader is handed; `week` keys the run's marker.
 */
export function weeklySummaryPeriod(runAt: Date): {
  now: Date
  week: string
  from: string
  to: string
  label: string
} {
  const startOfToday = Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth(), runAt.getUTCDate())
  const now = new Date(startOfToday - 1)
  const { current } = pluginFigureWindows(now, WEEKLY_SUMMARY_DAYS)
  return {
    now,
    week: pluginFigureIsoWeek(now),
    from: current.from,
    to: current.to,
    label: `${weeklySummaryDay(current.from)} – ${weeklySummaryDay(current.to)}`,
  }
}

/** `2026-10-05` as "Oct 5". */
export function weeklySummaryDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`)
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** `2026-10-26` as "Mon, Oct 26". */
export function weeklySummaryWeekday(day: string): string {
  const at = new Date(`${day}T00:00:00Z`)
  return at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/g

/**
 * A sentence's dates as a person says them: "Monday 2026-10-26" as "Monday,
 * Oct 26". Tables hand the model their dates in ISO form, and it copies them.
 */
export function weeklySummaryPlainDates(text: string): string {
  const said = (day: string) => {
    const words = weeklySummaryDay(day)
    return words === 'Invalid Date' ? day : words
  }
  return text
    .replace(/\b((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day),? (\d{4}-\d{2}-\d{2})\b/g, (_, weekday: string, day: string) => `${weekday}, ${said(day)}`)
    .replace(ISO_DAY, said)
}

// ── Helpers the readers word their parts with ──────────────────────────────

/** A cell as a number, `0` for anything that is not one. */
export function figureCount(value: PluginFigureCell | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The row whose `key` cell is `label`: "Visitors" in a table of figures. */
export function figureRow(table: PluginFigureTable, key: string, label: string): PluginFigureRow | undefined {
  return table.rows.find((row) => row[key] === label)
}

/** Whether a table carries a column, so a reader that changed shape is noticed rather than misread. */
export function figureHasColumn(table: PluginFigureTable, key: string): boolean {
  return table.columns.some((column) => column.key === key)
}

/** A cell as a tile, with its change when the table has one. */
export function figureStat(
  table: PluginFigureTable,
  row: PluginFigureRow,
  key: string,
  label: string,
  options: { change?: string; total?: { one: string; many: string } } = {},
): PluginFigureSummaryStat {
  const change = options.change ? row[options.change] : undefined
  return {
    label,
    value: pluginFigureCellText(table, key, row[key] ?? 0),
    ...(typeof change === 'number' ? { change } : {}),
    ...(options.total ? { total: { count: figureCount(row[key]), ...options.total } } : {}),
  }
}

/** The named rows with the most of `key`, as ranked rows; `[]` when none has any. */
export function figureRanked(
  table: PluginFigureTable,
  nameKey: string,
  key: string,
  rows: readonly PluginFigureRow[] = table.rows,
): Array<{ label: string; value: string }> {
  return rows
    .filter((row) => typeof row[nameKey] === 'string' && figureCount(row[key]) > 0)
    .slice(0, WEEKLY_SUMMARY_TOP_ROWS)
    .map((row) => ({ label: String(row[nameKey]), value: pluginFigureCellText(table, key, row[key] ?? 0) }))
}

/** "1 order", "18 orders". */
export function figurePlural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

// ── The emails ─────────────────────────────────────────────────────────────

/** One site's figures for the week. */
export interface WeeklySummarySite {
  name: string
  /** The site's dashboard in the console, absolute; `null` with no origin to build it from. */
  url: string | null
  /**
   * Where the site itself is, so a reader knows which site this is: its
   * custom domain when it serves on one, else its platform address. `null`
   * for a site with no address yet.
   */
  address?: { label: string; url: string } | null
  parts: readonly PluginFigureSummaryPart[]
}

/** The colors an email is drawn in, resolved from its theme by the caller. */
export interface WeeklySummaryColors {
  text: string
  muted: string
  border: string
  /** A tile's ground. */
  surface: string
  /** The accent rule beside a callout. */
  accent: string
  /** Links: the email theme's own link color, the one every other link in the email wears. */
  link: string
  /** A rise and a fall. */
  up: string
  down: string
}

/** A site with anything to say. */
export function weeklySummaryHasNews(site: Pick<WeeklySummarySite, 'parts'>): boolean {
  return site.parts.length > 0
}

/** The counts the readers offered for adding up, summed by noun, in the order they were first given. */
export function weeklySummaryTotals(
  sites: ReadonlyArray<Pick<WeeklySummarySite, 'parts'>>,
): Array<{ count: number; one: string; many: string }> {
  const sums = new Map<string, { count: number; one: string; many: string }>()
  for (const site of sites) {
    for (const part of site.parts) {
      for (const stat of part.stats ?? []) {
        if (!stat.total || stat.total.count <= 0) continue
        const sum = sums.get(stat.total.one)
        sums.set(stat.total.one, sum ? { ...sum, count: sum.count + stat.total.count } : { ...stat.total })
      }
    }
  }
  return [...sums.values()]
}

function headline(sites: ReadonlyArray<Pick<WeeklySummarySite, 'parts'>>): string {
  return weeklySummaryTotals(sites)
    .slice(0, WEEKLY_SUMMARY_HEADLINE_COUNTS)
    .map(({ count, one, many }) => figurePlural(count, one, many))
    .join(', ')
}

/** "+12.5%", "−27.9%", "no change"; `null` with nothing to compare with. */
export function weeklySummaryChange(change: number | null | undefined): { text: string; sign: 1 | -1 | 0 } | null {
  if (typeof change !== 'number' || !Number.isFinite(change)) return null
  if (change === 0) return { text: 'no change', sign: 0 }
  const amount = Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 1 })
  return change > 0 ? { text: `+${amount}%`, sign: 1 } : { text: `−${amount}%`, sign: -1 }
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const FONT = 'Helvetica, Arial, sans-serif'

const capitalized = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

/**
 * A label that reads like an address — `www.google.com` — kept from being
 * turned into a link by the inbox, which would draw it in the inbox's own
 * blue beside the theme's links. A zero-width space after each dot breaks
 * the detection and nothing a reader sees.
 */
const unlinked = (value: string): string => esc(value).replace(/\./g, '.\u200b')

function changeHtml(change: number | null | undefined, colors: WeeklySummaryColors): string {
  const said = weeklySummaryChange(change)
  if (!said) return ''
  const color = said.sign > 0 ? colors.up : said.sign < 0 ? colors.down : colors.muted
  const arrow = said.sign > 0 ? '▲ ' : said.sign < 0 ? '▼ ' : ''
  return `<div style="font-family:${FONT};font-size:13px;line-height:1.4;font-weight:600;color:${color};">${arrow}${esc(said.text)}</div>`
}

/**
 * How many tiles share each row: one row of up to three, two rows of two for
 * four, then rows of three — so a row is never left with an empty slot
 * beside two tiles.
 */
export function weeklySummaryTileRows(count: number): number[] {
  if (count <= 0) return []
  if (count <= TILES_PER_ROW) return [count]
  if (count === 4) return [2, 2]
  const rows: number[] = []
  for (let left = count; left > 0; left -= TILES_PER_ROW) rows.push(Math.min(TILES_PER_ROW, left))
  return rows
}

/** The gap between tiles, across and down. */
const TILE_GAP_PX = 8

/** A cell that is only a gap: nothing in it may hold it open. */
const TILE_GAP = 'font-size:0;line-height:0;padding:0;'

/**
 * Tiles, each a value, its label and its change, filling the width of their
 * row. The tile is the table cell itself, so a row's tiles are one height
 * whichever of them wraps, in every mail client; the gaps are cells of their own.
 */
function tilesHtml(stats: readonly PluginFigureSummaryStat[], colors: WeeklySummaryColors): string {
  const sizes = weeklySummaryTileRows(stats.length)
  const rows: string[] = []
  let at = 0
  sizes.forEach((size) => {
    const cells = stats.slice(at, at + size)
    at += size
    // A tile alone takes half the row, not all of it, so it reads as a tile.
    const columns = Math.max(size, 2)
    const width = `${Math.floor(100 / columns)}%`
    const tds: string[] = []
    for (let index = 0; index < columns; index += 1) {
      if (index > 0) tds.push(`<td style="width:${TILE_GAP_PX}px;${TILE_GAP}">&nbsp;</td>`)
      const stat = cells[index]
      tds.push(
        stat
          ? `<td style="width:${width};background-color:${colors.surface};border:1px solid ${colors.border};border-radius:8px;padding:12px 14px;vertical-align:top;">` +
              `<div style="font-family:${FONT};font-size:24px;line-height:1.2;font-weight:700;color:${colors.text};">${esc(stat.value)}</div>` +
              `<div style="font-family:${FONT};font-size:13px;line-height:1.4;color:${colors.muted};">${esc(stat.label)}</div>` +
              changeHtml(stat.change, colors) +
              `</td>`
          : `<td style="width:${width};"></td>`,
      )
    }
    rows.push(`<tr>${tds.join('')}</tr>`)
    rows.push(`<tr><td colspan="${columns * 2 - 1}" style="height:${TILE_GAP_PX}px;${TILE_GAP}">&nbsp;</td></tr>`)
  })
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;">${rows.join('')}</table>`
}

/** A ranked list: the label left, its figure right, a hairline between. */
function rowsHtml(rows: ReadonlyArray<{ label: string; value: string }>, colors: WeeklySummaryColors): string {
  const trs = rows.map(
    (row, index) =>
      `<tr>` +
      `<td style="font-family:${FONT};font-size:14px;line-height:1.4;color:${colors.text};padding:8px 12px 8px 0;` +
      `${index < rows.length - 1 ? `border-bottom:1px solid ${colors.border};` : ''}word-break:break-word;">${unlinked(row.label)}</td>` +
      `<td style="font-family:${FONT};font-size:14px;line-height:1.4;font-weight:600;color:${colors.text};padding:8px 0;text-align:right;white-space:nowrap;` +
      `${index < rows.length - 1 ? `border-bottom:1px solid ${colors.border};` : ''}">${esc(row.value)}</td>` +
      `</tr>`,
  )
  return `<table role="presentation" style="width:100%;border-collapse:collapse;">${trs.join('')}</table>`
}

function sectionTitleHtml(title: string, colors: WeeklySummaryColors): string {
  return (
    `<div style="font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.06em;` +
    `text-transform:uppercase;color:${colors.muted};padding:0 0 8px;">${esc(title)}</div>`
  )
}

/** A figure in a sentence: a count, a sum or a percent, never the digits in a path or a date. */
const FIGURE =
  /(?<![\p{L}\p{N}_./-])(?<!(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) )[+\-−]?[$€£¥]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?(?![\p{L}\p{N}_/-])/gu

/** A sentence with its figures in bold, so an eye running down the email lands on them. */
function figuresHtml(text: string, colors: WeeklySummaryColors): string {
  let html = ''
  let at = 0
  for (const match of text.matchAll(FIGURE)) {
    html += `${unlinked(text.slice(at, match.index))}<strong style="font-weight:700;color:${colors.text};">${esc(match[0])}</strong>`
    at = match.index + match[0].length
  }
  return html + unlinked(text.slice(at))
}

/** A figure a digest section lists: a page and its views. */
export interface WeeklySummarySectionRow {
  label: string
  /** Where the label goes: the page itself. */
  url?: string | null
  value: string
  change?: number | null
}

/** One day of a section's chart; `marked` when it is a day the section is about. */
export interface WeeklySummarySectionBar {
  label: string
  value: number
  /** The value as a person reads it. */
  display: string
  marked: boolean
}

/** One topic of an AI digest, told once: what stood out, and the figures behind it. */
export interface WeeklySummarySection {
  title: string
  /** Where the figures can be seen in full. */
  link?: { label: string; url: string } | null
  /** What was said about it: a line to scan and, if it needs one, the sentence behind it. */
  points: ReadonlyArray<{ headline: string | null; text: string | null }>
  rows?: readonly WeeklySummarySectionRow[]
  bars?: readonly WeeklySummarySectionBar[]
}

/** Tiles on their own, for an email that leads with its headline figures. */
export function weeklySummaryTilesHtml(stats: readonly PluginFigureSummaryStat[], colors: WeeklySummaryColors): string {
  return stats.length ? `<div style="padding:12px 0 8px;">${tilesHtml(stats, colors)}</div>` : ''
}

function sectionRowsHtml(rows: readonly WeeklySummarySectionRow[], colors: WeeklySummaryColors): string {
  const cell = `font-family:${FONT};font-size:14px;line-height:1.4;padding:7px 0;`
  // No column for a change no row has, so the figures reach the edge.
  const changes = rows.some((row) => weeklySummaryChange(row.change))
  const trs = rows.map((row, index) => {
    const border = index > 0 ? `border-top:1px solid ${colors.border};` : ''
    const label = row.url
      ? `<a href="${esc(row.url)}" style="color:${colors.link};text-decoration:none;font-weight:600;">${unlinked(row.label)}</a>`
      : unlinked(row.label)
    return (
      `<tr>` +
      `<td style="${cell}${border}color:${colors.text};word-break:break-word;">${label}</td>` +
      `<td style="${cell}${border}color:${colors.text};font-weight:600;padding-left:12px;text-align:right;white-space:nowrap;">${esc(row.value)}</td>` +
      (changes
        ? `<td style="${cell}${border}padding-left:12px;text-align:right;white-space:nowrap;">${changeHtml(row.change, colors)}</td>`
        : '') +
      `</tr>`
    )
  })
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;">${trs.join('')}</table>`
}

/** Horizontal bars, drawn in table cells so every mail client keeps them. */
function sectionBarsHtml(bars: readonly WeeklySummarySectionBar[], colors: WeeklySummaryColors): string {
  const most = Math.max(...bars.map((bar) => bar.value), 1)
  const trs = bars.map((bar) => {
    const text = `font-family:${FONT};font-size:13px;line-height:1.3;color:${bar.marked ? colors.text : colors.muted};white-space:nowrap;`
    const weight = bar.marked ? 'font-weight:700;' : ''
    return (
      `<tr>` +
      `<td style="${text}${weight}padding:3px 10px 3px 0;width:1%;">${esc(bar.label)}</td>` +
      `<td style="padding:3px 0;"><div style="background-color:${bar.marked ? colors.accent : colors.border};border-radius:2px;font-size:0;height:10px;line-height:0;width:${Math.max(1, Math.round((bar.value / most) * 100))}%;">&nbsp;</div></td>` +
      `<td style="${text}${weight}padding:3px 0 3px 10px;text-align:right;width:1%;">${esc(bar.display)}</td>` +
      `</tr>`
    )
  })
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;">${trs.join('')}</table>`
}

function sectionHtml(section: WeeklySummarySection, colors: WeeklySummaryColors, first: boolean): string {
  const link = section.link
    ? `<td style="padding:0;text-align:right;vertical-align:baseline;white-space:nowrap;">` +
      `<a href="${esc(section.link.url)}" style="font-family:${FONT};font-size:13px;line-height:1.4;font-weight:600;color:${colors.link};text-decoration:none;">${esc(section.link.label)}&nbsp;→</a>` +
      `</td>`
    : ''
  const points = section.points.map(
    (point) =>
      `<div style="padding:6px 0 0;">` +
      (point.headline
        ? `<div style="font-family:${FONT};font-size:16px;line-height:1.35;font-weight:700;color:${colors.text};">${unlinked(point.headline)}</div>`
        : '') +
      (point.text
        ? `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${colors.muted};">${figuresHtml(point.text, colors)}</div>`
        : '') +
      `</div>`,
  )
  return (
    `<div style="padding:${first ? '8px' : '18px'} 0 18px;${first ? '' : `border-top:1px solid ${colors.border};`}">` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;"><tr>` +
    `<td style="font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${colors.muted};padding:0;">${esc(section.title)}</td>` +
    link +
    `</tr></table>` +
    points.join('') +
    (section.rows?.length ? sectionRowsHtml(section.rows, colors) : '') +
    (section.bars?.length ? sectionBarsHtml(section.bars, colors) : '') +
    `</div>`
  )
}

/** An AI digest's topics, a hairline between them. */
export function weeklySummarySectionsHtml(sections: readonly WeeklySummarySection[], colors: WeeklySummaryColors): string {
  return sections.map((section, index) => sectionHtml(section, colors, index === 0)).join('')
}

/** The small print under the button, with its one link. */
export function weeklySummaryFootnoteHtml(
  text: string,
  link: { label: string; url: string } | null,
  colors: WeeklySummaryColors,
): string {
  return (
    `<div style="font-family:${FONT};font-size:12px;line-height:1.5;color:${colors.muted};padding:12px 0 0;">` +
    esc(text) +
    (link ? ` <a href="${esc(link.url)}" style="color:${colors.link};text-decoration:underline;">${esc(link.label)}</a>` : '') +
    `</div>`
  )
}

function partHtml(part: PluginFigureSummaryPart, colors: WeeklySummaryColors): string {
  return (
    `<div style="padding:16px 0 8px;">` +
    sectionTitleHtml(part.title, colors) +
    (part.note
      ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${colors.muted};padding:0 0 8px;">${esc(part.note)}</div>`
      : '') +
    (part.stats?.length ? tilesHtml(part.stats, colors) : '') +
    (part.rows?.length ? rowsHtml(part.rows, colors) : '') +
    `</div>`
  )
}

/** "aglyn.com · Aglyn LLC": which site, linked, and whose. */
function addressHtml(site: WeeklySummarySite, workspaceName: string, colors: WeeklySummaryColors): string {
  const address = site.address
    ? `<a href="${esc(site.address.url)}" style="color:${colors.link};text-decoration:underline;font-weight:600;">${esc(site.address.label)}</a>`
    : `<span style="font-weight:600;">${esc(site.name)}</span>`
  return (
    `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${colors.muted};padding:0 0 4px;">` +
    `${address} · ${esc(workspaceName)}</div>`
  )
}

function insightsHtml(url: string, colors: WeeklySummaryColors): string {
  return (
    `<div style="margin:16px 0 0;background-color:${colors.surface};border-left:3px solid ${colors.accent};border-radius:4px;padding:14px 16px;">` +
    `<div style="font-family:${FONT};font-size:14px;line-height:1.5;font-weight:700;color:${colors.text};">Want to know why the numbers moved?</div>` +
    `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${colors.text};">` +
    `AI weekly insights explain each site's week in a few plain sentences. ` +
    `<a href="${esc(url)}" style="color:${colors.link};text-decoration:underline;">Turn them on from Ask about your numbers</a>.` +
    `</div></div>`
  )
}

function partText(part: PluginFigureSummaryPart): string[] {
  const lines = [part.title.toUpperCase()]
  if (part.note) lines.push(part.note)
  for (const stat of part.stats ?? []) {
    const said = weeklySummaryChange(stat.change)
    lines.push(`${stat.label}: ${stat.value}${said ? ` (${said.text})` : ''}`)
  }
  for (const row of part.rows ?? []) lines.push(`- ${row.label}: ${row.value}`)
  return lines
}

/** What a send fills a weekly summary email's tokens with. */
export interface WeeklySummaryEmail {
  subject: string
  /** The heading: "Aglyn last week". */
  title: string
  /** "Oct 5 – Oct 11, compared with the week before". */
  period: string
  /** The figures, drawn. */
  html: string
  /** The whole email as plain text, closing line included. */
  text: string
  buttonLabel: string
  /** Where the button goes; `''` when there is no console origin to link to. */
  url: string
}

interface CommonInput {
  workspaceName: string
  productName: string
  periodLabel: string
  colors: WeeklySummaryColors
  /** Where AI weekly insights are turned on, when the plan includes them and this person has not; else `null`. */
  aiInsightsUrl: string | null
  settingsUrl: string
}

function closing(input: CommonInput): string[] {
  return [
    '',
    `You get this summary because you manage ${input.workspaceName}. Turn it off in Notifications: ${input.settingsUrl}`,
  ]
}

/**
 * One site's email, or `null` for a site with nothing to report. `workspace`
 * carries the workspace's own parts when this site's email stands in for the
 * overview, in a workspace with one active site.
 */
export function composeWeeklySummarySiteEmail(
  input: CommonInput & { site: WeeklySummarySite; workspace?: readonly PluginFigureSummaryPart[] },
): WeeklySummaryEmail | null {
  const workspace = input.workspace ?? []
  if (!weeklySummaryHasNews(input.site) && !workspace.length) return null
  const lead = headline([input.site])
  const subject = lead ? `${input.site.name} last week: ${lead}` : `${input.site.name} last week`
  const html =
    addressHtml(input.site, input.workspaceName, input.colors) +
    input.site.parts.map((part) => partHtml(part, input.colors)).join('') +
    (workspace.length
      ? `<div style="border-top:1px solid ${input.colors.border};margin:16px 0 0;"></div>` +
        workspace.map((part) => partHtml({ ...part, title: `${input.workspaceName} · ${part.title}` }, input.colors)).join('')
      : '') +
    (input.aiInsightsUrl ? insightsHtml(input.aiInsightsUrl, input.colors) : '')
  const text = [
    `${input.site.name} last week, ${input.periodLabel}. A change in brackets is against the week before.`,
    `Site: ${input.site.address ? `${input.site.address.label} (${input.site.address.url})` : input.site.name} · ${input.workspaceName}`,
    ...input.site.parts.flatMap((part) => ['', ...partText(part)]),
    ...workspace.flatMap((part) => ['', ...partText({ ...part, title: `${input.workspaceName} · ${part.title}` })]),
    ...(input.site.url ? ['', `Open ${input.site.name} in ${input.productName}: ${input.site.url}`] : []),
    ...(input.aiInsightsUrl
      ? ['', `Want to know why the numbers moved? Turn on AI weekly insights from Ask about your numbers: ${input.aiInsightsUrl}`]
      : []),
    ...closing(input),
  ].join('\n')
  return {
    subject,
    title: `${input.site.name} last week`,
    period: `${input.periodLabel}, compared with the week before`,
    html,
    text,
    buttonLabel: `Open ${input.site.name}`,
    url: input.site.url ?? '',
  }
}

/**
 * The workspace overview: the week's totals across its sites, a line for each
 * site, and the workspace's own figures, or `null` when nothing anywhere has
 * anything to report.
 */
export function composeWeeklySummaryOverviewEmail(
  input: CommonInput & {
    sites: readonly WeeklySummarySite[]
    workspace: readonly PluginFigureSummaryPart[]
    /** The workspace's home in the console, absolute; `''` with no origin. */
    url: string
  },
): WeeklySummaryEmail | null {
  const active = input.sites.filter(weeklySummaryHasNews)
  if (!active.length && !input.workspace.length) return null
  const totals = weeklySummaryTotals(active)
  const lead = totals
    .slice(0, WEEKLY_SUMMARY_HEADLINE_COUNTS)
    .map(({ count, one, many }) => figurePlural(count, one, many))
    .join(', ')
  const subject = lead ? `Your week at ${input.workspaceName}: ${lead}` : `Your week at ${input.workspaceName}`
  const { colors } = input
  const totalsPart: PluginFigureSummaryPart | null = totals.length
    ? {
        title: active.length === 1 ? 'At a glance' : `Across ${active.length} sites`,
        stats: totals.slice(0, TILES_PER_ROW * 2).map(({ count, one, many }) => ({
          label: capitalized(count === 1 ? one : many),
          value: count.toLocaleString('en-US'),
        })),
      }
    : null
  const siteLine = (site: WeeklySummarySite): string =>
    site.parts
      .flatMap((part) => part.stats ?? [])
      .filter((stat) => stat.total && stat.total.count > 0)
      .slice(0, WEEKLY_SUMMARY_HEADLINE_COUNTS)
      .map((stat) => {
        const total = stat.total as NonNullable<PluginFigureSummaryStat['total']>
        const said = weeklySummaryChange(stat.change)
        return `${figurePlural(total.count, total.one, total.many)}${said ? ` (${said.text})` : ''}`
      })
      .join(' · ')
  const quietCount = input.sites.length - active.length
  const quiet = quietCount
    ? `${figurePlural(quietCount, 'other site', 'other sites')} had nothing to report.`
    : ''
  const sitesHtml = active.length
    ? `<div style="padding:16px 0 8px;">` +
      sectionTitleHtml('Your sites', colors) +
      `<table role="presentation" style="width:100%;border-collapse:collapse;">` +
      active
        .map((site, index) => {
          const border = index < active.length - 1 ? `border-bottom:1px solid ${colors.border};` : ''
          const name = site.url
            ? `<a href="${esc(site.url)}" style="color:${colors.link};text-decoration:none;font-weight:700;">${esc(site.name)}</a>`
            : `<span style="font-weight:700;">${esc(site.name)}</span>`
          const line = siteLine(site)
          const address = site.address
            ? ` <a href="${esc(site.address.url)}" style="color:${colors.muted};text-decoration:underline;font-size:13px;font-weight:400;">${esc(site.address.label)}</a>`
            : ''
          return (
            `<tr><td style="font-family:${FONT};font-size:15px;line-height:1.4;color:${colors.text};padding:10px 0;${border}">` +
            name +
            address +
            (line ? `<div style="font-size:13px;line-height:1.5;color:${colors.muted};">${esc(line)}</div>` : '') +
            `</td></tr>`
          )
        })
        .join('') +
      `</table>` +
      (quiet
        ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${colors.muted};padding:4px 0 0;">${esc(quiet)}</div>`
        : '') +
      `</div>`
    : ''
  const html =
    (totalsPart ? partHtml(totalsPart, colors) : '') +
    sitesHtml +
    input.workspace.map((part) => partHtml(part, colors)).join('') +
    (active.length > 1
      ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${colors.muted};padding:8px 0 0;">Each site's own summary arrives beside this one.</div>`
      : '') +
    (input.aiInsightsUrl ? insightsHtml(input.aiInsightsUrl, colors) : '')
  const text = [
    `Here is how ${input.workspaceName} did last week, ${input.periodLabel}. A change in brackets is against the week before.`,
    ...(totalsPart ? ['', ...partText(totalsPart)] : []),
    ...(active.length
      ? [
          '',
          'YOUR SITES',
          ...active.map(
            (site) =>
              `- ${site.name}${site.address ? ` (${site.address.label})` : ''}: ${siteLine(site) || 'see its summary'}` +
              (site.url ? ` · ${site.url}` : ''),
          ),
          ...(quiet ? [quiet] : []),
        ]
      : []),
    ...input.workspace.flatMap((part) => ['', ...partText(part)]),
    ...(input.aiInsightsUrl
      ? ['', `Want to know why the numbers moved? Turn on AI weekly insights from Ask about your numbers: ${input.aiInsightsUrl}`]
      : []),
    ...closing(input),
  ].join('\n')
  return {
    subject,
    title: `${input.workspaceName} last week`,
    period: `${input.periodLabel}, compared with the week before`,
    html,
    text,
    buttonLabel: `Open ${input.workspaceName}`,
    url: input.url,
  }
}
