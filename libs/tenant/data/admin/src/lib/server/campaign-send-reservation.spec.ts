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
 * The campaign email cap: PER ORG and ATOMIC (AGL-2267).
 *
 * ## The two defects
 *
 * 1. The counter was `hosts/{hostId}/counters/campaignEmailSends` — per SITE —
 *    while `emailSendsPerMonth` is an ORG entitlement, so an org with N sites
 *    got N × the cap it bought.
 * 2. The figure was READ before the send and incremented after delivery, so
 *    two concurrent campaigns both passed the same reading. A read-then-write
 *    cap is not a cap.
 *
 * ## THE DOUBLE HAS TO MODEL CONTENTION, OR IT REPORTS GREEN FOR THE BUG
 *
 * A fake that merely ran a transaction callback and applied its writes would
 * pass this file with the defect intact. So it versions every document,
 * records the versions a transaction read, and RE-RUNS the whole callback if
 * any of them moved — Firestore's optimistic concurrency, and the only reason
 * the second campaign can observe the first one's claim.
 *
 * PER-DOCUMENT versioning is the faithful model here: every contending
 * campaign in one org reads and writes the SAME counter document, so a
 * document version is exactly the thing that moves. (The reservation-row shape
 * that needs per-COLLECTION versioning does not arise — there is one counter,
 * not a row per claim.)
 *
 * ## THE NEGATIVE CONTROL
 *
 * `describe('negative control')` at the bottom runs the OLD read-then-write
 * shape against a NAIVE double — one with no versioning, which is what a
 * careless fake looks like. It passes. That is the point: it proves this
 * file's green comes from the fix and not from the harness, and it proves the
 * harness would have certified the bug.
 *
 * Nothing here sends mail or touches the network; `global.fetch` throws.
 */

import {
  ORG_CAMPAIGN_EMAIL_SENDS_COUNTER,
  orgCampaignEmailSendsForMonth,
  reconcileCampaignSendReservation,
  reserveCampaignEmailSends,
} from './email-metering'

const MONTH = '2026-08'
const ORG = 'org-acme'
const COUNTER_PATH = `orgs/${ORG}/counters/${ORG_CAMPAIGN_EMAIL_SENDS_COUNTER}`

// ---------------------------------------------------------------------------
// Faithful double: per-document versions, abort-and-retry, deep merge
// ---------------------------------------------------------------------------

interface Store {
  docs: Map<string, Record<string, any>>
  versions: Map<string, number>
  aborts: number
}

function newStore(): Store {
  return { docs: new Map(), versions: new Map(), aborts: 0 }
}

function writeDoc(
  store: Store,
  path: string,
  value: Record<string, any>,
  merge: boolean,
) {
  store.docs.set(
    path,
    merge ? { ...(store.docs.get(path) ?? {}), ...value } : { ...value },
  )
  store.versions.set(path, (store.versions.get(path) ?? 0) + 1)
}

function snapshot(store: Store, path: string) {
  const data = store.docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(store: Store, path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    get: async () => snapshot(store, path),
    set: async (value: any, options?: { merge?: boolean }) =>
      writeDoc(store, path, value, Boolean(options?.merge)),
    collection: (name: string) => collectionRef(store, `${path}/${name}`),
  }
}

function collectionRef(store: Store, path: string): any {
  return { doc: (id: string) => docRef(store, `${path}/${id}`) }
}

/**
 * @param versioned false makes this the NAIVE double used by the negative
 *   control — writes are applied without checking whether the read moved.
 */
function makeFirestore(
  store: Store,
  options?: { versioned?: boolean; afterRead?: () => Promise<void> },
) {
  const versioned = options?.versioned !== false
  let hook = options?.afterRead ?? null
  return {
    collection: (name: string) => collectionRef(store, name),
    runTransaction: async (body: (tx: any) => Promise<any>) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const readVersions = new Map<string, number>()
        const writes: Array<{ path: string; value: any; merge: boolean }> = []
        const tx = {
          get: async (ref: any) => {
            readVersions.set(ref.path, store.versions.get(ref.path) ?? 0)
            return snapshot(store, ref.path)
          },
          set: (ref: any, value: any, opts?: any) => {
            writes.push({ path: ref.path, value, merge: Boolean(opts?.merge) })
          },
        }
        const result = await body(tx)
        if (hook && attempt === 0) {
          const parked = hook
          hook = null
          await parked()
        }
        const stale =
          versioned &&
          [...readVersions.entries()].some(
            ([path, version]) => (store.versions.get(path) ?? 0) !== version,
          )
        if (stale) {
          store.aborts += 1
          continue
        }
        for (const write of writes) {
          writeDoc(store, write.path, write.value, write.merge)
        }
        return result
      }
      const error: any = new Error('ABORTED')
      error.code = 10
      throw error
    },
  }
}

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = (async (url: any) => {
    throw new Error(`Blocked outbound request in a spec: ${String(url)}`)
  }) as any
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('the double itself', () => {
  it('aborts and re-runs a transaction whose read moved', async () => {
    const store = newStore()
    let attempts = 0
    const firestore = makeFirestore(store, {
      afterRead: async () => {
        writeDoc(store, COUNTER_PATH, { [MONTH]: 99 }, true)
      },
    })
    await firestore.runTransaction(async (tx: any) => {
      attempts += 1
      await tx.get(docRef(store, COUNTER_PATH))
      tx.set(docRef(store, COUNTER_PATH), { touched: true }, { merge: true })
    })
    expect(attempts).toBe(2)
    expect(store.aborts).toBe(1)
  })
})

describe('reserveCampaignEmailSends', () => {
  it('claims the whole batch up front', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 300,
      limit: 5_000,
      firestore,
    })
    expect(result.ok).toBe(true)
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(300)
  })

  it('refuses a batch that would cross the cap, and writes nothing', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: 4_900 }, false)
    const version = store.versions.get(COUNTER_PATH)
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 200,
      limit: 5_000,
      firestore,
    })
    expect(result.ok).toBe(false)
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(4_900)
    expect(store.versions.get(COUNTER_PATH)).toBe(version)
  })

  it('admits a batch that exactly reaches the cap', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: 4_900 }, false)
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 100,
      limit: 5_000,
      firestore,
    })
    expect(result.ok).toBe(true)
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(5_000)
  })

  it('admits everything under an UNLIMITED (Infinity) cap', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 1_000_000,
      limit: Number.POSITIVE_INFINITY,
      firestore,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses rather than bypassing when the org cannot be resolved', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: '',
      month: MONTH,
      count: 1,
      limit: 5_000,
      firestore,
    })
    expect(result.ok).toBe(false)
    expect(store.docs.size).toBe(0)
  })

  it('is scoped to the MONTH — another month is untouched headroom', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { '2026-07': 5_000 }, false)
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 5_000,
      limit: 5_000,
      firestore,
    })
    expect(result.ok).toBe(true)
    expect(store.docs.get(COUNTER_PATH)?.['2026-07']).toBe(5_000)
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(5_000)
  })

  it('reads a corrupt negative counter as zero, not as headroom', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: -1_000_000 }, false)
    const firestore = makeFirestore(store)
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 6_000,
      limit: 5_000,
      firestore,
    })
    expect(result.ok).toBe(false)
  })

  /**
   * THE ISSUE, reproduced and closed. Two campaigns start against a cap of
   * 500 with 400 already used; each wants 100. Exactly one may pass.
   */
  it('CANNOT be raced: two concurrent campaigns cannot both take the last slot', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: 400 }, false)
    let second: any = null
    const firestore = makeFirestore(store, {
      afterRead: async () => {
        second = await reserveCampaignEmailSends({
          orgId: ORG,
          month: MONTH,
          count: 100,
          limit: 500,
          firestore: makeFirestore(store),
        })
      },
    })
    const first = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 100,
      limit: 500,
      firestore,
    })
    expect(second.ok).toBe(true)
    // The first transaction re-ran against the raised figure and was refused.
    expect(store.aborts).toBeGreaterThan(0)
    expect(first.ok).toBe(false)
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(500)
  })
})

describe('reconcileCampaignSendReservation', () => {
  it('gives back the undelivered part', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    const claim = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 500,
      limit: 5_000,
      firestore,
    })
    expect(claim.ok).toBe(true)
    await reconcileCampaignSendReservation(
      (claim as any).reservation,
      300,
      firestore,
    )
    // The customer is charged for the 300 that went out, not the 500 claimed.
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(300)
  })

  it('is a no-op when everything was delivered', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    writeDoc(store, COUNTER_PATH, { [MONTH]: 500 }, false)
    const version = store.versions.get(COUNTER_PATH)
    await reconcileCampaignSendReservation(
      { orgId: ORG, month: MONTH, reserved: 500 },
      500,
      firestore,
    )
    expect(store.versions.get(COUNTER_PATH)).toBe(version)
  })

  it('never drives the counter below zero', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    writeDoc(store, COUNTER_PATH, { [MONTH]: 10 }, false)
    await reconcileCampaignSendReservation(
      { orgId: ORG, month: MONTH, reserved: 500 },
      0,
      firestore,
    )
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(0)
  })

  it('does not undo a claim another campaign took in the meantime', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: 500 }, false)
    const firestore = makeFirestore(store, {
      afterRead: async () => {
        // A second campaign claims 100 while the refund is in flight.
        await reserveCampaignEmailSends({
          orgId: ORG,
          month: MONTH,
          count: 100,
          limit: 5_000,
          firestore: makeFirestore(store),
        })
      },
    })
    await reconcileCampaignSendReservation(
      { orgId: ORG, month: MONTH, reserved: 500 },
      300,
      firestore,
    )
    // 500 claimed + 100 claimed = 600, refund 200 → 400. NOT 300, which is
    // what a refund computed from the stale read would have written.
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(400)
  })

  it('never throws — bookkeeping runs after mail has already gone out', async () => {
    const exploding: any = {
      collection: () => ({
        doc: () => ({ collection: () => ({ doc: () => ({ path: 'x' }) }) }),
      }),
      runTransaction: async () => {
        throw new Error('UNAVAILABLE')
      },
    }
    await expect(
      reconcileCampaignSendReservation(
        { orgId: ORG, month: MONTH, reserved: 10 },
        1,
        exploding,
      ),
    ).resolves.toBeUndefined()
  })

  it('ignores a missing reservation', async () => {
    await expect(
      reconcileCampaignSendReservation(null, 5),
    ).resolves.toBeUndefined()
  })
})

describe('orgCampaignEmailSendsForMonth', () => {
  it('reads the month, clamping absent and corrupt values to zero', async () => {
    const store = newStore()
    const firestore = makeFirestore(store)
    expect(await orgCampaignEmailSendsForMonth(ORG, MONTH, firestore)).toBe(0)
    writeDoc(store, COUNTER_PATH, { [MONTH]: -3 }, false)
    expect(await orgCampaignEmailSendsForMonth(ORG, MONTH, firestore)).toBe(0)
    writeDoc(store, COUNTER_PATH, { [MONTH]: 42 }, false)
    expect(await orgCampaignEmailSendsForMonth(ORG, MONTH, firestore)).toBe(42)
  })

  it('is zero for an unresolvable org rather than throwing', async () => {
    expect(await orgCampaignEmailSendsForMonth('', MONTH)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL
// ---------------------------------------------------------------------------

/**
 * Proof that this file's greens come from the fix and not from the harness.
 *
 * `readThenWrite` is the OLD shape — read the counter with a plain get, decide,
 * send, increment afterwards. Run against a NAIVE double (no version check,
 * which is what a careless fake looks like) it passes the very case the
 * versioned double above catches: both campaigns are admitted and the counter
 * finishes at 600 against a cap of 500.
 *
 * If a future edit weakens the double back to that, these two tests flip and
 * say so.
 */
describe('negative control: the old shape against a naive double', () => {
  async function readThenWrite(
    store: Store,
    limit: number,
    count: number,
    interleave?: () => Promise<void>,
  ): Promise<boolean> {
    const used = Number(store.docs.get(COUNTER_PATH)?.[MONTH] ?? 0)
    if (used + count > limit) return false
    if (interleave) await interleave()
    // The delivered-count increment, applied after the send.
    const now = Number(store.docs.get(COUNTER_PATH)?.[MONTH] ?? 0)
    writeDoc(store, COUNTER_PATH, { [MONTH]: now + count }, true)
    return true
  }

  it('the naive double lets BOTH campaigns through — the bug, certified green', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: 400 }, false)
    let second = false
    const first = await readThenWrite(store, 500, 100, async () => {
      second = await readThenWrite(store, 500, 100)
    })
    expect(first).toBe(true)
    expect(second).toBe(true)
    // 600 sent against a cap of 500.
    expect(store.docs.get(COUNTER_PATH)?.[MONTH]).toBe(600)
  })

  it('a naive (unversioned) transaction double also lets both through', async () => {
    const store = newStore()
    writeDoc(store, COUNTER_PATH, { [MONTH]: 400 }, false)
    let second: any = null
    const naive = makeFirestore(store, {
      versioned: false,
      afterRead: async () => {
        second = await reserveCampaignEmailSends({
          orgId: ORG,
          month: MONTH,
          count: 100,
          limit: 500,
          firestore: makeFirestore(store, { versioned: false }),
        })
      },
    })
    const first = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 100,
      limit: 500,
      firestore: naive,
    })
    // The FIXED code, run against an unfaithful fake, reports the bug's
    // outcome. The correctness is in the storage semantics, so a double that
    // does not model them cannot testify about it either way.
    expect(second.ok).toBe(true)
    expect(first.ok).toBe(true)
    expect(store.aborts).toBe(0)
  })
})
