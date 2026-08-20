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
 * AGL-1954 — the classifier that tells a handler which did nothing apart
 * from one which correctly did nothing.
 *
 * The three-way split is the substance of the issue. A binary check would
 * either miss the bug (gate on the status code) or fire on every ordinary
 * delivery (gate on "did it write"), and the second failure mode ends with
 * the alarm muted, which is worse than not having it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  classifyWebhookDelivery,
  CONNECT_SCOPE_METADATA_KEY,
  CONNECT_SCOPE_METADATA_VALUE,
  createWebhookEffectLedger,
  isConnectWebhookEndpoint,
  REQUIRED_CONNECT_WEBHOOK_EVENTS,
  REQUIRED_WEBHOOK_EVENTS,
  unsubscribedRequiredEvents,
} from './webhook-delivery'

function classify(input: {
  type?: string
  effects?: string[]
  skips?: string[]
  claimed?: boolean
}) {
  return classifyWebhookDelivery({
    type: input.type ?? 'invoice.paid',
    effects: input.effects ?? [],
    skips: input.skips ?? [],
    claimed: input.claimed ?? false,
  })
}

describe('createWebhookEffectLedger (AGL-1954)', () => {
  it('starts empty — a delivery has done nothing until it says so', () => {
    const ledger = createWebhookEffectLedger()
    expect(ledger.effects).toEqual([])
    expect(ledger.skips).toEqual([])
  })

  it('keeps effects and skips apart, in order', () => {
    const ledger = createWebhookEffectLedger()
    ledger.skip('no-org-metadata')
    ledger.effect('org-plan-mirrored')
    ledger.effect('platform-revenue-recorded')
    expect(ledger.effects).toEqual([
      'org-plan-mirrored',
      'platform-revenue-recorded',
    ])
    expect(ledger.skips).toEqual(['no-org-metadata'])
  })
})

describe('classifyWebhookDelivery (AGL-1954)', () => {
  it('acted: a committed effect', () => {
    expect(classify({ effects: ['platform-revenue-recorded'] })).toEqual({
      outcome: 'acted',
      reason: 'platform-revenue-recorded',
    })
  })

  it('acted: a plugin claimed it, even with no route-level effect', () => {
    // `checkout.session.completed` has NO branch on the route at all — the
    // marketplace and commerce plugins own it end to end.
    expect(
      classify({ type: 'checkout.session.completed', claimed: true }),
    ).toEqual({ outcome: 'acted', reason: 'plugin-claimed' })
  })

  it('acted: an effect OUTRANKS a skip in the same delivery', () => {
    // A delivery that wrote one thing and declined another did work. A
    // partially-skipped handler is not an idle one.
    expect(
      classify({ effects: ['orphan-recorded'], skips: ['no-matching-revenue-row'] })
        .outcome,
    ).toBe('acted')
  })

  it('ignored: a branch NAMED its reason', () => {
    // A tenant shopper's subscription carries no `metadata.orgId` and
    // correctly moves nothing on our side. This is the case whose
    // misclassification produces alert fatigue.
    expect(
      classify({
        type: 'customer.subscription.updated',
        skips: ['no-org-metadata'],
      }),
    ).toEqual({ outcome: 'ignored', reason: 'no-org-metadata' })
  })

  it('ignored: an event type we never subscribed to', () => {
    expect(classify({ type: 'payment_intent.succeeded' })).toEqual({
      outcome: 'ignored',
      reason: 'not-subscribed',
    })
  })

  it('INERT: a required event produced neither an effect nor a reason', () => {
    // The whole issue in one assertion. Nothing about the request
    // distinguishes this from the `acted` case above — same 200, same
    // Stripe delivery record, same idempotency claim.
    expect(classify({ type: 'charge.refunded' })).toEqual({
      outcome: 'inert',
      reason: 'no-effect',
    })
  })

  it('INERT on every required event, so no type is exempt by accident', () => {
    for (const type of REQUIRED_WEBHOOK_EVENTS) {
      expect(classify({ type }).outcome).toBe('inert')
    }
  })

  it('a skip is what separates inert from ignored, and nothing else does', () => {
    // Same event, same absence of writes; the only difference is whether a
    // branch could say why. That is deliberately the whole test.
    expect(classify({ type: 'charge.refunded' }).outcome).toBe('inert')
    expect(
      classify({ type: 'charge.refunded', skips: ['not-a-workspace-customer'] })
        .outcome,
    ).toBe('ignored')
  })

  it('honours an injected required list, so the rule is testable apart from the data', () => {
    expect(
      classifyWebhookDelivery({
        type: 'some.custom.event',
        effects: [],
        skips: [],
        claimed: false,
        required: ['some.custom.event'],
      }).outcome,
    ).toBe('inert')
    expect(
      classifyWebhookDelivery({
        type: 'some.custom.event',
        effects: [],
        skips: [],
        claimed: false,
        required: [],
      }).outcome,
    ).toBe('ignored')
  })
})

describe('unsubscribedRequiredEvents (AGL-1948 / AGL-1798)', () => {
  it('finds the required event a destination is missing', () => {
    const enabled = REQUIRED_WEBHOOK_EVENTS.filter(
      (event) => event !== 'charge.refunded',
    )
    expect(unsubscribedRequiredEvents(enabled)).toEqual(['charge.refunded'])
  })

  it('is empty when every required event is subscribed', () => {
    expect(unsubscribedRequiredEvents([...REQUIRED_WEBHOOK_EVENTS])).toEqual([])
  })

  it('accepts extra subscriptions without complaint', () => {
    expect(
      unsubscribedRequiredEvents([
        ...REQUIRED_WEBHOOK_EVENTS,
        'payment_intent.succeeded',
      ]),
    ).toEqual([])
  })

  it("treats Stripe's `*` wildcard as full coverage", () => {
    expect(unsubscribedRequiredEvents(['*'])).toEqual([])
  })

  it('reports nothing when the endpoint did not state its subscriptions', () => {
    // Distinguished from "subscribed to none" by the caller: null here means
    // unanswered, and `billingWebhookHealth` refuses to red on unanswered.
    expect(unsubscribedRequiredEvents(null)).toEqual([])
    expect(unsubscribedRequiredEvents(undefined)).toEqual([])
    expect(unsubscribedRequiredEvents([]).length).toBe(
      REQUIRED_WEBHOOK_EVENTS.length,
    )
  })

  it('sorts, so two readings of the same destination compare cleanly', () => {
    expect(unsubscribedRequiredEvents(['invoice.paid'])).toEqual(
      [...unsubscribedRequiredEvents(['invoice.paid'])].sort(),
    )
  })
})

/*==========================================
 * THE DRIFT GUARD.
 *
 * `REQUIRED_WEBHOOK_EVENTS` is a COPY of `WEBHOOK_EVENTS` in
 * `tools/scripts/lib/stripe-webhook-health.mjs`, because that file sits in
 * `tools/` and cannot be imported across the nx boundary from a lib. A copy
 * that nothing compares is a copy that drifts, and the drift here is
 * silent in the worst direction: an event added to the destination but not
 * to this list would be delivered, handled, and classified `ignored`
 * forever — the exact invisibility this module exists to end.
 *
 * Read as TEXT rather than imported, so no bundler, boundary rule or ESM
 * interop question stands between the two lists.
 *=========================================*/
describe('REQUIRED_WEBHOOK_EVENTS drift guard (AGL-1954)', () => {
  function repoRoot(): string {
    let dir = __dirname
    for (let hops = 0; hops < 12; hops += 1) {
      try {
        readFileSync(join(dir, 'nx.json'), 'utf8')
        return dir
      } catch {
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    }
    throw new Error('could not locate the workspace root from ' + __dirname)
  }

  function scriptEvents(): string[] {
    const source = readFileSync(
      join(repoRoot(), 'tools/scripts/lib/stripe-webhook-health.mjs'),
      'utf8',
    )
    const block = /export const WEBHOOK_EVENTS = \[([\s\S]*?)\n\]/.exec(source)
    if (!block) throw new Error('WEBHOOK_EVENTS not found in the script lib')
    return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  }

  it('the guard can actually read the script list', () => {
    // Fails LOUDLY if the regex stops matching — otherwise a rename would
    // turn this whole describe into a comparison of nothing with nothing.
    const events = scriptEvents()
    expect(events.length).toBeGreaterThan(5)
    expect(events).toContain('charge.refunded')
  })

  it('matches the list the destination is actually built from', () => {
    expect([...REQUIRED_WEBHOOK_EVENTS].sort()).toEqual(scriptEvents().sort())
  })

  it('has no duplicates', () => {
    expect(new Set(REQUIRED_WEBHOOK_EVENTS).size).toBe(
      REQUIRED_WEBHOOK_EVENTS.length,
    )
  })
})

/*==========================================
 * THE CONNECT MIRRORS (AGL-1948).
 *
 * Same copy-and-guard arrangement as the list above, and the same silent
 * drift risk in the worst direction: the Connect destination is identified
 * ONLY by this metadata stamp, because Stripe reports nothing about
 * `connect: true` when an endpoint is read back. If the key or value drifted
 * from the script that stamps it, the health probe would stop recognising a
 * destination that exists — and would then read it as the PLATFORM one,
 * since the two share a URL.
 *=========================================*/
describe('Connect mirrors drift guard (AGL-1948)', () => {
  function scriptSource(): string {
    let dir = __dirname
    for (let hops = 0; hops < 12; hops += 1) {
      try {
        readFileSync(join(dir, 'nx.json'), 'utf8')
        return readFileSync(
          join(dir, 'tools/scripts/lib/stripe-webhook-health.mjs'),
          'utf8',
        )
      } catch {
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    }
    throw new Error('could not locate the workspace root from ' + __dirname)
  }

  function scriptConst(name: string): string {
    const match = new RegExp(
      `export const ${name} =\\s*'([^']+)'`,
    ).exec(scriptSource())
    if (!match) throw new Error(name + ' not found in the script lib')
    return match[1]
  }

  it('the guard can actually read the script constants', () => {
    // Fails LOUDLY if a rename breaks the regex, rather than turning the
    // comparisons below into nothing-versus-nothing.
    expect(scriptConst('CONNECT_SCOPE_METADATA_KEY')).toBeTruthy()
    expect(scriptConst('CONNECT_SCOPE_METADATA_VALUE')).toBeTruthy()
  })

  it('the metadata stamp matches the one setup-stripe writes', () => {
    expect(CONNECT_SCOPE_METADATA_KEY).toBe(
      scriptConst('CONNECT_SCOPE_METADATA_KEY'),
    )
    expect(CONNECT_SCOPE_METADATA_VALUE).toBe(
      scriptConst('CONNECT_SCOPE_METADATA_VALUE'),
    )
  })

  it('the required Connect events match the script list', () => {
    const block = /export const CONNECT_WEBHOOK_EVENTS = \[([\s\S]*?)\n\]/.exec(
      scriptSource(),
    )
    if (!block) throw new Error('CONNECT_WEBHOOK_EVENTS not found')
    const events = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(events.length).toBeGreaterThan(0)
    expect([...REQUIRED_CONNECT_WEBHOOK_EVENTS].sort()).toEqual(events.sort())
  })
})

describe('isConnectWebhookEndpoint (AGL-1948)', () => {
  const stamped = {
    url: 'https://app.aglyn.com/api/billing/webhook',
    metadata: { [CONNECT_SCOPE_METADATA_KEY]: CONNECT_SCOPE_METADATA_VALUE },
  }
  const platform = {
    url: 'https://app.aglyn.com/api/billing/webhook',
    metadata: {},
  }

  it('separates the two destinations that share a URL', () => {
    // The whole point: an identical url on both, so nothing else can.
    expect(stamped.url).toBe(platform.url)
    expect(isConnectWebhookEndpoint(stamped)).toBe(true)
    expect(isConnectWebhookEndpoint(platform)).toBe(false)
  })

  it('does not guess from the subscribed events', () => {
    // Inferring the type from `enabled_events` would conclude the very thing
    // the audit is trying to verify.
    expect(
      isConnectWebhookEndpoint({ enabled_events: ['account.updated'] }),
    ).toBe(false)
  })

  it('treats a missing or malformed endpoint as not-Connect', () => {
    expect(isConnectWebhookEndpoint(undefined)).toBe(false)
    expect(isConnectWebhookEndpoint(null)).toBe(false)
    expect(isConnectWebhookEndpoint({})).toBe(false)
    expect(
      isConnectWebhookEndpoint({ metadata: { [CONNECT_SCOPE_METADATA_KEY]: 'other' } }),
    ).toBe(false)
  })
})

describe('unsubscribedRequiredEvents against the Connect list (AGL-1948)', () => {
  it('reports account.updated missing from a bare destination', () => {
    expect(
      unsubscribedRequiredEvents([], REQUIRED_CONNECT_WEBHOOK_EVENTS),
    ).toEqual(['account.updated'])
  })

  it('is satisfied by the event itself, and by the wildcard', () => {
    expect(
      unsubscribedRequiredEvents(['account.updated'], REQUIRED_CONNECT_WEBHOOK_EVENTS),
    ).toEqual([])
    expect(
      unsubscribedRequiredEvents(['*'], REQUIRED_CONNECT_WEBHOOK_EVENTS),
    ).toEqual([])
  })

  it('does NOT accept the platform subscription list as Connect coverage', () => {
    // The two destinations share a URL; if this ever passed, a Connect
    // destination could be declared covered by the platform's ten events.
    expect(
      unsubscribedRequiredEvents(
        [...REQUIRED_WEBHOOK_EVENTS],
        REQUIRED_CONNECT_WEBHOOK_EVENTS,
      ),
    ).toEqual(['account.updated'])
  })
})
