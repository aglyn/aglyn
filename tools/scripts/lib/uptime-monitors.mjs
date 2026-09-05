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
// The UptimeRobot monitor inventory — the docs table, the public monitor
// list, and the comparison between them (AGL-2593). Pure: no network, no
// filesystem, no process. `check-uptime-monitors.mjs` is the I/O half.
//
// ## WHY THIS EXISTS
//
// `docs/UPTIME_AND_SLA.md` tabulates the external keyword monitors by name,
// and the account's status page exposes the same names through an
// unauthenticated JSON endpoint. Both were maintained by hand — the set grew
// from eleven to fourteen on 2026-09-04 and the table was edited to match in
// the same sitting — and nothing read the two together. A monitor renamed,
// paused or deleted in the dashboard, or a row added to the table for a
// monitor nobody created, drifts silently while the doc keeps reading as an
// inventory.
//
// ## WHAT CAN BE ASSERTED
//
// The public payload returns `url: null` for every monitor. The NAME is the
// only thing outside the account that identifies one, so a name is what the
// table records and a name is what this compares. Targets, intervals and
// keywords are read from the dashboard, not from here.
//
// ## THE DOC IS THE SOURCE
//
// The expected names are parsed out of the docs table rather than kept in a
// second list, so there is exactly one place to edit when a monitor changes.
// The parser is deliberately narrow: the first pipe table after one named
// heading, first column only. A doc that no longer fits that shape is a
// cannot-check, never a pass — `parseDocumentedMonitors` returns `ok: false`
// and the caller exits 2.

export const PASS = 'PASS'
export const FAIL = 'FAIL'

/** The status page whose monitor list is public. */
export const STATUS_PAGE_ID = '7NGEl81zvD'
export const MONITOR_LIST_URL = `https://stats.uptimerobot.com/api/getMonitorList/${STATUS_PAGE_ID}`

export const DOCS_PATH = 'docs/UPTIME_AND_SLA.md'
export const DOCS_HEADING = '### The external monitors (UptimeRobot, free tier)'

/** The `statusClass` the status page assigns to a monitor that is up. */
export const UP = 'success'

const HEADING_LINE = /^#{1,6}\s/
const TABLE_LINE = /^\|/
const SEPARATOR_LINE = /^\|\s*:?-{3,}/

/** Table cells, trimmed, with the surrounding pipes dropped. */
function cells(row) {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

/** A cell's text with inline emphasis and code wrappers removed. */
function plain(cell) {
  return cell.replace(/^[`*_]+|[`*_]+$/g, '').trim()
}

/**
 * The monitor names the docs table claims exist, in row order.
 *
 * Reads the first pipe table after `DOCS_HEADING`. Refuses — rather than
 * returning a shorter list — when the heading is gone, when a later heading
 * arrives before any table, when the table's first column is not `Monitor`,
 * when a row has an empty name, or when a name repeats. Every one of those is
 * a doc that cannot be compared, and a comparison against a partial list
 * would pass on a partial inventory.
 *
 * @param {string} markdown
 * @returns {{ok: true, names: string[]} | {ok: false, reason: string}}
 */
export function parseDocumentedMonitors(markdown) {
  const lines = String(markdown).split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === DOCS_HEADING)
  if (start === -1) return { ok: false, reason: `${DOCS_PATH} has no heading "${DOCS_HEADING}"` }

  let i = start + 1
  while (i < lines.length && !TABLE_LINE.test(lines[i])) {
    if (HEADING_LINE.test(lines[i])) {
      return { ok: false, reason: `no table between "${DOCS_HEADING}" and the next heading` }
    }
    i += 1
  }
  const rows = []
  while (i < lines.length && TABLE_LINE.test(lines[i])) {
    rows.push(lines[i])
    i += 1
  }
  if (rows.length === 0) return { ok: false, reason: `no table after "${DOCS_HEADING}"` }

  const header = cells(rows[0]).map(plain)
  if (header[0] !== 'Monitor') {
    return {
      ok: false,
      reason: `the first table after the heading is not the monitor table (header ${JSON.stringify(header)})`,
    }
  }
  if (!rows[1] || !SEPARATOR_LINE.test(rows[1])) {
    return { ok: false, reason: 'the monitor table has no header separator row' }
  }

  const names = []
  const seen = new Set()
  for (const row of rows.slice(2)) {
    const name = plain(cells(row)[0] ?? '')
    if (!name) return { ok: false, reason: `a monitor row has an empty name: ${row}` }
    if (seen.has(name)) return { ok: false, reason: `the monitor table lists "${name}" twice` }
    seen.add(name)
    names.push(name)
  }
  if (names.length === 0) return { ok: false, reason: 'the monitor table has no rows' }
  return { ok: true, names }
}

/**
 * @typedef {object} LiveMonitor
 * @property {string} name
 * @property {string} status   the payload's `statusClass`; `success` is up
 * @property {string|null} createdAt
 * @property {string|null} ratio30   the 30-day availability, as the API prints it
 * @property {{date: string, duration: number, reason: string}|null} lastDowntime
 */

/**
 * The monitors the status page reports, reduced to what this check reads.
 *
 * Refuses a payload it cannot vouch for: no `psp.monitors` array, an empty
 * one, a nameless monitor, or a `totalMonitors` that disagrees with the
 * number returned — that last one is the paged-response shape, and comparing
 * a first page against the full table would report every monitor on page
 * two as missing.
 *
 * @param {unknown} payload
 * @returns {{ok: true, monitors: LiveMonitor[]} | {ok: false, reason: string}}
 */
export function parseMonitorList(payload) {
  const psp = payload && typeof payload === 'object' ? payload.psp : undefined
  if (!psp || !Array.isArray(psp.monitors)) {
    return { ok: false, reason: 'the payload has no psp.monitors array' }
  }
  if (psp.monitors.length === 0) {
    return { ok: false, reason: 'the status page reports zero monitors' }
  }
  const total = Number(psp.totalMonitors)
  if (Number.isInteger(total) && total !== psp.monitors.length) {
    return {
      ok: false,
      reason: `psp.totalMonitors is ${total} but ${psp.monitors.length} were returned — the list is paged or truncated`,
    }
  }
  const monitors = []
  for (const raw of psp.monitors) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) return { ok: false, reason: `a monitor has no name: ${JSON.stringify(raw)}` }
    monitors.push({
      name,
      status: typeof raw.statusClass === 'string' ? raw.statusClass : 'unknown',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
      ratio30: typeof raw['30dRatio']?.ratio === 'string' ? raw['30dRatio'].ratio : null,
      lastDowntime: raw.lastDowntime && typeof raw.lastDowntime === 'object' ? raw.lastDowntime : null,
    })
  }
  return { ok: true, monitors }
}

/**
 * @typedef {object} Verdict
 * @property {'PASS'|'FAIL'} verdict
 * @property {string[]} missing        documented, not live
 * @property {string[]} undocumented   live, not documented
 * @property {string[]} duplicated     a live name that appears more than once
 * @property {Array<{name: string, status: string}>} down
 */

/**
 * Compare the documented names with the live monitors.
 *
 * FAIL on any of: a documented monitor the account no longer has, a live
 * monitor the table does not name, a live name that appears twice (the table
 * cannot tell two monitors apart by anything else), or a monitor whose
 * `statusClass` is not `success`. Everything else is PASS. There is no third
 * state here on purpose — an unreadable input never reaches this function.
 *
 * @param {string[]} documented
 * @param {LiveMonitor[]} live
 * @returns {Verdict}
 */
export function compareInventory(documented, live) {
  const documentedSet = new Set(documented)
  const counts = new Map()
  for (const monitor of live) counts.set(monitor.name, (counts.get(monitor.name) ?? 0) + 1)

  const missing = documented.filter((name) => !counts.has(name))
  const undocumented = [...counts.keys()].filter((name) => !documentedSet.has(name))
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name)
  const down = live
    .filter((monitor) => monitor.status !== UP)
    .map((monitor) => ({ name: monitor.name, status: monitor.status }))

  const clean = !missing.length && !undocumented.length && !duplicated.length && !down.length
  return { verdict: clean ? PASS : FAIL, missing, undocumented, duplicated, down }
}

/** `"93.072"` → `" 93.072%"`, right-aligned so the column lines up. */
function ratio(value) {
  return value === null ? '   n/a  ' : `${value.padStart(7)}%`
}

function downtime(entry) {
  if (!entry) return 'no downtime recorded'
  const reason = entry.reason ? ` (${entry.reason})` : ''
  return `last down ${entry.date} for ${entry.duration}s${reason}`
}

/**
 * One line per monitor plus the verdict, in a shape that reads on its own.
 *
 * The per-monitor lines carry the 30-day ratio and the last downtime because
 * a status-page monitor reports transitions, not history: "no alerts lately"
 * and "red for a week" look identical from the inbox. Printing the ratio on
 * every run makes the run log the answer to "has this ever been red".
 *
 * @param {string[]} documented
 * @param {LiveMonitor[]} live
 * @param {Verdict} result
 * @returns {string}
 */
export function formatReport(documented, live, result) {
  const documentedSet = new Set(documented)
  const width = Math.max(...live.map((m) => m.name.length), ...documented.map((n) => n.length))
  const lines = [`UptimeRobot monitors — documented ${documented.length} · live ${live.length}`, '']

  const sorted = [...live].sort((a, b) => a.name.localeCompare(b.name))
  for (const monitor of sorted) {
    const mark = monitor.status !== UP ? '✗' : documentedSet.has(monitor.name) ? '✓' : '?'
    const created = monitor.createdAt ? `  created ${monitor.createdAt}` : ''
    lines.push(
      `  ${mark} ${monitor.name.padEnd(width)}  30d ${ratio(monitor.ratio30)}  ${downtime(monitor.lastDowntime)}${created}`,
    )
  }
  for (const name of result.missing) {
    lines.push(`  ✗ ${name.padEnd(width)}  documented in ${DOCS_PATH}, not on the status page`)
  }

  lines.push('')
  if (result.verdict === PASS) {
    lines.push(`PASS — the table in ${DOCS_PATH} and the status page name the same ${live.length} monitors, all up`)
    return lines.join('\n')
  }
  lines.push('FAIL')
  if (result.missing.length) {
    lines.push(`  missing from the status page (documented, not live): ${result.missing.join(', ')}`)
  }
  if (result.undocumented.length) {
    lines.push(`  not in the docs table (live, undocumented): ${result.undocumented.join(', ')}`)
  }
  if (result.duplicated.length) {
    lines.push(`  more than one live monitor named: ${result.duplicated.join(', ')}`)
  }
  if (result.down.length) {
    lines.push(`  not up: ${result.down.map((d) => `${d.name} (${d.status})`).join(', ')}`)
  }
  lines.push('', `Fix the side that is wrong — the table in ${DOCS_PATH} or the account — never the check.`)
  return lines.join('\n')
}

/** 0 for PASS, 1 for FAIL. Cannot-check (2) is decided before a verdict exists. */
export function exitCodeFor(result) {
  return result.verdict === PASS ? 0 : 1
}
