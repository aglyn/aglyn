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
 * The console's embedded checkout imports symbols that really exist (AGL-2486).
 *
 * The storefront has this check already, in
 * `libs/plugins/commerce/src/lib/components/stripe-stays-lazy.spec.ts`, and it
 * was written because a Stripe major bump can DELETE an export while every
 * suite stays green: `storefront-payment-element.spec.tsx` mocks
 * `@stripe/react-stripe-js` with a hand-written double, and a double does not
 * have to resemble the module it replaces.
 *
 * The console is the second place we take money and it had no such check. That
 * asymmetry is the gap this file closes, and it is not hypothetical:
 * `@stripe/react-stripe-js` v6 removed `CheckoutProvider` from the main entry
 * outright and moved `useCheckout` behind a `/checkout` subpath. The two call
 * sites happen to fare differently under that bump —
 *
 *   - the storefront imports `CheckoutProvider` / `useCheckout`, which are GONE
 *   - this dialog imports `EmbeddedCheckout` / `EmbeddedCheckoutProvider`,
 *     which survive
 *
 * — but "happens to survive" is a fact about today's diff, not a property of
 * the code, and the only reason anyone knows which is which is that somebody
 * read the package's type definitions by hand. A check that reads the INSTALLED
 * package says it automatically, on every future bump, for both call sites.
 *
 * It is a contract check, not a version pin. It asserts nothing about WHICH
 * version is installed — only that every symbol this component imports is
 * really exported by whatever is on disk. An upgrade that keeps them stays
 * green; one that removes them turns red naming the missing symbol, instead of
 * failing later as a blank dialog where a payment form should be.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMPONENT = join(
  __dirname,
  '..',
  'components',
  'embedded-checkout-dialog.component.tsx',
)

/**
 * The named VALUE imports taken from one module specifier.
 *
 * Inline `type` specifiers are DROPPED rather than merely un-prefixed, and the
 * difference matters here in a way it does not in the storefront's copy of this
 * helper: this component writes `import { loadStripe, type Stripe } from
 * '@stripe/stripe-js'`, and `Stripe` is an interface. It has no runtime
 * existence to assert, so keeping it would fail the check against a package
 * that is perfectly fine — a false red that would most likely be "fixed" by
 * deleting the check.
 */
function namedValueImportsFrom(source: string, specifier: string): string[] {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `[^{}]` rather than `.` on two counts. Multi-line, because this component
  // writes its `@stripe/react-stripe-js` list across several lines and a
  // single-line match would silently miss it — and a silent miss returns []
  // and proves nothing, which is what the equality assertion below catches.
  // Brace-excluding, because a plain lazy `[\s\S]*?` does NOT stop at the end
  // of one import: asked for `@stripe/stripe-js` it happily spans from the
  // `import {` of the react-stripe list down to the NEXT `} from '…'`,
  // returning both lists glued together. Excluding braces pins the capture to
  // a single import statement.
  const match = source.match(
    new RegExp(`import\\s+\\{([^{}]*?)\\}\\s*from\\s*'${escaped}'`),
  )
  if (!match) return []
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^type\s/.test(part))
    // `a as b` imports the binding named `a`; the local alias is ours, the
    // export name is the package's, and it is the package's we are checking.
    .map((part) => part.split(/\s+as\s+/)[0].trim())
}

describe('the console embedded checkout imports symbols the package really has', () => {
  const source = readFileSync(COMPONENT, 'utf8')

  it.each([
    ['@stripe/react-stripe-js', ['EmbeddedCheckout', 'EmbeddedCheckoutProvider']],
    ['@stripe/stripe-js', ['loadStripe']],
  ])('%s exports every symbol the dialog imports from it', (specifier, expected) => {
    const imported = namedValueImportsFrom(source, specifier as string)

    // Fail on a silent no-op. If the parse stops finding the import — the file
    // is renamed, the import is reformatted, the symbols move to a subpath —
    // an empty list would sail through the check below and prove nothing at
    // all. Pinning the expected names also makes a DELETED import a failure
    // rather than a pass, which a bare "everything I found exists" would not.
    expect(imported).toEqual(expected)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const real = require(specifier as string) as Record<string, unknown>
    const missing = imported.filter((name) => real[name] === undefined)

    expect({ specifier, missing }).toEqual({ specifier, missing: [] })
  })

  it('takes the Stripe type without asserting it exists at runtime', () => {
    // Guards the helper's own `type` filter. If a later tidy-up rewrites this
    // to a value import, the check above starts demanding a runtime `Stripe`
    // export that has never existed, and the natural next move is to weaken
    // the check. Pin the shape instead.
    expect(source).toMatch(/import \{ loadStripe, type Stripe \} from '@stripe\/stripe-js'/)
  })
})
