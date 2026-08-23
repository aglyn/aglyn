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

/**
 * Named value imports taken from one module specifier, in source order.
 * Deliberately a source parse rather than an import of the component: this
 * file must keep working when the component does NOT compile, which is
 * precisely the state a bad dependency bump leaves it in.
 */
function namedImportsFrom(source: string, specifier: string): string[] {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(
    new RegExp(`^\\s*import\\s+\\{([^}]*)\\}\\s*from\\s*'${escaped}'`, 'm'),
  )
  if (!match) return []
  return match[1]
    .split(',')
    .map((part) => part.trim())
    // `a as b` imports the binding named `a`; the local alias is ours, the
    // export name is the package's, and it is the package's we are checking.
    .map((part) => part.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter(Boolean)
}

/**
 * The check whose absence let a breaking bump look green (AGL-2486).
 *
 * `storefront-payment-element.spec.tsx` mocks `@stripe/react-stripe-js` at
 * the module boundary with a hand-written double. A jest mock does not have
 * to resemble the module it replaces, so when `@stripe/react-stripe-js` v6
 * REMOVED `CheckoutProvider` and moved `useCheckout` behind a `/checkout`
 * subpath — changing its return type from the checkout value to a
 * `{type:'loading'|'success'|'error'}` union on the way — that suite went on
 * passing against a v3 shape the installed package no longer had. The build
 * was the only thing that failed, and it failed somewhere else.
 *
 * So this asserts the component's imports against the REAL installed package
 * rather than against a double. It is in this file, not in the component's
 * own spec, because this file mocks nothing: a `jest.mock` of `@stripe/*` in
 * scope would make `require` hand back the very fake we are trying to
 * distrust.
 *
 * It is a contract check, not a version pin — it says nothing about WHICH
 * version is installed, only that the symbols we import from it exist. An
 * upgrade that keeps them stays green; one that removes them turns this red
 * with the missing name in the failure message.
 */
describe('the Stripe imports we rely on exist in the installed package', () => {
  const REACT_STRIPE = '@stripe/react-stripe-js'

  it('exports every symbol the payment element imports from it', () => {
    const imported = namedImportsFrom(
      read('storefront-payment-element.tsx'),
      REACT_STRIPE,
    )

    // Fail on a silent no-op: if the parse stops finding the import (renamed
    // file, reformatted import, symbols moved to a subpath) an empty list
    // would sail through the loop below and prove nothing at all.
    expect(imported.length).toBeGreaterThan(0)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const real = require(REACT_STRIPE) as Record<string, unknown>
    const missing = imported.filter((name) => real[name] === undefined)

    expect({ missing, imported }).toEqual({ missing: [], imported })
  })

  it('is mocked in the component spec with symbols that really exist', () => {
    // The double and the real module must name the same things. Otherwise the
    // component spec is exercising an API that no longer ships, which is the
    // exact failure this pair of tests exists to make loud.
    const mocked = [
      ...read('storefront-payment-element.spec.tsx').matchAll(
        /jest\.mock\('@stripe\/react-stripe-js',[\s\S]*?\n\}\)\)/g,
      ),
    ]
      .flatMap((block) => [...block[0].matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)])
      .map((entry) => entry[1])

    expect(mocked.length).toBeGreaterThan(0)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const real = require(REACT_STRIPE) as Record<string, unknown>
    const fabricated = mocked.filter((name) => real[name] === undefined)

    expect({ fabricated, mocked }).toEqual({ fabricated: [], mocked })
  })
})
