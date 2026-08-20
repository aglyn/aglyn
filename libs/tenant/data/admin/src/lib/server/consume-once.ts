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
 * Single use as a PROPERTY, not a policy (AGL-1353 D2/D8, extraction 1).
 *
 * Lifted from the WebAuthn challenge consume in
 * `apps/console/app/api/_lib/passkeys.ts`, whose comment states the standard
 * verbatim:
 *
 * > single use is not a policy here, it is a property: a second consume of the
 * > same id finds nothing, whatever the outcome of the first
 *
 * ## Why the transaction must WRITE
 *
 * Firestore transactions are serializable with optimistic concurrency: two
 * transactions that read AND write the same document cannot both commit. The
 * loser retries, re-reads the consumed state, and fails cleanly — so exactly
 * one caller ever sees a success. A read-only check followed by a write
 * *outside* the transaction would not be detected as contention at all, and is
 * the mistake to look for in review. That is why {@link consumeOnce} always
 * mutates the document it read, on every accepting path, and why `validate`
 * returns the new state rather than performing the write itself.
 *
 * ## Why not the rate limiter
 *
 * `consumeRateLimit(key, { limit: 1 })` looks like single use and is not.
 * It **fails soft**: on a Firestore error it silently falls back to a
 * per-instance in-memory limiter and reports `degraded: true`. A single-use
 * guarantee that evaporates during a Firestore blip is a replayable
 * credential. Volume control fails soft; uniqueness must fail closed.
 */

/** What {@link consumeOnce} does with the document it read. */
export type ConsumeDecision<T> =
  | {
      /** Accept: commit `patch` (merged) — or delete — and return `value`. */
      accept: true
      value: T
      patch?: Record<string, unknown>
      /** Delete the document instead of patching it. */
      remove?: boolean
    }
  | {
      accept: false
      reason: string
      /**
       * Delete the document anyway.
       *
       * Off by default, and the default is the safer one: a refused consume
       * that writes can destroy a record a concurrent legitimate consume is
       * about to accept, which hands a denial of service to anyone who can
       * guess an id. The cross-domain handoff relies on that default.
       *
       * The WebAuthn challenge consume opted in when it was migrated here
       * (AGL-1902), because that is what it did before and an extraction must
       * not change behaviour on its way out of the file it came from. Whether
       * it SHOULD is a separate question from whether this refactor may
       * decide it.
       */
      remove?: boolean
    }

export interface ConsumeOnceResult<T> {
  ok: boolean
  value: T | null
  /** Why it was refused. `'absent'` when the document was already gone. */
  reason: string | null
}

/**
 * Read a document and, in the same transaction, consume it.
 *
 * `validate` is called with the document's data and must decide. It runs
 * INSIDE the transaction, so every check it makes — status, expiry, hashes,
 * target host, liveness — is part of the same serializable unit as the write.
 * Nothing it needs may be fetched afterwards.
 *
 * @param firestore - Admin SDK Firestore
 * @param ref - the document to consume
 * @param validate - decides, given the stored data
 */
export async function consumeOnce<T>(
  firestore: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  validate: (data: Record<string, unknown>) => ConsumeDecision<T>,
): Promise<ConsumeOnceResult<T>> {
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) {
      return { ok: false, value: null, reason: 'absent' }
    }
    // Read structurally rather than by narrowing. `strictNullChecks` is off
    // repo-wide and discriminated-union narrowing on a boolean literal does
    // not survive it — the same reason `security-alerts.ts` reads its send
    // failures this way.
    const decision = validate(
      (snapshot.data() ?? {}) as Record<string, unknown>,
    ) as {
      accept: boolean
      value?: T
      patch?: Record<string, unknown>
      remove?: boolean
      reason?: string
    }
    if (!decision.accept) {
      // No write on a refusal unless the caller asks. A refused consume must
      // not be able to destroy a record that a concurrent legitimate consume
      // is about to accept — and the record's own expiry, not this call, is
      // what eventually clears it.
      if (decision.remove) tx.delete(ref)
      return { ok: false, value: null, reason: decision.reason ?? 'refused' }
    }
    if (decision.remove) tx.delete(ref)
    else tx.set(ref, decision.patch ?? {}, { merge: true })
    return { ok: true, value: decision.value ?? null, reason: null }
  })
}
