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
 * AGL-1440: what the screen-cap detector actually costs.
 *
 * Its own doc comment claimed "two projected reads per host". It is an
 * UNBOUNDED scan of the host's whole `screens` collection, and a `select()`
 * projection still bills one read per document — so the true figure is one read
 * per screen per host, per run. It ran twice a day (the usage-alerts cron and
 * the monthly rollup), against a third full `screens` scan the rollup does for
 * site size. A comment that understates a cost by orders of magnitude is how
 * nobody notices, so both the number and the mechanism are pinned here.
 *
 * Two ways out, both tested below, neither of which weakens the detector:
 *
 *  - **rows already in hand cost nothing.** The rollup walks every screen
 *    document anyway; handing those rows to the detector removes one of its
 *    two scans outright.
 *  - **the alert reads the recorded figure.** The rollup already writes
 *    `maxBillableScreens`, and `usage-alerts` already reads that very document
 *    for `dataStorageMb` — so the second scan becomes zero extra reads. It
 *    falls back to measuring when the figure is absent or stale, because a
 *    detector that silently reports 0 for an org it has no measurement of is
 *    the loading-default bug (AGL-1064) wearing a cron's clothes.
 */

import {
  measureScreenCaps,
  recordedMaxBillableScreens,
  screenCapMaxBillable,
  SCREEN_CAP_ROLLUP_MAX_AGE_MS,
} from './screen-cap-reconciliation'

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  resolveOrgEntitlements: () => ({ screensPerHost: 5 }),
  SCREEN_KIND_TEMPLATE: 'template',
  screenClaimsToBeAPage: (screen: { kind?: unknown; deletedAt?: unknown }) =>
    !screen.deletedAt && screen.kind !== 'email' && screen.kind !== 'template',
}))

/** A host ref whose `screens` scan counts every document it hands back. */
const hostRef = (ids: string[], counter: { reads: number }) => ({
  collection: () => ({
    select: () => ({
      get: async () => {
        // One BILLED READ PER DOCUMENT, projection or not. This is the whole
        // point of the issue.
        counter.reads += ids.length || 1
        return {
          docs: ids.map((id) => ({
            id,
            get: (field: string) => (field === 'kind' ? 'page' : undefined),
          })),
        }
      },
    }),
  }),
})

describe('measureScreenCaps read cost (AGL-1440)', () => {
  it('scans the whole screens collection when it has nothing in hand', async () => {
    const counter = { reads: 0 }
    const report = await measureScreenCaps(
      [
        {
          id: 'h1',
          ref: hostRef(['a', 'b', 'c'], counter) as never,
          routingMap: { a: '/', b: '/b', c: '/c' },
        },
      ],
      {},
    )

    expect(report.maxBillable).toBe(3)
    // NOT two. One per document — the number the comment used to hide.
    expect(counter.reads).toBe(3)
  })

  it('issues NO read when the caller already holds the rows', async () => {
    const counter = { reads: 0 }
    const report = await measureScreenCaps(
      [
        {
          id: 'h1',
          ref: hostRef(['a', 'b', 'c'], counter) as never,
          routingMap: { a: '/', b: '/b', c: '/c' },
          screens: [
            { id: 'a', kind: 'page' },
            { id: 'b', kind: 'page' },
            { id: 'c', kind: 'page' },
          ],
        },
      ],
      {},
    )

    expect(counter.reads).toBe(0)
    // Same verdict, no read: the rule is applied to the rows, not re-fetched.
    expect(report.maxBillable).toBe(3)
  })

  it('applies the SAME rule to rows as it does to a scan', async () => {
    // The saving is only safe if both arms agree. A soft-deleted, unrouted
    // screen is billable through neither.
    const counter = { reads: 0 }
    const scanned = await measureScreenCaps(
      [{ id: 'h1', ref: hostRef(['a'], counter) as never, routingMap: {} }],
      {},
    )
    const fromRows = await measureScreenCaps(
      [
        {
          id: 'h1',
          ref: hostRef(['a'], counter) as never,
          routingMap: {},
          screens: [{ id: 'a', kind: 'page' }],
        },
      ],
      {},
    )
    expect(fromRows.maxBillable).toBe(scanned.maxBillable)
  })

  it('still reports over-cap hosts from rows', async () => {
    const counter = { reads: 0 }
    const report = await measureScreenCaps(
      [
        {
          id: 'over',
          ref: hostRef([], counter) as never,
          routingMap: {},
          screens: Array.from({ length: 7 }, (_, index) => ({
            id: `s${index}`,
            kind: 'page',
          })),
        },
      ],
      {},
    )
    expect(report.overCapHostIds).toEqual(['over'])
    expect(report.rows[0].overBy).toBe(2)
    expect(counter.reads).toBe(0)
  })
})

describe('recordedMaxBillableScreens (AGL-1440)', () => {
  const now = Date.UTC(2026, 7, 12, 8, 0, 0)
  const agoMs = (ms: number) => ({ toMillis: () => now - ms })

  it('accepts a figure the rollup measured recently', () => {
    expect(
      recordedMaxBillableScreens(
        { maxBillableScreens: 12, computedAt: agoMs(60_000) },
        now,
      ),
    ).toBe(12)
  })

  it('accepts zero, which is a measurement and not an absence', () => {
    // The trap this exists to avoid is the reverse — treating "no figure" as 0
    // — so a genuine 0 has to survive the round trip.
    expect(
      recordedMaxBillableScreens(
        { maxBillableScreens: 0, computedAt: agoMs(60_000) },
        now,
      ),
    ).toBe(0)
  })

  it('refuses a figure older than the staleness window', () => {
    expect(
      recordedMaxBillableScreens(
        {
          maxBillableScreens: 12,
          computedAt: agoMs(SCREEN_CAP_ROLLUP_MAX_AGE_MS + 1),
        },
        now,
      ),
    ).toBeNull()
  })

  it('refuses an absent, unmeasured or malformed figure', () => {
    for (const rollup of [
      null,
      undefined,
      {},
      { maxBillableScreens: 12 },
      { maxBillableScreens: undefined, computedAt: agoMs(0) },
      { maxBillableScreens: 'twelve', computedAt: agoMs(0) },
      { maxBillableScreens: Number.NaN, computedAt: agoMs(0) },
      { maxBillableScreens: -1, computedAt: agoMs(0) },
      { maxBillableScreens: 12, computedAt: 'yesterday' },
    ]) {
      expect(recordedMaxBillableScreens(rollup as never, now)).toBeNull()
    }
  })

  it('reads the timestamp shapes a rollup can actually be in', () => {
    // A Firestore Timestamp survives as `Timestamp` on a live read and decays
    // to `{_seconds}` / `{seconds}` across a JSON round trip. All three name
    // the same instant and all three must be honoured, or the alert re-measures
    // every host every day for no reason.
    const seconds = Math.floor((now - 60_000) / 1000)
    for (const computedAt of [
      { toMillis: () => now - 60_000 },
      new Date(now - 60_000),
      { seconds },
      { _seconds: seconds },
    ]) {
      expect(
        recordedMaxBillableScreens({ maxBillableScreens: 9, computedAt }, now),
      ).toBe(9)
    }
  })
})

describe('screenCapMaxBillable — measure only when we must (AGL-1440)', () => {
  const now = Date.UTC(2026, 7, 12, 8, 0, 0)
  const fresh = { maxBillableScreens: 4, computedAt: { toMillis: () => now } }

  it('never measures when a fresh figure is recorded', async () => {
    const measure = jest.fn()
    const result = await screenCapMaxBillable(fresh, now, measure)

    expect(result).toBe(4)
    // The whole saving: no scan of any host's screens collection.
    expect(measure).not.toHaveBeenCalled()
  })

  it('measures when nothing is recorded', async () => {
    // A brand-new org, or one the chunked rollup has not reached. Reporting 0
    // here would silently answer the only question this detector exists to ask.
    const measure = jest.fn(async () => 6)
    expect(await screenCapMaxBillable(null, now, measure)).toBe(6)
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('measures when the recorded figure has gone stale', async () => {
    const measure = jest.fn(async () => 6)
    const stale = {
      maxBillableScreens: 4,
      computedAt: { toMillis: () => now - SCREEN_CAP_ROLLUP_MAX_AGE_MS - 1 },
    }
    expect(await screenCapMaxBillable(stale, now, measure)).toBe(6)
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('leaves room for a daily rollup to be a few hours late', async () => {
    // report-usage runs at 02:00 and usage-alerts at 08:00, so a window under
    // ~30h would re-measure every host on any day the rollup slipped a run.
    expect(SCREEN_CAP_ROLLUP_MAX_AGE_MS).toBeGreaterThanOrEqual(
      30 * 60 * 60 * 1000,
    )
  })
})
