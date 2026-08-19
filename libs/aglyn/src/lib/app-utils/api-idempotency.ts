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

import { createHash } from 'node:crypto'

/**
 * The atomic attempt claim (AGL-1691, promoted here by AGL-1697).
 *
 * Nine call sites in this repo create a Stripe Checkout session and eight of
 * them sent no `Idempotency-Key`, so a retry, a double-click or a client
 * timeout minted a second session on a live account. Closing them one at a time
 * with one local copy each is how a codebase ends up with nine subtly different
 * answers to the same question, so the POS implementation moves here whole
 * rather than being reimplemented per caller.
 *
 * Exported ONLY from `@aglyn/aglyn/server` (never the client barrel): it needs
 * `node:crypto`, which is the same reason `realm-server` lives behind that
 * entry point.
 */

/**
 * The minimum Firestore surface the claim needs, declared structurally.
 *
 * A `FirebaseFirestore.Firestore` satisfies it, but stating it this way keeps
 * `@aglyn/aglyn` free of a firebase-admin dependency — and it is the reason a
 * spec can hand this an in-memory map and count what actually landed.
 */
export interface IdempotencyDocRef {
  create(data: Record<string, unknown>): Promise<unknown>
  get(): Promise<{ get(field: string): unknown }>
  set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown>
  delete(): Promise<unknown>
}

export interface IdempotencyStore {
  collection(name: string): { doc(id: string): IdempotencyDocRef }
}

/** A claim on one attempt. */
export interface AttemptClaim {
  /**
   * The digest to hand Stripe as `Idempotency-Key`, or null when the client
   * sent no key.
   */
  stripeKey: string | null
  /** Record the response so a repeat of this attempt replays it. */
  record: (status: number, body: unknown) => Promise<void>
  /** Give the key back, so a failed attempt can be retried with it. */
  release: () => Promise<void>
}

export type AttemptClaimResult =
  | { claim: AttemptClaim }
  | { replay: { status: number; body: unknown } }

export interface AttemptScope {
  /**
   * What kind of attempt this is (`pos`, `marketplace-checkout`, …). Part of
   * the digest, so two features cannot collide on one client-minted key.
   */
  kind: string
  /**
   * What the attempt is scoped to — a host id, or a `listingId:buyerUid` pair.
   * Also part of the digest.
   */
  scopeId: string
  /**
   * The org whose data this is, so `eraseOrgIdempotencyKeys` sweeps the claim
   * on org erasure (AGL-1448). Empty is written as explicit `null` — Firestore
   * rejects `undefined`.
   */
  orgId: string
  /** The client-minted attempt key. Empty means "the client sent none". */
  key: string
  /** What to answer a caller whose identical attempt is still in flight. */
  busyMessage: string
}

/** Where the REST API already keeps replay keys (AGL-618). */
const COLLECTION = 'apiIdempotency'

/**
 * How long a replay key is remembered (AGL-1978).
 *
 * This was unbounded, and the reason that matters is not document count. A
 * settled claim stores the ORIGINAL RESPONSE BODY, and for the REST API that
 * body is the created record's `values` — the customer's own data. So the
 * collection was a second, permanent copy of every record ever created
 * through the API, and `conventions.md` advertises the consequence in terms:
 * a replay "keeps working after the record has been edited or deleted". A
 * customer who deleted a record left our copy of it behind, forever, in a
 * collection nobody thought of as content.
 *
 * 30 days, chosen against real retry behaviour rather than against the
 * feeling that shorter is safer:
 *
 * - Stripe's own idempotency window is 24 hours, and it serves the whole
 *   payments industry. 30 days is thirty times that.
 * - It covers every retry pattern an integration actually has: the immediate
 *   retry, the retry after a timeout, and the nightly job that fails and
 *   re-runs the next morning. A human re-importing last quarter's data is
 *   not retrying — that is a new operation, and it should mint a new key.
 * - It turns an unbounded archive into a working set without touching the
 *   in-flight semantics the `409` protects.
 *
 * ⚠️ This CHANGES a documented promise. `apps/docs/api/conventions.md` said
 * keys "never expire — a key really is single-use forever"; it now states
 * the window. The doc moved in the same commit, because a retention change
 * that leaves the published contract behind is the AGL-1496 shape.
 */
export const API_IDEMPOTENCY_RETENTION_DAYS = 30

/**
 * When a claim taken at `now` expires. A `Date`, never an epoch number: a
 * TTL policy keys on a Firestore Timestamp and silently governs nothing when
 * the field is a number. Note the existing `createdAtMs`/`settledAtMs`
 * fields are numbers and could not have been used — which is why AGL-1978
 * called for a new field rather than a policy on an existing one.
 */
export function apiIdempotencyExpiry(now = new Date()): Date {
  return new Date(
    now.getTime() + API_IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
}

/**
 * One Stripe idempotency key per OBJECT an attempt creates (AGL-1714).
 *
 * Stripe's idempotency layer is account-scoped, not endpoint-scoped: it
 * "compares incoming parameters to those of the original request and errors if
 * they're not the same". Sending one claim digest unchanged to two endpoints —
 * a coupon and then the session, a price and then the subscription — therefore
 * makes the SECOND call fail outright. An attempt that creates more than one
 * Stripe object derives a key per object from the one digest instead.
 *
 * Null-propagating so a keyless attempt (older cached client bundle) sends no
 * header at all rather than the string `"null:session"`.
 */
export function deriveStripeObjectKey(
  digest: string | null,
  object: string,
): string | null {
  return digest ? `${digest}:${object}` : null
}

/**
 * Take an exclusive claim on one attempt, so a retry cannot mint a second
 * order, a second purchase or a second Checkout session.
 *
 * The key is supplied by the CLIENT, once per attempt, and is deliberately NOT
 * derived from the content. A cashier ringing the same coffee twice in a minute
 * is a real second sale, and a buyer re-buying a component after a refund is a
 * real second purchase; a content hash would silently swallow both, which is a
 * worse bug than the one this closes. So the client mints a key when something
 * first becomes an attempt and retires it when that attempt is over — stable
 * across a retry of THAT attempt, distinct for a legitimately identical next
 * one. Callers that need "you cannot have two of these at all" want a business
 * rule as well, not a longer-lived key.
 *
 * The claim is `create()`. Firestore rejects a create on an existing document,
 * and that rejection is the whole dedupe primitive — a read-then-write would
 * race exactly the double-submit it exists to stop.
 *
 * Storage reuses the REST API's collection and its `orgId` field rather than
 * inventing a second replay store, so `eraseOrgIdempotencyKeys` already sweeps
 * these on org erasure (AGL-1448) with no change there.
 */
export async function claimAttempt(
  store: IdempotencyStore,
  scope: AttemptScope,
): Promise<AttemptClaimResult> {
  // No key: transact as before. These are public API routes and an older
  // cached client bundle must keep working rather than start failing.
  //
  // ⚠️ THIS IS A NO-OP CLAIM, AND IT IS A REAL HOLE — deliberately left open,
  // now made LOUD (AGL-2163). `stripeKey: null` propagates through
  // `deriveStripeObjectKey` to the Stripe call (see
  // `marketplace/checkout.ts`), so a caller that sends no Idempotency-Key
  // header gets neither our claim nor Stripe's own 24-hour window: the
  // concurrent-double-charge race this module exists to close is fully back
  // for that request.
  //
  // THE POLICY IS NOT CHANGED HERE, ON PURPOSE. The obvious "fix" — synthesise
  // a key from the request body — would redefine what "the same attempt"
  // means: a cashier ringing the same coffee twice and a buyer re-purchasing
  // the same listing after a refund would both read as replays and be
  // silently swallowed, which is a worse bug than the one it closes (see the
  // paragraph above on why the key is client-minted). Requiring the header
  // instead would break every older cached client bundle mid-checkout.
  // Choosing between those two is a product call, not a bug fix.
  //
  // What IS wrong is that it was SILENT. An unprotected money call left no
  // trace anywhere, so nobody could tell whether this path was taken once a
  // year or on a third of all checkouts — which is exactly the number the
  // policy decision needs. `console.warn` rather than a counter because it
  // rides the platform's existing log pipeline and this path is low-volume by
  // construction (one line per money attempt, not per request).
  if (!scope.key) {
    console.warn(
      'api-idempotency: UNPROTECTED money call — no Idempotency-Key header, ' +
        'so neither the attempt claim nor Stripe idempotency applies',
      { kind: scope.kind, scopeId: scope.scopeId, orgId: scope.orgId ?? null },
    )
    return {
      claim: {
        stripeKey: null,
        record: async () => undefined,
        release: async () => undefined,
      },
    }
  }
  const digest = createHash('sha256')
    .update(`${scope.kind}:${scope.scopeId}:${scope.key}`)
    .digest('hex')
  const ref = store.collection(COLLECTION).doc(digest)
  try {
    await ref.create({
      orgId: scope.orgId || null,
      scopeId: scope.scopeId,
      kind: scope.kind,
      status: 'pending',
      createdAtMs: Date.now(),
      // Stamped at CLAIM, not at settlement, so a claim stranded by a killed
      // process is reaped on the same schedule as one that completed. Those
      // are the documents that would otherwise sit forever holding a key
      // hostage — the failure mode `release()` exists to avoid and cannot
      // cover when the process is gone.
      expiresAt: apiIdempotencyExpiry(),
    })
  } catch {
    // Already claimed: either the attempt finished and we replay its result,
    // or it is still in flight.
    const prior = await ref.get()
    const priorResponse = prior.get('response')
    if (priorResponse) {
      return {
        replay: {
          status: Number(prior.get('responseStatus') ?? 200),
          body: priorResponse,
        },
      }
    }
    // In flight. Fail CLOSED — the money direction. Letting the second caller
    // through IS the duplicate charge. A process killed between the claim and
    // the record leaves a key stuck here; the customer starts a fresh attempt
    // with a fresh key, which is the correct failure direction even though it
    // is not a pleasant one.
    return { replay: { status: 409, body: { error: scope.busyMessage } } }
  }
  return {
    claim: {
      // The same digest goes to Stripe, so even if our claim is lost after the
      // call, Stripe replays its own session rather than opening a second one.
      // Scoped by kind and attempt, so it cannot collide.
      stripeKey: digest,
      // Both swallow their own failure. A claim that cannot be recorded or
      // released must not turn a completed purchase into a 500 — the money has
      // already moved by then, and the worst case here is a key that replays
      // nothing or one that goes unused.
      record: async (status: number, body: unknown): Promise<void> => {
        try {
          await ref.set(
            {
              status: 'done',
              responseStatus: status,
              response: body,
              settledAtMs: Date.now(),
            },
            { merge: true },
          )
        } catch {
          /* best effort */
        }
      },
      // A rejected or failed attempt must not burn the key: the customer fixes
      // the cause and presses the same button.
      release: async (): Promise<void> => {
        try {
          await ref.delete()
        } catch {
          /* best effort */
        }
      },
    },
  }
}
