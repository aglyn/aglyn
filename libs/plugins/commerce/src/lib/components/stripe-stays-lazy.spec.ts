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
 * Stripe.js must not load on a page that is not asking to be paid (AGL-2486).
 *
 * Measured on the live published site `northwind-coffee.aglyn.app` — a page of
 * static coffee-shop content with no cart and no checkout on it — Lighthouse
 * mobile recorded `https://js.stripe.com/v3` as the single largest resource on
 * the page: **249 KB gzipped** (1,052 KB unzipped), of which its own coverage
 * said 182 KB was never executed, plus a 139 ms long task. That was more bytes
 * than any first-party chunk, on a page with nothing to buy.
 *
 * TWO separate defects put it there, and fixing either alone leaves it loading.
 *
 * ## 1. Importing `@stripe/stripe-js` injects the script by itself
 *
 * The package's main entry ends with a module-scope side effect:
 *
 * ```js
 * // Execute our own script injection after a tick to give users time to do
 * // their own script injection.
 * Promise.resolve().then(() => getStripePromise()).catch(…)
 * ```
 *
 * So the `<script src="js.stripe.com/v3">` tag goes in a microtask after the
 * module is *evaluated*, whether or not anything ever calls `loadStripe()`.
 * Memoising `loadStripe` per key — which this module does, and which is right
 * for other reasons — cannot help, because the injection never went through
 * `loadStripe` in the first place. `@stripe/stripe-js/pure` is the same API
 * with that one statement removed, which is precisely what a lazily-mounted
 * checkout wants: the script is fetched when `loadStripe()` is called.
 *
 * ## 2. The `lazy()` boundary was defeated by its own fallback
 *
 * `cart.tsx` and `product-detail.tsx` both do the right-looking thing:
 *
 * ```ts
 * const StorefrontPaymentElement = lazy(() => import('./storefront-payment-element'))
 * ```
 *
 * and then, one line above, `import { StorefrontPaymentElementFallback } from
 * './storefront-payment-element'` — a STATIC import of the very module the
 * `lazy()` was there to defer. A static and a dynamic import of one module
 * resolve to one module, and the static one wins: the module lands in the
 * eager graph, gets evaluated with the bundle, and defect 1 fires. The
 * spinner shown *while* a chunk loads must not live in that chunk.
 *
 * So this guard pins both invariants at the source level. It is deliberately
 * a source assertion rather than a render test: the defect is which modules a
 * bundler puts in the eager graph, and no amount of rendering observes that —
 * a render test passes happily while Stripe loads on every page, which is how
 * this survived having a full behavioural spec next to it already.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = __dirname
const read = (file: string) => readFileSync(join(DIR, file), 'utf8')

/**
 * Static VALUE imports — `import x from 's'` — and deliberately not
 * `import type { … } from 's'`.
 *
 * The distinction is the whole point rather than a convenience: a type-only
 * import is erased by the compiler and emits no `require`/`import` at all, so
 * it cannot evaluate the module and cannot run its injection side effect. The
 * payment element needs Stripe's `Stripe` interface, which `/pure` does not
 * re-export, so it takes the type from the bare entry — which is safe, and
 * which a checker that only matched on the specifier string would wrongly
 * flag. Comments are stripped first so that the prose above (which names the
 * bare specifier repeatedly) is not mistaken for code.
 */
function staticValueImportSpecifiers(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '')
  return [
    ...withoutLineComments.matchAll(
      /^\s*import\s+(?!type\s)[^;]*?from\s*['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1])
}

describe('Stripe.js stays out of the eager graph', () => {
  it('loads Stripe through the entry that does NOT self-inject', () => {
    const source = read('storefront-payment-element.tsx')
    const specifiers = staticValueImportSpecifiers(source)
    // The bare specifier is the one with the module-scope injection in it.
    expect(specifiers).not.toContain('@stripe/stripe-js')
    expect(specifiers).toContain('@stripe/stripe-js/pure')
    // ...and taking the TYPE from the bare entry stays allowed, because
    // `import type` is erased and evaluates nothing. Pinned so a later tidy-up
    // that "consistently" rewrites it to a value import is caught above.
    expect(source).toMatch(
      /^import type \{[^}]*\} from '@stripe\/stripe-js'$/m,
    )
  })

  it.each(['cart.tsx', 'product-detail.tsx'])(
    '%s does not statically import the module it lazy-loads',
    (file) => {
      const source = read(file)
      // It still has to lazy-load it — otherwise this test passes by the
      // feature being deleted rather than by the boundary being honest.
      expect(source).toMatch(/import\(\s*'\.\/storefront-payment-element'\s*\)/)
      expect(staticValueImportSpecifiers(source)).not.toContain(
        './storefront-payment-element',
      )
    },
  )

  it('keeps the fallback in a module with no Stripe import of any kind', () => {
    const specifiers = staticValueImportSpecifiers(
      read('storefront-payment-element-fallback.tsx'),
    )
    expect(specifiers.filter((s) => s.startsWith('@stripe/'))).toEqual([])
  })
})
