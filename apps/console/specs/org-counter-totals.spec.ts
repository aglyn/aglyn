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

import { orgCounterTotals } from '../utils/org-counter-totals'

/**
 * Email sends and workflow/action runs, summed per org (AGL-1134).
 *
 * A billing meter that double-counts or misses is worse than no meter,
 * because it looks authoritative — so these tests are about arithmetic, not
 * about the field arriving. AGL-1402 is the cautionary case: one usage figure
 * measured two different ways read 20-45% wrong for years and nothing
 * announced it.
 *
 * UNIT UNDER TEST: counts, for one calendar month, summed across the org's
 * hosts. `hosts/{hostId}/counters/{name}` is one document per counter whose
 * FIELDS are `YYYY-MM` keys.
 */

/** A fake `hosts/{id}/counters/*` layout: hostId → counter → month → count. */
type Fixture = Record<string, Record<string, Record<string, unknown>>>

/**
 * A `getAll`-shaped double. It resolves refs by the (hostId, counter) pair
 * the helper asked for, so a helper that built its refs in the wrong ORDER —
 * the way a `flatMap` + modulo pairing can silently transpose two counters —
 * fails here rather than swapping two columns of a bill.
 */
const fakeFirestore = (fixture: Fixture) =>
  ({
    getAll: async (...refs: any[]) =>
      refs.map((ref) => ({
        get: (field: string) => fixture[ref.hostId]?.[ref.counter]?.[field],
      })),
  }) as any

const hostRef = (hostId: string) =>
  ({
    id: hostId,
    collection: () => ({ doc: (counter: string) => ({ hostId, counter }) }),
  }) as any

describe('orgCounterTotals', () => {
  it('sums one month across the org’s hosts, and only that month', () => {
    return orgCounterTotals(
      fakeFirestore({
        siteA: {
          emailSends: { '2026-07': 120, '2026-06': 999 },
          workflowRuns: { '2026-07': 40 },
          actionRuns: { '2026-07': 7 },
        },
        siteB: {
          emailSends: { '2026-07': 80 },
          workflowRuns: { '2026-07': 5, '2026-08': 500 },
          actionRuns: { '2026-07': 3 },
        },
      }),
      [hostRef('siteA'), hostRef('siteB')],
      '2026-07',
    ).then((totals) => {
      // Hand-computed: 120+80, 40+5, 7+3. Neighbouring months are present in
      // the fixture precisely so that reading the wrong field is a failure
      // and not an identical number.
      expect(totals).toEqual({
        emailSends: 200,
        workflowRuns: 45,
        actionRuns: 10,
      })
    })
  })

  it('gives the same total however the work is spread across hosts', async () => {
    // The two differently-shaped inputs. 300 sends is 300 sends whether one
    // host did all of it or three split it — if the per-host fan-out ever
    // changed the total, the same org would be billed differently for
    // identical usage depending on how many sites it happens to run.
    const oneBigHost = await orgCounterTotals(
      fakeFirestore({ solo: { emailSends: { '2026-07': 300 } } }),
      [hostRef('solo')],
      '2026-07',
    )
    const threeSmallHosts = await orgCounterTotals(
      fakeFirestore({
        one: { emailSends: { '2026-07': 100 } },
        two: { emailSends: { '2026-07': 100 } },
        three: { emailSends: { '2026-07': 100 } },
      }),
      [hostRef('one'), hostRef('two'), hostRef('three')],
      '2026-07',
    )
    expect(threeSmallHosts.emailSends).toBe(oneBigHost.emailSends)
    expect(oneBigHost.emailSends).toBe(300)
  })

  it('does not accumulate when the month is rolled up twice', async () => {
    // The cron can legitimately re-run a closed month. The counter is keyed
    // by month ON THE DOCUMENT, so a re-read must re-derive the same figure
    // rather than add to it — the difference between a re-run and a
    // double-bill.
    const fixture = fakeFirestore({
      siteA: { emailSends: { '2026-07': 120 }, actionRuns: { '2026-07': 9 } },
    })
    const first = await orgCounterTotals(fixture, [hostRef('siteA')], '2026-07')
    const second = await orgCounterTotals(fixture, [hostRef('siteA')], '2026-07')
    expect(second).toEqual(first)
    expect(second.emailSends).toBe(120)
  })

  it('reads an absent counter as zero, never NaN', async () => {
    // A host that has never sent an email has no `counters/emailSends`
    // document at all. `undefined` through arithmetic is NaN, and a NaN in a
    // rollup poisons every figure downstream of it silently.
    const totals = await orgCounterTotals(
      fakeFirestore({ fresh: {} }),
      [hostRef('fresh')],
      '2026-07',
    )
    expect(totals).toEqual({ emailSends: 0, workflowRuns: 0, actionRuns: 0 })
    expect(Number.isFinite(totals.emailSends)).toBe(true)
  })

  it('refuses to let a corrupt counter subtract from the total', async () => {
    // Same posture as the cost model: a negative meter must not become a
    // credit. A bad write on one host would otherwise cancel out real usage
    // on another and under-bill the org.
    const totals = await orgCounterTotals(
      fakeFirestore({
        bad: { emailSends: { '2026-07': -5_000 }, actionRuns: { '2026-07': NaN } },
        good: { emailSends: { '2026-07': 10 } },
      }),
      [hostRef('bad'), hostRef('good')],
      '2026-07',
    )
    expect(totals.emailSends).toBe(10)
    expect(totals.actionRuns).toBe(0)
  })

  it('reads nothing at all for an org with no hosts', async () => {
    // Guards the `getAll()` spread: calling it with zero refs throws in the
    // real SDK, and an org between sites is an ordinary state, not an error.
    const firestore = fakeFirestore({})
    const spy = jest.spyOn(firestore, 'getAll')
    const totals = await orgCounterTotals(firestore, [], '2026-07')
    expect(totals).toEqual({ emailSends: 0, workflowRuns: 0, actionRuns: 0 })
    expect(spy).not.toHaveBeenCalled()
  })
})
