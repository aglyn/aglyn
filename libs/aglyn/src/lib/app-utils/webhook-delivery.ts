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
 * DID THE WEBHOOK ACTUALLY DO ANYTHING? (AGL-1954)
 *
 * Every signal we have about the billing webhook is a signal about the
 * REQUEST. Stripe records `delivery_success` off the status code. The
 * idempotency claim in `stripeEvents` records that the signature verified and
 * the handler was entered. `/api/health/billing` (AGL-1924) counts what
 * Stripe attempted and failed to deliver. All three read green for the one
 * failure this module exists to catch: **a handler that answers 200 and moves
 * nothing.**
 *
 * That is not hypothetical here. AGL-1798 is exactly it — `charge.refunded`
 * was never subscribed on the live destination, so AGL-1546's entitlement
 * revocation had no trigger, and every other indicator looked fine for as
 * long as it lasted. AGL-1551 is the same class from the other side: a week
 * of 100% rejected deliveries behind a green "Active" badge.
 *
 * ## The honest signal is an EFFECT, not a return code
 *
 * A check that asserts "the handler ran" is nearly as blind as the 200 —
 * the handler DID run in the AGL-1798 shape, it just had no work registered
 * for the event. So the route reports what it COMMITTED: an org's plan
 * mirrored, a `platformRevenue` row written, a refund stamped, an orphan
 * recorded, an audit row appended, a plugin claiming the event. Those are the
 * things whose absence is the bug.
 *
 * ## Three outcomes, and conflating the middle two is its own failure
 *
 * A binary "did it write something" would fire on every legitimately
 * irrelevant delivery — a tenant shopper's subscription carries no
 * `metadata.orgId` and correctly moves nothing on OUR side; a marketplace
 * refund resolves to no workspace customer and is correctly left to the
 * plugins; a `won` dispute nobody claimed reversed no money and correctly
 * wakes nobody. Alerting on those is alert fatigue, which ends with the alarm
 * muted and the real one lost inside it.
 *
 * So a branch that decides an event is not its business must SAY SO, by
 * name, through {@link WebhookEffectLedger.skip}. That is what separates:
 *
 * | outcome   | meaning                                            | alarm |
 * |-----------|----------------------------------------------------|-------|
 * | `acted`   | something durable committed, or a plugin claimed it | no    |
 * | `ignored` | a branch named a reason, or we never asked for this event type | no |
 * | `inert`   | an event we deliberately subscribe to produced NEITHER | YES  |
 *
 * `inert` is the whole point. Falling off the end of the dispatch with no
 * effect and no stated reason is precisely what a deleted write, an
 * unregistered plugin handler, or a renamed event type looks like from
 * inside the process — and it is the only one of the three that nothing else
 * in this system can see.
 *
 * ## Why the "did we ask for it" test is the required-events list
 *
 * Stripe delivers what the destination is subscribed to, and the destination
 * is created by `tools/scripts/setup-stripe.mjs` from `WEBHOOK_EVENTS`. An
 * event type outside that list reaching us is either a hand-added
 * subscription or a Connect delivery arriving at the platform destination —
 * unremarkable, and never our silent-drop bug, because we never claimed to
 * handle it. An event type INSIDE it is one we went out of our way to ask
 * Stripe for, so producing nothing from it is a contradiction by
 * construction.
 *
 * `REQUIRED_WEBHOOK_EVENTS` below is a copy of that list, and a copy is a
 * drift hazard — so `webhook-delivery.spec.ts` reads the `.mjs` and fails on
 * any divergence, in either direction. The alternative (moving the list
 * across the nx boundary out of `tools/`) is a wider change than this
 * warrants and is tracked on AGL-1948.
 *
 * Pure: no clock, no I/O, no Firestore. The route records, this decides, the
 * spec exercises every branch without a network.
 */

/** What a single delivery turned out to be. */
export type WebhookDeliveryOutcome = 'acted' | 'ignored' | 'inert'

/**
 * The event types the platform destination is subscribed to, mirroring
 * `WEBHOOK_EVENTS` in `tools/scripts/lib/stripe-webhook-health.mjs`.
 *
 * The list is the definition of "we asked for this", which is what makes a
 * no-op delivery of one of them a defect rather than a non-event. Kept in
 * the same order as the source so a diff between the two reads cleanly.
 */
export const REQUIRED_WEBHOOK_EVENTS: readonly string[] = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'checkout.session.completed',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
]

/**
 * How the CONNECT destination identifies itself (AGL-1948), mirroring
 * `CONNECT_SCOPE_METADATA_KEY` / `CONNECT_SCOPE_METADATA_VALUE` in
 * `tools/scripts/lib/stripe-webhook-health.mjs`.
 *
 * Connected-account events are delivered only to a destination created with
 * `connect: true`, and Stripe's API does not report that flag back on the
 * endpoint object — so the destination is identified by metadata we set at
 * creation instead. Same copy-and-guard arrangement as the list above.
 */
export const CONNECT_SCOPE_METADATA_KEY = 'aglyn_scope'
export const CONNECT_SCOPE_METADATA_VALUE = 'connect'

/**
 * What the Connect destination must carry, mirroring
 * `CONNECT_WEBHOOK_EVENTS` in the same script lib.
 *
 * `account.updated` is the whole point of it: AGL-1997's `syncConnectAccountStatus`
 * is what stops a merchant whose Stripe account was later restricted from
 * going on selling against a stale `stripeChargesEnabled`, with the SHOPPER
 * meeting the failure at payment time. Without this event the handler cannot
 * run — which is exactly the state AGL-2122 found and fixed.
 */
export const REQUIRED_CONNECT_WEBHOOK_EVENTS: readonly string[] = ['account.updated']

/**
 * Does this Stripe endpoint object carry our Connect scope marker?
 *
 * Coverage for it reuses `unsubscribedRequiredEvents` with
 * `REQUIRED_CONNECT_WEBHOOK_EVENTS` as the `required` argument — the wildcard
 * and null handling are identical questions, and a second copy of that logic
 * is a second place for it to drift.
 */
export function isConnectWebhookEndpoint(endpoint: unknown): boolean {
  const metadata = (endpoint as { metadata?: Record<string, unknown> })?.metadata
  return metadata?.[CONNECT_SCOPE_METADATA_KEY] === CONNECT_SCOPE_METADATA_VALUE
}

/**
 * A per-delivery record of what actually committed.
 *
 * Deliberately append-only and stringly-typed: the reasons are read by a
 * human in a log line and by a spec, never switched on. Keeping it dumb is
 * what stops it growing into a second dispatch table that can disagree with
 * the real one.
 */
export interface WebhookEffectLedger {
  /** Durable things this delivery committed, in the order they landed. */
  readonly effects: readonly string[]
  /** Reasons a branch decided the event was none of its business. */
  readonly skips: readonly string[]
  /**
   * Record a committed effect. Call this AFTER the write it names, so a
   * throw between the two cannot claim an effect that never landed.
   */
  effect(name: string): void
  /**
   * Record a deliberate no-op and why. This is the difference between "not
   * ours" and "broken", and it is the half that prevents alert fatigue.
   */
  skip(reason: string): void
}

export function createWebhookEffectLedger(): WebhookEffectLedger {
  const effects: string[] = []
  const skips: string[] = []
  return {
    effects,
    skips,
    effect(name: string) {
      effects.push(name)
    },
    skip(reason: string) {
      skips.push(reason)
    },
  }
}

/** Firestore methods that MUTATE. Everything else is a read or a builder. */
const WRITE_METHODS = new Set(['set', 'update', 'create', 'delete', 'add'])

/**
 * Wrap a Firestore handle so every write it commits lands in the ledger.
 *
 * ## Why this exists rather than a `ledger.effect()` beside each write
 *
 * A hand-placed note next to a write is a check that CANNOT FAIL in the one
 * way that matters. Delete the write and leave the note, and the ledger
 * cheerfully reports an effect that never happened — which is the same
 * "asserts its own literals" defect the health probes are written to avoid.
 * The note has to be caused by the write, not merely adjacent to it.
 *
 * So the effect is recorded from INSIDE the call, after it resolves. A write
 * that throws records nothing (it did not commit); a write that is deleted
 * from the source records nothing (it is not called). There is no edit to
 * the handler that removes the work and keeps the signal.
 *
 * ## What it deliberately does not see
 *
 * Writes issued through a DIFFERENT Firestore handle — the shared
 * `tenant-data-admin` writers (`writeOrgBilling`, `notifyOrgAdmins`,
 * `notifyStaff`), which each open their own — and anything a plugin does
 * inside its own handler. Those are noted explicitly by the caller where
 * they are the only consequence of a branch, and the comments at those call
 * sites say so. The boundary is stated rather than hidden: this covers the
 * route's own writes, which is where the route's own bugs live.
 *
 * A Proxy rather than a hand-written facade because the wrapped object is
 * passed on to `updateExisting` and friends, which call methods this module
 * has never heard of. A facade would have to enumerate them and would
 * silently drop the ones it forgot.
 */
export function observeWrites<T extends object>(
  handle: T,
  ledger: WebhookEffectLedger,
  label = 'firestore',
): T {
  return new Proxy(handle, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value
      }
      const method = property
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(
          target,
          args,
        )
        // `collection('orgs')` names the thing being written, so the ledger
        // reads `orgs.update` rather than `firestore.update`. Everything
        // else inherits the label it was reached through.
        const nextLabel =
          method === 'collection' && typeof args[0] === 'string'
            ? (args[0] as string)
            : label
        if (WRITE_METHODS.has(method)) {
          // Recorded on RESOLUTION. A rejected write committed nothing and
          // must not read as an effect.
          return Promise.resolve(result).then((settled) => {
            ledger.effect(`${nextLabel}.${method}`)
            return settled
          })
        }
        // Builders (`collection`, `doc`, `where`, `limit`) return objects
        // that can themselves be written through, so the wrapper follows
        // them. Thenables are returned bare: wrapping a promise would make
        // `then` look like a builder and recurse forever.
        if (
          result &&
          typeof result === 'object' &&
          typeof (result as { then?: unknown }).then !== 'function'
        ) {
          return observeWrites(result as object, ledger, nextLabel)
        }
        return result
      }
    },
  })
}

export interface WebhookDeliveryVerdict {
  outcome: WebhookDeliveryOutcome
  /** One short phrase naming WHY, for the log line and the spec. */
  reason: string
}

/**
 * Classify one delivery.
 *
 * Order is the argument:
 *
 * 1. **Any effect, or any plugin claim, wins.** A delivery that both wrote
 *    something and skipped something else did work; a partially-skipped
 *    handler is not an idle one.
 * 2. **A named skip is an answer.** Reaching a branch that consciously
 *    decided "not ours" is a handled event, not a dropped one.
 * 3. **An event type we never subscribed to is not our problem.** Nothing
 *    promised to handle it.
 * 4. **Everything else is inert** — and by elimination that means: we asked
 *    Stripe for this event, we received it, no handler claimed it, no branch
 *    wrote anything, and no branch could say why.
 */
export function classifyWebhookDelivery(input: {
  type: string
  effects: readonly string[]
  skips: readonly string[]
  claimed: boolean
  /** Overridable so the spec can prove the rule rather than the list. */
  required?: readonly string[]
}): WebhookDeliveryVerdict {
  const { type, effects, skips, claimed } = input
  const required = input.required ?? REQUIRED_WEBHOOK_EVENTS
  if (effects.length > 0) return { outcome: 'acted', reason: effects[0] }
  if (claimed) return { outcome: 'acted', reason: 'plugin-claimed' }
  if (skips.length > 0) return { outcome: 'ignored', reason: skips[0] }
  if (!required.includes(type)) {
    return { outcome: 'ignored', reason: 'not-subscribed' }
  }
  return { outcome: 'inert', reason: 'no-effect' }
}

/**
 * Which required events is a destination NOT subscribed to? (AGL-1948)
 *
 * The same blind spot from the configuration side, and the cheaper half of
 * it: a subscription removed by hand in the Stripe dashboard produces no
 * failed delivery, no rejected request and no inert one either — Stripe
 * simply stops sending, and every count on the health probe reads a
 * perfectly healthy zero. `charge.refunded` was missing from the live
 * endpoint for exactly this reason (AGL-1798) and the only thing that ever
 * noticed was a script nobody ran.
 *
 * `['*']` is Stripe's wildcard subscription and covers everything.
 *
 * Returns the names, sorted, so the probe body is stable and a diff between
 * two readings is meaningful.
 */
export function unsubscribedRequiredEvents(
  enabledEvents: readonly string[] | null | undefined,
  required: readonly string[] = REQUIRED_WEBHOOK_EVENTS,
): string[] {
  if (!enabledEvents) return []
  if (enabledEvents.includes('*')) return []
  const enabled = new Set(enabledEvents)
  return required.filter((event) => !enabled.has(event)).sort()
}
