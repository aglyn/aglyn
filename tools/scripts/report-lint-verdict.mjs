#!/usr/bin/env node
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
// Grades a CI lint step from its log and its commands' exit codes (AGL-2829).
// The grading lives in `lib/lint-verdict.mjs`, where it is unit-tested.
//
//   node tools/scripts/report-lint-verdict.mjs <log> <exit> [<exit>...]
//
// Prints one workflow annotation, appends it to the job summary, and exits 0
// only when every lint command exited 0.

import { appendFileSync, readFileSync } from 'node:fs'

import { VERDICTS, describeLintVerdict, lintVerdict } from './lib/lint-verdict.mjs'

const [logPath, ...exits] = process.argv.slice(2)
if (!logPath || !exits.length) {
  console.error('usage: node tools/scripts/report-lint-verdict.mjs <log> <exit> [<exit>...]')
  process.exit(64)
}

let log
try {
  log = readFileSync(logPath, 'utf8')
} catch (error) {
  console.log(`::error::lint: cannot read ${logPath} (${error.message}), so this step has no verdict.`)
  process.exit(1)
}

const result = lintVerdict({ log, exits })
const { level, text } = describeLintVerdict(result)
console.log(`::${level}::${text}`)

const summary = process.env['GITHUB_STEP_SUMMARY']
if (summary) appendFileSync(summary, `### lint\n\n**${result.verdict}**: ${text}\n\n`)

process.exit(result.verdict === VERDICTS.CLEAN ? 0 : 1)
