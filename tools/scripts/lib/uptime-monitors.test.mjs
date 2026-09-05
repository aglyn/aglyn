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
// The monitor-inventory comparator's own tests (AGL-2593). Fixture JSON in,
// verdict out — nothing here touches the network.
//
// Two of these are the load-bearing ones. `the fixture and the docs table
// name the same monitors` is what turns a hand edit to the table into a red
// BEFORE the morning run fetches anything; and the paged-payload refusal is
// what stops a truncated first page from reporting every monitor on page two
// as missing.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DOCS_HEADING,
  DOCS_PATH,
  FAIL,
  PASS,
  UP,
  compareInventory,
  exitCodeFor,
  formatReport,
  parseDocumentedMonitors,
  parseMonitorList,
} from './uptime-monitors.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const fixture = JSON.parse(readFileSync(resolve(here, '..', 'fixtures', 'uptime-monitor-list.json'), 'utf8'))
const docs = readFileSync(resolve(repoRoot, DOCS_PATH), 'utf8')

const table = (rows, header = '| Monitor | Created (UTC) |') =>
  ['# Doc', '', DOCS_HEADING, '', 'Prose before the table.', '', header, '| --- | --- |', ...rows, '', 'After.'].join(
    '\n',
  )

// ── the docs table ─────────────────────────────────────────────────────────

test('the real docs table parses to a non-empty, duplicate-free list of names', () => {
  const parsed = parseDocumentedMonitors(docs)
  assert.equal(parsed.ok, true, parsed.reason)
  assert.ok(parsed.names.length >= 14)
  assert.equal(new Set(parsed.names).size, parsed.names.length)
  for (const added of ['Sign-in doors', 'First-run journeys', 'Lead forms']) {
    assert.ok(parsed.names.includes(added), `${added} should be in the table`)
  }
})

test('the fixture and the docs table name the same monitors', () => {
  const documented = parseDocumentedMonitors(docs)
  const live = parseMonitorList(fixture)
  assert.equal(documented.ok, true)
  assert.equal(live.ok, true)
  assert.deepEqual(
    [...documented.names].sort(),
    live.monitors.map((m) => m.name).sort(),
    'edit the table and tools/scripts/fixtures/uptime-monitor-list.json together',
  )
})

test('names are read from the first column, in row order, with wrappers stripped', () => {
  const parsed = parseDocumentedMonitors(table(['| Console | 08:10 |', '| `Backups` | 09:12 |', '| **Lead forms** | 23:09 |']))
  assert.deepEqual(parsed, { ok: true, names: ['Console', 'Backups', 'Lead forms'] })
})

test('a missing heading is a refusal, not an empty list', () => {
  const parsed = parseDocumentedMonitors('# Nothing here\n\n| Monitor |\n| --- |\n| Console |\n')
  assert.equal(parsed.ok, false)
  assert.match(parsed.reason, /no heading/)
})

test('a heading with no table before the next heading is a refusal', () => {
  const parsed = parseDocumentedMonitors([DOCS_HEADING, '', 'Prose.', '', '### Next', '', '| Monitor |', '| --- |', '| X |'].join('\n'))
  assert.equal(parsed.ok, false)
  assert.match(parsed.reason, /no table between/)
})

test('a first table that is not the monitor table is a refusal', () => {
  const parsed = parseDocumentedMonitors(table(['| 429 | 429 |'], '| request | `aglyn.com/` |'))
  assert.equal(parsed.ok, false)
  assert.match(parsed.reason, /not the monitor table/)
})

test('an empty name or a repeated name is a refusal', () => {
  assert.equal(parseDocumentedMonitors(table(['| Console | 08:10 |', '|  | 08:11 |'])).ok, false)
  const repeated = parseDocumentedMonitors(table(['| Console | 08:10 |', '| Console | 08:11 |']))
  assert.equal(repeated.ok, false)
  assert.match(repeated.reason, /twice/)
})

// ── the live payload ───────────────────────────────────────────────────────

test('the fixture parses to fourteen named monitors with ratios and downtime', () => {
  const live = parseMonitorList(fixture)
  assert.equal(live.ok, true)
  assert.equal(live.monitors.length, 14)
  const jobs = live.monitors.find((m) => m.name === 'Scheduled jobs')
  assert.equal(jobs.status, UP)
  assert.equal(jobs.ratio30, '93.072')
  assert.equal(jobs.lastDowntime.duration, 611)
  assert.equal(live.monitors.find((m) => m.name === 'Backups').lastDowntime, null)
})

test('a paged or truncated list is a refusal', () => {
  const paged = { psp: { ...fixture.psp, totalMonitors: fixture.psp.monitors.length + 1 } }
  const parsed = parseMonitorList(paged)
  assert.equal(parsed.ok, false)
  assert.match(parsed.reason, /paged or truncated/)
})

test('no monitors, no psp, and a nameless monitor are refusals', () => {
  assert.equal(parseMonitorList({ psp: { monitors: [], totalMonitors: 0 } }).ok, false)
  assert.equal(parseMonitorList({ status: 'ok' }).ok, false)
  assert.equal(parseMonitorList(null).ok, false)
  assert.equal(parseMonitorList({ psp: { monitors: [{ statusClass: UP }] } }).ok, false)
})

// ── the comparison ─────────────────────────────────────────────────────────

const documented = parseDocumentedMonitors(docs).names
const live = parseMonitorList(fixture).monitors

test('the fixture against the docs table is PASS with nothing to report', () => {
  const result = compareInventory(documented, live)
  assert.deepEqual(result, { verdict: PASS, missing: [], undocumented: [], duplicated: [], down: [] })
  assert.equal(exitCodeFor(result), 0)
})

test('a documented monitor the account no longer has is FAIL', () => {
  const result = compareInventory(documented, live.filter((m) => m.name !== 'Lead forms'))
  assert.equal(result.verdict, FAIL)
  assert.deepEqual(result.missing, ['Lead forms'])
  assert.equal(exitCodeFor(result), 1)
})

test('a renamed monitor is both missing and undocumented', () => {
  const renamed = live.map((m) => (m.name === 'Signups' ? { ...m, name: 'Sign ups' } : m))
  const result = compareInventory(documented, renamed)
  assert.deepEqual(result.missing, ['Signups'])
  assert.deepEqual(result.undocumented, ['Sign ups'])
})

test('a live monitor the table does not name is FAIL', () => {
  const extra = [...live, { ...live[0], name: 'Something new' }]
  const result = compareInventory(documented, extra)
  assert.equal(result.verdict, FAIL)
  assert.deepEqual(result.undocumented, ['Something new'])
})

test('two live monitors with one name is FAIL', () => {
  const result = compareInventory(documented, [...live, { ...live[0] }])
  assert.deepEqual(result.duplicated, [live[0].name])
  assert.equal(result.verdict, FAIL)
})

test('a monitor that is not up is FAIL even when the names agree', () => {
  const down = live.map((m) => (m.name === 'Billing' ? { ...m, status: 'danger' } : m))
  const result = compareInventory(documented, down)
  assert.equal(result.verdict, FAIL)
  assert.deepEqual(result.down, [{ name: 'Billing', status: 'danger' }])
})

// ── the report ─────────────────────────────────────────────────────────────

test('the report prints every monitor with its ratio and last downtime', () => {
  const report = formatReport(documented, live, compareInventory(documented, live))
  for (const monitor of live) assert.ok(report.includes(monitor.name), monitor.name)
  assert.match(report, /Scheduled jobs.*30d\s+93\.072%.*last down 2026-09-04 22:16:33 for 611s/)
  assert.match(report, /Backups.*100\.000%.*no downtime recorded/)
  assert.match(report, /^PASS/m)
})

test('the report names each defect on a FAIL', () => {
  const broken = live.filter((m) => m.name !== 'Console').map((m) => (m.name === 'Billing' ? { ...m, status: 'danger' } : m))
  broken.push({ ...live[0], name: 'Mystery' })
  const report = formatReport(documented, broken, compareInventory(documented, broken))
  assert.match(report, /^FAIL/m)
  assert.match(report, /missing from the status page.*Console/)
  assert.match(report, /undocumented.*Mystery/)
  assert.match(report, /not up: Billing \(danger\)/)
  assert.match(report, /\? Mystery/)
})
