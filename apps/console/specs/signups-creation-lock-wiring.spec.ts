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
 * THE CREATION-LEVEL VALVE IS ACTUALLY WIRED (AGL-1531).
 *
 * The signups feature lock (AGL-1510) refuses the SESSION, the acceptance
 * recorder and the signup-page doors. Account creation itself is
 * client -> Firebase Auth with no Aglyn server in front of it, so the only
 * thing that can refuse it is a Firebase Auth `beforeUserCreated` blocking
 * function — which lives in `cloud/functions`, a plain npm package OUTSIDE
 * the nx workspace. Nothing in the workspace imports it and no nx target
 * tests it, so without this spec the deployed valve has no coverage at all.
 *
 * Two different jobs here, and neither substitutes for the other:
 *
 *  1. The DECISION is tested for real, in lockdown.spec.ts, against
 *     `signupsCreationVerdict` — fail-closed, timeout, expiry boundary. That
 *     is only meaningful if the deployed function runs the same characters,
 *     which is what the byte-for-byte region check below establishes.
 *  2. The WIRING — which trigger, which document, which doors, which pools —
 *     is a property of `cloud/functions/src/index.ts` and is checked here.
 *
 * Every assertion is written to fail on a plausible edit, not merely to
 * pass: delete the trigger, add a provider carve-out, gate on `tenantId`,
 * swap `beforeUserCreated` for `beforeUserSignedIn`, or let the region drift
 * from the library, and exactly one of these reddens.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const LIB_LOCKDOWN = join(
  REPO_ROOT,
  'libs/aglyn/src/lib/app-utils/lockdown.ts',
)
const FUNCTION_LOCK = join(REPO_ROOT, 'cloud/functions/src/signups-lock.ts')
const FUNCTION_INDEX = join(REPO_ROOT, 'cloud/functions/src/index.ts')

const REGION_START = '// #region signups-creation-lock'
const REGION_END = '// #endregion signups-creation-lock'

/** The marked block, or a failure that names the file that lost its marker. */
function region(path: string): string {
  const source = readFileSync(path, 'utf8')
  const from = source.indexOf(REGION_START)
  const to = source.indexOf(REGION_END)
  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `${path} has no ${REGION_START} … ${REGION_END} block — the shared ` +
        'signups-creation decision cannot be compared, so it cannot be trusted.',
    )
  }
  return source.slice(from + REGION_START.length, to)
}

describe('AGL-1531 · the deployed decision is the tested decision', () => {
  it('is byte-for-byte identical in the library and in cloud/functions', () => {
    // Not "equivalent", not "similar". The library copy is the one with
    // tests; the cloud copy is the one that runs at account creation. Any
    // divergence at all means the tests describe code nobody deploys.
    expect(region(FUNCTION_LOCK)).toBe(region(LIB_LOCKDOWN))
  })

  it('carries no import, which is what lets it be copied at all', () => {
    // `cloud/functions` can resolve firebase-admin and firebase-functions and
    // nothing else. An import added to the region would compile in the
    // library and break the function at deploy time — the one failure mode
    // the byte comparison alone would happily wave through.
    expect(region(LIB_LOCKDOWN)).not.toMatch(/^\s*import\s/m)
  })
})

describe('AGL-1531 · the blocking function is registered and reached', () => {
  const index = readFileSync(FUNCTION_INDEX, 'utf8')

  it('registers a beforeUserCreated trigger', () => {
    expect(index).toMatch(
      /export const \w+ = beforeUserCreated\(/,
    )
    expect(index).toMatch(/from 'firebase-functions\/identity'/)
  })

  it('reads the same document the staff lever writes', () => {
    // `featureLockdownDocId('signups')` is not reachable from here, so the
    // literal is spelled out — and pinned, because a typo would produce a
    // function that reads a document nothing ever writes and therefore never
    // refuses anything, silently, forever.
    expect(index).toContain("'lockdowns'")
    expect(index).toContain("'feature--signups'")
  })

  it('routes the decision through the shared verdict', () => {
    expect(index).toMatch(/signupsCreationVerdict\(/)
    expect(index).toMatch(/from '\.\/signups-lock'/)
  })

  /**
   * AGL-2581. The warm-up runs at module scope and is gated on the entry
   * point Cloud Run names in `FUNCTION_TARGET`, so that the every-minute job
   * beat and the deploy-time trigger scan — which load this same module — do
   * not pay for a document they never read. A rename of the export that
   * missed the string would leave a warm-up that silently never runs and put
   * the cold read back inside the handler's budget, which is the whole
   * defect this guards.
   */
  it('warms the lock read for its OWN entry point, named exactly', () => {
    const target = /SIGNUPS_LOCK_WARM_TARGET = '(\w+)'/.exec(index)?.[1]
    const exported = /export const (\w+) = beforeUserCreated\(/.exec(index)?.[1]
    expect(target).toBeDefined()
    expect(target).toBe(exported)
    expect(index).toMatch(/process\.env\.FUNCTION_TARGET === SIGNUPS_LOCK_WARM_TARGET/)
  })

  it('refuses by throwing, so Identity Platform aborts the creation', () => {
    // Returning a value from a blocking function MODIFIES the user being
    // created; only a thrown HttpsError refuses it. A `return` where a
    // `throw` belongs is a lock that runs, logs, decides "refuse", and then
    // creates the account anyway.
    expect(index).toMatch(/throw new HttpsError\(/)
  })

  /**
   * AGL-1888. `beforeUserSignedIn` fires for EXISTING accounts. Registering
   * one here would put every sign-in — including the permanent break-glass
   * account, whose whole purpose is to be reachable when other credentials
   * are not — behind this Firestore read and this fail-closed posture. The
   * lock must stop accounts being BORN, never stop them coming home.
   */
  /**
   * AGL-2581. An unreadable lock now ADMITS the account, which is the right
   * trade but also the one outcome nothing else records: the person sees a
   * normal signup and the lever was never consulted. The warn is the only
   * trace, so the handler must log on BOTH outcomes — the refusal and the
   * blind admission — not just the one that stops something.
   */
  it('warns on the blind admission as well as on the refusal', () => {
    const handler = index.slice(index.indexOf('beforeUserCreated('))
    expect(handler.match(/logger\.warn\(/g)).toHaveLength(2)
    expect(handler).toMatch(/verdict\.unreadable/)
  })

  it('registers no beforeUserSignedIn trigger — break-glass stays reachable', () => {
    // The CALL and the IMPORT, not the identifier: the handler's own comment
    // names the trigger to say why it is absent, and a guard that a comment
    // can trip is a guard people delete.
    expect(index).not.toMatch(/beforeUserSignedIn\s*\(/)
    expect(index).not.toMatch(/import\s*\{[^}]*beforeUserSignedIn/)
  })
})

describe('AGL-1531 · all three doors, both pools', () => {
  const index = readFileSync(FUNCTION_INDEX, 'utf8')
  const handler = index.slice(index.indexOf('beforeUserCreated('))

  /**
   * Email/password, Google and SSO are three doors onto ONE chokepoint:
   * Firebase Auth account creation. The way a control ends up guarding one
   * gate of three is by learning to tell them apart, so the handler must not
   * read the discriminators at all.
   */
  it('never branches on the provider', () => {
    for (const discriminator of [
      'providerId',
      'providerData',
      'signInMethod',
      'sign_in_provider',
      'password',
      'google.com',
      'saml.',
      'oidc.',
    ]) {
      expect(handler).not.toContain(discriminator)
    }
  })

  /**
   * AGL-1993: SSO mints through a per-org GCIP tenant pool, email/password
   * and Google through the project pool. `event.data.tenantId` is the only
   * thing that differs, and a handler that consults it is a handler that can
   * be made to skip one pool.
   */
  it('never branches on the auth pool', () => {
    expect(handler).not.toMatch(/tenantId\s*(===|!==|\?|&&|\|\|)/)
    expect(handler).not.toMatch(/if\s*\([^)]*tenantId/)
  })

  it('never branches on the email address', () => {
    // An allowlist here would be the carve-out that a bot wave aims at: the
    // attacker controls the address. Recovery for real people is the
    // break-glass account, which already exists and is never re-created.
    expect(handler).not.toMatch(/\bendsWith\(|\bincludes\(.*@|ALLOW|allowlist/i)
  })
})
