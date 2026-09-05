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

// Compares the UptimeRobot monitor inventory `docs/UPTIME_AND_SLA.md`
// documents with the one the status page reports (AGL-2593).
//
//   npm run check:uptime-monitors
//   npm run check:uptime-monitors -- --file tools/scripts/fixtures/uptime-monitor-list.json
//
// ## WHAT IT ASSERTS
//
// The table under "The external monitors (UptimeRobot, free tier)" names the
// monitors. The status page's monitor list is public and unauthenticated —
// no key, no env var, nothing this script could leak — and it names them
// too. The check is red when a documented monitor is absent from the account,
// when the account holds a monitor the table does not name, or when any
// monitor's `statusClass` is not `success`. Every monitor is printed with its
// 30-day ratio and last downtime, so the run log is also the record of
// whether one of them has been red.
//
// ## EXIT CODES
//
//   0  the table and the account agree, and every monitor is up
//   1  they disagree, or a monitor is down — read the report
//   2  could not check: the list was unreachable, not JSON, paged, or the
//      docs table could not be parsed
//
// 2 is never 0. An unreadable status page is not a healthy one, and a table
// the parser cannot read is not an inventory anything was compared against.

import { appendFileSync, readFileSync } from 'node:fs'

import {
  DOCS_PATH,
  MONITOR_LIST_URL,
  PASS,
  compareInventory,
  exitCodeFor,
  formatReport,
  parseDocumentedMonitors,
  parseMonitorList,
} from './lib/uptime-monitors.mjs'

const TIMEOUT_MS = 20_000

class CannotCheck extends Error {}

function parseArgs(argv) {
  const options = { file: null, docs: DOCS_PATH }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new CannotCheck(`${arg} needs a path`)
      i += 1
      return value
    }
    if (arg === '--file') options.file = next()
    else if (arg.startsWith('--file=')) options.file = arg.slice(7)
    else if (arg === '--docs') options.docs = next()
    else if (arg.startsWith('--docs=')) options.docs = arg.slice(7)
    else throw new CannotCheck(`unknown argument: ${arg}`)
  }
  return options
}

/**
 * The live list, or a CannotCheck naming what went wrong.
 *
 * Plain fetch, no bypass header: this is UptimeRobot's host, not ours, and
 * `withProbeHeaders` exists precisely so the firewall token never reaches a
 * third party.
 */
async function fetchMonitorList() {
  let response
  try {
    response = await fetch(MONITOR_LIST_URL, {
      headers: { accept: 'application/json', 'user-agent': 'aglyn-uptime-monitors' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new CannotCheck(`could not reach ${MONITOR_LIST_URL}: ${error.message}`)
  }
  if (!response.ok) throw new CannotCheck(`${MONITOR_LIST_URL} answered ${response.status}`)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new CannotCheck(`${MONITOR_LIST_URL} did not answer JSON (${text.slice(0, 80)}…)`)
  }
}

function readPayload(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new CannotCheck(`could not read ${file}: ${error.message}`)
  }
}

function readDocs(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new CannotCheck(`could not read ${path}: ${error.message}`)
  }
}

/**
 * The run page, not just its log — the external-facts precedent. A daily
 * verdict that lives only inside a collapsed log group is written and never
 * read.
 */
function writeStepSummary(result, report) {
  const path = process.env['GITHUB_STEP_SUMMARY']
  if (!path) return
  const headline =
    result.verdict === PASS
      ? '## UptimeRobot monitors — the docs table and the account agree'
      : '## ⚠ UptimeRobot monitors — the docs table and the account disagree, or a monitor is down'
  try {
    appendFileSync(path, `${headline}\n\n\`\`\`\n${report}\n\`\`\`\n`)
  } catch {
    /* Best effort; the log carries the report. */
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const documented = parseDocumentedMonitors(readDocs(options.docs))
  if (!documented.ok) throw new CannotCheck(documented.reason)

  const payload = options.file ? readPayload(options.file) : await fetchMonitorList()
  const live = parseMonitorList(payload)
  if (!live.ok) throw new CannotCheck(live.reason)

  const result = compareInventory(documented.names, live.monitors)
  const report = formatReport(documented.names, live.monitors, result)
  process.stdout.write(`${report}\n`)
  if (options.file) process.stdout.write(`\n(read from ${options.file}, not from the status page)\n`)
  writeStepSummary(result, report)
  process.exit(exitCodeFor(result))
}

main().catch((error) => {
  const prefix = error instanceof CannotCheck ? 'CANNOT CHECK' : 'ERROR'
  process.stderr.write(`${prefix}: ${error.message}\n`)
  process.exit(2)
})
