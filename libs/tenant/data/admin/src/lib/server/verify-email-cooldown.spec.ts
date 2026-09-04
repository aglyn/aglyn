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

import {
  consumeVerifyEmailAutoSend,
  VERIFY_EMAIL_AUTO_SEND_COOLDOWN_MS,
} from './verify-email-cooldown'

/**
 * AGL-2584 — reopening `/verify-email` must not mint another link.
 *
 * The page asks for a link on every mount, so leaving the tab and coming back
 * to check whether the mail arrived asked for a second one. Identity Platform
 * throttles minting per account, ahead of and independently of the route's own
 * hourly budget, and the collision reported a mail that HAD been sent as a
 * send failure.
 *
 * What must hold, in order of how badly getting it wrong would hurt:
 *  1. a first arrival always sends — the common case is not traded away;
 *  2. a revisit inside the cooldown does not;
 *  3. the cooldown is one account's and never another's.
 */

/**
 * Minimal in-memory stand-in for the Firestore the durable limiter writes to,
 * matching password-reset-throttle.spec.ts: one counter per document id,
 * incremented from the sentinel's real `operand` so a mutation to
 * `increment(0)` in the limiter changes what this store holds rather than
 * being absorbed by a hand-rolled double.
 */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    collection: () => ({
      doc: (id: string) => ({
        id,
        set: async (value: Record<string, unknown>) => {
          const prior = docs.get(id) ?? {}
          const next: Record<string, unknown> = { ...prior }
          for (const [field, raw] of Object.entries(value)) {
            const operand = (raw as { operand?: unknown })?.operand
            next[field] =
              typeof operand === 'number'
                ? (Number(prior[field]) || 0) + operand
                : raw
          }
          docs.set(id, next)
        },
        get: async () => ({
          exists: docs.has(id),
          get: (field: string) => docs.get(id)?.[field],
        }),
      }),
    }),
  }
}

const NOW = 1_800_000_000_000

describe('consumeVerifyEmailAutoSend', () => {
  it('lets a first arrival send immediately', async () => {
    const firestore = fakeFirestore()
    const first = await consumeVerifyEmailAutoSend('uid-first', {
      now: NOW,
      firestore,
    })
    expect(first.allowed).toBe(true)
    expect(first.retryAfterSeconds).toBe(0)
  })

  it('refuses the revisit inside the cooldown', async () => {
    const firestore = fakeFirestore()
    await consumeVerifyEmailAutoSend('uid-returning', { now: NOW, firestore })

    // The measured shape of the incident: the tab came back seconds later.
    const revisit = await consumeVerifyEmailAutoSend('uid-returning', {
      now: NOW + 18_000,
      firestore,
    })
    expect(revisit.allowed).toBe(false)
    // Not an error to report — a countdown, so the caller can say how long.
    expect(revisit.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('sends again once the cooldown has passed', async () => {
    const firestore = fakeFirestore()
    await consumeVerifyEmailAutoSend('uid-later', { now: NOW, firestore })

    // A full window past the one the first send landed in, so the boundary
    // has certainly been crossed whatever the alignment.
    const later = await consumeVerifyEmailAutoSend('uid-later', {
      now: NOW + 2 * VERIFY_EMAIL_AUTO_SEND_COOLDOWN_MS,
      firestore,
    })
    expect(later.allowed).toBe(true)
  })

  it('does not leak across uids', async () => {
    const firestore = fakeFirestore()
    // One account burning its cooldown must not make the next person to sign
    // up wait for a mail that was never sent to them.
    await consumeVerifyEmailAutoSend('uid-one', { now: NOW, firestore })
    const other = await consumeVerifyEmailAutoSend('uid-two', {
      now: NOW + 1_000,
      firestore,
    })
    expect(other.allowed).toBe(true)
  })

  it('holds for repeated mounts, not just the second', async () => {
    const firestore = fakeFirestore()
    await consumeVerifyEmailAutoSend('uid-reloader', { now: NOW, firestore })
    for (const offset of [5_000, 30_000, 120_000]) {
      const again = await consumeVerifyEmailAutoSend('uid-reloader', {
        now: NOW + offset,
        firestore,
      })
      expect(again.allowed).toBe(false)
    }
  })
})
