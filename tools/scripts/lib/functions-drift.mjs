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
 * WHY A SOURCE STAMP AND NOT A TIMESTAMP (AGL-3968). The rules checker
 * byte-compares the live ruleset against the file, because the control plane
 * hands the source back. Cloud Functions does not: what is deployed is a build
 * artifact of a whole npm package, and the API reports `updateTime`, a build id
 * and a source bucket URL, never the TypeScript that went in. Ordering (is the
 * deploy newer than the last commit touching the package?) cannot stand in for
 * content: on 2026-10-17 a functions commit landed at 01:19Z, a deploy of the
 * PREVIOUS promotion's source ran at 02:54Z, and an ordering check would call
 * the next promotion matched while production ran the older code.
 *
 * So the deploy writes down what it shipped. The functions predeploy hook
 * (`cloud/functions/scripts/stamp-source.mjs`) puts the checkout's HEAD sha in
 * the package dotenv as `AGLYN_SOURCE_SHA`; firebase-functions copies every
 * dotenv variable onto every function it deploys, and the list API returns it
 * under `serviceConfig.environmentVariables`. The check then asks git whether
 * the stamped commit's package tree equals the baseline's
 * (`git diff --quiet <stamp> <baseline> -- <pathspecs>`). Tree equality, not
 * ancestry, so a squashed promotion with the same tree reads as the same
 * source.
 *
 * The verdicts, and why each is separate:
 *
 *  - STALE — the stamped source differs from the baseline, and the baseline
 *    carries package commits the stamp does not. The deploy is owed. This is
 *    the AGL-2575 incident, and the 2026-10-17 one.
 *  - AHEAD — the stamped source differs and only the stamp carries the
 *    commits: a deploy from a checkout past the promoted sha, so production
 *    runs code that has not been promoted.
 *  - UNSTAMPED — no `AGLYN_SOURCE_SHA`: deployed before the stamp existed, or
 *    by a path that skipped the predeploy hook. Unknown is never a match;
 *    redeploy to stamp.
 *  - DIRTY — the stamp says the deploy packed uncommitted changes, so no
 *    commit describes what is running.
 *  - UNKNOWN SOURCE — the stamped sha is not in this clone (an unpushed
 *    commit, or a shallow fetch), so its tree cannot be compared.
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
 *    half-finished deployment can carry the new stamp on a revision that is
 *    not serving.
 */

/** Everything `firebase deploy --only functions` packs and ships. */
export const FUNCTIONS_SOURCE_PATH = 'cloud/functions'

/**
 * The dotenv variable the predeploy hook writes and this check reads. Not a
 * reserved prefix: firebase-tools refuses `FIREBASE_`, `X_GOOGLE_`, `EXT_`.
 */
export const SOURCE_STAMP_ENV = 'AGLYN_SOURCE_SHA'

/** Suffix the stamp carries when the deploy packed uncommitted changes. */
export const DIRTY_STAMP_SUFFIX = '-dirty'

/** The deployed function's source stamp, or null when it carries none. */
export function readSourceStamp(fn) {
  const value = fn?.serviceConfig?.environmentVariables?.[SOURCE_STAMP_ENV]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * `dotenv` with exactly one `AGLYN_SOURCE_SHA=<stamp>` line, every other line
 * kept as written. A null stamp removes the line, so a deploy that cannot read
 * git ships UNSTAMPED rather than carrying an earlier deploy's sha forward.
 */
export function withSourceStamp(dotenv, stamp) {
  const kept = String(dotenv ?? '')
    .split('\n')
    .filter((line) => !new RegExp(`^\\s*${SOURCE_STAMP_ENV}\\s*=`).test(line))
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  if (stamp) kept.push(`${SOURCE_STAMP_ENV}=${stamp}`)
  return kept.length > 0 ? `${kept.join('\n')}\n` : ''
}

/**
 * The pathspecs whose tree must match between the stamped commit and the
 * baseline: everything under the package EXCEPT what cannot change what runs.
 * The predeploy hook's dirty check reads the same list.
 *
 * The exclusions are deliberately few, and the list only ever grows by
 * argument, because it is the direction that fails UNSAFELY — a path wrongly
 * excluded is a missed deploy, the incident this whole check exists to catch.
 * An include-list would fail that way by default, which is why this is not one.
 *
 * `node_modules` — never packed; the deploy installs its own from the
 * lockfile. One was tracked by accident (AGL-2695) and both the commit that
 * added it and the commit that removed it read as source changes.
 *
 * `.gitignore` — read by git, and by nothing the deploy runs. `firebase.json`
 * declares no `ignore` for this package, so packing follows firebase-tools'
 * own defaults; this file is carried along and never consulted.
 *
 * Each was a real red with nothing to deploy behind it: a difference there
 * changes nothing that runs, so a check that counted it would owe a deploy
 * that ships nothing new.
 */
export const FUNCTIONS_SOURCE_PATHSPECS = Object.freeze([
  FUNCTIONS_SOURCE_PATH,
  `:(exclude)${FUNCTIONS_SOURCE_PATH}/node_modules`,
  `:(exclude)${FUNCTIONS_SOURCE_PATH}/.gitignore`,
])

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

const short = (sha) => String(sha ?? '').slice(0, 9)

function listCommits(lines, limit = 5) {
  const shown = lines.slice(0, limit).join('; ')
  return lines.length > limit ? `${shown}; and ${lines.length - limit} more` : shown
}

/**
 * Compare the deployed functions against the promoted source.
 *
 * @param deployed  the API's `functions` array (resource `name`, `updateTime`,
 *                  `state`, `serviceConfig.environmentVariables`).
 * @param declared  function ids the promoted entry file exports.
 * @param baselineSha  the commit whose package SHOULD be live, for messages.
 * @param compareSource  `(stampSha) => ({ known, same, missing, extra })`:
 *                  `known` is false when the sha is not in this clone; `same`
 *                  is tree equality of the package at the stamp and at the
 *                  baseline; `missing` lists the baseline's package commits
 *                  the stamp lacks and `extra` the reverse, one oneline each.
 *                  Called once per distinct stamp.
 * @param unreachable  regions the API could not answer for. LOAD-BEARING: an
 *                  export missing from a listing that skipped a region is
 *                  UNVERIFIABLE, not absent, and accusing it of never having
 *                  been deployed would be the check crying wolf about the one
 *                  case it genuinely cannot see.
 * @returns `{ findings, current, stale, ahead, unstamped, dirty,
 *            unknownSource, neverDeployed, orphaned, notActive, unverifiable,
 *            drifted }`
 */
export function classifyFunctionsDrift({
  deployed,
  declared,
  baselineSha,
  compareSource,
  unreachable,
}) {
  const blindRegions = (unreachable ?? []).length > 0
  const declaredIds = new Set(declared ?? [])
  const seen = new Set()
  const findings = []
  const current = []
  const comparisons = new Map()
  const compare = (sha) => {
    if (!comparisons.has(sha)) {
      comparisons.set(
        sha,
        compareSource ? compareSource(sha) : { known: false, same: false, missing: [], extra: [] },
      )
    }
    return comparisons.get(sha)
  }
  const baseline = baselineSha ? short(baselineSha) : 'the baseline'

  for (const fn of deployed ?? []) {
    const id = functionId(fn.name)
    const region = functionRegion(fn.name)
    const stamp = readSourceStamp(fn)
    seen.add(id)
    const entry = {
      id,
      region,
      updateTime: fn.updateTime ?? null,
      updatedAtMs: parseTimestamp(fn.updateTime),
      state: fn.state ?? 'UNKNOWN',
      stamp,
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
    if (!stamp) {
      findings.push({
        ...entry,
        verdict: 'unstamped',
        detail:
          `unknown — no source stamp (${SOURCE_STAMP_ENV}), so nothing says which code it ` +
          'runs. Redeploy to stamp; a deploy time is not evidence of content.',
      })
      continue
    }
    if (stamp.endsWith(DIRTY_STAMP_SUFFIX)) {
      findings.push({
        ...entry,
        verdict: 'dirty',
        detail:
          `deployed from ${short(stamp)} WITH uncommitted ${FUNCTIONS_SOURCE_PATH} changes, ` +
          'so no commit describes what runs. Redeploy from a clean checkout.',
      })
      continue
    }
    const result = compare(stamp)
    if (!result.known) {
      findings.push({
        ...entry,
        verdict: 'unknown-source',
        detail:
          `stamped ${short(stamp)}, which this clone does not have — an unpushed commit, ` +
          'or a shallow fetch. Fetch it, or redeploy from a pushed checkout at the baseline.',
      })
      continue
    }
    if (result.same) {
      current.push(entry)
      continue
    }
    const missing = result.missing ?? []
    const extra = result.extra ?? []
    const verdict = missing.length === 0 && extra.length > 0 ? 'ahead' : 'stale'
    findings.push({
      ...entry,
      verdict,
      detail:
        verdict === 'ahead'
          ? `runs ${short(stamp)}, which carries ${extra.length} ${FUNCTIONS_SOURCE_PATH} ` +
            `commit(s) ${baseline} does not: ${listCommits(extra)}.`
          : `runs ${short(stamp)}, whose ${FUNCTIONS_SOURCE_PATH} differs from ${baseline}` +
            (missing.length > 0
              ? ` — missing ${missing.length} commit(s): ${listCommits(missing)}.`
              : '.'),
    })
  }

  const unverifiable = []
  for (const id of [...declaredIds].sort()) {
    if (seen.has(id)) continue
    const absent = {
      id,
      region: '(none)',
      updateTime: null,
      updatedAtMs: null,
      state: 'ABSENT',
      stamp: null,
    }
    if (blindRegions) {
      unverifiable.push({
        ...absent,
        verdict: 'unverifiable',
        detail:
          `absent from a listing that could not answer for ${(unreachable ?? []).join(', ')} — ` +
          'it may be deployed there. Unknown, which is neither clean nor drift.',
      })
      continue
    }
    findings.push({
      ...absent,
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
    ahead: byVerdict('ahead'),
    unstamped: byVerdict('unstamped'),
    dirty: byVerdict('dirty'),
    unknownSource: byVerdict('unknown-source'),
    neverDeployed: byVerdict('never-deployed'),
    orphaned: byVerdict('orphaned'),
    notActive: byVerdict('not-active'),
    unverifiable,
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
      `  ${e.id.padEnd(width)}  ${e.region.padEnd(12)}  ${e.updateTime ?? '(never deployed)'}` +
      (e.stamp ? `  source ${short(e.stamp)}` : ''),
  )
}
