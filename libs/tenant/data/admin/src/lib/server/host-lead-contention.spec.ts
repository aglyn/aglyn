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
 * What the lead writer may and may not serialise against.
 *
 * Two rules pull in opposite directions here, and the reason this file exists
 * is that each one is enforced somewhere a test of the other cannot see.
 *
 *  - The rate-limit counter (`rate-limit-store.ts`) must open NO transaction.
 *    It is a per-(key, window) document touched by every request, so a
 *    read-modify-write there is a hot document, and one hot document is how
 *    AGL-2404 became ten seconds of held function and a bodyless 504.
 *  - The lead ceiling MUST evaluate its count inside the transaction that
 *    writes. A create-time quota is laundered by WHEN it is evaluated
 *    (AGL-2231/2265/2266): read-then-decide-then-write lets N concurrent
 *    visitors read the same pre-count, each find room, and each land, and
 *    nothing re-counts afterwards, so the extra rows are permanent.
 *
 * Both are load-bearing and neither may be traded for the other. The property
 * that reconciles them is about WHICH captures pay the collection-wide read:
 * only a genuinely new person does. A returning visitor's capture reads one
 * document, so two returning visitors — or a returning visitor and a new one —
 * do not abort each other, and the serialisation that guards the quota is paid
 * only on the writes that can actually move it.
 *
 * ## Why the double models a document VERSION
 *
 * `host-lead-dedupe.spec.ts` runs the transaction body inline. That double has
 * no read set and no version, so no two transactions can ever conflict and a
 * contention assertion written against it passes under ANY implementation —
 * including one that takes a collection-wide read lock on every capture. This
 * one stamps a version on every write, records the versions a transaction
 * READ, and aborts the attempt if any of them moved before the commit, which
 * is the optimistic-concurrency rule Firestore actually applies. A read of the
 * count aggregate takes a dependency on the whole collection, because that is
 * what `Transaction.get(AggregateQuery)` does and it is the entire reason it
 * can serialise a quota.
 *
 * `contentionNegativeControl` below proves the double can go red, so a green
 * from it means the implementation avoided contention rather than the double
 * being unable to detect it.
 */

import { personKey } from '@aglyn/aglyn/server'

const HOST_ID = 'site-1'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

jest.mock('./notifications', () => ({
  __esModule: true,
  notifyHostManagers: async () => undefined,
}))

/** The whole collection, as one read target. */
const COLLECTION_PATH = 'leads'

/** One round trip. `setImmediate` so concurrent callers really interleave. */
const hop = () => new Promise((resolve) => setImmediate(resolve))

function fakeLeadStore() {
  /** doc id → fields. */
  const leads = new Map<string, Record<string, any>>()
  /**
   * Read-dependency path → monotonic version. A document has its own; the
   * collection has one too, bumped by every create, because that is the
   * dependency a count aggregate takes.
   */
  const versions = new Map<string, number>([[COLLECTION_PATH, 0]])
  const counts = { aborts: 0, countReads: 0, docReads: 0, commits: 0 }
  let autoId = 0

  const bump = (path: string) =>
    versions.set(path, (versions.get(path) ?? 0) + 1)

  const applyMerge = (prior: Record<string, any>, patch: Record<string, any>) => {
    const next = { ...prior }
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && '__increment' in value) {
        next[key] = Number(next[key] ?? 0) + (value as any).__increment
      } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
        const current: unknown[] = Array.isArray(next[key]) ? next[key] : []
        for (const entry of (value as any).__arrayUnion) {
          if (!current.includes(entry)) current.push(entry)
        }
        next[key] = current
      } else {
        next[key] = value
      }
    }
    return next
  }

  function write(id: string, patch: Record<string, any>) {
    const isCreate = !leads.has(id)
    leads.set(id, applyMerge(leads.get(id) ?? {}, patch))
    bump(id)
    // A create changes the count, so it invalidates a reader of the aggregate.
    // An update to an existing person does not.
    if (isCreate) bump(COLLECTION_PATH)
  }

  const leadDoc = (id: string) => ({ __doc: id, id })

  const leadsCollection = {
    doc: (id?: string) => leadDoc(id ?? `auto-${(autoId += 1)}`),
    count: () => ({ __count: true }),
  }

  const hostRef: any = {
    firestore: {
      runTransaction: async (body: (tx: any) => Promise<boolean>) => {
        // Firestore's own default.
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const readVersions = new Map<string, number>()
          const pending: Array<[string, Record<string, any>]> = []
          const tx = {
            get: async (target: any) => {
              await hop()
              if (target?.__count) {
                counts.countReads += 1
                readVersions.set(
                  COLLECTION_PATH,
                  versions.get(COLLECTION_PATH) ?? 0,
                )
                return { data: () => ({ count: leads.size }) }
              }
              counts.docReads += 1
              readVersions.set(target.__doc, versions.get(target.__doc) ?? 0)
              const data = leads.get(target.__doc)
              return {
                exists: data !== undefined,
                id: target.__doc,
                get: (field: string) => data?.[field],
              }
            },
            set: (ref: any, patch: Record<string, any>) => {
              pending.push([ref.__doc, patch])
            },
          }
          const result = await body(tx)
          // The commit is its own round trip — the window another writer
          // slips through.
          await hop()
          const stale = [...readVersions].some(
            ([path, version]) => (versions.get(path) ?? 0) !== version,
          )
          if (stale) {
            counts.aborts += 1
            continue
          }
          for (const [id, patch] of pending) write(id, patch)
          counts.commits += 1
          return result
        }
        throw Object.assign(new Error('too much contention'), { code: 10 })
      },
    },
    collection: (name: string) =>
      name === 'leads'
        ? leadsCollection
        : {
            doc: () => ({
              get: async () => ({ get: () => 0 }),
              set: async () => undefined,
            }),
          },
  }

  return { leads, counts, hostRef, seed: write }
}

import { addHostLead } from './host-visitor-records'

const capture = (
  store: ReturnType<typeof fakeLeadStore>,
  email: string,
  extra: Record<string, any> = {},
) =>
  addHostLead({
    hostRef: store.hostRef,
    hostId: HOST_ID,
    lead: { email, source: 'form:f1', ...extra } as any,
  })

/**
 * The lead writer EXACTLY as it would be if the count read were taken on every
 * capture rather than only on a new person — the shape this file forbids,
 * driven through the same double.
 *
 * Without this, a green above could mean the double cannot see contention at
 * all. With it, the double is shown to go red on demand.
 */
function contentionNegativeControl(
  store: ReturnType<typeof fakeLeadStore>,
  id: string,
) {
  return store.hostRef.firestore.runTransaction(async (tx: any) => {
    await tx.get({ __doc: id })
    await tx.get({ __count: true })
    tx.set({ __doc: id }, { touched: true })
    return false
  })
}

describe('the double can detect contention at all', () => {
  it('aborts two concurrent readers of the count when one of them creates', async () => {
    const store = fakeLeadStore()
    await Promise.all([
      contentionNegativeControl(store, 'a'),
      contentionNegativeControl(store, 'b'),
    ])
    // Both read the collection version; the first to commit created a
    // document, which bumped it, so the second had to retry.
    expect(store.counts.aborts).toBeGreaterThan(0)
  })
})

describe('a returning person never contends with anyone', () => {
  it('two returning people captured at once neither abort nor retry', async () => {
    const store = fakeLeadStore()
    // Both already exist, so neither capture grows the collection.
    await capture(store, 'one@example.com')
    await capture(store, 'two@example.com')
    store.counts.aborts = 0
    store.counts.countReads = 0

    await Promise.all([
      capture(store, 'one@example.com'),
      capture(store, 'two@example.com'),
    ])

    // The property. A returning capture reads ONE document, so two of them
    // touch disjoint read sets and cannot abort each other.
    expect(store.counts.aborts).toBe(0)
    expect(store.counts.countReads).toBe(0)
  })

  it('a returning capture is not aborted by an unrelated new person landing', async () => {
    const store = fakeLeadStore()
    await capture(store, 'one@example.com')
    store.counts.aborts = 0
    store.counts.countReads = 0

    // A new person bumps the collection version. A returning capture that
    // took a collection-wide read would lose its race against that.
    await Promise.all([
      capture(store, 'one@example.com'),
      capture(store, 'brand-new@example.com'),
    ])

    expect(store.counts.aborts).toBe(0)
    expect(store.leads.size).toBe(2)
    // Exactly ONE of the two paid the collection-wide read — the new person.
    // Asserted alongside the abort count because that one is settled by which
    // attempt commits first, while this one holds whatever the order was.
    expect(store.counts.countReads).toBe(1)
  })

  it('still records the source and the count it was captured with', async () => {
    // A contention-free path that dropped the data would satisfy the
    // assertions above and be worthless.
    const store = fakeLeadStore()
    await capture(store, 'one@example.com', { source: 'signup' })
    await capture(store, 'one@example.com', { source: 'booking' })
    const lead = store.leads.get(personKey('one@example.com') as string)
    expect(lead?.['sources']).toEqual(['signup', 'booking'])
    expect(lead?.['submissionCount']).toBe(2)
  })
})

describe('a new person still pays the serialised count', () => {
  it('reads the count aggregate inside the transaction that writes', async () => {
    // The anti-laundering property (AGL-2231/2265/2266). If this read moved
    // out of the transaction, or stopped happening, N concurrent visitors
    // could each read the same pre-count and each land past the ceiling.
    const store = fakeLeadStore()
    await capture(store, 'brand-new@example.com')
    expect(store.counts.countReads).toBe(1)
  })

  it('serialises two new people against each other, so the quota cannot be laundered', async () => {
    const store = fakeLeadStore()
    await Promise.all([
      capture(store, 'new-one@example.com'),
      capture(store, 'new-two@example.com'),
    ])
    // Both took the collection dependency, so one retried and re-read a
    // higher count rather than deciding against a stale one.
    expect(store.counts.aborts).toBeGreaterThan(0)
    expect(store.leads.size).toBe(2)
  })
})
