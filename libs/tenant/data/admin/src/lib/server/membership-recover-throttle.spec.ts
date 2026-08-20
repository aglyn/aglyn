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
  consumeMembershipRecoverAttempt,
  consumeMembershipRecoverSend,
  RECOVER_ATTEMPT_WINDOW_MS,
  RECOVER_ATTEMPTS_PER_IP,
  RECOVER_MIN_MEMBER_AGE_MS,
  RECOVER_SEND_WINDOW_MS,
  RECOVER_SENDS_PER_HOST_PER_DAY,
  RECOVER_SENDS_PER_RECIPIENT,
} from './membership-recover-throttle'

/**
 * The same in-memory stand-in `password-reset-throttle.spec.ts` uses, and for
 * the same reason: this file is about the CAPS and their keying, not about the
 * transaction plumbing, which `rate-limit-store.spec.ts` covers directly.
 *
 * It models the two Firestore behaviours the limiter actually depends on —
 * `exists` on a document that was never written, and read-modify-write inside
 * a transaction — rather than being a bag of `jest.fn()`s that would agree
 * with whatever the code did.
 */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    collection: () => ({
      doc: (id: string) => ({
        id,
        // AGL-2416: the counter is now an atomic increment plus a read-back,
        // not a read-modify-write transaction. `increment` is applied from the
        // sentinel's real `operand`, so mutating the production call to
        // `increment(0)` changes what this store holds instead of being absorbed.
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
          docs.set(id, next as never)
        },
        get: async () => {
          return {
            exists: docs.has(id),
            get: (field: string) => (docs.get(id) as never)?.[field],
          }
        },
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<number>) =>
      fn({
        get: async (ref: { id: string }) => ({
          exists: docs.has(ref.id),
          get: (field: string) => docs.get(ref.id)?.[field],
        }),
        set: (ref: { id: string }, data: Record<string, unknown>) => {
          docs.set(ref.id, { ...(docs.get(ref.id) ?? {}), ...data })
        },
      }),
  }
}

const NOW = 1_800_000_000_000
const IP = '203.0.113.9'
const EMAIL = 'member@example.com'

describe('recovery throttle policy (AGL-1966)', () => {
  /**
   * The numbers, pinned literally.
   *
   * Every other test in this file is written in terms of the constants, which
   * is what keeps them readable — and which also means they all pass if
   * somebody widens a cap to 10,000, because the loops widen with it. That is
   * exactly the change this file exists to make hard, so the values are
   * asserted once, here, as values.
   *
   * Widening one of these is a legitimate decision; doing it without noticing
   * is not. If you are here because this test failed, the number moved on
   * purpose — say so in the commit and update the line.
   */
  it('pins the caps so a silent widening cannot pass', () => {
    expect(RECOVER_SENDS_PER_RECIPIENT).toBe(3)
    expect(RECOVER_ATTEMPTS_PER_IP).toBe(10)
    expect(RECOVER_ATTEMPT_WINDOW_MS).toBe(60 * 60 * 1000)
    expect(RECOVER_SENDS_PER_HOST_PER_DAY).toBe(200)
    expect(RECOVER_SEND_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    expect(RECOVER_MIN_MEMBER_AGE_MS).toBe(10 * 60 * 1000)
  })
})

describe('consumeMembershipRecoverAttempt (AGL-1966)', () => {
  it('allows attempts up to the per-recipient cap, then refuses', async () => {
    const firestore = fakeFirestore()
    for (let n = 1; n <= RECOVER_SENDS_PER_RECIPIENT; n += 1) {
      const result = await consumeMembershipRecoverAttempt({
        email: EMAIL,
        // A FRESH IP each time, so only the recipient cap can be what refuses.
        ip: `198.51.100.${n}`,
        now: NOW,
        firestore,
      })
      expect(result.allowed).toBe(true)
      expect(result.limited).toBeNull()
    }
    const over = await consumeMembershipRecoverAttempt({
      email: EMAIL,
      ip: '198.51.100.250',
      now: NOW,
      firestore,
    })
    expect(over.allowed).toBe(false)
    expect(over.limited).toBe('recipient')
    expect(over.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('refuses on the IP cap when every address is different', async () => {
    const firestore = fakeFirestore()
    for (let n = 1; n <= RECOVER_ATTEMPTS_PER_IP; n += 1) {
      const result = await consumeMembershipRecoverAttempt({
        // A fresh address each time — this is the register-then-recover
        // composition's traffic shape, where the per-recipient cap never fires
        // because no address is ever asked for twice.
        email: `victim-${n}@example.com`,
        ip: IP,
        now: NOW,
        firestore,
      })
      expect(result.allowed).toBe(true)
    }
    const over = await consumeMembershipRecoverAttempt({
      email: 'victim-fresh@example.com',
      ip: IP,
      now: NOW,
      firestore,
    })
    expect(over.allowed).toBe(false)
    expect(over.limited).toBe('ip')
  })

  it('does not spend the IP budget on a request the recipient cap refuses', async () => {
    const firestore = fakeFirestore()
    // Exhaust one address from one IP...
    for (let n = 0; n <= RECOVER_SENDS_PER_RECIPIENT; n += 1) {
      await consumeMembershipRecoverAttempt({
        email: EMAIL,
        ip: IP,
        now: NOW,
        firestore,
      })
    }
    // ...then keep hammering it. Only the first RECOVER_SENDS_PER_RECIPIENT
    // reached the IP counter, so the IP still has budget for other addresses.
    for (let n = 0; n < 50; n += 1) {
      await consumeMembershipRecoverAttempt({
        email: EMAIL,
        ip: IP,
        now: NOW,
        firestore,
      })
    }
    const other = await consumeMembershipRecoverAttempt({
      email: 'someone-else@example.com',
      ip: IP,
      now: NOW,
      firestore,
    })
    expect(other.allowed).toBe(true)
  })

  it('keys the recipient cap on the address alone, not on the site', async () => {
    // The cap must follow the mailbox: an attacker who controls several sites
    // must not multiply one person's reset mail by the number of sites. There
    // is no hostId in the attempt signature at all, so this asserts the
    // property by exhausting the cap and showing nothing resets it.
    const firestore = fakeFirestore()
    for (let n = 0; n <= RECOVER_SENDS_PER_RECIPIENT; n += 1) {
      await consumeMembershipRecoverAttempt({
        email: EMAIL,
        ip: `192.0.2.${n}`,
        now: NOW,
        firestore,
      })
    }
    const elsewhere = await consumeMembershipRecoverAttempt({
      email: EMAIL,
      ip: '192.0.2.200',
      now: NOW,
      firestore,
    })
    expect(elsewhere.allowed).toBe(false)
    expect(elsewhere.limited).toBe('recipient')
  })

  it('lets the window roll over', async () => {
    const firestore = fakeFirestore()
    for (let n = 0; n <= RECOVER_SENDS_PER_RECIPIENT; n += 1) {
      await consumeMembershipRecoverAttempt({
        email: EMAIL,
        ip: IP,
        now: NOW,
        firestore,
      })
    }
    const next = await consumeMembershipRecoverAttempt({
      email: EMAIL,
      ip: IP,
      now: NOW + RECOVER_ATTEMPT_WINDOW_MS,
      firestore,
    })
    expect(next.allowed).toBe(true)
  })

  it('degrades rather than refusing when the store is unreachable', async () => {
    // Fail SOFT on an outage: a Firestore blip must not lock every site's
    // members out of their own password reset. `consumeRateLimit` falls back
    // to the in-process cap and flags it, and this asserts the flag reaches
    // the caller rather than being swallowed.
    const unavailable = async () => {
      throw Object.assign(new Error('unavailable'), { code: 14 })
    }
    const broken = {
      collection: () => ({
        doc: (id: string) => ({ id, set: unavailable, get: unavailable }),
      }),
    }
    const result = await consumeMembershipRecoverAttempt({
      email: 'degrade@example.com',
      ip: '203.0.113.77',
      now: NOW,
      firestore: broken,
    })
    expect(result.allowed).toBe(true)
    expect(result.degraded).toBe(true)
  })

  it('refuses CLOSED when the key is contended', async () => {
    // The other half of AGL-2404's split posture. Contention on a key that is
    // per recipient and per IP is not a legitimate visitor racing themselves.
    const abort = async () => {
      throw Object.assign(new Error('aborted'), { code: 10 })
    }
    const contended = {
      collection: () => ({ doc: (id: string) => ({ id, set: abort, get: abort }) }),
    }
    const result = await consumeMembershipRecoverAttempt({
      email: 'contend@example.com',
      ip: '203.0.113.78',
      now: NOW,
      firestore: contended,
    })
    expect(result.allowed).toBe(false)
    expect(result.contended).toBe(true)
    expect(result.degraded).toBe(false)
  })
})

describe('consumeMembershipRecoverSend (AGL-1966)', () => {
  it('allows sends up to the per-site daily ceiling, then refuses', async () => {
    const firestore = fakeFirestore()
    for (let n = 1; n <= RECOVER_SENDS_PER_HOST_PER_DAY; n += 1) {
      const result = await consumeMembershipRecoverSend({
        hostId: 'host-1',
        now: NOW,
        firestore,
      })
      expect(result.allowed).toBe(true)
    }
    const over = await consumeMembershipRecoverSend({
      hostId: 'host-1',
      now: NOW,
      firestore,
    })
    expect(over.allowed).toBe(false)
    expect(over.limited).toBe('host')
  })

  it('gives each site its own budget', async () => {
    const firestore = fakeFirestore()
    for (let n = 0; n <= RECOVER_SENDS_PER_HOST_PER_DAY; n += 1) {
      await consumeMembershipRecoverSend({
        hostId: 'host-1',
        now: NOW,
        firestore,
      })
    }
    const other = await consumeMembershipRecoverSend({
      hostId: 'host-2',
      now: NOW,
      firestore,
    })
    expect(other.allowed).toBe(true)
  })

  it('rolls over after a day', async () => {
    const firestore = fakeFirestore()
    for (let n = 0; n <= RECOVER_SENDS_PER_HOST_PER_DAY; n += 1) {
      await consumeMembershipRecoverSend({
        hostId: 'host-1',
        now: NOW,
        firestore,
      })
    }
    const tomorrow = await consumeMembershipRecoverSend({
      hostId: 'host-1',
      now: NOW + RECOVER_SEND_WINDOW_MS,
      firestore,
    })
    expect(tomorrow.allowed).toBe(true)
  })
})
