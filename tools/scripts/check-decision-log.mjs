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

// The change-control rule, made into an exit code (AGL-1908).
//
//   npm run check:decision-log
//   npm run check:decision-log -- --base origin/main
//   npm run check:decision-log -- --summary
//
// ## The defect it answers
//
// `00-Pricing-Source-of-Truth` → "Change-control rule" requires a price or
// entitlement change to move TOGETHER across six places, the last of which is
// the Pricing Decision Log. Nothing enforced the last one. The consequences
// were not hypothetical:
//
//  * The Decision Log went from 2026-08-09 to 2026-08-18 with the whole
//    retention/packaging arc (AGL-1859/1862/1863) landing in between and no
//    entry naming any of it — the gap AGL-1908 was filed about.
//  * On 2026-08-24 an agent found a live revenue leak (entry scheduling is
//    ungated while screen scheduling is gated) and declined to fix it, citing
//    among its reasons that closing it is an entitlement change and
//    "AGL-1908's change-control rule requires publication legs I cannot do".
//    A rule that blocks a real fix while enforcing nothing is the worst of
//    both.
//
// ## What it can and cannot prove
//
// It proves ONE leg: a watched price or entitlement VALUE moved between the
// base ref and HEAD, and `docs/DECISION_LOG.md` moved in the same range. It
// cannot see Stripe, Figma, or `aglyn.com/pricing` — that page is
// hand-authored besigner content on the `aglyn-marketing` host and lives
// outside the repo entirely. It also cannot see the shared Google Drive from
// CI: `check:no-tax-identifiers` scans tracked git files, so nothing on Drive
// is covered by any repo guard. The repo Decision Log is the anchor precisely
// because it is the only leg CI can hold.
//
// EXIT CODES mirror `check-pricing-drift.mjs` and `legal-doc-diff.mjs`,
// deliberately: 0 = something was compared and everything agrees, 1 = a change
// is unrecorded or an entry is malformed, 2 = could not check. A run that
// compared nothing exits 2, because "no disagreements found" and "no
// comparison performed" must never render the same.

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  WATCHED,
  DECISION_LOG_PATH,
  parseDecisionLog,
  changeControlVerdicts,
  driveCrossCheckVerdicts,
} from './lib/decision-log.mjs'
import { driveDocPath, driveMountSkipNote } from './lib/drive-mount.mjs'
import { overallExitCode } from './lib/pricing-drift.mjs'

/** The authoritative Pricing Decision Log, when the shared drive is mounted. */
const DRIVE_DECISION_LOG = driveDocPath(
  'Platform Docs',
  'Pricing & Packaging',
  '05-Pricing-Decision-Log',
  'Pricing-Decision-Log.md',
)

/**
 * Base refs, in preference order.
 *
 * `origin/production` is the right default: the change-control rule is about
 * what SHIPS, and a promotion batch is the unit that ships. `main` is a
 * staging area where a price move and its decision may land in separate
 * commits, which is fine and must not red.
 */
const BASE_CANDIDATES = ['origin/production', 'production', 'origin/main']

function parseArgs(argv) {
  const args = { summary: false, base: null }
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (raw === '--summary') args.summary = true
    else if (raw === '--base') args.base = argv[++i]
    else if (raw.startsWith('--base=')) args.base = raw.slice('--base='.length)
    else {
      console.error(`Unknown argument: ${raw}`)
      console.error('Usage: check:decision-log [--base <ref>] [--summary]')
      process.exit(2)
    }
  }
  return args
}

function refExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/** File contents at a ref, or `null` when the path does not exist there. */
function showAtRef(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/** Working-tree contents, or `null`. */
function readWorktree(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

const args = parseArgs(process.argv.slice(2))

if (!existsSync(WATCHED[0].path)) {
  console.error(`CANNOT CHECK: ${WATCHED[0].path} not found — run from the repo root.`)
  process.exit(2)
}

const baseRef = args.base ?? BASE_CANDIDATES.find(refExists) ?? null
if (!baseRef || !refExists(baseRef)) {
  console.error(
    `CANNOT CHECK: no base ref to compare against (tried ${
      args.base ? args.base : BASE_CANDIDATES.join(', ')
    }). Run \`git fetch origin\`, or pass \`--base <ref>\`. This exits 2, not 0 — a comparison that did not happen ` +
      'must never read as "nothing changed".',
  )
  process.exit(2)
}

const baseSources = {}
const headSources = {}
for (const spec of WATCHED) {
  baseSources[spec.path] = showAtRef(baseRef, spec.path)
  headSources[spec.path] = readWorktree(spec.path)
}

const verdicts = changeControlVerdicts({
  baseRef,
  baseSources,
  headSources,
  baseLog: showAtRef(baseRef, DECISION_LOG_PATH),
  headLog: readWorktree(DECISION_LOG_PATH),
})

// ---- the Drive leg, when the shared drive is mounted ----------------------
// `existsSync` is TRUE for a Google Drive placeholder whose contents have not
// been materialised locally, and the read then throws ENOENT — so presence is
// not readability here. Same trap `check-pricing-drift.mjs` documents.
let driveMd = null
try {
  if (DRIVE_DECISION_LOG && existsSync(DRIVE_DECISION_LOG)) {
    driveMd = readFileSync(DRIVE_DECISION_LOG, 'utf8')
  }
} catch {
  driveMd = null
}
if (driveMd) {
  verdicts.push(...driveCrossCheckVerdicts(parseDecisionLog(readWorktree(DECISION_LOG_PATH)).entries, driveMd))
} else {
  console.log(driveMountSkipNote('the Pricing Decision Log'))
}

const differs = verdicts.filter((v) => v.status === 'differs')
const unreadable = verdicts.filter((v) => v.status === 'unreadable')
const inSync = verdicts.filter((v) => v.status === 'in-sync')

for (const v of differs) console.error(`DIFFERS     ${v.key} — ${v.detail}`)
for (const v of unreadable) console.error(`UNREADABLE  ${v.key} — ${v.detail}`)
if (!args.summary) for (const v of inSync) console.log(`in sync     ${v.key} — ${v.detail}`)

const code = overallExitCode(verdicts)
console.log(
  `\nbase ${baseRef} — ${inSync.length} in-sync, ${differs.length} differs, ${unreadable.length} unreadable — exit ${code}`,
)
process.exit(code)
