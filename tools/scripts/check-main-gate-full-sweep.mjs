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
// Decides whether Main Gate's `full` sweep is due (AGL-2552, AGL-2836). The
// rule and its rationale live in `lib/main-gate-full-sweep.mjs`; this file
// reads the event and writes the answer.
//
//   node tools/scripts/check-main-gate-full-sweep.mjs
//   node tools/scripts/check-main-gate-full-sweep.mjs --explain   # no writes
//
// Writes `due=true|false` to $GITHUB_OUTPUT. ALWAYS exits 0: this decides
// whether to spend runner minutes, and a gate that went red because it could
// not decide would be a worse outcome than spending them.
import { appendFileSync } from 'node:fs'

import { decideFullSweep } from './lib/main-gate-full-sweep.mjs'

const args = process.argv.slice(2)
const EXPLAIN = args.includes('--explain')
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : ''
}

const eventName = flag('event') || process.env['GITHUB_EVENT_NAME'] || 'push'
const schedule = flag('schedule') || process.env['MAIN_GATE_SCHEDULE'] || ''
const inputsFull = (flag('inputs-full') || process.env['MAIN_GATE_INPUTS_FULL'] || '') === 'true'

const decision = decideFullSweep({ eventName, schedule, inputsFull })

process.stderr.write(`full-sweep: ${decision.due ? 'DUE' : 'not due'} — ${decision.reason}\n`)

if (!EXPLAIN) {
  const out = process.env['GITHUB_OUTPUT']
  if (out) appendFileSync(out, `due=${decision.due}\nreason=${decision.reason}\n`)
  const summary = process.env['GITHUB_STEP_SUMMARY']
  if (summary) {
    appendFileSync(
      summary,
      `### full sweep\n\n${decision.due ? '**running**' : '**skipped**'} — ${decision.reason}\n\n`,
    )
  }
}

process.exit(0)
