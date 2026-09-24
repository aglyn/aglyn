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
 * The three platform carries of a consent group change (AGL-3320): a site
 * about to stop reading another's refusals gets a copy of them first.
 *
 * Each store is held to the rule that makes a carry safe to run any number of
 * times — it only ever ADDS a refusal the receiving site lacks, and never
 * rewrites one it has — and I5 pins the consequence: a second full run writes
 * nothing, and a run resumed page by page from its cursor ends exactly where
 * one uninterrupted run does.
 */

import { Timestamp } from 'firebase-admin/firestore'
import { type ConsentGroupCarryStore, carryConsentGroupRefusals } from './consent-group-carry'
import { queryFakeFirestore } from './test-firestore-queries'

const FROM = 'site-r'
const TO = 'site-x'
const CARRY = { toHostId: TO, fromHostId: FROM }
const CHANGE = 'change-1'
const at = (ms: number) => Timestamp.fromMillis(ms)

/** Runs one store's carry to the end, page by page, like the executor does. */
async function carryAll(
  firestore: ReturnType<typeof queryFakeFirestore>,
  store: ConsentGroupCarryStore,
  options: { pageSize?: number; sinceMs?: number | null; dryRun?: boolean } = {},
) {
  let cursor: string | null = null
  let written = 0
  let pages = 0
  for (;;) {
    const page = await carryConsentGroupRefusals({
      firestore: firestore as never,
      store,
      carry: CARRY,
      changeId: CHANGE,
      cursor,
      ...options,
    })
    written += page.written
    pages += 1
    cursor = page.cursor
    if (page.done) return { written, pages }
  }
}

describe('C1 — the site suppression list', () => {
  const seed = () =>
    queryFakeFirestore({
      [`hosts/${FROM}/suppressions/k-unsub`]: {
        email: 'pat@example.com',
        reason: 'unsubscribe',
        createdAt: at(1_000),
        suppressedAt: at(2_000),
        campaignId: 'camp-1',
        topicId: 'newsletter',
      },
      [`hosts/${FROM}/suppressions/k-erased`]: {
        email: null,
        reason: 'erasure',
        createdAt: at(3_000),
        suppressedAt: at(3_000),
      },
      [`hosts/${FROM}/suppressions/k-manual`]: {
        email: 'lee@example.com',
        reason: 'manual',
        note: 'Asked by phone',
        suppressedByUid: 'uid-staff',
        createdAt: at(4_000),
        suppressedAt: at(4_000),
      },
      // The receiving site's own row for the same person, with its own reason.
      [`hosts/${TO}/suppressions/k-manual`]: {
        email: 'lee@example.com',
        reason: 'bounce',
        createdAt: at(500),
        suppressedAt: at(500),
      },
    })

  it('creates the rows the receiving site lacks, with the reason, the dates and provenance', async () => {
    const firestore = seed()
    expect(await carryAll(firestore, 'siteSuppressions')).toMatchObject({ written: 2 })
    const unsub = firestore.read(`hosts/${TO}/suppressions/k-unsub`)
    expect(unsub).toMatchObject({
      email: 'pat@example.com',
      reason: 'unsubscribe',
      campaignId: 'camp-1',
      topicId: 'newsletter',
      carriedFromHostId: FROM,
      carriedByChangeId: CHANGE,
    })
    expect(unsub?.['createdAt']).toEqual(at(1_000))
    expect(unsub?.['suppressedAt']).toEqual(at(2_000))
    expect(unsub?.['carriedAt']).toBeInstanceOf(Timestamp)
    // An erasure row keeps its null address: the hash is the whole record.
    expect(firestore.read(`hosts/${TO}/suppressions/k-erased`)).toMatchObject({
      email: null,
      reason: 'erasure',
    })
  })

  it('never rewrites a row the receiving site already has', async () => {
    const firestore = seed()
    await carryAll(firestore, 'siteSuppressions')
    expect(firestore.read(`hosts/${TO}/suppressions/k-manual`)).toEqual({
      email: 'lee@example.com',
      reason: 'bounce',
      createdAt: at(500),
      suppressedAt: at(500),
    })
  })

  it('I5: a second run writes nothing', async () => {
    const firestore = seed()
    await carryAll(firestore, 'siteSuppressions')
    firestore.resetWrites()
    expect(await carryAll(firestore, 'siteSuppressions')).toMatchObject({ written: 0 })
    expect(firestore.writes()).toBe(0)
  })

  it('a catch-up reads only what was suppressed since, by suppressedAt', async () => {
    const firestore = seed()
    expect(await carryAll(firestore, 'siteSuppressions', { sinceMs: 2_500 })).toMatchObject({
      written: 1,
    })
    expect(firestore.read(`hosts/${TO}/suppressions/k-erased`)).toBeDefined()
    expect(firestore.read(`hosts/${TO}/suppressions/k-unsub`)).toBeUndefined()
  })

  it('a dry run counts and writes nothing', async () => {
    const firestore = seed()
    firestore.resetWrites()
    expect(await carryAll(firestore, 'siteSuppressions', { dryRun: true })).toMatchObject({
      written: 2,
    })
    expect(firestore.writes()).toBe(0)
  })
})

describe('C2 — topic opt-outs', () => {
  const seed = () =>
    queryFakeFirestore({
      [`hosts/${FROM}/topicOptOuts/k1`]: {
        email: 'pat@example.com',
        topics: {
          // Live: carried.
          newsletter: { optedOutAt: at(1_000), resubscribedAt: null },
          // Rejoined: not a refusal any more.
          marketing: { optedOutAt: at(900), resubscribedAt: at(1_100) },
          // Asked and never answered: a question, not a refusal — not carried.
          sales: { pendingAt: 1_200, confirmedAt: null },
        },
        updatedAt: at(1_200),
      },
      [`hosts/${FROM}/topicOptOuts/k2`]: {
        email: 'lee@example.com',
        topics: { newsletter: { optedOutAt: at(2_000), resubscribedAt: null } },
        updatedAt: at(2_000),
      },
      // The receiving site already knows k2: its own confirmation and its own opt-out.
      [`hosts/${TO}/topicOptOuts/k2`]: {
        email: 'lee@example.com',
        topics: {
          sales: { pendingAt: 100, confirmedAt: 200 },
          newsletter: { optedOutAt: at(150), resubscribedAt: null },
        },
        createdAt: at(100),
        updatedAt: at(200),
      },
    })

  it('carries live opt-outs only, dated when the person left the source site', async () => {
    const firestore = seed()
    expect(await carryAll(firestore, 'topicOptOuts')).toMatchObject({ written: 1 })
    const carried = firestore.read(`hosts/${TO}/topicOptOuts/k1`)
    expect(carried?.['email']).toBe('pat@example.com')
    expect(carried?.['topics']).toEqual({
      newsletter: { optedOutAt: at(1_000), resubscribedAt: null, carriedFromHostId: FROM },
    })
    expect(carried?.['createdAt']).toBeInstanceOf(Timestamp)
  })

  it('keeps the receiving site’s own evidence and never restamps an opt-out it holds', async () => {
    const firestore = seed()
    await carryAll(firestore, 'topicOptOuts')
    expect(firestore.read(`hosts/${TO}/topicOptOuts/k2`)?.['topics']).toEqual({
      sales: { pendingAt: 100, confirmedAt: 200 },
      newsletter: { optedOutAt: at(150), resubscribedAt: null },
    })
  })

  it('turns a receiving site’s rejoined stream back into an opt-out, keeping its entry', async () => {
    const firestore = seed()
    firestore.seed(`hosts/${TO}/topicOptOuts/k1`, {
      email: 'pat@example.com',
      topics: { newsletter: { optedOutAt: at(10), resubscribedAt: at(20) } },
      createdAt: at(10),
      updatedAt: at(20),
    })
    await carryAll(firestore, 'topicOptOuts')
    const doc = firestore.read(`hosts/${TO}/topicOptOuts/k1`)
    expect(doc?.['topics']).toEqual({
      newsletter: { optedOutAt: at(1_000), resubscribedAt: null, carriedFromHostId: FROM },
    })
    expect(doc?.['createdAt']).toEqual(at(10))
  })

  it('I5: a second run writes nothing', async () => {
    const firestore = seed()
    await carryAll(firestore, 'topicOptOuts')
    firestore.resetWrites()
    expect(await carryAll(firestore, 'topicOptOuts')).toMatchObject({ written: 0 })
    expect(firestore.writes()).toBe(0)
  })

  it('decides again from a fresh read when the receiving document moved under it', async () => {
    const firestore = seed()
    // A signup on the receiving site creates its document between the carry's
    // read and its write: the create is refused, and the retry keeps both the
    // signup's entry and the carried opt-out.
    const realBulkWriter = firestore.bulkWriter.bind(firestore)
    let raced = false
    ;(firestore as { bulkWriter: () => unknown }).bulkWriter = () => {
      const writer = realBulkWriter()
      const close = writer.close
      writer.close = async () => {
        if (!raced) {
          raced = true
          firestore.seed(`hosts/${TO}/topicOptOuts/k1`, {
            email: 'pat@example.com',
            topics: { sales: { pendingAt: 7_000, confirmedAt: null } },
            createdAt: at(7_000),
            updatedAt: at(7_000),
          })
        }
        return close()
      }
      return writer
    }
    expect(await carryAll(firestore, 'topicOptOuts')).toMatchObject({ written: 1 })
    expect(raced).toBe(true)
    expect(firestore.read(`hosts/${TO}/topicOptOuts/k1`)).toMatchObject({
      createdAt: at(7_000),
      topics: {
        sales: { pendingAt: 7_000, confirmedAt: null },
        newsletter: { optedOutAt: at(1_000), resubscribedAt: null, carriedFromHostId: FROM },
      },
    })
  })
})

describe('C3 — the pace', () => {
  const seed = () =>
    queryFakeFirestore({
      // Chose monthly on the source site after choosing weekly on the receiver.
      [`hosts/${FROM}/emailFrequency/k1`]: {
        email: 'pat@example.com',
        cadence: 'monthly',
        cadenceSetAtMs: 2_000,
        lastSentAtMs: 9_000,
        sentAtMs: [9_000],
        firstSentAtMs: 1_000,
      },
      [`hosts/${TO}/emailFrequency/k1`]: {
        email: 'pat@example.com',
        cadence: 'weekly',
        cadenceSetAtMs: 1_000,
        lastSentAtMs: 5_000,
        sentAtMs: [5_000],
        firstSentAtMs: 500,
      },
      // An older choice on the source: the receiver's newer one stands, but
      // it learns the source's more recent send.
      [`hosts/${FROM}/emailFrequency/k2`]: {
        email: 'lee@example.com',
        cadence: 'daily',
        cadenceSetAtMs: 100,
        lastSentAtMs: 8_000,
      },
      [`hosts/${TO}/emailFrequency/k2`]: {
        email: 'lee@example.com',
        cadence: 'weekly',
        cadenceSetAtMs: 300,
        lastSentAtMs: 7_000,
      },
      // The receiver has never mailed this person and holds no document.
      [`hosts/${FROM}/emailFrequency/k3`]: {
        email: 'sam@example.com',
        cadence: 'weekly',
        cadenceSetAtMs: 50,
        sentAtMs: [6_000, 6_500],
      },
      // Sends only, no choice anywhere: nothing to carry.
      [`hosts/${FROM}/emailFrequency/k4`]: { email: 'kim@example.com', lastSentAtMs: 4_000 },
    })

  it('carries the most recent choice, with provenance, and the later last send', async () => {
    const firestore = seed()
    await carryAll(firestore, 'paces')
    expect(firestore.read(`hosts/${TO}/emailFrequency/k1`)).toEqual({
      email: 'pat@example.com',
      cadence: 'monthly',
      cadenceSetAtMs: 2_000,
      cadenceCarriedFromHostId: FROM,
      lastSentAtMs: 9_000,
      // The counters are the receiving site's own and never move.
      sentAtMs: [5_000],
      firstSentAtMs: 500,
    })
  })

  it('keeps a newer choice on the receiver, and learns the later send for its pace', async () => {
    const firestore = seed()
    await carryAll(firestore, 'paces')
    expect(firestore.read(`hosts/${TO}/emailFrequency/k2`)).toEqual({
      email: 'lee@example.com',
      cadence: 'weekly',
      cadenceSetAtMs: 300,
      lastSentAtMs: 8_000,
    })
  })

  it('creates a pace document without send counters for a person the receiver never mailed', async () => {
    const firestore = seed()
    await carryAll(firestore, 'paces')
    expect(firestore.read(`hosts/${TO}/emailFrequency/k3`)).toEqual({
      email: 'sam@example.com',
      cadence: 'weekly',
      cadenceSetAtMs: 50,
      cadenceCarriedFromHostId: FROM,
      // The newest send in the source's window, the gate's own fallback.
      lastSentAtMs: 6_500,
    })
    expect(firestore.read(`hosts/${TO}/emailFrequency/k4`)).toBeUndefined()
  })

  it('I5: a second run writes nothing', async () => {
    const firestore = seed()
    await carryAll(firestore, 'paces')
    firestore.resetWrites()
    expect(await carryAll(firestore, 'paces')).toMatchObject({ written: 0 })
    expect(firestore.writes()).toBe(0)
  })

  it('a catch-up reads by cadenceSetAtMs', async () => {
    const firestore = seed()
    await carryAll(firestore, 'paces', { sinceMs: 1_500 })
    expect(firestore.read(`hosts/${TO}/emailFrequency/k1`)?.['cadence']).toBe('monthly')
    expect(firestore.read(`hosts/${TO}/emailFrequency/k3`)).toBeUndefined()
  })
})

describe('I5 — resuming from a cursor', () => {
  it('ends page by page exactly where one uninterrupted run does', async () => {
    const seed: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index < 7; index += 1) {
      seed[`hosts/${FROM}/suppressions/k${index}`] = {
        email: `p${index}@example.com`,
        reason: 'unsubscribe',
        suppressedAt: at(1_000 + index),
      }
    }
    const whole = queryFakeFirestore(seed)
    const paged = queryFakeFirestore(seed)
    await carryAll(whole, 'siteSuppressions')
    const result = await carryAll(paged, 'siteSuppressions', { pageSize: 2 })
    expect(result.pages).toBe(4)
    expect(paged.docs(`hosts/${TO}/suppressions`)).toEqual(whole.docs(`hosts/${TO}/suppressions`))
    expect(Object.keys(paged.docs(`hosts/${TO}/suppressions`))).toHaveLength(7)
  })

  it('pages a catch-up by its timestamp without skipping a tie', async () => {
    const seed: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index < 5; index += 1) {
      seed[`hosts/${FROM}/suppressions/k${index}`] = {
        email: `p${index}@example.com`,
        reason: 'unsubscribe',
        // Three rows share one instant.
        suppressedAt: at(index < 3 ? 5_000 : 6_000 + index),
      }
    }
    const firestore = queryFakeFirestore(seed)
    const result = await carryAll(firestore, 'siteSuppressions', { pageSize: 2, sinceMs: 5_000 })
    expect(result.written).toBe(5)
  })
})
