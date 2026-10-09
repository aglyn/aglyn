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

// What the local guided AI start run concludes, from what it recorded
// (AGL-3596). Pure functions over the build page's row snapshots and the
// documents the job left, so each verdict can be tested without a browser,
// an emulator or a model; `ai-guided-start-local.e2e.mjs` gathers the inputs.

import { decode } from '@msgpack/msgpack'

/**
 * A document with every msgpack-encoded node tree decoded, as plain JSON.
 * Screens, layouts and forms store `nodes` as bytes, which serialize as
 * `{"type":"Buffer",...}` and hold none of the ids or paths a check reads.
 *
 * @param {unknown} data
 */
export function decodedDocument(data) {
  return JSON.parse(
    JSON.stringify(data ?? null, (_key, value) => {
      const bytes =
        value instanceof Uint8Array
          ? value
          : value &&
              typeof value === 'object' &&
              value.type === 'Buffer' &&
              Array.isArray(value.data)
            ? Uint8Array.from(value.data)
            : null
      if (!bytes) return value
      try {
        return decode(bytes)
      } catch {
        return null
      }
    }),
  )
}

/** A job status the run stops watching at: terminal, or waiting on a person. */
export const AI_JOB_SETTLED_STATUSES = [
  'done',
  'failed',
  'canceled',
  'needs_review',
  'needs_input',
]

/** The statuses during which the build page should show something working. */
export const AI_JOB_WORKING_STATUSES = ['queued', 'running']

/** Words in a row or alert that say the run went wrong. */
const TROUBLE = /\b(fail(?:ed|ure)?|stopped|error|went wrong|could not)\b/i

/**
 * The identity of one snapshot of the build page: its heading and each row's
 * label and state. Two snapshots with the same key looked the same.
 *
 * @param {{ heading?: string|null, rows: Array<{ label: string, state: string }> }} snapshot
 */
export function snapshotKey(snapshot) {
  return JSON.stringify([
    snapshot.heading ?? '',
    snapshot.rows.map((row) => [row.label, row.state]),
  ])
}

/**
 * Keeps the first of each run of identical snapshots, in order.
 *
 * @template {{ heading?: string|null, rows: Array<{ label: string, state: string }> }} T
 * @param {T[]} snapshots
 * @returns {T[]}
 */
export function distinctSnapshots(snapshots) {
  const kept = []
  let last = null
  for (const snapshot of snapshots) {
    const key = snapshotKey(snapshot)
    if (key !== last) kept.push(snapshot)
    last = key
  }
  return kept
}

/**
 * The progress verdicts: whether an active row was on screen whenever the job
 * was working, whether the form row was ever the active one, and anything
 * that read as failed, stopped or an error before the job settled.
 *
 * Each snapshot carries the job's status as read in the same tick
 * (`jobStatus`), its rows, and any alert text (`alerts`).
 *
 * @param {Array<{ atMs: number, jobStatus: string|null, heading?: string|null,
 *   rows: Array<{ label: string, state: string, text?: string }>, alerts?: string[] }>} snapshots
 */
export function analyzeProgress(snapshots) {
  // A snapshot with no rows is the page still loading the job, not a state
  // of the build.
  const working = snapshots.filter(
    (snapshot) =>
      snapshot.rows.length > 0 &&
      AI_JOB_WORKING_STATUSES.includes(snapshot.jobStatus ?? ''),
  )
  const withoutActive = working.filter(
    (snapshot) => !snapshot.rows.some((row) => row.state === 'active'),
  )
  // The look is designed first, on a row of its own (AGL-3660): after the
  // plan, before the header and footer, and its credits stay on it once done.
  const lookRow = (row) => /^Designing your look/i.test(row.label)
  const lookRowSeen = snapshots.some((snapshot) => snapshot.rows.some(lookRow))
  const lookRowSeenActive = snapshots.some((snapshot) =>
    snapshot.rows.some((row) => lookRow(row) && row.state === 'active'),
  )
  const lookRowFirst = snapshots
    .filter((snapshot) => snapshot.rows.some(lookRow))
    .every((snapshot) => snapshot.rows.findIndex(lookRow) === 1)
  const lastLook = [...snapshots]
    .reverse()
    .map((snapshot) => snapshot.rows.find(lookRow))
    .find(Boolean)
  // The row's text runs its label into its credits with no space between
  // them ("Designing your look4 credits"), so no word boundary leads the number.
  const lookCreditsKept = Boolean(
    lastLook && lastLook.state === 'done' && /\d+\s*credits?\b/i.test(lastLook.text ?? ''),
  )
  // A look takes a few seconds, and can go from waiting to done between two
  // snapshots: a done row that kept its credits ran, seen active or not.
  const lookRowActive = lookRowSeenActive || lookCreditsKept
  const formRow = (row) => /\bform\b/i.test(row.label)
  const formRowSeen = snapshots.some((snapshot) => snapshot.rows.some(formRow))
  const formRowActive = snapshots.some((snapshot) =>
    snapshot.rows.some((row) => formRow(row) && row.state === 'active'),
  )
  const troubleMidRun = []
  for (const snapshot of snapshots) {
    if (AI_JOB_SETTLED_STATUSES.includes(snapshot.jobStatus ?? '')) continue
    const rows = snapshot.rows.filter(
      (row) =>
        row.state === 'failed' ||
        TROUBLE.test(row.text ?? '') ||
        TROUBLE.test(row.label),
    )
    const alerts = (snapshot.alerts ?? []).filter((text) => TROUBLE.test(text))
    const heading = TROUBLE.test(snapshot.heading ?? '')
      ? snapshot.heading
      : null
    if (rows.length || alerts.length || heading) {
      troubleMidRun.push({
        atMs: snapshot.atMs,
        jobStatus: snapshot.jobStatus,
        heading,
        rows: rows.map((row) => ({
          label: row.label,
          state: row.state,
          text: row.text ?? '',
        })),
        alerts,
      })
    }
  }
  return {
    snapshots: snapshots.length,
    workingSnapshots: working.length,
    activeRowAlwaysWhileWorking:
      working.length > 0 && withoutActive.length === 0,
    workingWithoutActive: withoutActive.map((snapshot) => ({
      atMs: snapshot.atMs,
      jobStatus: snapshot.jobStatus,
      rows: snapshot.rows.map((row) => `${row.label}: ${row.state}`),
    })),
    lookRowSeen,
    lookRowFirst,
    lookRowActive,
    lookCreditsKept,
    lookRowLast: lastLook ? `${lastLook.state}: ${lastLook.text ?? ''}` : null,
    formRowSeen,
    formRowActive,
    troubleMidRun,
  }
}

const DANGLING = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'your',
  '&',
  '-',
  '—',
  '|',
])

/**
 * Whether a search title or description reads as finished: present, within
 * its length, and not cut mid-phrase (an ellipsis, or a last word that only
 * ever leads into another).
 *
 * @param {unknown} text
 * @param {number} max The guidance length (60 for a title, 155 for a description).
 */
export function seoTextVerdict(text, max) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return { ok: false, reason: 'empty' }
  if (value.length > max)
    return { ok: false, reason: `${value.length} characters, over ${max}` }
  if (/(?:\.\.\.|…)$/.test(value))
    return { ok: false, reason: 'ends in an ellipsis' }
  const last =
    value
      .split(/\s+/)
      .pop()
      ?.toLowerCase()
      .replace(/[.,;:!?]+$/, '') ?? ''
  if (DANGLING.has(last)) return { ok: false, reason: `ends on "${last}"` }
  return { ok: true, reason: null }
}

/**
 * Every `formId` a set of documents binds, as found anywhere in them. A node
 * tree is free-form, so the search is over the JSON rather than a schema.
 *
 * @param {unknown[]} documents
 */
export function boundFormIds(documents) {
  const ids = new Set()
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'formId' && typeof inner === 'string' && inner)
          ids.add(inner)
        else visit(inner)
      }
    }
  }
  for (const document of documents) visit(document)
  return [...ids].sort()
}

/**
 * Whether a document links to a page path: a string equal to it, or to it
 * with the site's own origin-relative forms (`/contact`, `contact`).
 *
 * @param {unknown} document
 * @param {string} path
 */
export function linksTo(document, path) {
  const wanted = new Set([
    path,
    path.replace(/^\//, ''),
    path === '/' ? '' : `${path}/`,
  ])
  let found = false
  const visit = (value) => {
    if (found) return
    if (typeof value === 'string') {
      if (wanted.has(value.trim())) found = true
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) visit(inner)
    }
  }
  visit(document)
  return found
}

/** A Firestore timestamp, an ISO string or millis, as millis; null otherwise. */
export function toMillis(value) {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value._seconds === 'number') return value._seconds * 1000
  return null
}

const mark = (ok) => (ok === true ? 'PASS' : ok === false ? 'FAIL' : 'n/a')

/**
 * The run's summary as Markdown, for a person to read first.
 *
 * @param {object} summary The object written to summary.json.
 */
export function summaryMarkdown(summary) {
  const lines = []
  lines.push(`# Local guided AI start — ${summary.startedAt}`)
  lines.push('')
  lines.push(
    `- Served from: \`${summary.appRoot}\` (${summary.appRef ?? 'unknown ref'})`,
  )
  lines.push(`- Brief: ${JSON.stringify(summary.answers)}`)
  lines.push(`- Runs: ${summary.runs.length}`)
  for (const [index, run] of summary.runs.entries()) {
    lines.push('')
    lines.push(`## Run ${index + 1}: ${run.verdict}`)
    lines.push('')
    if (run.error) lines.push(`- Harness error: ${run.error}`)
    lines.push(
      `- Workspace \`${run.orgSlug}\` (org ${run.orgId}), site \`${run.subdomain}\` (host ${run.hostId ?? '?'}), job ${run.jobId ?? '?'}`,
    )
    lines.push(
      `- Job status: **${run.job?.status ?? 'unknown'}** after ${run.durationS ?? '?'} s`,
    )
    const checks = run.checks ?? {}
    for (const [name, check] of Object.entries(checks)) {
      lines.push(
        `- ${mark(check.ok)} ${name}${check.detail ? ` — ${check.detail}` : ''}`,
      )
    }
    if (run.items?.length) {
      lines.push('')
      lines.push('| item | status | spent | refunded | failure |')
      lines.push('| -- | -- | -- | -- | -- |')
      for (const item of run.items) {
        lines.push(
          `| ${item.label} | ${item.status} | ${item.creditsSpent ?? 0} | ${item.creditsRefunded ?? 0} | ${(item.failure ?? '').replace(/\|/g, '\\|')} |`,
        )
      }
    }
    if (run.credits) {
      lines.push('')
      lines.push(
        `Credits: reserved ${run.credits.reserved}, spent ${run.credits.spent}, refunded ${run.credits.refunded}` +
          (run.credits.pageLine
            ? ` — page says "${run.credits.pageLine}"`
            : ''),
      )
    }
    if (run.progress) {
      const progress = run.progress
      lines.push('')
      lines.push(
        `Progress: ${progress.snapshots} distinct row states; active row always present while working: ` +
          `${progress.activeRowAlwaysWhileWorking ? 'yes' : 'NO'} (${progress.workingWithoutActive.length} working state(s) without one); ` +
          `form row active: ${progress.formRowActive ? 'yes' : 'no'}${progress.formRowSeen ? '' : ' (no form row seen)'}; ` +
          `failed/stopped/error mid-run: ${progress.troubleMidRun.length ? `YES (${progress.troubleMidRun.length})` : 'no'}`,
      )
      for (const state of run.timeline ?? []) {
        lines.push(
          `  - +${Math.round(state.atMs / 1000)} s [${state.jobStatus}] ${state.heading ?? ''}: ${state.rows.map((row) => `${row.label}=${row.state}`).join(' · ')}`,
        )
      }
    }
    if (run.shots?.length) {
      lines.push('')
      lines.push('Screenshots:')
      for (const shot of run.shots) lines.push(`- ${shot}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
