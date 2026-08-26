/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Route } from '../constants/route-links'

/**
 * A BILLING LOCK MUST NOT LOCK OUT PAYMENT (AGL-2430).
 *
 * The shape being guarded is a deadlock, not a bug in any one file: an org
 * suspended for non-payment that can no longer reach the page where payment
 * happens can never pay its way out, and every effect of the lock is
 * therefore permanent. Nothing on this path is exotic — each link was
 * written correctly and independently, which is exactly why the next author
 * can close one of them without noticing what the set adds up to.
 *
 * So the set is written down, in one place, with the reason attached.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE. These are SOURCE assertions: they read
 * the shipped files and check the property holds there. They are not a drive
 * of a real locked session, and they cannot become one — a real drive needs
 * a live delinquent org. Treat a green here as "no one has removed the
 * exemption", never as "a locked customer was observed paying".
 */

const REPO_ROOT = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

/**
 * The routes that ARE the card-recovery path. Each must stay exempt from the
 * lockdown 423 — the `lockdown-423-coverage` sweep already forces every
 * console route to be wired, delegated or exempt, so the risk here is not an
 * unmarked route but a well-meaning author converting an exemption into
 * enforcement.
 */
const RECOVERY_ROUTES: Array<{ path: string; why: string }> = [
  {
    path: 'apps/console/app/api/billing/subscription/route.ts',
    why:
      'the `portal` action is the card-update path — refusing it during a ' +
      'billing lock is the deadlock itself',
  },
]

/** The marker `lockdown-423-coverage.spec.ts` recognises as an exemption. */
const EXEMPT_MARKER = /\/\/\s*lockdown-423:\s*exempt\s*—/

/**
 * The wiring that would REFUSE a locked caller.
 *
 * Deliberately does NOT match `featureLockdownRefusal(` — capital L, and a
 * different thing. That is the staff kill switch for a whole capability
 * (`checkout`, `signups`, `uploads`), platform-scope by definition, and
 * `api/billing/checkout` carries it on purpose: while staff have checkout off
 * over a billing bug, nobody may open a NEW Stripe session. Neither of those
 * is the org lock this file guards against, and folding them together would
 * make the guard demand the removal of a staff control that is meant to be
 * there.
 *
 * Found the hard way: pointing this list at `api/billing/checkout` as a
 * deliberate-failure probe came back GREEN, because checkout refuses through
 * that other helper. `api/hosts/screens/route.ts` — genuinely wired with
 * `getLockdownVerdict` + `lockdownJsonResponse` — is the substitution that
 * proves this assertion reads the file.
 */
const WIRED_MARKER = /lockdownRefusal\(|lockdownJsonResponse\(|getLockdownVerdict\(/

describe('the billing recovery path survives a billing lock', () => {
  it.each(RECOVERY_ROUTES)('$path is exempt — $why', ({ path }) => {
    const source = read(path)
    expect({ path, exempt: EXEMPT_MARKER.test(source) }).toEqual({
      path,
      exempt: true,
    })
    expect({ path, refuses: WIRED_MARKER.test(source) }).toEqual({
      path,
      refuses: false,
    })
  })

  /**
   * The other half, and the quieter one: the session mint.
   *
   * `getLockdownVerdict` evaluates the ORG scope only when the caller hands
   * it an org doc — "absent = scope not evaluated" is its own contract. The
   * mint deliberately hands it `staff` and `uid` and NOTHING else, so a
   * suspended org's members can still sign in. Adding `org:` there would
   * read as tightening a security gate and would in fact mean a customer
   * whose card failed cannot reach the console at all.
   */
  it('the session mint does not evaluate the ORG scope — a suspended org can still sign in', () => {
    const source = read('apps/console/app/api/auth/session/route.ts')
    const calls = [...source.matchAll(/getLockdownVerdict\(\{([\s\S]*?)\}\)/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const [, args] of calls) {
      // Comments inside the options object legitimately mention the word;
      // what must not appear is an `org:` or `host:` KEY.
      const withoutComments = args
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect({ scoped: /(^|[\s,{])(org|host)\s*:/.test(withoutComments) }).toEqual(
        { scoped: false },
      )
    }
  })

  /**
   * Reads are what the billing page is made of: the org doc, the
   * `billing/stripe` subdoc, the member row. `orgNotSuspended()` gates
   * WRITES in the rules and must not spread to those reads, or the page
   * renders as a row of permission errors for exactly the customer who came
   * to fix their card.
   */
  it('the Firestore rules do not gate the billing reads on suspension', () => {
    const rules = read('cloud/firebase-firestore.rules')
    const billingBlock = rules.slice(
      rules.indexOf('match /billing/{billingDocId}'),
    )
    const allowRead = billingBlock.slice(
      billingBlock.indexOf('allow read:'),
      billingBlock.indexOf(';', billingBlock.indexOf('allow read:')),
    )
    expect({ allowRead: allowRead.includes('orgNotSuspended') }).toEqual({
      allowRead: false,
    })
  })

  /**
   * A `billing` lock must not sign the members out. `applyOrgLockdown` says
   * so in its own docblock — "members must be able to reach console billing
   * settings to fix the thing" — but a docblock is not a guard, and this is
   * one boolean at each of two call sites.
   */
  it('a billing lock does not revoke member sessions', () => {
    const sweep = read('apps/console/app/api/billing/usage-alerts/route.ts')
    expect({ sweep: /revokeMemberTokens:\s*false/.test(sweep) }).toEqual({
      sweep: true,
    })
    const staff = read('apps/console/app/api/admin/lockdown/route.ts')
    const clause = staff.slice(
      staff.indexOf('revokeMemberTokens:'),
      staff.indexOf('revokeMemberTokens:') + 220,
    )
    // Whatever else it gates on, `billing` must not be one of the reasons
    // that revokes — the staff route names the two that do.
    expect({
      security: clause.includes("'security'"),
      manual: clause.includes("'manual'"),
      billing: clause.includes("'billing'"),
    }).toEqual({ security: true, manual: true, billing: false })
  })

  /**
   * The console shell's own gate. `PlatformLockdownGate` swaps the whole app
   * for a notice screen; if the status route ever started reporting an ORG
   * lock, a billing-locked customer would get that screen instead of the
   * billing page — with a Sign out button as the only affordance.
   */
  it('the lockdown notice surface stays platform-scope, so an org lock never blanks the console', () => {
    const source = read('apps/console/app/api/lockdown-status/route.ts')
    expect({ orgScoped: /getOrgLockdown|orgs?\s*\.\s*doc\(|orgId/.test(source) }).toEqual(
      { orgScoped: false },
    )
  })
})

describe('the org-agnostic entry point Stripe can link to', () => {
  const PAGE = 'apps/console/app/(app)/billing/page.tsx'

  it('exists, and the route table names it', () => {
    expect(Route.BILLING_ENTRY).toBe('/billing')
    expect(existsSync(join(REPO_ROOT, PAGE))).toBe(true)
  })

  /**
   * INSIDE the `(app)` group, which is the whole signed-out story: that
   * group's layout mounts `AuthenticatedLayout`, which pushes
   * `/signin?continue=<path>` and returns the customer HERE. A copy of this
   * page anywhere else would silently lose the return target — the customer
   * signs in and lands on a dashboard, which is the dead end the page exists
   * to remove.
   */
  it('sits under the authenticated shell, so the signed-out leg keeps its return target', () => {
    expect(PAGE).toContain('/app/(app)/')
    const groupLayout = read('apps/console/app/(app)/layout.tsx')
    expect(groupLayout).toContain('AuthenticatedLayout')
  })

  /**
   * The resolver must have nowhere to look for suspension. Asserted on the
   * page and the helper together because the filter could be added to
   * either.
   */
  it('never filters a workspace out of the answer for being suspended or delinquent', () => {
    for (const path of [PAGE, 'apps/console/utils/billing-entry.ts']) {
      const source = read(path)
      // Prose about the deadlock is expected and welcome; a predicate is not.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect({
        path,
        filters:
          /suspend/i.test(code) ||
          /past_due|billingStatus/.test(code),
      }).toEqual({ path, filters: false })
    }
  })
})
