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
 * The canary writes what the door reads (AGL-2715).
 *
 * `tools/e2e/signup-canary.mjs` runs OUTSIDE the workspace — a plain `.mjs`
 * on a CI runner with the admin SDK — so it cannot import
 * `recordSignupCanaryWalk` and writes the document by hand. That is the same
 * arrangement `signup-refusal-marker-wiring.spec.ts` guards for the
 * `beforeUserCreated` blocking function, and it fails the same way: rename a
 * field on one side and the door reads `undefined` forever.
 *
 * What that failure looks like matters. `signupCanaryHealth` grades a marker
 * with no usable `walkedAtMs` as `canary-unavailable` — RED — so a drift here
 * pages rather than going quiet. That is the right direction, and it is still
 * a false alarm about signup being broken when the real fault is a typo. This
 * file is what stops it.
 *
 * A source assertion rather than a run: the script talks to production
 * Identity Platform and creates a real account, so executing it in a unit
 * suite is not an option.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const CANARY = readFileSync(
  join(REPO_ROOT, 'tools/e2e/signup-canary.mjs'),
  'utf8',
)
const STORE = readFileSync(
  join(REPO_ROOT, 'libs/tenant/data/admin/src/lib/server/rate-limit-store.ts'),
  'utf8',
)

const frontDoorSource = () =>
  CANARY.slice(
    CANARY.indexOf('async function walkFrontDoor'),
    CANARY.indexOf('async function main'),
  )

describe('the canary writes the document the health door reads', () => {
  it('writes to the id the reader opens', () => {
    expect(STORE).toContain(
      "export const SIGNUP_CANARY_DOC_ID = 'signupCanary_production'",
    )
    expect(CANARY).toContain("'signupCanary_production'")
    // Same collection, or the reader opens an empty document forever.
    expect(CANARY).toContain("collection('rateLimits')")
  })

  it('writes every field the verdict grades', () => {
    /**
     * Each of these decides an outcome:
     *  - `walkedAtMs` — freshness, and its absence is `canary-unavailable`
     *  - `ok` — `signup-walk-failed`
     *  - `failedStep` — which step, for the body
     *  - `elapsedMs` — the latency graph
     *  - `reapedCleanly` — `canary-left-residue`
     */
    for (const field of [
      'walkedAtMs',
      'ok',
      'failedStep',
      'elapsedMs',
      'reapedCleanly',
    ]) {
      expect(CANARY).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  it('stamps an expiry, so a dead canary expires its own evidence', () => {
    // Without it a stale PASS sits in the store forever waiting to be
    // misread. The verdict's own two-hour window is the mechanism; this is
    // the backstop for the case where nobody is reading it at all.
    expect(CANARY).toContain('expiresAt')
  })
})

describe('the walk cannot quietly stop being a walk', () => {
  it('names every step the verdict can report', () => {
    // `failedStep` is what the on-call person reads first. A step renamed
    // here and not in the runbook sends them to the wrong door.
    for (const step of [
      'account',
      'verify',
      'session',
      'org-create',
      'assert',
      'front-door',
      'reap',
    ]) {
      expect(CANARY).toContain(`'${step}'`)
    }
  })

  it('walks the FRONT DOOR without the bypass header', () => {
    /**
     * The whole reason the browser half exists. The mechanism half carries
     * `x-aglyn-probe` and therefore cannot observe bot protection refusing
     * real visitors — which is not hypothetical: an ordinary desktop Chrome
     * User-Agent measured `429 x-vercel-mitigated: challenge` on 2026-09-09.
     *
     * `api()` is the only function that attaches the header, so the front
     * door stays honest exactly as long as it does not go through `api()`.
     */
    const frontDoor = frontDoorSource()
    expect(frontDoor).toContain('playwright-core')
    expect(frontDoor).not.toContain('api(')
    expect(frontDoor).not.toContain('x-aglyn-probe')
  })

  it('asserts the form, not merely a 200', () => {
    // A Vercel challenge page is served with a 200 and no form on it, so a
    // status check alone would pass straight through the outage this watches.
    expect(frontDoorSource()).toContain('input[type="password"]')
  })

  it('reaps on every path, including a failed walk', () => {
    // A failed walk that also leaves residue is two problems. The reap must
    // sit after the try/catch rather than inside the happy path.
    const main = CANARY.slice(CANARY.indexOf('async function main'))
    const catchAt = main.indexOf('} catch (error) {')
    const reapAt = main.indexOf("begin('reap')")
    expect(catchAt).toBeGreaterThan(-1)
    expect(reapAt).toBeGreaterThan(catchAt)
  })

  it('bounds the orphan sweep to canary-shaped names', () => {
    // An unbounded sweep over `orgs` would delete customers' workspaces.
    expect(CANARY).toContain("const CANARY_SLUG_PREFIX = 'signup-canary-'")
    expect(CANARY).toContain("where('slug', '>=', CANARY_SLUG_PREFIX)")
  })

  it('sweeps a real PREFIX range, not an empty one', () => {
    /**
     * `>= p` AND `< p` is the empty set. Written that way the sweep matches
     * nothing, reports nothing, and reads exactly like a sweep with nothing
     * to do — while residue accumulates forever behind a green run. The upper
     * bound has to be the prefix's successor.
     *
     * This is not hypothetical either: it is the bug this file's author wrote
     * on the first pass.
     */
    expect(CANARY).not.toContain("where('slug', '<', CANARY_SLUG_PREFIX)")
    expect(CANARY).toContain('\\uf8ff')
  })

  it('refuses to run without an explicit opt-in', () => {
    // It creates a real account on production. A shell that happens to carry
    // production credentials must not be able to start it by accident.
    expect(CANARY).toContain("process.env['SIGNUP_CANARY_ENABLE'] !== '1'")
  })
})
