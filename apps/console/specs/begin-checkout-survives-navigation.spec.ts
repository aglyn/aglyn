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
 * AGL-1580 — both `begin_checkout` emitters exist, and neither one races the
 * navigation that follows it.
 *
 * ## Why a source assertion and not a behavioural test
 *
 * Two separate gaps, and only one of them is about behaviour.
 *
 * The delivery CONTRACT — that `trackEventBeforeNavigation` waits for an async
 * transport, gives up after a bounded timeout, and never rejects — is asserted
 * properly, with fakes and timers, in
 * `libs/aglyn/src/lib/app-utils/analytics-events.spec.ts`. That is where the
 * logic lives and that is where it is exercised.
 *
 * What no test could see is whether the two call sites still CALL it. Before
 * this file, deleting either `begin_checkout` emit outright produced zero test
 * reds: the emitters live inside long async click handlers in a Next.js page
 * and a plugin component, behind an authenticated org, a plan selection, a
 * network round trip and a Stripe session — and the event is fire-and-forget,
 * so nothing downstream observes it. Standing that up as a behavioural test
 * would mean mounting the whole billing page against a faked checkout route to
 * assert one analytics call, which is a large amount of machinery pointed at a
 * single line and would rot faster than the line it guards.
 *
 * So this pins the two lines directly. It is a weaker kind of test and it is
 * chosen deliberately: a grep that reddens is worth more than a perfect test
 * that does not exist. Ads are live, and GA4 key-event marking is NOT
 * retroactive — every `begin_checkout` lost before the event is first seen and
 * starred is conversion data that cannot be recovered later.
 *
 * ## What each assertion is defending
 *
 * The bug was measured, not guessed. gtag.js already flushes its queue on
 * pagehide through `fetch(..., { keepalive: true })`, so a hit that REACHES
 * gtag survives the navigation. What is lost is the hit that never gets there:
 * Firebase's `logEvent` awaits the SDK's initialization promise first, and
 * while that promise is pending the continuation is scheduled behind the
 * navigation and never runs. Hence: the emit must exist, and it must be
 * awaited before `window.location.assign`.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** The two surfaces that start a checkout and then navigate away. */
const EMITTERS = [
  {
    file: 'apps/console/app/(app)/[orgSlug]/billing/(sections)/page.tsx',
    what: 'the console plan subscribe (no navigation at all)',
    emits: 1,
    // The un-awaitable spelling is now the CORRECT one here. Subscribing is a
    // server-side call against a stored payment method — the console never
    // hands the browser to Stripe, so there is no navigation for the hit to
    // lose a race against. `navigates: false` is what makes that a rule rather
    // than an omission: the two navigation assertions invert for this file.
    bare: 1,
    navigates: false,
  },
  {
    file: 'libs/plugins/commerce/src/lib/components/cart.tsx',
    what: 'the tenant storefront cart checkout',
    // Two: the native in-page branch and the hosted redirect. The funnel is
    // reported on BOTH paths deliberately (AGL-1944) so flipping the flag
    // cannot look like a conversion collapse.
    emits: 2,
    // The native branch renders a form in place and never navigates, so a
    // plain fire-and-forget emit is correct there. Exactly one, though — if
    // this becomes two, the redirect branch has been downgraded back into the
    // race, and every other assertion here would still pass.
    bare: 1,
    navigates: true,
  },
] as const

/** Comments discuss all of this at length; only CODE is asserted on. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function read(file: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
}

describe('begin_checkout survives the checkout navigation (AGL-1580)', () => {
  describe.each(EMITTERS)('$what', ({ file, emits, bare, navigates }) => {
    it('still emits begin_checkout, exactly as many times as it should', () => {
      // The bare regression guard: deleting an emit used to be entirely
      // silent. Counted rather than merely present, so losing ONE of the
      // cart's two branches reddens too.
      const found = read(file).match(/'begin_checkout'/g) ?? []
      expect(found).toHaveLength(emits)
    })

    it('emits through the delivery helper its navigation demands', () => {
      if (!navigates) {
        // Nothing navigates on this path, so the navigation-safe helper would
        // be borrowed machinery: it exists to hold a redirect open until the
        // hit lands, and there is no redirect. Asserted as an ABSENCE so a
        // future edit cannot quietly reintroduce one and keep this green.
        expect(read(file)).not.toMatch(
          /trackEventBeforeNavigation\(\s*'begin_checkout'/,
        )
        return
      }
      expect(read(file)).toMatch(
        /trackEventBeforeNavigation\(\s*'begin_checkout'/,
      )
    })

    it('uses the fire-and-forget spelling only where nothing navigates', () => {
      // `trackEvent` is legitimate on these files for other events, and on a
      // branch that renders in place. What is counted is the un-awaitable
      // spelling of THIS event specifically.
      const found = read(file).match(/(?<!e)trackEvent\(\s*'begin_checkout'/g)
      expect(found ?? []).toHaveLength(bare)
    })

    it('waits for the hit before handing the browser to Stripe', () => {
      const source = read(file)
      if (!navigates) {
        // The stronger statement: the browser is never handed to Stripe on
        // this path at all. A `window.location.assign` reappearing next to
        // this emit would mean the checkout redirect came back.
        const emit = source.search(/trackEvent\(\s*'begin_checkout'/)
        expect(emit).toBeGreaterThan(-1)
        expect(source.indexOf('window.location.assign', emit)).toBe(-1)
        return
      }

      // Anchored on the EMIT, not on the first `window.location.assign` in the
      // file — the console page has an unrelated earlier redirect, and
      // anchoring on that made this pass for the wrong reason.
      const emit = source.search(/trackEventBeforeNavigation\(\s*'begin_checkout'/)
      expect(emit).toBeGreaterThan(-1)

      const assign = source.indexOf('window.location.assign', emit)
      expect(assign).toBeGreaterThan(emit)

      // An `await` must stand between the two. The window starts slightly
      // BEFORE the emit because the two files spell it differently — the cart
      // awaits the call inline, the console holds the promise across the
      // intervening refusal branches and awaits it at the redirect. What is
      // pinned is that the navigation cannot outrun the hit, not one spelling.
      const window_ = source.slice(Math.max(0, emit - 40), assign)
      expect(window_).toMatch(
        /await\s+(trackEventBeforeNavigation\(|beginCheckoutFlush)/,
      )
    })
  })

  it('the delivery helper is exported from the shared taxonomy', () => {
    // Guards the inverse mistake: renaming or dropping the helper and leaving
    // the call sites matching a string that no longer means anything.
    const taxonomy = read('libs/aglyn/src/lib/app-utils/analytics-events.ts')
    expect(taxonomy).toMatch(/export async function trackEventBeforeNavigation\b/)
  })

  it('the console transport returns its promise, or the await is a no-op', () => {
    // The load-bearing half of the fix on the console side. If this transport
    // goes back to discarding `logEvent`'s promise, `trackEventBeforeNavigation`
    // resolves immediately, every assertion above still passes, and the event
    // silently starts racing the navigation again.
    const layout = read('apps/console/components/layouts/firebase-app.layout.tsx')
    expect(layout).toMatch(/return\s*\(?\s*\n?\s*logEvent as/)
  })
})
