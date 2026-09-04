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
 * Deployed-vs-promoted Cloud Functions comparison (AGL-2580).
 *
 * The third sibling of lib/rules-drift.mjs and lib/index-drift.mjs, and the
 * one that was missing on 2026-09-04. `cloud/functions` ships by hand with
 * `firebase deploy --only functions`; the promotion merge deploys the Vercel
 * apps and nothing else. So a merged commit touching `cloud/functions/**` is
 * not evidence that anything is running — and unlike a missing rule, which
 * denies a write loudly, a stale function simply keeps doing yesterday's job.
 * `consoleFastCrons` had been deployed on 2026-09-01 and never learned the
 * `drain-publish-outbox` route added on 2026-09-04, so a `SCHEDULED_JOBS` row
 * production was already judging never fired, `/api/health/crons` returned
 * `job-never-reported`, and the Scheduled jobs monitor went red.
 *
 * WHY A TIMESTAMP AND NOT A CONTENT HASH. The rules checker byte-compares the
 * live ruleset against the file, because the control plane hands the source
 * back. Cloud Functions does not: what is deployed is a build artifact of a
 * whole npm package, and the API reports `updateTime`, a build id and a source
 * bucket URL, never the TypeScript that went in. The comparable question is
 * therefore ordering — is the newest promoted commit touching the package
 * older than the deploy that is running? — and it answers the failure that
 * actually happens, which is a deploy step nobody ran.
 *
 * The four verdicts, and why each is separate:
 *
 *  - STALE — a promoted commit touches the package and is NEWER than the
 *    deploy. The deploy is owed. This is the AGL-2575 incident.
 *  - NEVER DEPLOYED — the promoted source exports a function that does not
 *    exist in the project at all. Worse than stale and reported apart from it,
 *    because a new scheduled export also creates a Cloud Scheduler job, and
 *    `/api/health/crons` starts judging the row the moment the promotion
 *    serves it.
 *  - ORPHANED — the project runs a function the promoted source no longer
 *    exports. `firebase deploy --only functions` prunes these, so an orphan is
 *    a deploy that has not run; until it does, a schedule keeps firing at code
 *    that review has already deleted.
 *  - NOT ACTIVE — deployed, but in a state other than ACTIVE. A FAILED or
 *    half-finished deployment reads as "recently updated" on `updateTime`
 *    alone, so the timestamp comparison would call it clean.
 *
 * CLOCK SKEW is real but not load-bearing here. Both timestamps come from
 * elsewhere — git's committer date and Google's deploy time — and the gap the
 * check exists to catch is measured in hours or days, not seconds. A deploy
 * made from an OLDER checkout than the promoted sha is the one case a
 * timestamp cannot see; nothing short of hashing the built artifact can, and
 * that failure has never happened here while the missed-deploy one has.
 */

/** Everything `firebase deploy --only functions` packs and ships. */
export const FUNCTIONS_SOURCE_PATH = 'cloud/functions'

/** The file whose `export const` names become deployed function ids. */
export const FUNCTIONS_ENTRY_FILE = 'cloud/functions/src/index.ts'

/**
 * The function ids the entry file declares.
 *
 * Firebase deploys one function per top-level export of the entry module, and
 * names it after the export, verbatim — `consoleFastCrons` is
 * `projects/aglyn-main/locations/us-central1/functions/consoleFastCrons`. Only
 * top-level `export const` declarations are matched: this file exports
 * function handles and nothing else, and a parser that also swept re-exports
 * would invent function ids for the constants in `signups-lock.ts`.
 */
export function parseFunctionExports(source) {
  const names = []
  for (const line of String(source ?? '').split('\n')) {
    const match = /^export const ([A-Za-z_$][\w$]*)\s*=/.exec(line)
    if (match) names.push(match[1])
  }
  return names.sort()
}

/** `us-central1` from a v2 function resource name, or `?`. */
export function functionRegion(resourceName) {
  const match = /\/locations\/([^/]+)\//.exec(String(resourceName ?? ''))
  return match ? match[1] : '?'
}

/** `consoleFastCrons` from a v2 function resource name, or the name itself. */
export function functionId(resourceName) {
  const name = String(resourceName ?? '')
  const match = /\/functions\/([^/]+)$/.exec(name)
  return match ? match[1] : name
}

/** Milliseconds from an RFC-3339 timestamp, or null when it does not parse. */
export function parseTimestamp(value) {
  if (!value) return null
  const ms = Date.parse(String(value))
  return Number.isNaN(ms) ? null : ms
}

function formatAge(fromMs, toMs) {
  const hours = Math.round(((toMs - fromMs) / 3_600_000) * 10) / 10
  if (Math.abs(hours) < 48) return `${hours}h`
  return `${Math.round((hours / 24) * 10) / 10}d`
}

/**
 * Compare the deployed functions against the promoted source.
 *
 * @param deployed  the API's `functions` array (resource `name`, `updateTime`,
 *                  `state`).
 * @param declared  function ids the promoted entry file exports.
 * @param commit    `{ sha, timestampMs, subject }` for the newest promoted
 *                  commit touching the package, or null when the history
 *                  carries none.
 * @param unreachable  regions the API could not answer for. LOAD-BEARING: an
 *                  export missing from a listing that skipped a region is
 *                  UNVERIFIABLE, not absent, and accusing it of never having
 *                  been deployed would be the check crying wolf about the one
 *                  case it genuinely cannot see.
 * @returns `{ findings, current, stale, neverDeployed, orphaned, notActive,
 *            unverifiable, oldestDeployMs, drifted }`
 */
export function classifyFunctionsDrift({ deployed, declared, commit, unreachable }) {
  const blindRegions = (unreachable ?? []).length > 0
  const declaredIds = new Set(declared ?? [])
  const seen = new Set()
  const findings = []
  const current = []
  let oldestDeployMs = null

  for (const fn of deployed ?? []) {
    const id = functionId(fn.name)
    const region = functionRegion(fn.name)
    const updatedAtMs = parseTimestamp(fn.updateTime)
    seen.add(id)
    if (updatedAtMs !== null) {
      oldestDeployMs =
        oldestDeployMs === null ? updatedAtMs : Math.min(oldestDeployMs, updatedAtMs)
    }
    const entry = {
      id,
      region,
      updateTime: fn.updateTime ?? null,
      updatedAtMs,
      state: fn.state ?? 'UNKNOWN',
    }
    if (!declaredIds.has(id) && declaredIds.size > 0) {
      findings.push({
        ...entry,
        verdict: 'orphaned',
        detail:
          'deployed, but the promoted entry file no longer exports it — the next ' +
          'functions deploy prunes it, and until then its trigger still fires.',
      })
      continue
    }
    if (entry.state !== 'ACTIVE') {
      findings.push({
        ...entry,
        verdict: 'not-active',
        detail: `state is ${entry.state}, not ACTIVE — the last deployment did not finish.`,
      })
      continue
    }
    if (commit && updatedAtMs !== null && commit.timestampMs > updatedAtMs) {
      findings.push({
        ...entry,
        verdict: 'stale',
        detail:
          `deployed ${formatAge(updatedAtMs, commit.timestampMs)} BEFORE ` +
          `${commit.sha.slice(0, 9)}, which changed ${FUNCTIONS_SOURCE_PATH}.`,
      })
      continue
    }
    if (updatedAtMs === null) {
      findings.push({
        ...entry,
        verdict: 'not-active',
        detail: 'the API reported no parsable updateTime, so its age is unknown.',
      })
      continue
    }
    current.push(entry)
  }

  const unverifiable = []
  for (const id of [...declaredIds].sort()) {
    if (seen.has(id)) continue
    const missing = {
      id,
      region: '(none)',
      updateTime: null,
      updatedAtMs: null,
      state: 'ABSENT',
    }
    if (blindRegions) {
      unverifiable.push({
        ...missing,
        verdict: 'unverifiable',
        detail:
          `absent from a listing that could not answer for ${(unreachable ?? []).join(', ')} — ` +
          'it may be deployed there. Unknown, which is neither clean nor drift.',
      })
      continue
    }
    findings.push({
      ...missing,
      verdict: 'never-deployed',
      detail:
        'the promoted entry file exports it and the project has no such function — ' +
        'nothing schedules it and nothing serves its trigger.',
    })
  }

  const byVerdict = (verdict) => findings.filter((f) => f.verdict === verdict)
  return {
    findings,
    current,
    stale: byVerdict('stale'),
    neverDeployed: byVerdict('never-deployed'),
    orphaned: byVerdict('orphaned'),
    notActive: byVerdict('not-active'),
    unverifiable,
    oldestDeployMs,
    drifted: findings.length > 0,
  }
}

/** One aligned line per function, newest deploy last. */
export function renderFunctionLines(entries) {
  const sorted = [...entries].sort(
    (a, b) => (a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0) || a.id.localeCompare(b.id),
  )
  const width = sorted.reduce((n, e) => Math.max(n, e.id.length), 0)
  return sorted.map(
    (e) =>
      `  ${e.id.padEnd(width)}  ${e.region.padEnd(12)}  ${e.updateTime ?? '(never deployed)'}`,
  )
}
