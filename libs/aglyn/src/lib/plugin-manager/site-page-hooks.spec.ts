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
 * `runSitePageEnrichers` runs its enrichers CONCURRENTLY (2026-08-26), and
 * these are the three properties that change made load-bearing.
 *
 * It used to be a sequential `for … await`. Production timing put the phase at
 * a flat ~85–120 ms on every render — including pages whose whole loader was
 * 137 ms — because it is a fixed number of round trips that share nothing.
 * Concurrency is worth having, but it silently rewrites two guarantees the
 * sequential loop gave for free, so both are pinned here rather than assumed:
 *
 * 1. **Merge order.** Two enrichers writing the same key must resolve in
 *    REGISTRATION order, not completion order — otherwise which plugin wins a
 *    collision depends on which Firestore read happens to return first, and
 *    the page changes between renders for no reason anyone can see.
 * 2. **Error isolation.** A broken plugin drops its slice and the page
 *    survives. That is what the plugin docs promise, and under `Promise.all`
 *    one rejection would have taken the whole enrichment down.
 * 3. **Actual concurrency**, asserted against the wall clock — a regression to
 *    sequential awaits would still pass 1 and 2 while quietly restoring the
 *    cost this change removed.
 *
 * `enrichers` is module-private with no reset seam, so each case registers its
 * own and asserts on ITS OWN keys. Registrations from earlier cases stay in the
 * array; nothing here reads a total count.
 */
import {
  registerSitePageEnricher,
  runSitePageEnrichers,
  type SitePageContext,
} from './site-page-hooks'

const context = {} as SitePageContext

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runSitePageEnrichers (AGL-1152 — concurrent)', () => {
  it('merges in REGISTRATION order, not completion order', async () => {
    // The slow one is registered FIRST and the fast one second, so completion
    // order is the reverse of registration order. Sequential code cannot tell
    // the difference; concurrent code that merges as results land gets it
    // backwards, which is exactly the bug being guarded.
    registerSitePageEnricher(async () => {
      await sleep(40)
      return { collidingKey: 'first-registered', slowOnly: true }
    })
    registerSitePageEnricher(async () => {
      await sleep(1)
      return { collidingKey: 'second-registered' }
    })

    const { props } = await runSitePageEnrichers(context)

    // Later registration wins the collision, as it did when the loop was
    // sequential and `Object.assign` ran in array order.
    expect(props['collidingKey']).toBe('second-registered')
    expect(props['slowOnly']).toBe(true)
  })

  it('isolates a throwing enricher — its slice drops, the rest survive', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerSitePageEnricher(async () => {
      throw new Error('plugin exploded')
    })
    registerSitePageEnricher(async () => ({ survivorKey: 'present' }))

    const { props } = await runSitePageEnrichers(context)

    expect(props['survivorKey']).toBe('present')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('THE REGRESSION GUARD: enrichers overlap rather than queue', async () => {
    // Three 60ms enrichers. Sequential is >=180ms; concurrent is ~60ms. The
    // 150ms ceiling is comfortably between the two and well clear of CI jitter
    // in both directions.
    for (let i = 0; i < 3; i += 1) {
      registerSitePageEnricher(async () => {
        await sleep(60)
        return { [`overlap${i}`]: true }
      })
    }

    const startedAt = Date.now()
    const { props } = await runSitePageEnrichers(context)
    const elapsed = Date.now() - startedAt

    expect(props['overlap0']).toBe(true)
    expect(props['overlap2']).toBe(true)
    expect(elapsed).toBeLessThan(150)
  })
})
