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
 * Every card payment Aglyn opens asks for 3-D Secure through ONE seam
 * (AGL-3360).
 *
 * The platform's own SetupIntent requested 3DS after the 9/26 fraud
 * (AGL-3356); the Checkout Sessions every plugin opens for a site's
 * customers — storefront, cart, draft order, POS, reservation, booking
 * deposit, marketplace — sent nothing, so a tenant's shoppers got whatever
 * Stripe's default happened to be. They now share
 * `stripe-card-authentication.ts`, and this sweep keeps it that way: a file
 * that creates a Checkout Session, a SetupIntent or a PaymentIntent without
 * calling the helper fails here, including one written after this spec.
 *
 * Path-keyed on purpose: it reads source and imports nothing, so a plugin
 * added tomorrow is covered the day it lands.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import {
  cardAuthenticationParams,
  checkoutSessionCardAuthenticationParams,
  REQUEST_THREE_D_SECURE_PARAM,
  requestThreeDSecureFor,
} from '@aglyn/tenant-data-admin/server/stripe-card-authentication'

const REPO_ROOT = resolve(__dirname, '../../..')

/** Every shipped `.ts` under `dir`, specs and generated files excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(spec|test)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      out.push(path)
    }
  }
  return out
}

/**
 * A request that CREATES a card payment or a saved card: the bare
 * collection URL of a Checkout Session, SetupIntent or PaymentIntent, as a
 * direct `fetch` or through a route's own `stripeRequest(…, 'setup_intents')`.
 * `…/checkout/sessions/${id}/expire` and reads by id do not match.
 */
const CREATES_A_CARD_PAYMENT =
  /api\.stripe\.com\/v1\/(checkout\/sessions|setup_intents|payment_intents)['`]|['`](setup_intents|payment_intents)['`]/

const SCANNED = ['libs/plugins', 'apps/console/app', 'apps/tenant/app', 'libs/tenant']

function creators(): string[] {
  return SCANNED.flatMap((root) => sourceFiles(resolve(REPO_ROOT, root)))
    .filter((file) => CREATES_A_CARD_PAYMENT.test(readFileSync(file, 'utf8')))
    .map((file) => relative(REPO_ROOT, file))
    .sort()
}

describe('3-D Secure is requested by every card payment, at one seam', () => {
  it('finds the payment creators it is meant to guard', () => {
    // Pinned so a regex that stops matching cannot pass vacuously.
    const found = creators()
    for (const expected of [
      'apps/console/app/api/billing/profile/route.ts',
      'libs/plugins/bookings/src/lib/server.ts',
      'libs/plugins/commerce/src/lib/server/cart-checkout.ts',
      'libs/plugins/commerce/src/lib/server/checkout.ts',
      'libs/plugins/commerce/src/lib/server/draft-order.ts',
      'libs/plugins/commerce/src/lib/server/pos-order.ts',
      'libs/plugins/commerce/src/lib/server/reserve.ts',
      'libs/plugins/marketplace/src/lib/server/checkout.ts',
    ]) {
      expect(found).toContain(expected)
    }
  })

  it('every creator builds its params through the shared helper', () => {
    const offenders = creators().filter((file) => {
      const source = readFileSync(resolve(REPO_ROOT, file), 'utf8')
      return !/\b(checkoutSessionCardAuthenticationParams|cardAuthenticationParams)\(/.test(
        source,
      )
    })
    // Confirming an EXISTING intent (the platform checkout confirms the
    // invoice's own PaymentIntent, whose card the SetupIntent above already
    // authenticated) reads it by id and never matches the pattern, so it is
    // not asked to challenge the customer a second time.
    expect(offenders).toEqual([])
  })

  it('no creator hand-writes the 3DS param instead of asking the helper', () => {
    const handWritten = creators().filter((file) =>
      readFileSync(resolve(REPO_ROOT, file), 'utf8').includes(
        REQUEST_THREE_D_SECURE_PARAM,
      ),
    )
    expect(handWritten).toEqual([])
  })
})

describe('stripe-card-authentication', () => {
  it('asks for automatic 3DS on a one-time payment', () => {
    expect(requestThreeDSecureFor('one-time')).toBe('automatic')
    expect(checkoutSessionCardAuthenticationParams('payment')).toEqual({
      'payment_method_options[card][request_three_d_secure]': 'automatic',
    })
  })

  it('asks for 3DS on every capable card that is kept for later', () => {
    expect(cardAuthenticationParams('off-session')).toEqual({
      'payment_method_options[card][request_three_d_secure]': 'any',
    })
    expect(checkoutSessionCardAuthenticationParams('subscription')).toEqual({
      'payment_method_options[card][request_three_d_secure]': 'any',
    })
    expect(checkoutSessionCardAuthenticationParams('setup')).toEqual({
      'payment_method_options[card][request_three_d_secure]': 'any',
    })
  })
})
