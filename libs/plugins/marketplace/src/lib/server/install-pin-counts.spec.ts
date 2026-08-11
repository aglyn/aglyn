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
 *
 * @jest-environment node
 */

/**
 * Install counts derived from the pins (AGL-1419).
 *
 * Two things are being proved here, and the second matters more than the
 * first. One: the count comes from the pins, which is the only way it can ever
 * come back DOWN. Two: when the aggregation cannot run, the answer is "not
 * counted" and never "zero" — because this module writes its answer back into
 * the listing document, so a zero mistaken for a count is not a bad render, it
 * is durable data loss across every listing on the platform.
 */

import {
  countLivePins,
  countLivePinsByVersion,
  resetPinCountBackoff,
  verifiedLivePins,
  PIN_VERIFY_TTL_MS,
} from './install-pin-counts'

/** The real thing, verbatim from `aglyn-main` before the index was added. */
const missingIndexError = () =>
  Object.assign(
    new Error(
      '9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC ' +
        'index for collection installs and field listingId. You can create ' +
        'it here: https://console.firebase.google.com/...',
    ),
    { code: 9 },
  )

interface Plan {
  total?: number
  byVersion?: Record<string, number>
  /** Throw this instead of answering. */
  error?: () => Error
}

function fakeFirestore(plan: Plan) {
  /** Every aggregation issued, as `listingId` or `listingId@version`. */
  const aggregations: string[] = []
  const answer = (key: string, count: number) => ({
    count: () => ({
      get: async () => {
        aggregations.push(key)
        if (plan.error) throw plan.error()
        return { data: () => ({ count }) }
      },
    }),
  })
  const firestore = {
    collectionGroup(name: string) {
      expect(name).toBe('installs')
      return {
        where(field: string, _op: '==', listingId: unknown) {
          expect(field).toBe('listingId')
          return {
            ...answer(String(listingId), plan.total ?? 0),
            where(vField: string, _vOp: '==', version: unknown) {
              expect(vField).toBe('version')
              return answer(
                `${String(listingId)}@${String(version)}`,
                plan.byVersion?.[String(version)] ?? 0,
              )
            },
          }
        },
      }
    },
  }
  return { firestore, aggregations }
}

function fakeListingRef() {
  const writes: Array<{
    patch: Record<string, unknown>
    precondition: unknown
  }> = []
  return {
    writes,
    ref: {
      update: async (patch: Record<string, unknown>, precondition?: unknown) => {
        writes.push({ patch, precondition })
        return undefined
      },
    },
  }
}

const NOW = 1_800_000_000_000

beforeEach(() => {
  resetPinCountBackoff()
  jest.restoreAllMocks()
})

describe('countLivePins (AGL-1419)', () => {
  it('counts every pin for the listing, wherever it lives', async () => {
    // Production `Tfnrb4wJzF`: two org-wide pins in two different orgs. The
    // aggregation is what makes this affordable — Firestore bills it at about
    // one read per 1000 index entries, not one per pin.
    const { firestore, aggregations } = fakeFirestore({ total: 2 })
    expect(await countLivePins(firestore as never, 'Tfnrb4wJzF')).toBe(2)
    expect(aggregations).toEqual(['Tfnrb4wJzF'])
  })

  it('reports a verified zero as a zero', async () => {
    const { firestore } = fakeFirestore({ total: 0 })
    expect(await countLivePins(firestore as never, 'g-0Fz-7Xf1')).toBe(0)
  })

  /**
   * THE test. A missing index is a `FAILED_PRECONDITION`, and every other
   * counter path in this codebase swallows its failures into `undefined`.
   * Swallowed to a `0` here it would be written back over every listing's
   * `activeInstalls` inside one TTL window.
   */
  it('returns null, never zero, when the index is missing', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { firestore } = fakeFirestore({ error: missingIndexError })
    const result = await countLivePins(firestore as never, 'z6glT_UDAQ')
    expect(result).toBeNull()
    expect(result).not.toBe(0)
    expect(errors).toHaveBeenCalledTimes(1)
    // Loud, and actionable: it names the file to change and the command.
    const said = String(errors.mock.calls[0]?.join(' '))
    expect(said).toMatch(/index is MISSING/)
    expect(said).toMatch(/cloud\/firebase-firestore\.indexes\.json/)
  })

  it('is just as loud about a failure that is not the index', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { firestore } = fakeFirestore({
      error: () => Object.assign(new Error('DEADLINE_EXCEEDED'), { code: 4 }),
    })
    expect(await countLivePins(firestore as never, 'l1')).toBeNull()
    expect(errors).toHaveBeenCalled()
  })
})

describe('countLivePinsByVersion (AGL-1419)', () => {
  it('takes one aggregation per version and no more', async () => {
    const { firestore, aggregations } = fakeFirestore({
      total: 2,
      byVersion: { '1.0.2': 2, '1.0.1': 0, '1.0.0': 0 },
    })
    const split = await countLivePinsByVersion(firestore as never, 'z6glT_UDAQ', [
      '1.0.2',
      '1.0.1',
      '1.0.0',
    ])
    expect(Object.fromEntries(split as Map<string, number>)).toEqual({
      '1.0.2': 2,
      '1.0.1': 0,
      '1.0.0': 0,
    })
    expect(aggregations).toHaveLength(3)
  })

  it('asks once for a version repeated in the history', async () => {
    const { firestore, aggregations } = fakeFirestore({ byVersion: { '1.0.0': 1 } })
    await countLivePinsByVersion(firestore as never, 'l1', ['1.0.0', '1.0.0', ''])
    expect(aggregations).toEqual(['l1@1.0.0'])
  })

  it('fails the whole split rather than reporting a hole as a zero', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { firestore } = fakeFirestore({ error: missingIndexError })
    expect(
      await countLivePinsByVersion(firestore as never, 'l1', ['1.0.0', '1.0.1']),
    ).toBeNull()
  })
})

describe('verifiedLivePins cost and cache (AGL-1419)', () => {
  const listing = (extra: Record<string, unknown> = {}) => ({
    activeInstalls: 3,
    installCount: 10,
    ...extra,
  })

  it('costs a copied artifact nothing at all', async () => {
    // Themes, components, layouts, email templates and dataset schemas
    // install by COPYING and hold no pin. A derived count would be a derived
    // zero written over a real number — this fix causing the damage it exists
    // to repair.
    const { firestore, aggregations } = fakeFirestore({ total: 0 })
    const target = fakeListingRef()
    const result = await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'ZiQtiF63yl',
      listing: listing(),
      artifactType: 'theme',
      nowMs: NOW,
    })
    expect(result).toBeNull()
    expect(aggregations).toEqual([])
    expect(target.writes).toEqual([])
  })

  it('corrects a listing DOWNWARDS, which no accumulator can', async () => {
    // Production `z6glT_UDAQ`: the listing claims 3 active against 2 live
    // pins. Nothing decrements when a tenant erase sweeps `installs`, so the
    // stored number could never have come back on its own.
    const { firestore, aggregations } = fakeFirestore({
      total: 2,
      byVersion: { '1.0.2': 2, '1.0.1': 0, '1.0.0': 0 },
    })
    const target = fakeListingRef()
    const result = await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'z6glT_UDAQ',
      listing: listing(),
      artifactType: 'plugin',
      versionIds: ['1.0.2', '1.0.1', '1.0.0'],
      nowMs: NOW,
    })
    expect(result?.activeInstalls).toBe(2)
    // 1 for the total + 1 per version, paid once per TTL window rather than
    // once per request.
    expect(aggregations).toHaveLength(4)
  })

  it('writes the derived value back, so the stored counter self-heals', async () => {
    const { firestore } = fakeFirestore({ total: 2, byVersion: { '1.0.2': 2 } })
    const target = fakeListingRef()
    await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'z6glT_UDAQ',
      listing: listing(),
      artifactType: 'plugin',
      versionIds: ['1.0.2', '1.0.1'],
      nowMs: NOW,
      updateTime: 'update-time-token',
    })
    expect(target.writes).toHaveLength(1)
    expect(target.writes[0].patch).toMatchObject({
      activeInstalls: 2,
      pinnedActiveInstalls: 2,
      pinsVerifiedAtMs: NOW,
    })
    // All-time is an accumulator the pins cannot verify — an uninstall leaves
    // nothing behind — so it is left alone when it is already above the floor.
    expect(target.writes[0].patch['installCount']).toBeUndefined()
    // The one race that matters: an install landing between the aggregation
    // and this write, whose `increment()` an absolute value would erase.
    expect(target.writes[0].precondition).toEqual({
      lastUpdateTime: 'update-time-token',
    })
  })

  it('raises all-time to the live floor, because a pin IS an install', async () => {
    const { firestore } = fakeFirestore({ total: 4 })
    const target = fakeListingRef()
    await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'l1',
      listing: { activeInstalls: 0, installCount: 1 },
      artifactType: 'plugin',
      versionIds: ['1.0.0'],
      nowMs: NOW,
    })
    expect(target.writes[0].patch['installCount']).toBe(4)
  })

  it('serves a fresh cache without issuing a single aggregation', async () => {
    // The cost claim for the buyer-facing page: the listing document was read
    // by the route already, so an ordinary request pays ZERO extra reads.
    const { firestore, aggregations } = fakeFirestore({ total: 2 })
    const target = fakeListingRef()
    const result = await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'z6glT_UDAQ',
      listing: {
        activeInstalls: 2,
        installCount: 10,
        pinnedActiveInstalls: 2,
        pinnedVersionInstalls: { '1.0.2': 2 },
        pinsVerifiedAtMs: NOW - 1_000,
      },
      artifactType: 'plugin',
      versionIds: ['1.0.2'],
      nowMs: NOW,
    })
    expect(aggregations).toEqual([])
    expect(target.writes).toEqual([])
    expect(result?.activeInstalls).toBe(2)
    expect(Object.fromEntries(result?.byVersion as Map<string, number>)).toEqual({
      '1.0.2': 2,
    })
  })

  it('re-derives once the TTL is up, which is how silent drift is caught', async () => {
    const { firestore, aggregations } = fakeFirestore({ total: 1 })
    const target = fakeListingRef()
    const result = await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'l1',
      listing: {
        activeInstalls: 2,
        installCount: 2,
        pinnedActiveInstalls: 2,
        pinsVerifiedAtMs: NOW - PIN_VERIFY_TTL_MS - 1,
      },
      artifactType: 'plugin',
      versionIds: ['1.0.0'],
      nowMs: NOW,
    })
    expect(aggregations).toHaveLength(1)
    expect(result?.activeInstalls).toBe(1)
  })

  it('re-derives immediately when an install route moved the accumulator', async () => {
    // No install route had to learn this module exists. Every one of them
    // moves `activeInstalls`, which breaks it away from `pinnedActiveInstalls`
    // — so a real install shows on the very next request rather than up to a
    // TTL later, and the TTL is left covering only the silent drift.
    const { firestore, aggregations } = fakeFirestore({ total: 3 })
    const target = fakeListingRef()
    const result = await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'l1',
      listing: {
        activeInstalls: 3, // incremented by the install route a second ago
        installCount: 3,
        pinnedActiveInstalls: 2, // what the last derivation wrote
        pinsVerifiedAtMs: NOW - 1_000, // still well inside the TTL
      },
      artifactType: 'plugin',
      versionIds: ['1.0.0'],
      nowMs: NOW,
    })
    expect(aggregations).toHaveLength(1)
    expect(result?.activeInstalls).toBe(3)
  })

  it('answers concurrent requests with ONE aggregation', async () => {
    const { firestore, aggregations } = fakeFirestore({ total: 2 })
    const target = fakeListingRef()
    const input = {
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'l1',
      listing: listing(),
      artifactType: 'plugin' as const,
      versionIds: ['1.0.0'],
      nowMs: NOW,
    }
    const all = await Promise.all([
      verifiedLivePins(input),
      verifiedLivePins(input),
      verifiedLivePins(input),
    ])
    expect(all.map((entry) => entry?.activeInstalls)).toEqual([2, 2, 2])
    expect(aggregations).toEqual(['l1'])
  })
})

describe('verifiedLivePins when the index is missing (AGL-1419)', () => {
  it('reports "not counted" and writes NOTHING', async () => {
    // The failure that must not be quiet, and must not be durable. Falling
    // back to `null` puts the page on AGL-1418's reconciliation — the previous
    // release — rather than on zeros.
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { firestore } = fakeFirestore({ error: missingIndexError })
    const target = fakeListingRef()
    const result = await verifiedLivePins({
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'z6glT_UDAQ',
      listing: { activeInstalls: 3, installCount: 10 },
      artifactType: 'plugin',
      versionIds: ['1.0.2'],
      nowMs: NOW,
    })
    expect(result).toBeNull()
    expect(target.writes).toEqual([])
    expect(errors).toHaveBeenCalled()
  })

  it('stops re-issuing a query it already knows has no index', async () => {
    // A buyer-facing page must not turn a missing index into one failed
    // aggregation per request. Bounded in process, not persisted: a cold
    // instance SHOULD try and log again, because that log is how anyone finds
    // out the index was never deployed.
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { firestore, aggregations } = fakeFirestore({ error: missingIndexError })
    const target = fakeListingRef()
    const input = {
      firestore: firestore as never,
      listingRef: target.ref,
      listingId: 'z6glT_UDAQ',
      listing: { activeInstalls: 3, installCount: 10 },
      artifactType: 'plugin' as const,
      versionIds: ['1.0.2'],
      nowMs: NOW,
    }
    await verifiedLivePins(input)
    await verifiedLivePins(input)
    await verifiedLivePins(input)
    expect(aggregations).toHaveLength(1)
  })
})
