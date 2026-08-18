/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The replay store's retention period (AGL-1978).
 *
 * `apiIdempotency` was unbounded against a live org, and the reason that
 * matters is not document count: a settled claim stores the ORIGINAL
 * RESPONSE BODY, which for the REST API is the created record's `values`.
 * The collection was therefore a permanent second copy of every record
 * created through the API — one that outlived the record's own deletion, as
 * `conventions.md` advertised in terms.
 *
 * The period is asserted in BOTH directions here. A retention guard that
 * only proves something expires passes trivially if the code expires
 * everything immediately, and an idempotency key that expires immediately is
 * a duplicate-charge bug wearing a privacy fix's clothes.
 */

import {
  API_IDEMPOTENCY_RETENTION_DAYS,
  apiIdempotencyExpiry,
  claimAttempt,
  type IdempotencyStore,
} from './api-idempotency'

const DAY_MS = 24 * 60 * 60 * 1000

/** In-memory store modelling the one behaviour the claim depends on:
 * `create()` REJECTS on an existing document. A fake that overwrote instead
 * would make every dedupe assertion in this file green and meaningless. */
function makeStore() {
  const docs = new Map<string, Record<string, unknown>>()
  const store: IdempotencyStore = {
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`
        return {
          create: async (data: Record<string, unknown>) => {
            if (docs.has(path)) throw new Error('ALREADY_EXISTS')
            docs.set(path, { ...data })
            return undefined
          },
          get: async () => ({
            get: (field: string) => docs.get(path)?.[field],
          }),
          set: async (data: Record<string, unknown>, options: { merge: boolean }) => {
            docs.set(path, {
              ...(options.merge ? (docs.get(path) ?? {}) : {}),
              ...data,
            })
            return undefined
          },
          delete: async () => {
            docs.delete(path)
            return undefined
          },
        }
      },
    }),
  }
  return { store, docs }
}

const SCOPE = {
  kind: 'records',
  scopeId: 'org-1:ds_1',
  orgId: 'org-1',
  key: 'client-key-1',
  busyMessage: 'still in progress',
}

describe('apiIdempotencyExpiry', () => {
  it('is exactly one period ahead, as a Date not a number', () => {
    const now = new Date('2026-08-18T00:00:00Z')
    const expiry = apiIdempotencyExpiry(now)
    // A number governs NOTHING: a TTL policy keys on a Firestore Timestamp
    // and ignores a number field. The existing `createdAtMs`/`settledAtMs`
    // fields are numbers, which is why a new field was needed at all.
    expect(expiry).toBeInstanceOf(Date)
    expect(expiry.getTime() - now.getTime()).toBe(
      API_IDEMPOTENCY_RETENTION_DAYS * DAY_MS,
    )
  })

  it('THE NEGATIVE CONTROL: the window is long enough to be a retry window', () => {
    // The direction that actually protects customers. An expiry stamped in
    // the past — or a period accidentally set to hours — silently turns
    // every retry into a duplicate record, and every duplicate into a
    // duplicate CHARGE on the POS and marketplace paths that share this
    // store. A guard that only checked "it expires" would pass.
    const now = new Date('2026-08-18T00:00:00Z')
    const ahead = apiIdempotencyExpiry(now).getTime() - now.getTime()
    expect(ahead).toBeGreaterThan(7 * DAY_MS)
    // …and bounded, so "never expires" cannot creep back in as a very large
    // number that reads as a fix.
    expect(ahead).toBeLessThanOrEqual(90 * DAY_MS)
  })
})

describe('claimAttempt stamps the field the TTL policy keys on', () => {
  it('a claim carries expiresAt in the future', async () => {
    const { store, docs } = makeStore()
    const before = Date.now()
    const result = await claimAttempt(store, SCOPE)
    expect('claim' in result).toBe(true)

    const [claimDoc] = [...docs.values()]
    expect(claimDoc.expiresAt).toBeInstanceOf(Date)
    expect((claimDoc.expiresAt as Date).getTime()).toBeGreaterThan(before)
  })

  it('settling the claim does NOT clear the expiry', async () => {
    // `record()` is a `set(merge: true)`, so the field survives — but that
    // is a property of the call, not a law, and a future switch to a
    // non-merging write would silently un-govern every settled claim while
    // leaving pending ones covered. That is the hardest kind of retention
    // bug to notice, because the collection still shrinks.
    const { store, docs } = makeStore()
    const result = await claimAttempt(store, SCOPE)
    if (!('claim' in result)) throw new Error('expected a claim')
    await result.claim.record(200, { id: 'rec_1', values: { name: 'Avery' } })

    const [claimDoc] = [...docs.values()]
    expect(claimDoc.status).toBe('done')
    expect(claimDoc.expiresAt).toBeInstanceOf(Date)
  })

  it('a keyless attempt writes no document, so there is nothing to expire', async () => {
    const { store, docs } = makeStore()
    const result = await claimAttempt(store, { ...SCOPE, key: '' })
    expect('claim' in result).toBe(true)
    expect(docs.size).toBe(0)
  })

  it('the expiry did not break the dedupe it protects', async () => {
    // The whole reason the collection exists. Adding a retention field must
    // not change the primitive: the second identical attempt replays rather
    // than creating a second record.
    const { store } = makeStore()
    const first = await claimAttempt(store, SCOPE)
    if (!('claim' in first)) throw new Error('expected a claim')
    await first.claim.record(201, { id: 'rec_1' })

    const second = await claimAttempt(store, SCOPE)
    expect(second).toEqual({ replay: { status: 201, body: { id: 'rec_1' } } })
  })
})
