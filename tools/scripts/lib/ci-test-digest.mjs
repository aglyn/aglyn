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

/**
 * Make a failed CI test run diagnosable (AGL-1617).
 *
 * ```
 * node tools/scripts/lib/ci-test-digest.mjs "$RUNNER_TEMP/nx-test.log"
 * ```
 *
 * ## The failure this exists for
 *
 * Main Gate run 32685698590 and NX CI run 32687205268 both went red with the
 * whole of their diagnosis being:
 *
 * ```
 * NX  Running target test for 38 projects failed
 * Failed tasks:
 * - console:test
 * ```
 *
 * The full job log is 244,397 lines and contains ZERO ` FAIL ` markers, zero
 * `Tests: … failed` summaries, and zero SIGSEGV / SIGTERM / heap-limit lines.
 * GitHub truncates the MIDDLE of a long `##[group]`, keeping the head and the
 * tail, and jest prints its failure block in the middle. So the one fact
 * worth having — which test failed — is the one fact the log cannot carry.
 * The same commit passes `nx run console:test` locally (586 suites, 6821
 * tests), which is exactly why legibility is the whole job here: a failure
 * this rare will only ever be seen through the log.
 *
 * The fix is two-sided and both sides live in the workflows: `tee` the run to
 * a file so the raw bytes survive as an uploadable artifact, and on failure
 * print THIS — a digest small enough that it can never itself be truncated.
 *
 * ## Why `inconclusive` is a verdict and not a green
 *
 * A digest that read the log above and printed "0 test failures" would be
 * worse than no digest at all: it would answer a question it never actually
 * looked at, and it would answer it wrong. A crashed worker, an OOM kill and
 * a truncated log all produce a log with a failed task and no failed test,
 * and none of them is a clean run. So there are THREE states, never two:
 *
 * - `failures-found`      — a suite, a test, or a jest summary named a failure
 * - `no-failures-in-log`  — INCONCLUSIVE: something failed and the log does
 *                           not say what. Suspect a crash, an OOM, or a
 *                           truncated log; the uploaded artifact is the next
 *                           place to look.
 * - `clean`               — nothing failed and nothing claims anything failed
 *
 * (See feedback: "confirm the sink exists before designing the report" — a
 * skipped Actions job reports `success`, and a verdict without a third
 * inconclusive state launders that into a pass.)
 *
 * ## Why the ANSI stripping is done HERE and not in the shell
 *
 * On macOS BSD `sed`, `\x1b` in a pattern is the literal characters `x1b`,
 * not an escape byte — a `sed $'s/\x1b\\[[0-9;]*m//g'` pipeline silently
 * strips nothing and every grep for ` FAIL ` afterwards comes back empty,
 * which reads identically to "there were no failures". That near-miss is the
 * reason this depends on no shell at all. It also handles the CARET-ESCAPED
 * form (`^[[31m`, two literal characters) that some log downloads produce,
 * and the GitHub log-line prefix (`job\tstep\t2026-08-24T…Z `) that a
 * downloaded job log carries but a `tee`'d one does not.
 *
 * Exit codes: 0 a digest was printed · 2 the log could not be read.
 */

import { readFileSync } from 'node:fs'

/** The three verdicts. Two would be a bug — see the header. */
export const VERDICTS = Object.freeze({
  FAILURES: 'failures-found',
  INCONCLUSIVE: 'no-failures-in-log',
  CLEAN: 'clean',
})

/** Caps. The digest's entire value is that it is too small to be truncated. */
export const CAPS = Object.freeze({
  suites: 40,
  tests: 80,
  summaries: 40,
  tasks: 40,
  crashes: 20,
  totalLines: 300,
})

/**
 * jest prints `●` for things that are not failures too. `● Console` is the
 * grouped console output of a PASSING suite and there are 362 of them in the
 * log this was written for — counting those as failures would have turned an
 * inconclusive run into a confident, wrong answer.
 */
const NON_FAILURE_BULLETS = Object.freeze([
  'Console',
  'Deprecation Warning',
  'Validation Warning',
])

/**
 * The signals that would separate a CRASH from a TRUNCATION (AGL-1617).
 *
 * Every one of these is reported as found-or-absent, never silently omitted.
 * That matters more here than anywhere else in this file: on the log this
 * tool was written for, ALL of them are absent, and the honest reading of
 * that is "the log is too short to say", not "nothing crashed". A digest
 * that printed only what it found would let an empty section be misread as a
 * clean bill of health.
 */
export const CRASH_PROBES = Object.freeze([
  { label: 'SIGKILL', test: (l) => /SIGKILL|\bkilled\b/i.test(l) },
  { label: 'SIGSEGV', test: (l) => /SIGSEGV|segmentation fault/i.test(l) },
  { label: 'SIGTERM/SIGABRT', test: (l) => /SIGTERM|SIGABRT/.test(l) },
  {
    label: 'heap out of memory',
    test: (l) =>
      /JavaScript heap out of memory|Allocation failed - JavaScript heap|Reached heap limit/.test(
        l,
      ),
  },
  { label: 'V8 fatal error', test: (l) => /FATAL ERROR:/.test(l) },
  {
    label: 'jest worker died',
    test: (l) =>
      /A jest worker process .* failed|Jest worker encountered \d+ child process exception|Call retries were exceeded/.test(
        l,
      ),
  },
  {
    label: 'worker force-exited',
    test: (l) =>
      /worker process has failed to exit gracefully and has been force exited/i.test(
        l,
      ),
  },
  {
    label: 'resource exhaustion',
    test: (l) => /\bENOSPC\b|\bENOMEM\b|out of memory|no space left/i.test(l),
  },
])

/**
 * Strip ANSI colour, both as real escape bytes and in the caret-escaped form.
 *
 * The real-escape branch takes the full CSI grammar plus OSC, so a cursor
 * move or a hyperlink cannot leave a fragment glued to the text a matcher is
 * about to read. The caret branch is deliberately narrower — `^[` is two
 * printable characters that can legitimately occur in program output — so it
 * only removes an SGR sequence (`^[[…m`), which is what a colourised log
 * actually contains.
 */
export function stripAnsi(text) {
  return (
    String(text)
      // no-control-regex is disabled deliberately and only here: ESC (0x1b)
      // and BEL (0x07) ARE the subject. A rule that forbids naming them turns
      // a stripper into one that cannot match what it is stripping.
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\^\[\[[0-9;]*m/g, '')
  )
}

/**
 * Remove the per-line noise a job log carries and a `tee`'d one does not: a
 * UTF-8 BOM, the `job\tstep\t` columns of a downloaded log, the ISO timestamp
 * GitHub stamps on every line, and the `##[group]` / `##[endgroup]` markers.
 *
 * `##[error]` is NOT removed — it is one of the signals that a task failed.
 */
export function stripLogPrefix(line) {
  return line
    .replace(/^\uFEFF/, '')
    .replace(
      /^(?:[^\t]*\t)*\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z ?/,
      '',
    )
    .replace(/^##\[(?:group|endgroup)\]/, '')
}

/** Split on any line ending, including a lone `\r` from progress output. */
export function toLines(text) {
  return stripAnsi(text)
    .split(/\r\n|\n|\r/)
    .map(stripLogPrefix)
}

/**
 * Read a log and decide what it says.
 *
 * @param {string} text raw log bytes as a string
 * @param {{taskFailed?: boolean}} [opts] `taskFailed` forces the "something
 *   failed" premise on — the CI step runs under `if: failure()`, so the job
 *   already knows a fact the log may not contain. Without it the premise is
 *   inferred from the log's own failure markers.
 */
export function digestLog(text, opts = {}) {
  const lines = toLines(text)

  const failedSuites = []
  const failedTests = []
  const summaries = []
  const failedTasks = []
  const crashes = []
  const exitCodes = []
  const taskFailureSignals = []
  const found = new Set()

  let inFailedTasks = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    // --- the nx `Failed tasks:` list -------------------------------------
    // Blank lines are tolerated INSIDE the list (nx prints one between the
    // header and the entries) but the first non-blank, non-entry line ends
    // it, so an unrelated `- something` further down the log cannot be
    // vacuumed in.
    if (inFailedTasks) {
      const entry = /^-\s+(\S+)$/.exec(trimmed)
      if (entry) {
        pushUnique(failedTasks, entry[1])
        continue
      }
      if (trimmed !== '') inFailedTasks = false
    }
    if (/^Failed tasks:$/.test(trimmed)) {
      inFailedTasks = true
      taskFailureSignals.push(trimmed)
      continue
    }

    // --- the premise: does anything claim a failure happened? ------------
    if (
      /^NX\s+Running target \S+ for \d+ projects? failed/.test(trimmed) ||
      /^NX\s+Ran target \S+ for .* \(\d+ failed\)/.test(trimmed) ||
      /^##\[error\]/.test(trimmed) ||
      /Process completed with exit code [1-9]/.test(trimmed)
    ) {
      pushUnique(taskFailureSignals, trimmed)
    }

    // --- crash shapes, which are the likeliest cause of an INCONCLUSIVE --
    for (const probe of CRASH_PROBES) {
      if (probe.test(line)) {
        pushUnique(crashes, `${probe.label}: ${trimmed.slice(0, 160)}`)
        found.add(probe.label)
      }
    }

    // --- exit codes -------------------------------------------------------
    // 137 is the one worth staring at: 128 + 9 = SIGKILL, which on a CI
    // runner is nearly always the kernel OOM killer taking a jest worker.
    // Anchored to a REPORTED exit, not the word "exit". The real log
    // contains the shell fragment `exit 1; }` inside an echoed guard
    // script, and counting that as a task exit code is a fact invented out
    // of someone else quoting a shell.
    const exit =
      /(?:exited with (?:code|status)|with exit (?:code|status)|exit code)\s+(\d{1,3})\b/i.exec(
        trimmed,
      )
    if (exit && exit[1] !== '0') {
      pushUnique(exitCodes, `${exit[1]}  ${trimmed.slice(0, 140)}`)
    }

    // --- failed suites ---------------------------------------------------
    // Anchored to a FAIL token at a word boundary followed by a path, so
    // prose that merely contains the word (`FAILURES`, `should FAIL when …`)
    // does not qualify.
    const fail = /(?:^|\s)FAIL(?:\s+\[[^\]]*\])?\s+(\S+)/.exec(line)
    if (fail && /[/\\]|\.[cm]?[jt]sx?$/.test(fail[1])) {
      pushUnique(failedSuites, fail[1])
    }

    // --- failed test names ------------------------------------------------
    const bullet = /^●\s*(.+)$/.exec(trimmed)
    if (bullet) {
      const name = bullet[1].trim()
      if (name && !NON_FAILURE_BULLETS.includes(name)) {
        pushUnique(failedTests, name)
      }
    }
    const cross = /^✕\s*(.+)$/.exec(trimmed)
    if (cross) pushUnique(failedTests, cross[1].trim())

    // --- per-project jest summaries that mention a failure ----------------
    if (
      /^(Tests|Test Suites|Snapshots):\s/.test(trimmed) &&
      /failed/.test(trimmed)
    ) {
      pushUnique(summaries, trimmed)
    }
  }

  const foundFailures =
    failedSuites.length > 0 || failedTests.length > 0 || summaries.length > 0

  const taskFailed = Boolean(opts.taskFailed) || taskFailureSignals.length > 0

  const verdict = foundFailures
    ? VERDICTS.FAILURES
    : taskFailed
      ? VERDICTS.INCONCLUSIVE
      : VERDICTS.CLEAN

  return {
    verdict,
    inconclusive: verdict === VERDICTS.INCONCLUSIVE,
    taskFailed,
    failedSuites,
    failedTests,
    summaries,
    failedTasks,
    crashes,
    taskFailureSignals,
    exitCodes,
    crashProbes: CRASH_PROBES.map((probe) => ({
      label: probe.label,
      found: found.has(probe.label),
    })),
    lineCount: lines.length,
    truncated: looksTruncated(text),
    endsMidToken: endsMidToken(text),
    lastLine: lastLineOf(text),
  }
}

/**
 * A log that ends without a newline was cut mid-line — the shape GitHub's
 * group truncation and a killed `tee` both leave. It is a HINT printed
 * alongside the verdict, never a verdict of its own: a perfectly healthy log
 * can also end without a trailing newline.
 */
export function looksTruncated(text) {
  const s = String(text)
  if (s === '') return false
  return !/\n$/.test(s)
}

/**
 * Append if new. The membership test is a Set and not `Array#includes`
 * because the input is a quarter of a million lines: a linear scan per line
 * is quadratic, and a digest that takes minutes on the log it was written for
 * is a digest nobody waits for.
 */
const seen = new WeakMap()
function pushUnique(list, value) {
  if (value === '') return
  let set = seen.get(list)
  if (!set) {
    set = new Set()
    seen.set(list, set)
  }
  if (set.has(value)) return
  set.add(value)
  list.push(value)
}

/**
 * Did the log stop in the middle of a WORD, rather than merely between two
 * lines? A process that exits normally almost always ends its output on a
 * line boundary; a truncated stream stops wherever the byte budget ran out.
 * Reported alongside `truncated`, never instead of it — a healthy log can
 * also lack a trailing newline, so neither flag is a verdict on its own.
 */
export function endsMidToken(text) {
  const s = String(text)
  if (s === '' || /\n$/.test(s)) return false
  const tail = lastLineOf(s)
  // Ends on a word/path character with no closing punctuation or whitespace,
  // or on a dangling escape sequence that never reached its final byte.
  // NOT `.` or `-`: a line ending in a full stop ("Ran all test suites.")
  // is a COMPLETE line that merely lacks its newline, and calling that a
  // mid-token cut would make the flag fire on healthy logs.
  // eslint-disable-next-line no-control-regex
  return /[\w/\\]$/.test(tail) || /\x1b\[?[0-9;]*$/.test(tail)
}

/** The last line, for printing verbatim so a human can see where it stopped. */
export function lastLineOf(text) {
  const s = String(text)
  if (s === '') return ''
  const lines = s.split(/\r\n|\n|\r/)
  if (lines.at(-1) === '') lines.pop()
  return stripLogPrefix(stripAnsi(lines.at(-1) ?? '')).trimEnd()
}

function section(out, title, items, cap) {
  if (items.length === 0) return
  out.push(`${title} (${items.length})`)
  for (const item of items.slice(0, cap)) out.push(`  ${item}`)
  if (items.length > cap) {
    out.push(`  … ${items.length - cap} more — see the uploaded log artifact`)
  }
  out.push('')
}

/** Render the digest. Capped in every direction; see CAPS. */
export function formatDigest(result, source = '') {
  const out = []
  out.push('─'.repeat(72))
  out.push(`CI TEST DIGEST · ${result.verdict}`)
  if (source) out.push(`log: ${source} (${result.lineCount} lines)`)
  out.push('─'.repeat(72))
  out.push('')

  section(out, 'Failed suites:', result.failedSuites, CAPS.suites)
  section(out, 'Failed tests:', result.failedTests, CAPS.tests)
  section(
    out,
    'Jest summaries naming a failure:',
    result.summaries,
    CAPS.summaries,
  )
  section(out, 'nx failed tasks:', result.failedTasks, CAPS.tasks)
  section(out, 'Crash / resource signals:', result.crashes, CAPS.crashes)
  section(out, 'Non-zero exit codes:', result.exitCodes, CAPS.crashes)

  if (result.verdict === VERDICTS.INCONCLUSIVE) {
    out.push(
      'INCONCLUSIVE — a task failed but the log shows NO failed suite and NO',
      'failed test. This is NOT a clean run. Suspect a crash, an OOM kill, or',
      'a truncated log (GitHub drops the MIDDLE of a long ##[group], which is',
      'exactly where jest prints its failure block). Download the nx-test.log',
      'artifact attached to this run — it is the untruncated bytes.',
      '',
      'Crash vs truncation — every signal, found OR absent:',
    )
    for (const probe of result.crashProbes ?? []) {
      const dots = '.'.repeat(Math.max(2, 32 - probe.label.length))
      out.push(`  ${probe.label} ${dots} ${probe.found ? 'FOUND' : 'absent'}`)
    }
    const codes = (result.exitCodes ?? []).map((e) => e.split(/\s+/)[0])
    out.push(
      `  non-zero exit code ............... ${codes.length ? codes.join(', ') : 'absent'}`,
      `  log ends mid-line ................ ${result.truncated ? 'YES' : 'no'}`,
      `  log ends mid-token ............... ${result.endsMidToken ? 'YES' : 'no'}`,
    )
    if (result.lastLine) {
      out.push(`  last line: ${JSON.stringify(result.lastLine.slice(0, 90))}`)
    }
    if (codes.includes('137')) {
      out.push(
        '',
        'Exit code 137 is 128 + 9 = SIGKILL. On a CI runner that is almost',
        'always the kernel OOM killer taking a jest worker.',
      )
    }
    out.push(
      '',
      'An `absent` above is NOT evidence against a crash. GitHub drops the',
      'middle of the group, and a SIGKILL or heap-limit line printed there',
      'would not have survived either — which is exactly why the raw log is',
      'uploaded as an artifact.',
    )
    out.push('')
  } else if (result.verdict === VERDICTS.CLEAN) {
    out.push(
      'clean — no failed suite, no failed test, and nothing in the log claims',
      'a task failed.',
      '',
    )
  }

  if (result.truncated && result.verdict !== VERDICTS.INCONCLUSIVE) {
    out.push('Note: the log ends mid-line and may be incomplete.', '')
  }

  const capped = out.slice(0, CAPS.totalLines)
  if (out.length > CAPS.totalLines) {
    capped.push(`… digest capped at ${CAPS.totalLines} lines.`)
  }
  return capped.join('\n')
}

/* c8 ignore start — the CLI shell; the logic above is what the suite drives. */
const invokedDirectly =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const args = process.argv.slice(2)
  const taskFailed = args.includes('--task-failed')
  const file = args.find((a) => !a.startsWith('--'))

  if (!file) {
    console.error('usage: ci-test-digest.mjs <log-file> [--task-failed]')
    process.exit(2)
  }

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    // Cannot-check is never clean. Say so loudly rather than printing an
    // empty digest that reads like a quiet pass.
    console.error(
      `CI TEST DIGEST · could not read ${file}: ${error.message}\n` +
        'No digest is possible, which is NOT the same as no failures.',
    )
    process.exit(2)
  }

  const result = digestLog(text, { taskFailed })
  console.log(formatDigest(result, file))
  process.exit(0)
}
/* c8 ignore stop */
