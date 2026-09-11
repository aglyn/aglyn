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
// What a CI lint step's log says about its own red (AGL-2829).
//
// ## Why a lint red has to be read, not just counted
//
// `nx run-many -t lint` ends a red run with `Failed tasks: - console:lint` and
// nothing else it can promise. The ESLint report above that line is written by
// the `@nx/eslint:lint` executor in a single `console.info` call, and the task
// process exits before a large write to its pipe drains. Main Gate runs
// 34540545704 and 34553636957 printed ~66 KB of warnings cut off mid-file, no
// `✖ N problems` summary and no error row, while the one real error (an
// `@nx/enforce-module-boundaries` violation) sat in the lost tail. The red read
// as "0 errors" and sent its readers looking for a flake.
//
// The CI steps lint with `--quiet`, so the report is the errors alone and small
// enough to arrive whole. This module grades what arrived, so the cases that
// are NOT a finding say what they are:
//
//   errors        an error row, or a summary counting at least one error
//   killed        an exit code >= 128, or a line a dying process prints
//   inconclusive  a command failed and the log holds no error at all
//   clean         every exit code is 0
//
// `inconclusive` is never folded into `errors`. A red that printed no error is
// a report that did not arrive, and the remedy is different: rerun the named
// task with `--quiet` and read it.

import { toLines } from './ci-test-digest.mjs'

export const VERDICTS = Object.freeze({
  CLEAN: 'clean',
  ERRORS: 'errors',
  KILLED: 'killed',
  INCONCLUSIVE: 'inconclusive',
})

/** A stylish-formatter error row: `  39:1  error  message  rule`. */
const ERROR_ROW = /^\s+\d+:\d+\s+error\s+/

/** A stylish-formatter row of either severity. Its message is free text. */
const REPORT_ROW = /^\s+\d+:\d+\s+(?:error|warning)\s+/

/** ESLint's summary line, which the executor prints after the report. */
const SUMMARY = /✖ \d+ problems? \((\d+) errors?, \d+ warnings?\)/

/** One entry of nx's `Failed tasks:` list. */
const FAILED_TASK = /^\s*-\s+(\S+:lint)\s*$/

/**
 * Lines a dying process prints. Matched only outside report rows, because a
 * lint message is free text and can name a signal without being one.
 */
export const DEATH_MARKERS = Object.freeze([
  /JavaScript heap out of memory/i,
  /\bKilled\b/,
  /\bSIG(?:KILL|TERM|ABRT|SEGV)\b/,
  /Oops! Something went wrong!/,
  /runner has received a shutdown signal/i,
])

/**
 * Grade one lint step.
 *
 * @param {{ log: string, exits: Array<number|string> }} input
 *   `exits` are the bare exit codes of the lint commands the step ran, in the
 *   order it ran them.
 */
export function lintVerdict({ log, exits }) {
  const codes = (exits ?? []).map((code) => Number(code))
  if (!codes.length || codes.some((code) => !Number.isInteger(code) || code < 0)) {
    throw new Error(`lintVerdict needs one non-negative integer exit code per command, got ${JSON.stringify(exits)}`)
  }

  const lines = toLines(log ?? '')
  const errorRows = lines.filter((line) => ERROR_ROW.test(line)).length
  const summarizedErrors = lines.reduce((most, line) => {
    const match = SUMMARY.exec(line)
    return match ? Math.max(most, Number(match[1])) : most
  }, 0)
  const failedTasks = [
    ...new Set(lines.map((line) => FAILED_TASK.exec(line)?.[1]).filter(Boolean)),
  ]
  const deaths = lines
    .filter((line) => !REPORT_ROW.test(line) && DEATH_MARKERS.some((re) => re.test(line)))
    .map((line) => line.trim())
  const signals = codes.filter((code) => code >= 128).map((code) => code - 128)

  const facts = { exits: codes, failedTasks, errorRows, summarizedErrors, deaths: deaths.slice(0, 3), signals }
  if (codes.every((code) => code === 0)) return { verdict: VERDICTS.CLEAN, ...facts }
  if (signals.length || deaths.length) return { verdict: VERDICTS.KILLED, ...facts }
  if (errorRows > 0 || summarizedErrors > 0) return { verdict: VERDICTS.ERRORS, ...facts }
  return { verdict: VERDICTS.INCONCLUSIVE, ...facts }
}

/**
 * The one-line annotation for a verdict. `level` is the GitHub workflow command
 * it should be printed as.
 */
export function describeLintVerdict(result) {
  const tasks = result.failedTasks.length ? result.failedTasks.join(', ') : 'a lint command'
  switch (result.verdict) {
    case VERDICTS.CLEAN:
      return { level: 'notice', text: 'lint: every lint command exited 0.' }
    case VERDICTS.ERRORS: {
      const count = Math.max(result.errorRows, result.summarizedErrors)
      return { level: 'error', text: `lint: ${tasks} reported ${count} error(s), printed in the log above.` }
    }
    case VERDICTS.KILLED: {
      const how = result.signals.length
        ? `was killed by signal ${result.signals.join(', ')}`
        : `died mid-run (${result.deaths[0].slice(0, 120)})`
      const alsoErrors = result.errorRows ? ` It also printed ${result.errorRows} error row(s) before that.` : ''
      return {
        level: 'error',
        text: `lint: ${tasks} ${how}. That is not a lint finding; rerun the job.${alsoErrors}`,
      }
    }
    default:
      return {
        level: 'error',
        text:
          `lint: ${tasks} failed and the log holds no error, so its report did not arrive. ` +
          'Rerun the task with --quiet to read it: npx nx run <project>:lint --quiet',
      }
  }
}
