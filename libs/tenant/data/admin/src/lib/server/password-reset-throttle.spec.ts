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
  consumePasswordResetSend,
  passwordResetThrottleMessage,
  RESET_SENDS_PER_ACTOR,
  RESET_SENDS_PER_RECIPIENT,
} from './password-reset-throttle'

/**
 * Minimal in-memory stand-in for the Firestore the durable limiter writes to:
 * one counter per document id, updated inside a fake transaction. Keeps the
 * caps under test rather than the transaction plumbing, which
 * rate-limit-store.spec.ts already covers.
 */
function fakeFirestore() {
  const docs = new Map<string, { count: number; [key: string]: unknown }>()
  return {
    docs,
    collection: () => ({
      doc: (id: string) => ({ id }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<number>) =>
      fn({
        get: async (ref: { id: string }) => ({
          exists: docs.has(ref.id),
          get: (field: string) => docs.get(ref.id)?.[field],
        }),
        set: (ref: { id: string }, data: { count: number }) => {
          docs.set(ref.id, { ...(docs.get(ref.id) ?? {}), ...data })
        },
      }),
  }
}

const NOW = 1_800_000_000_000

describe('consumePasswordResetSend', () => {
  it('allows sends up to the per-recipient cap', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 1; attempt <= RESET_SENDS_PER_RECIPIENT; attempt += 1) {
      const result = await consumePasswordResetSend({
        actorKey: 'admin-1',
        recipientKey: 'member@example.com',
        now: NOW,
        firestore,
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('refuses the send after the per-recipient cap', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 0; attempt < RESET_SENDS_PER_RECIPIENT; attempt += 1) {
      await consumePasswordResetSend({
        actorKey: 'admin-1',
        recipientKey: 'member@example.com',
        now: NOW,
        firestore,
      })
    }
    const result = await consumePasswordResetSend({
      actorKey: 'admin-1',
      recipientKey: 'member@example.com',
      now: NOW,
      firestore,
    })
    expect(result.allowed).toBe(false)
    expect(result.limited).toBe('recipient')
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('keys the recipient cap on the mailbox, so several admins cannot converge', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 0; attempt < RESET_SENDS_PER_RECIPIENT; attempt += 1) {
      await consumePasswordResetSend({
        actorKey: `admin-${attempt}`,
        recipientKey: 'member@example.com',
        now: NOW,
        firestore,
      })
    }
    const result = await consumePasswordResetSend({
      actorKey: 'admin-fresh',
      recipientKey: 'member@example.com',
      now: NOW,
      firestore,
    })
    expect(result.allowed).toBe(false)
    expect(result.limited).toBe('recipient')
  })

  it('caps one admin spraying many different recipients', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 0; attempt < RESET_SENDS_PER_ACTOR; attempt += 1) {
      const result = await consumePasswordResetSend({
        actorKey: 'admin-1',
        recipientKey: `member-${attempt}@example.com`,
        now: NOW,
        firestore,
      })
      expect(result.allowed).toBe(true)
    }
    const result = await consumePasswordResetSend({
      actorKey: 'admin-1',
      recipientKey: 'member-fresh@example.com',
      now: NOW,
      firestore,
    })
    expect(result.allowed).toBe(false)
    expect(result.limited).toBe('actor')
  })

  it('does not spend the actor budget on a send the recipient cap already refused', async () => {
    const firestore = fakeFirestore()
    // Exhaust one recipient, then keep hammering that same recipient well past
    // the actor cap. A refused send must not count against the admin, or one
    // over-eager admin locks themselves out of helping everybody else.
    for (let attempt = 0; attempt < RESET_SENDS_PER_ACTOR * 2; attempt += 1) {
      await consumePasswordResetSend({
        actorKey: 'admin-1',
        recipientKey: 'blocked@example.com',
        now: NOW,
        firestore,
      })
    }
    const result = await consumePasswordResetSend({
      actorKey: 'admin-1',
      recipientKey: 'someone-else@example.com',
      now: NOW,
      firestore,
    })
    expect(result.allowed).toBe(true)
  })

  it('lets the window roll over', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 0; attempt < RESET_SENDS_PER_RECIPIENT; attempt += 1) {
      await consumePasswordResetSend({
        actorKey: 'admin-1',
        recipientKey: 'member@example.com',
        now: NOW,
        firestore,
      })
    }
    const later = await consumePasswordResetSend({
      actorKey: 'admin-1',
      recipientKey: 'member@example.com',
      now: NOW + 60 * 60 * 1000,
      firestore,
    })
    expect(later.allowed).toBe(true)
  })

  it('keeps separate recipients independent', async () => {
    const firestore = fakeFirestore()
    for (let attempt = 0; attempt < RESET_SENDS_PER_RECIPIENT; attempt += 1) {
      await consumePasswordResetSend({
        actorKey: 'admin-1',
        recipientKey: 'one@example.com',
        now: NOW,
        firestore,
      })
    }
    const other = await consumePasswordResetSend({
      actorKey: 'admin-1',
      recipientKey: 'two@example.com',
      now: NOW,
      firestore,
    })
    expect(other.allowed).toBe(true)
  })
})

describe('passwordResetThrottleMessage', () => {
  it('tells the admin it was them when they hit their own cap', () => {
    const message = passwordResetThrottleMessage({
      allowed: false,
      retryAfterSeconds: 600,
      limited: 'actor',
      degraded: false,
    })
    expect(message).toMatch(/you have sent too many/i)
    expect(message).toContain('10')
  })

  it('points at setting a password directly when the recipient is capped', () => {
    const message = passwordResetThrottleMessage({
      allowed: false,
      retryAfterSeconds: 120,
      limited: 'recipient',
      degraded: false,
    })
    expect(message).toMatch(/set a password directly/i)
  })
})
