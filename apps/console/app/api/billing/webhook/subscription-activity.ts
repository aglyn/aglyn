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
 * WHICH SUBSCRIPTION EVENTS REACH THE WORKSPACE ACTIVITY LOG, AND WHOSE NAME
 * GOES ON THEM (AGL-118).
 *
 * ── WHY THE WEBHOOK AND NOT THE CONSOLE ROUTE ─────────────────────────────
 *
 * /api/billing/subscription and /api/billing/checkout are deliberately silent.
 *
 *  1. The webhook reports what HAPPENED; the console route reports what was
 *     ATTEMPTED. A plan change Stripe declines, or that fails SCA at the
 *     issuer, is a console action with no billing consequence — and a log
 *     that records the attempt as the event is wrong in precisely the cases
 *     somebody is reading it to understand.
 *  2. It covers events with NO console action at all: dunning cancellations,
 *     Stripe-side retries, disputes, a portal cancel, a dashboard edit. With
 *     the console as writer those are invisible, which is the same hole this
 *     whole issue closed everywhere else.
 *  3. One writer, so there is no de-duplication problem to solve.
 *
 * ── THE COST, AND HOW IT IS PAID ──────────────────────────────────────────
 *
 * The webhook has no session and no idea who a person is. So the acting uid
 * travels in Stripe METADATA on the call the console makes, and is read back
 * off the event here.
 *
 * That alone is not enough, and the reason is the whole design of this file.
 * Stripe metadata PERSISTS: a uid stamped at checkout is still on the
 * subscription a year later when dunning finally cancels it. Reading a bare
 * `actorUid` would therefore put a real person's name on a cancellation
 * nobody performed — which is the org-owner inference this issue rejected,
 * wearing a different hat and looking like evidence.
 *
 * So the stamp is a PAIR. `actorAction` names the console act the uid
 * authorized, and a stamp signs only the kind of event that act can produce:
 *
 *   subscribe  -> started        (checkout)
 *   switch     -> plan-changed   (an immediate upgrade or downgrade)
 *   downgrade  -> plan-changed   (a scheduled downgrade, at the phase flip)
 *   cancel     -> canceled       (cancel at period end, weeks earlier)
 *
 * `resume` signs NOTHING, and its absence is the point: clearing a pending
 * cancellation produces no event this log records, and a resume stamp left on
 * the subscription must not go on to sign the next thing that happens to it.
 *
 * A stale stamp can then only ever sign the kind of event it was written for,
 * and every console act re-stamps, so the pair on the object always describes
 * the most recent thing a person did to it.
 *
 * ── AND A SECOND, INDEPENDENT REFUSAL ─────────────────────────────────────
 *
 * A cancellation Stripe decided on is unattributable no matter what metadata
 * says. `cancellation_details.reason` is Stripe's own statement about who
 * ended it, and anything other than `cancellation_requested` — dunning
 * exhaustion, a lost dispute, an unknown — drops the actor here even if a
 * `cancel` stamp happens to be sitting on the object. The two rules overlap
 * on purpose: either one alone keeps a dunning cancellation anonymous, and
 * the failure that would put a name on one has to defeat both.
 */

/** The console acts that may sign an event, and the one kind each may sign. */
const SIGNS: Record<string, SubscriptionEventKind> = {
  subscribe: 'started',
  switch: 'plan-changed',
  downgrade: 'plan-changed',
  cancel: 'canceled',
}

/** Stripe's word for a cancellation a PERSON asked for. */
const REQUESTED = 'cancellation_requested'

export type SubscriptionEventKind = 'started' | 'plan-changed' | 'canceled'

export interface SubscriptionActivityInput {
  /** True on `customer.subscription.deleted`. */
  canceled: boolean
  /** `org.plan` as it read BEFORE this event's mirror landed. */
  previousPlan: string
  /** The plan the mirror just wrote — `'free'` on a cancellation. */
  plan: string
  /** `cancellation_details.reason`, verbatim, or null when absent. */
  cancellationReason: string | null
  /** The subscription's `metadata`, as delivered. */
  metadata: Record<string, unknown> | null | undefined
}

export interface SubscriptionActivityEntry {
  kind: SubscriptionEventKind
  action: string
  /** The uid to attribute, or null when nobody may honestly be named. */
  actorUid: string | null
  /** The plan the entry is ABOUT — the one left, on a cancellation. */
  plan: string
}

/**
 * The entry a subscription event earns, or `null` when it earns none.
 *
 * Null is the common answer and has to be: Stripe re-delivers
 * `customer.subscription.updated` for renewals, metered usage, payment-method
 * changes and its own retries, and every one of those would otherwise put a
 * row in a customer's feed saying their plan changed when it did not. A plan
 * TRANSITION is the signal, which is the same thing the cache fan-out beside
 * this already keys on.
 */
export function subscriptionActivityEntry(
  input: SubscriptionActivityInput,
): SubscriptionActivityEntry | null {
  const { canceled, previousPlan, plan, cancellationReason, metadata } = input
  const previous = String(previousPlan || 'free')
  const next = String(plan || 'free')

  const kind: SubscriptionEventKind | null = canceled
    ? 'canceled'
    : previous === next
      ? null
      : previous === 'free'
        ? 'started'
        : 'plan-changed'
  if (!kind) return null

  const stampedAction = String(metadata?.['actorAction'] ?? '')
  const stampedUid = String(metadata?.['actorUid'] ?? '')
  // RULE ONE: the stamp signs only its own kind of event.
  const signed = SIGNS[stampedAction] === kind
  // RULE TWO: a cancellation Stripe decided on has no actor, whatever is
  // stamped. `null` is included — an event carrying no reason at all is not
  // evidence that a person asked.
  const stripeEndedIt = kind === 'canceled' && cancellationReason !== REQUESTED
  const actorUid = signed && stampedUid && !stripeEndedIt ? stampedUid : null

  if (kind === 'canceled') {
    return {
      kind,
      // The three cancellations read differently on purpose. Until AGL-1877
      // a workspace Stripe gave up on and one that clicked Cancel were the
      // same row, and the feed is the surface where that distinction is read.
      action:
        cancellationReason === 'payment_failed'
          ? 'Subscription canceled after failed payments'
          : cancellationReason === REQUESTED
            ? 'Canceled the subscription'
            : 'Subscription canceled',
      actorUid,
      // The plan being LEFT. `next` is `'free'` on every cancellation, so
      // naming it would make each of these entries say the same nothing.
      plan: previous,
    }
  }
  return {
    kind,
    action:
      kind === 'started'
        ? `Started the ${next} subscription`
        : `Changed the plan from ${previous} to ${next}`,
    actorUid,
    plan: next,
  }
}
