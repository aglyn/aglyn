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
 *
 * @jest-environment node
 */

/**
 * EVERY MONEY DOOR ASKS THE SAME QUESTION (AGL-2471).
 *
 * `connect-mode-gate.spec.ts` proves the storefront checkout refuses an
 * unverified linkage, at the Stripe boundary. It proves it for ONE door. The
 * readiness test was copy-pasted into seven, and a helper that six of them
 * ignore is this repo's most repeated failure — AGL-1994 exists only because
 * the marketplace twin was fixed while the commerce one stayed broken, with
 * nothing able to notice.
 *
 * So this file enumerates the doors and reads their source. It is a weaker
 * kind of evidence than a behavioural test and it is honest about that: it
 * cannot tell whether the call is on the path a shopper takes. What it CAN do
 * is fail the moment an eighth door appears with the old two-field test in it,
 * or someone deletes the call from one of these seven — which is exactly the
 * regression that put three unusable storefronts into production.
 *
 * The negative half matters more than the positive half. Asserting the call is
 * present is satisfied by a call sitting anywhere in the file; asserting the
 * OLD predicate is absent is what says the decision actually moved.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Repo-relative, resolved from this file rather than from cwd. */
const PLUGINS = join(__dirname, '..', '..', '..', '..')

/**
 * Every server path that turns a stored Connect linkage into a charge.
 *
 * Derived by grepping `stripeChargesEnabled` across the plugin servers, not
 * from memory — the list has to be re-derived whenever this changes, and the
 * `no other door` test below is what re-derives it.
 */
const DOORS = [
  'commerce/src/lib/server/checkout.ts',
  'commerce/src/lib/server/cart-checkout.ts',
  'commerce/src/lib/server/reserve.ts',
  'commerce/src/lib/server/draft-order.ts',
  'commerce/src/lib/server/pos-order.ts',
  'bookings/src/lib/server.ts',
  'marketplace/src/lib/server/checkout.ts',
  // Not a charge, but the same claim one step earlier: publishing a PAID
  // listing tells a seller they are set up to sell (AGL-2471).
  'marketplace/src/lib/server/publish-preconditions.ts',
]

const read = (relative: string) =>
  readFileSync(join(PLUGINS, relative), 'utf8')

describe('AGL-2471 connect-mode gate coverage', () => {
  it.each(DOORS)('%s consults connectLinkageIsReady', (door) => {
    expect(read(door)).toContain('connectLinkageIsReady(')
  })

  it.each(DOORS)('%s no longer decides on stripeChargesEnabled alone', (door) => {
    const source = read(door)
    // The exact shape that shipped the defect, in both its `?.` and plain
    // forms. A door still carrying it is a door that never asks about mode.
    expect(source).not.toMatch(
      /if \(!\w+ \|\| !\w+\??\.(get\('stripeChargesEnabled'\)|stripeChargesEnabled)\)/,
    )
  })

  it.each(DOORS)('%s reads the recorded mode off the profile', (door) => {
    expect(read(door)).toContain('stripeAccountLivemode')
  })

  it('names every door that reads stripeChargesEnabled at all', () => {
    // Re-derived, not asserted from memory: any NEW non-spec server file that
    // touches the readiness flag has to be triaged into DOORS or explained
    // here. The two connect routes and the status sync WRITE the flag rather
    // than gating on it, so they are named as the known non-doors.
    const NON_DOORS = [
      // Write the flag rather than gate on it.
      'commerce/src/lib/server/connect.ts',
      'marketplace/src/lib/server/connect.ts',
      'commerce/src/lib/server/billing-webhook.ts',
      'marketplace/src/lib/server/billing-webhook.ts',
      // The PROJECTION the marketplace doors read. It must carry
      // `stripeAccountLivemode` or the predicate downstream is starved into a
      // constant — asserted directly below.
      'marketplace/src/lib/server/publisher-profile.ts',
    ]
    const { execFileSync } = require('node:child_process')
    const hits = execFileSync(
      'grep',
      ['-rl', '--include=*.ts', 'stripeChargesEnabled', '.'],
      { cwd: PLUGINS, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .map((path: string) => path.replace(/^\.\//, ''))
      .filter((path: string) => !path.includes('.spec.'))
      .filter((path: string) => path.includes('/server'))
      .sort()
    expect(hits).toEqual([...DOORS, ...NON_DOORS].sort())
  })

  it('the marketplace projection carries the field its gate reads', () => {
    // `resolvePublisherProfile` is what `checkout.ts` and the publish
    // preconditions actually see. A projection that dropped this field would
    // make every marketplace sale refuse for a reason no test in this file
    // would name — the AGL-2471 fix failing closed on everyone.
    const source = read('marketplace/src/lib/server/publisher-profile.ts')
    expect(source).toContain("snapshot.get('stripeAccountLivemode')")
    // And NOT flattened to a boolean: absent and false are different answers.
    expect(source).not.toContain(
      "stripeAccountLivemode: snapshot.get('stripeAccountLivemode') === true",
    )
  })
})
