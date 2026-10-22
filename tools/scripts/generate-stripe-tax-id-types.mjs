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
 * Lifts Stripe's own list of tax ID types into a RUNTIME array.
 *
 * ## Why this is generated rather than typed out
 *
 * The Tax ID card offers a country-specific type beside the value, and the
 * type decides how the identifier is printed on the customer's invoice and
 * how a tax authority reads it. A hand-written enum of ~100 codes is wrong
 * within a quarter — Stripe adds jurisdictions steadily, and the failure is
 * silent in the expensive direction: the customer picks the nearest wrong
 * type, and the compliance cost lands on them, not on us.
 *
 * ## Where the list comes from
 *
 * `@stripe/stripe-js` — already a dependency, because the checkout dialog
 * mounts it — publishes `StripeCheckoutTaxIdType`, the union Stripe generates
 * from its own API spec. It is the only machine-readable copy of the list in
 * the tree: the REST API has no "enumerate tax ID types" endpoint, and there
 * is no server-side `stripe` SDK here (every call is a raw `fetch`).
 *
 * A TypeScript union is erased at runtime, so a `<select>` cannot read it.
 * This script turns it into an array, and
 * `apps/console/utils/stripe-tax-id-types.spec.ts` re-extracts from the same
 * `.d.ts` on every test run and fails on any difference. That is the whole
 * design: bumping `@stripe/stripe-js` turns the suite red rather than leaving
 * the dropdown quietly short of a jurisdiction.
 *
 * Regenerate with:
 *   node tools/scripts/generate-stripe-tax-id-types.mjs
 *
 * Verify without writing (what CI and the spec run):
 *   node tools/scripts/generate-stripe-tax-id-types.mjs --check
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { extractStripeTaxIdTypes, STRIPE_TAX_ID_TYPES_SOURCE } from './lib/stripe-tax-id-types-source.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const outPath = resolve(
  repoRoot,
  'apps/console/utils/stripe-tax-id-types.generated.ts',
)

const types = extractStripeTaxIdTypes(repoRoot)

const body = `/**
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
// GENERATED FILE — do not edit. Regenerate with:
//   node tools/scripts/generate-stripe-tax-id-types.mjs
// Source of truth: ${STRIPE_TAX_ID_TYPES_SOURCE}
//   (the \`StripeCheckoutTaxIdType\` union Stripe generates from its API spec).
//
// \`stripe-tax-id-types.spec.ts\` re-extracts from that file and fails on drift,
// so a \`@stripe/stripe-js\` bump that adds a jurisdiction turns the suite red
// instead of leaving this list quietly short of one.

/** Every \`tax_id\` type Stripe accepts, in Stripe's own order. */
export const STRIPE_TAX_ID_TYPES = [
${types.map((type) => `  '${type}',`).join('\n')}
] as const

export type StripeTaxIdType = (typeof STRIPE_TAX_ID_TYPES)[number]
`

if (process.argv.includes('--check')) {
  // Regenerate in memory and compare. A `@stripe/stripe-js` bump that adds a
  // jurisdiction fails HERE — loudly, in CI and in the console test suite —
  // instead of leaving the picker quietly short of a country.
  const current = (() => {
    try {
      return readFileSync(outPath, 'utf8')
    } catch {
      return null
    }
  })()
  if (current !== body) {
    console.error(
      '[generate-stripe-tax-id-types] DRIFT: the checked-in tax ID type list ' +
        "no longer matches Stripe's own. Regenerate with:\n" +
        '  node tools/scripts/generate-stripe-tax-id-types.mjs',
    )
    process.exit(1)
  }
  console.log(
    `[generate-stripe-tax-id-types] up to date (${types.length} types)`,
  )
} else {
  writeFileSync(outPath, body, 'utf8')
  console.log(
    `[generate-stripe-tax-id-types] wrote ${types.length} types to ${outPath}`,
  )
}
