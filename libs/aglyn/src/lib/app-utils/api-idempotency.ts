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
  if (!scope.key) {
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
