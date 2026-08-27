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
 * No build may read an App Check DEBUG token (AGL-2402).
 *
 * ## What this is protecting
 *
 * An App Check debug token is a standing **bypass of attestation** for whoever
 * holds it. Console Firestore reads are gated by App Check, so a valid debug
 * token is a skeleton key against that gate — and one that presents as a
 * Firestore *permission denial* when it is missing, which is why an App Check
 * problem is routinely misdiagnosed as a rules problem.
 *
 * `APP_CHECK_DEBUG_TOKEN_FROM_CI` and `APP_CHECK_DEBUG_TOKEN_FROM_CONSOLE`
 * were found on the runtime env of both apps' production deployments by the
 * AGL-1874 secrets audit. What made them merely bad rather than exploitable is
 * precisely the property this file pins: **nothing reads them.** Their last
 * consumer was deleted in `30755327a` (the commit that removed `apps/www`), and
 * they have been orphaned since.
 *
 * Re-measured 2026-08-20: `APP_CHECK_DEBUG_TOKEN` appears once in the whole
 * tree — in the audit tool's known-issue table, which exists to report them —
 * and `FIREBASE_APPCHECK_DEBUG_TOKEN`, the name the Firebase SDK actually
 * reads, appears nowhere at all.
 *
 * ## Why a guard and not a note
 *
 * Revoking the tokens in the Firebase console and deleting the Vercel
 * variables are both the clicks; a repo cannot do either. What a repo CAN
 * do is make the dangerous half — a build that starts READING one — a failing
 * check rather than a plausible-looking three-line diff. The SDK reads
 * `FIREBASE_APPCHECK_DEBUG_TOKEN` off `self`/`globalThis`/`window`, so a
 * single assignment anywhere in a client bundle is enough to turn an inert env
 * var back into a live bypass.
 */

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const REPO_ROOT = resolve(__dirname, '../../../../..')

/**
 * Names that make a debug token operative. `FIREBASE_APPCHECK_DEBUG_TOKEN` is
 * the SDK's own; the two `APP_CHECK_DEBUG_TOKEN_FROM_*` are ours, and are what
 * is sitting in Vercel.
 */
const DEBUG_TOKEN_NAMES =
  'FIREBASE_APPCHECK_DEBUG_TOKEN|APP_CHECK_DEBUG_TOKEN'

/**
 * The one file allowed to name them: the production env audit, whose entire
 * job is to report that they exist. It never reads a VALUE — the tool is
 * metadata-only by construction.
 */
const REPORTING_TOOL = 'tools/deploy/verify-env-isolation.mjs'

/** This file, which necessarily contains the pattern it searches for. */
const SELF = 'libs/aglyn/src/lib/app-utils/app-check-debug-token.spec.ts'
/**
 * The rotation runbook (AGL-2403) names both variables in its inventory — as
 * the two entries whose instruction is **delete, do not rotate**, citing this
 * guard by path as what keeps them deleted.
 *
 * Exempt because this guard's subject is CODE THAT READS a debug token, and a
 * runbook telling an operator to remove one is the opposite of that. Naming
 * the single file rather than exempting `docs/**` is deliberate: a doc that
 * told someone to SET one would still be caught, which is the failure worth
 * catching.
 */
const ROTATION_RUNBOOK = 'docs/SECRET_ROTATION.md'

function filesNaming(pattern: string): string[] {
  try {
    // `--untracked` deliberately: a violation arrives as a NEW file, and a
    // search that only reads the index would go green on the working tree
    // that introduced it and red only after someone committed.
    return execFileSync('git', ['grep', '-lE', '--untracked', pattern], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .sort()
  } catch (error) {
    // `git grep` exits 1 for "no matches", which is the outcome we want for
    // most of these searches — not an error.
    if ((error as { status?: number })?.status === 1) return []
    throw error
  }
}

describe('App Check debug tokens are read by nothing (AGL-2402)', () => {
  it('the search itself works — it finds the file that is SUPPOSED to match', () => {
    // The anti-vacuity assertion. A `git grep` invocation that silently
    // matched nothing (wrong cwd, wrong flag, a pattern that stopped
    // compiling) would make every assertion below pass while proving nothing,
    // which is the exact shape of a green check that cannot fail.
    expect(filesNaming(DEBUG_TOKEN_NAMES)).toContain(REPORTING_TOOL)
  })

  it('no file outside the audit tool names an App Check debug token', () => {
    const offenders = filesNaming(DEBUG_TOKEN_NAMES).filter(
      (file) =>
        file !== REPORTING_TOOL && file !== SELF && file !== ROTATION_RUNBOOK,
    )
    expect(offenders).toEqual([])
  })

  it('nothing assigns the name the Firebase SDK actually reads', () => {
    // The SDK picks the token up off the global object, so this — not an env
    // read — is the assignment that turns the env var back into a live
    // bypass. Listed separately from the rule above because it is the one a
    // reviewer would most plausibly wave through as a debugging convenience.
    expect(
      filesNaming(
        '(self|window|globalThis)\\.FIREBASE_APPCHECK_DEBUG_TOKEN\\s*=',
      ),
    ).toEqual([])
  })

  it('the audit tool still only reports them, never reads a value', () => {
    // A stale-exemption check: if the tool ever grew a `process.env[...]` read
    // of one of these, the allowance above would be silently covering a real
    // consumer.
    const tool = readFileSync(resolve(REPO_ROOT, REPORTING_TOOL), 'utf8')
    expect(tool).not.toMatch(
      /process\.env\[?['"`]?(FIREBASE_APPCHECK_DEBUG_TOKEN|APP_CHECK_DEBUG_TOKEN)/,
    )
  })
})
