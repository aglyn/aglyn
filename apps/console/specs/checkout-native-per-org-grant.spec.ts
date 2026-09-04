/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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

/**
 * The money path branches on NOTHING.
 *
 * ## What this file used to be
 *
 * `release_native_checkout` chose between Stripe's embedded Checkout and the
 * hosted redirect, and AGL-2486 fixed a real bug in how that flag was read:
 * the route consulted the platform-wide Remote Config template rather than
 * `isServerReleaseFlagOnForOrg`, so a staff per-org grant was written,
 * confirmed on the document, and then ignored by the one code path that takes
 * money.
 *
 * ## Why it is now the opposite assertion
 *
 * There is no choice left to make. Checkout — embedded and hosted alike — is
 * gone: a customer arrives at the plan grid with a payment method and a
 * billing address already saved, and subscribing is a server-side call against
 * the stored method. Nothing renders Stripe's page, so nothing needs to decide
 * whether to.
 *
 * A flag would be worse than useless here — it would be the thing that brings
 * the deleted surface back. So this suite pins the ABSENCE: no release flag is
 * consulted on the money path, and no Checkout Session is ever created. Those
 * are the two shapes a resurrection would take.
 *
 * The AGL-2486 lesson survives in the file it belongs to:
 * `libs/aglyn/.../release-flags.ts` still has its own tests, and the org-aware
 * resolver is still what every OTHER flag consumer uses.
 */

export {}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripTypeScriptComments } from '@aglyn/aglyn/foundation/definitions/write-deny-coverage.util'

const ROUTE = join(
  __dirname,
  '..',
  'app',
  'api',
  'billing',
  'checkout',
  'route.ts',
)

/**
 * Comments discuss the history at length; only CODE is asserted on.
 *
 * The SHARED stripper, not a local regex. A naive `//.*$` also eats the `//`
 * in `https://api.stripe.com/...` inside a string literal, which silently
 * removed the very line the control below looks for — a guard that passes
 * because it deleted its own evidence.
 */
describe('the subscribe path has no flag and no checkout session', () => {
  const source = stripTypeScriptComments(readFileSync(ROUTE, 'utf8'))

  it('CONTROL — the file being read really is the checkout route', () => {
    // A guard that reads the wrong file, or an empty one, reports "no flags"
    // forever. Prove the read with things that must be present.
    expect(source).toContain('claimAttempt')
    expect(source).toContain('isOrgSubscriptionLive')
    expect(source).toContain('api.stripe.com/v1/subscriptions')
  })

  it('consults no release flag', () => {
    // Both spellings: the org-aware resolver and the platform-wide template
    // read that AGL-2486 replaced. Either one reappearing means a branch has
    // come back.
    expect(source).not.toContain('isServerReleaseFlagOnForOrg')
    expect(source).not.toContain('getServerReleaseFlagValues')
    expect(source).not.toContain('isReleaseFlagOn')
    expect(source).not.toContain('release_native_checkout')
  })

  it('creates no Checkout Session, in either mode', () => {
    expect(source).not.toContain('checkout/sessions')
    expect(source).not.toContain('ui_mode')
    // The hosted redirect's parameters, which only a session takes.
    expect(source).not.toContain('success_url')
    expect(source).not.toContain('cancel_url')
  })

  it('still refuses a second subscription, which is the guard that mattered', () => {
    // The one thing from the old flow that MUST survive its removal: two
    // completed purchases on one org are two recurring charges, and the
    // webhook cannot undo that because its job is to mirror what Stripe
    // reports.
    expect(source).toContain('subscription_exists')
  })
})
