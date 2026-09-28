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
 * Staff cancellation of a workspace's Stripe subscriptions (AGL-3359), shared
 * by `/api/admin/billing/cancel-subscription` and the lockdown route, so the
 * two callers cannot drift.
 *
 * Why it exists: a lock stops a workspace's sites, writes and sessions, but it
 * does not stop billing. A fraudster's workspace, locked, keeps a live
 * subscription that renews on a card that is probably stolen, and every
 * renewal is a future chargeback. Until this, the only lever was the Stripe
 * API by hand.
 *
 * What it guarantees:
 *
 *  - It FINDS every subscription, not just one. The org's stored customer id
 *    (for this deployment's Stripe mode) is listed with `status=all`, and a
 *    `metadata['orgId']` search picks up a subscription created against some
 *    other customer — checkout, enterprise provisioning and the retention
 *    offer all stamp `metadata[orgId]`. A lookup that fails is REPORTED, and
 *    the result is then never `confirmed`: "we cancelled what we found" is not
 *    "nothing is left billing".
 *  - It NEVER refunds. `now` deletes with `invoice_now=false` and
 *    `prorate=false`, so no final invoice and no proration credit;
 *    `period_end` sets `cancel_at_period_end`. Money already collected stays
 *    collected — a refund is its own audited action on the org page.
 *  - It is IDEMPOTENT by reading first. A subscription already in a terminal
 *    state is not touched, nor is one already set to end at the period end
 *    when that is what was asked. Running it twice writes nothing to Stripe
 *    the second time.
 *  - It answers with a FRESH READ of every subscription it acted on, in the
 *    same verified/confirmed shape as the lockdown route (AGL-1571): a click
 *    is a request, and only the read-back says what Stripe now holds.
 *
 * What it does not do: write the org doc. The existing webhook projects the
 * cancellation (`plan: free`, `billingStatus: canceled`) the same way it does
 * for every other cancellation, so there is one writer of that state.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { readOrgBilling } from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { planFromPriceId } from '@aglyn/tenant-data-admin/server/billing-addons'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import {
  STAFF_CANCELLATION_COMMENT_MARKER,
  type SubscriptionCancelWhen,
} from '../../constants/subscription-cancel'

/**
 * The statuses a subscription never leaves. Everything else — live, in
 * dunning, paused or awaiting its first payment — can still bill, so it is a
 * cancellation candidate.
 */
const TERMINAL_STATUSES = ['canceled', 'incomplete_expired']

export function isTerminalSubscriptionStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.includes(status)
}

/** Stripe caps `cancellation_details.comment` at 500 characters. */
const STRIPE_COMMENT_MAX = 500

/** A workspace id as the route accepts it — also safe inside a search query. */
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isCancelableOrgId(orgId: unknown): orgId is string {
  return typeof orgId === 'string' && ORG_ID_PATTERN.test(orgId)
}

/** One subscription as staff see it. Dates are ISO strings, or null. */
export interface StaffSubscriptionView {
  id: string
  status: string
  /** The self-serve plan its price sells; null for custom or unknown prices. */
  plan: string | null
  priceId: string | null
  interval: string | null
  cancelAtPeriodEnd: boolean
  /** When a scheduled cancellation takes effect, if one is set. */
  cancelAt: string | null
  canceledAt: string | null
  /** The next renewal while it is live; the last period's end once it is not. */
  currentPeriodEnd: string | null
  /** The comment Stripe holds for the cancellation, if any. */
  cancellationComment: string | null
  customerId: string | null
  /** Whether it can still bill. */
  terminal: boolean
}

export type SubscriptionCancelOutcome =
  | 'canceled'
  | 'scheduled'
  | 'already-canceled'
  | 'already-scheduled'
  | 'failed'

export interface SubscriptionCancelStep {
  id: string
  outcome: SubscriptionCancelOutcome
  /** Stripe's own message when the write or the read-back failed. */
  error: string | null
  /** The subscription as read back AFTER the write; null if that read failed. */
  verified: StaffSubscriptionView | null
  /** The read-back matches what was asked for. */
  confirmed: boolean
}

export interface OrgSubscriptionCancelResult {
  orgId: string
  when: SubscriptionCancelWhen
  customerId: string | null
  /** False when this deployment has no Stripe key; nothing was attempted. */
  configured: boolean
  /** Lookups that failed. Any entry here means something may have been missed. */
  lookupErrors: string[]
  subscriptions: SubscriptionCancelStep[]
  /** Subscriptions this call actually changed in Stripe. */
  changed: number
  /**
   * Every subscription found reads back as asked, AND every lookup ran. A
   * workspace with nothing billing is confirmed with an empty list.
   */
  confirmed: boolean
  readAtMs: number
}

export interface StripeReply {
  ok: boolean
  status: number
  body: any
}

export async function stripe(
  secretKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params?: Record<string, string>,
): Promise<StripeReply> {
  const encoded = params ? new URLSearchParams(params).toString() : ''
  // DELETE carries its parameters in the query string, as Stripe's own
  // clients send them; POST carries them in a form body.
  const url =
    method === 'DELETE' && encoded
      ? `https://api.stripe.com/v1/${path}?${encoded}`
      : `https://api.stripe.com/v1/${path}`
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(method === 'POST'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
    },
    body: method === 'POST' ? encoded : undefined,
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

const isoFromSeconds = (value: unknown): string | null =>
  typeof value === 'number' && value > 0
    ? new Date(value * 1000).toISOString()
    : null

/** Stripe's subscription object → the view staff read. */
export function describeSubscription(subscription: any): StaffSubscriptionView {
  const items: any[] = Array.isArray(subscription?.items?.data)
    ? subscription.items.data
    : []
  const priced = items.map((item) => item?.price).filter(Boolean)
  const planPrice =
    priced.find((price) => planFromPriceId(price?.id)) ?? priced[0] ?? null
  const status = String(subscription?.status ?? 'unknown')
  const customer = subscription?.customer
  return {
    id: String(subscription?.id ?? ''),
    status,
    plan: planPrice ? planFromPriceId(planPrice.id) : null,
    priceId: planPrice?.id ? String(planPrice.id) : null,
    interval: planPrice?.recurring?.interval
      ? String(planPrice.recurring.interval)
      : null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
    cancelAt: isoFromSeconds(subscription?.cancel_at),
    canceledAt: isoFromSeconds(subscription?.canceled_at),
    // Newer API versions moved the period onto the items; read either.
    currentPeriodEnd: isoFromSeconds(
      subscription?.current_period_end ?? items[0]?.current_period_end,
    ),
    cancellationComment:
      typeof subscription?.cancellation_details?.comment === 'string'
        ? subscription.cancellation_details.comment
        : null,
    customerId:
      typeof customer === 'string' ? customer : (customer?.id ?? null),
    terminal: isTerminalSubscriptionStatus(status),
  }
}

/**
 * Every subscription Stripe holds for the workspace, newest first, by both
 * routes in: the stored customer and the `metadata['orgId']` search.
 */
export async function findOrgSubscriptions(options: {
  orgId: string
  secretKey: string
}): Promise<{
  customerId: string | null
  subscriptions: StaffSubscriptionView[]
  lookupErrors: string[]
}> {
  const { orgId, secretKey } = options
  const lookupErrors: string[] = []
  const byId = new Map<string, any>()

  // AGL-1028: the customer lives at `orgs/{orgId}/billing/stripe`, with the
  // org doc as the fallback, projected onto this deployment's Stripe mode.
  const customerId =
    ((await readOrgBilling(orgId)).stripeCustomerId as string | undefined) ??
    null

  const [byCustomer, byMetadata] = await Promise.all([
    customerId
      ? stripe(
          secretKey,
          'GET',
          `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
        )
      : null,
    // The id is pattern-checked by every caller, so it cannot close the quote.
    stripe(
      secretKey,
      'GET',
      `subscriptions/search?query=${encodeURIComponent(
        `metadata['orgId']:'${orgId}'`,
      )}&limit=100`,
    ),
  ])
  if (byCustomer) {
    if (byCustomer.ok) {
      for (const subscription of byCustomer.body?.data ?? []) {
        if (subscription?.id) byId.set(String(subscription.id), subscription)
      }
      if (byCustomer.body?.has_more === true) {
        lookupErrors.push(
          'The customer has more than 100 subscriptions; only the newest 100 were read.',
        )
      }
    } else {
      lookupErrors.push(
        `Listing the customer's subscriptions failed: ${
          byCustomer.body?.error?.message ?? `HTTP ${byCustomer.status}`
        }`,
      )
    }
  }
  if (byMetadata.ok) {
    for (const subscription of byMetadata.body?.data ?? []) {
      if (subscription?.id && !byId.has(String(subscription.id))) {
        byId.set(String(subscription.id), subscription)
      }
    }
  } else {
    lookupErrors.push(
      `Searching subscriptions by metadata.orgId failed: ${
        byMetadata.body?.error?.message ?? `HTTP ${byMetadata.status}`
      }`,
    )
  }

  const subscriptions = [...byId.values()]
    .sort((a, b) => Number(b?.created ?? 0) - Number(a?.created ?? 0))
    .map(describeSubscription)
  return { customerId, subscriptions, lookupErrors }
}

/** What Stripe records as the reason, bounded to its limit. */
export function cancellationComment(options: {
  reason: string
  note?: string | null
  actorUid: string
  via: 'staff-console' | 'lockdown'
}): string {
  const note = options.note?.trim()
  return (
    `${PLATFORM_BRAND_NAME} ${STAFF_CANCELLATION_COMMENT_MARKER} ${options.via}: ${options.reason}` +
    `${note ? ` — ${note}` : ''} (actor ${options.actorUid}; no refund)`
  ).slice(0, STRIPE_COMMENT_MAX)
}

function matchesIntent(
  view: StaffSubscriptionView | null,
  when: SubscriptionCancelWhen,
): boolean {
  if (!view) return false
  if (view.terminal) return true
  return when === 'period_end' && view.cancelAtPeriodEnd
}

/**
 * Cancel every subscription of the workspace that can still bill, then read
 * each one back. Never throws for a Stripe failure — every failure is a step
 * with an error, because the lockdown caller must be able to report a failed
 * cancel beside a lock that succeeded.
 */
export async function cancelOrgSubscriptions(options: {
  orgId: string
  when: SubscriptionCancelWhen
  comment: string
  secretKey?: string | null
}): Promise<OrgSubscriptionCancelResult> {
  const { orgId, when, comment } = options
  const secretKey = options.secretKey ?? process.env['STRIPE_SECRET_KEY'] ?? ''
  const empty = {
    orgId,
    when,
    customerId: null,
    subscriptions: [],
    changed: 0,
    readAtMs: Date.now(),
  }
  if (!secretKey) {
    return {
      ...empty,
      configured: false,
      lookupErrors: ['Stripe is not configured on this deployment.'],
      confirmed: false,
    }
  }

  let found: Awaited<ReturnType<typeof findOrgSubscriptions>>
  try {
    found = await findOrgSubscriptions({ orgId, secretKey })
  } catch (error) {
    return {
      ...empty,
      configured: true,
      lookupErrors: [
        `Looking up the workspace's subscriptions failed: ${
          (error as Error)?.message ?? String(error)
        }`,
      ],
      confirmed: false,
    }
  }

  const steps: SubscriptionCancelStep[] = []
  let changed = 0
  for (const current of found.subscriptions) {
    // Already over. Reported so the operator sees it was looked at.
    if (current.terminal) {
      steps.push({
        id: current.id,
        outcome: 'already-canceled',
        error: null,
        verified: current,
        confirmed: true,
      })
      continue
    }
    if (when === 'period_end' && current.cancelAtPeriodEnd) {
      steps.push({
        id: current.id,
        outcome: 'already-scheduled',
        error: null,
        verified: current,
        confirmed: true,
      })
      continue
    }

    let write: StripeReply
    try {
      if (when === 'now') {
        write = await stripe(
          secretKey,
          'DELETE',
          `subscriptions/${encodeURIComponent(current.id)}`,
          {
            invoice_now: 'false',
            prorate: 'false',
            'cancellation_details[comment]': comment,
          },
        )
      } else {
        // A pending downgrade holds the subscription in a schedule, and
        // Stripe refuses `cancel_at_period_end` on a scheduled subscription.
        // Releasing keeps it on its current phase — the same move the
        // customer's own cancel makes in /api/billing/subscription.
        const raw = await stripe(
          secretKey,
          'GET',
          `subscriptions/${encodeURIComponent(current.id)}`,
        )
        const scheduleId =
          typeof raw.body?.schedule === 'string'
            ? raw.body.schedule
            : raw.body?.schedule?.id
        if (scheduleId) {
          await stripe(
            secretKey,
            'POST',
            `subscription_schedules/${encodeURIComponent(String(scheduleId))}/release`,
            {},
          )
        }
        write = await stripe(
          secretKey,
          'POST',
          `subscriptions/${encodeURIComponent(current.id)}`,
          {
            cancel_at_period_end: 'true',
            'cancellation_details[comment]': comment,
          },
        )
      }
    } catch (error) {
      write = {
        ok: false,
        status: 0,
        body: { error: { message: (error as Error)?.message ?? String(error) } },
      }
    }

    // The read-back, whatever the write said: a write that errored may still
    // have landed, and a 200 is not the state.
    let verified: StaffSubscriptionView | null = null
    let readError: string | null = null
    try {
      const reread = await stripe(
        secretKey,
        'GET',
        `subscriptions/${encodeURIComponent(current.id)}`,
      )
      if (reread.ok) verified = describeSubscription(reread.body)
      else readError = reread.body?.error?.message ?? `HTTP ${reread.status}`
    } catch (error) {
      readError = (error as Error)?.message ?? String(error)
    }
    const confirmed = matchesIntent(verified, when)
    if (write.ok) changed += 1
    steps.push({
      id: current.id,
      outcome: write.ok
        ? when === 'now'
          ? 'canceled'
          : 'scheduled'
        : 'failed',
      error: write.ok
        ? readError
          ? `Read-back failed: ${readError}`
          : null
        : (write.body?.error?.message ?? `HTTP ${write.status}`),
      verified,
      confirmed,
    })
  }

  return {
    orgId,
    when,
    customerId: found.customerId,
    configured: true,
    lookupErrors: found.lookupErrors,
    subscriptions: steps,
    changed,
    confirmed:
      found.lookupErrors.length === 0 && steps.every((step) => step.confirmed),
    readAtMs: Date.now(),
  }
}

/**
 * The `adminAudit` row for one cancellation attempt, written by both callers
 * so a reader finds a lockdown's cancel and a console cancel the same way.
 * Written for failures too: an attempt that did not land is the row an
 * incident reviewer most needs.
 */
export async function auditOrgSubscriptionCancel(
  firestore: Firestore,
  options: {
    actorUid: string
    actorEmail?: string | null
    reason: string
    note?: string | null
    via: 'staff-console' | 'lockdown'
    result: OrgSubscriptionCancelResult
  },
): Promise<void> {
  const { result } = options
  await addAdminAudit(firestore, {
    actorUid: options.actorUid,
    actorEmail: options.actorEmail ?? null,
    action: 'org.subscription-cancel',
    scope: 'org',
    target: `orgs/${result.orgId}`,
    reason: options.reason,
    note: options.note ?? null,
    via: options.via,
    when: result.when,
    // Stated on the row, not implied by the action name: nothing was
    // refunded, and a reviewer should not have to know the code to trust it.
    refunded: false,
    before: {
      customerId: result.customerId,
      subscriptions: result.subscriptions.map((step) => step.id),
    },
    after: {
      changed: result.changed,
      confirmed: result.confirmed,
      lookupErrors: result.lookupErrors,
      subscriptions: result.subscriptions.map((step) => ({
        id: step.id,
        outcome: step.outcome,
        status: step.verified?.status ?? null,
        cancelAtPeriodEnd: step.verified?.cancelAtPeriodEnd ?? null,
        error: step.error,
      })),
    },
    at: FieldValue.serverTimestamp(),
  })
}
