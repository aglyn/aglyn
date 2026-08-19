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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { actionRunResult, actionRunSummary } from './activity-presenter'

/**
 * Every writer of a RUN into `hosts/{hostId}/activity` must write the shape
 * the run table reads (AGL-2222).
 *
 * AGL-2171 built a `Time | Trigger | Result | What happened` table and made
 * `actionRunResult()` the filter that keeps publishes and media saves out of
 * it. That filter recognises a run by its `result` field, falling back to the
 * prose prefix `Action ran on`.
 *
 * Two writers were never updated. `run-event-workflows.ts` writes
 * `Workflow ran on …` with `status` and `durationMs`; the inbound-webhook
 * handler writes `Inbound webhook ran …` with neither. Both fail the filter,
 * so **every workflow execution was dropped from the table built to show
 * them** — the Runs dialog on the Workflows tab read "No runs yet" no matter
 * how many times a workflow had run. The `durationMs` caption in that table
 * could never render either, since the only rows carrying a duration were the
 * dropped ones.
 *
 * A unit test of `actionRunResult()` cannot see this: the function was right.
 * What was wrong was that a producer and a consumer of the same collection
 * disagreed about its shape, and nothing was reading both. So this guard reads
 * both — the sources that write, and the function that reads.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')

/**
 * Enumerated from `git ls-files`, never a filesystem walk (AGL-2116) — a walk
 * sweeps `dist/`, which holds compiled copies of these very writers.
 */
function sources(): Array<{ file: string; source: string }> {
  // `libs apps` alone overruns execFileSync's default stdout buffer on this
  // repo, so the listing is narrowed with a pathspec rather than raised — a
  // buffer bump would only postpone the same failure.
  return execFileSync(
    'git',
    ['ls-files', '--', 'libs/**/*.ts', 'libs/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.spec.'))
    .map((file) => ({
      file,
      source: readFileSync(join(REPO_ROOT, file), 'utf8'),
    }))
}

/**
 * Every `collection('activity').add({ … })` object literal, brace-matched.
 *
 * A regex to the first `}` stops inside `target: { type: 'workflow', … }`,
 * which every one of these writers has — and a payload read as ending there
 * has no `result` in it, so the guard would report a finding on a writer that
 * is correct. Over-reporting is survivable; the reason to match braces is that
 * the truncation also hides `target`, which is how a payload is identified as
 * a run at all.
 */
function activityPayloads(source: string): string[] {
  const payloads: string[] = []
  const opener = /\.add\(\{/g
  for (const match of source.matchAll(opener)) {
    const start = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let cursor = start
    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) break
      }
      cursor += 1
    }
    payloads.push(source.slice(start, cursor + 1))
  }
  return payloads
}

/** A payload is a RUN record when it targets a workflow or an action. */
const RUN_TARGET = /target:\s*\{[^}]*type:\s*'workflow'/

const runWriters = sources().flatMap(({ file, source }) =>
  activityPayloads(source)
    .filter((payload) => RUN_TARGET.test(payload))
    .map((payload) => ({ file, payload })),
)

describe('run history shape (AGL-2222)', () => {
  // Anti-vacuity, first: every assertion below is satisfied by an empty set,
  // so a renamed collection, a moved writer or a broken brace matcher has to
  // fail as itself rather than as a pass.
  it('finds the writers that record a run', () => {
    expect(runWriters.length).toBeGreaterThanOrEqual(3)
    expect(new Set(runWriters.map((writer) => writer.file)).size).toBeGreaterThanOrEqual(2)
  })

  it('every run writer records a result the run table can read', () => {
    const silent = runWriters
      .filter(({ payload }) => !/\bresult:/.test(payload))
      .map(({ file }) => file)
    if (silent.length) {
      throw new Error(
        `These writers record a run into hosts/{hostId}/activity with no \`result\` field. actionRunResult() will not recognise them, so the run is dropped from the Runs table silently — the dialog reads "No runs yet" while the run is sitting in the collection:\n  ${[...new Set(silent)].join('\n  ')}`,
      )
    }
  })

  it('every run writer records a trigger and a summary', () => {
    const thin = runWriters
      .filter(
        ({ payload }) => !/\btrigger:/.test(payload) || !/\bsummary:/.test(payload),
      )
      .map(({ file }) => file)
    if (thin.length) {
      throw new Error(
        `These run writers omit \`trigger\` or \`summary\`, so the table renders an empty Trigger cell or falls back to legacy prose:\n  ${[...new Set(thin)].join('\n  ')}`,
      )
    }
  })

  // The reader half, against the exact shapes those writers produce. Modelled
  // on the real payloads rather than on a convenient fake: an unfaithful
  // double manufactures a false green as readily as a false red.
  it('the reader recognises a workflow run and an inbound-webhook run', () => {
    expect(
      actionRunResult({
        action: 'Workflow ran on formSubmission',
        result: 'succeeded',
        trigger: 'formSubmission',
        summary: 'Ran',
      }),
    ).toBe('succeeded')
    expect(
      actionRunResult({
        action: 'Inbound webhook run failed: boom',
        result: 'failed',
        trigger: 'hook:orders',
        summary: 'boom',
      }),
    ).toBe('failed')
    expect(actionRunSummary({ action: 'x', summary: 'Ran' })).toBe('Ran')
  })

  it('still refuses an activity row that is not a run', () => {
    // The filter's real job. A publish carries no verdict, and calling it
    // `succeeded` would put it in the run history under a word that means
    // nothing for it.
    expect(actionRunResult({ action: 'Published screen "Home"' })).toBeUndefined()
    expect(actionRunResult({ action: 'Uploaded media' })).toBeUndefined()
  })
})
