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
 * The dispatch's claim fold (AGL-2429).
 *
 * The console's billing webhook decides whether to raise a staff alert for a
 * chargeback from one bit: did ANY plugin recognise this event? Before that
 * bit existed the route could not tell a storefront chargeback the commerce
 * plugin handled from a dispute nothing in the platform handles at all, and
 * answered 200 in silence to both — so real money moved with no ledger entry
 * and no alert, and it looked exactly like the routine case.
 *
 * The bit is therefore load-bearing, and the three ways it can be wrong all
 * have direct money consequences:
 *
 *   - stuck FALSE  → every storefront chargeback wakes staff; the alert is
 *                    muted within a week and the real one is never seen.
 *   - stuck TRUE   → nothing is ever unattributed and the branch this exists
 *                    for can never fire. The failure is silent, which is the
 *                    original bug wearing a new hat.
 *   - short-circuit → a handler after the claiming one never runs, turning a
 *                    reporting signal into a dispatch rule and dropping side
 *                    effects on a money path.
 *
 * `registerBillingWebhookHandler` appends to module state with no unregister,
 * so every case resets modules and re-imports.
 */

type Hooks = typeof import('./billing-webhook-hooks')

function freshHooks(): Hooks {
  jest.resetModules()
  return require('./billing-webhook-hooks')
}

const EVENT = {
  type: 'charge.dispute.closed',
  object: { id: 'dp_1' },
  event: { id: 'evt_1' },
}

describe('runBillingWebhookHandlers claim fold (AGL-2429)', () => {
  it('reports no claim when every handler stays silent', () => {
    const { registerBillingWebhookHandler, runBillingWebhookHandlers } =
      freshHooks()
    registerBillingWebhookHandler(async () => undefined)
    // A handler that returns nothing at all — the shape every handler had
    // before this change, and the one the contract must keep meaning
    // "not mine".
    registerBillingWebhookHandler(() => {
      /* no return */
    })
    return expect(runBillingWebhookHandlers(EVENT)).resolves.toEqual({
      claimed: false,
    })
  })

  it('reports a claim when ANY handler claims, whatever its position', async () => {
    for (const claimingIndex of [0, 1, 2]) {
      const { registerBillingWebhookHandler, runBillingWebhookHandlers } =
        freshHooks()
      for (const index of [0, 1, 2]) {
        registerBillingWebhookHandler(async () =>
          index === claimingIndex ? { claimed: true } : undefined,
        )
      }
      await expect(runBillingWebhookHandlers(EVENT)).resolves.toEqual({
        claimed: true,
      })
    }
  })

  it('runs EVERY handler even after one has claimed', async () => {
    const { registerBillingWebhookHandler, runBillingWebhookHandlers } =
      freshHooks()
    const ran: string[] = []
    registerBillingWebhookHandler(async () => {
      ran.push('first')
      return { claimed: true }
    })
    registerBillingWebhookHandler(async () => {
      ran.push('second')
    })

    await runBillingWebhookHandlers(EVENT)

    // Two plugins may legitimately care about the same event. Stopping at the
    // first claim would silently drop the second's side effects — an order
    // stamp, a ledger row — which on this route is money.
    expect(ran).toEqual(['first', 'second'])
  })

  it('treats only an explicit `claimed: true` as a claim', async () => {
    const { registerBillingWebhookHandler, runBillingWebhookHandlers } =
      freshHooks()
    // `{ claimed: false }` and a bare object are both "I ran, it was not
    // mine". Truthiness on the object rather than the field would read both
    // as claims and silence the alert for every dispute in the system.
    registerBillingWebhookHandler(async () => ({ claimed: false }))
    registerBillingWebhookHandler(async () => ({}))

    await expect(runBillingWebhookHandlers(EVENT)).resolves.toEqual({
      claimed: false,
    })
  })

  it('still lets the first throw propagate', async () => {
    const { registerBillingWebhookHandler, runBillingWebhookHandlers } =
      freshHooks()
    const ran: string[] = []
    registerBillingWebhookHandler(async () => {
      throw new Error('handler exploded')
    })
    registerBillingWebhookHandler(async () => {
      ran.push('second')
    })

    // Unchanged by the claim fold, and asserted here because collecting
    // results is exactly the kind of change that quietly turns a throw into a
    // swallowed result: a 500 is what makes Stripe redeliver.
    await expect(runBillingWebhookHandlers(EVENT)).rejects.toThrow(
      'handler exploded',
    )
    expect(ran).toEqual([])
  })
})
