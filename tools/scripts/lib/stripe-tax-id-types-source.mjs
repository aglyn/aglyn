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
 * The one extractor, shared by the generator and the drift spec.
 *
 * Kept in its own module precisely so the guard and the thing it guards
 * cannot parse the file differently: a spec that re-implements the extraction
 * proves the two parsers agree, not that the checked-in list matches Stripe.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Where Stripe publishes the list, relative to a repo root. */
export const STRIPE_TAX_ID_TYPES_SOURCE =
  'node_modules/@stripe/stripe-js/dist/stripe-js/checkout.d.ts'

/** The union declaration that holds it. */
const UNION_NAME = 'StripeCheckoutTaxIdType'

/**
 * Read Stripe's tax ID type codes out of the installed `@stripe/stripe-js`.
 *
 * THROWS rather than returning `[]` on anything unexpected — a moved or
 * renamed declaration must break the build loudly. An empty array would ship
 * an empty dropdown, which reads as "this org has no tax IDs to declare".
 */
export function extractStripeTaxIdTypes(repoRoot) {
  const path = resolve(repoRoot, STRIPE_TAX_ID_TYPES_SOURCE)
  const source = readFileSync(path, 'utf8')
  const start = source.indexOf(`export type ${UNION_NAME} =`)
  if (start === -1) {
    throw new Error(
      `${UNION_NAME} not found in ${STRIPE_TAX_ID_TYPES_SOURCE} — ` +
        '@stripe/stripe-js moved or renamed the tax ID type union.',
    )
  }
  const end = source.indexOf(';', start)
  if (end === -1) {
    throw new Error(`${UNION_NAME} declaration is unterminated`)
  }
  const declaration = source.slice(start, end)
  const types = [...declaration.matchAll(/'([a-z]{2}_[a-z_]+)'/g)].map(
    (match) => match[1],
  )
  if (types.length < 50) {
    throw new Error(
      `${UNION_NAME} yielded only ${types.length} types — the declaration ` +
        'shape changed and the extractor is reading it wrong.',
    )
  }
  return types
}
