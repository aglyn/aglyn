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
 * ASSIST SPEND MUST REACH THE MARGIN MODEL (AGL-2280).
 *
 * `assist-usage.ts` writes `orgs/{id}/assistUsage/{month}.estCostUsd` and says
 * out loud, in its own header, why: *"cost visibility per org from day one so
 * the paid gate and caps can be tuned with data — Zach's 'must not eat
 * margins' constraint."* Five writers put a real provider bill on that
 * document. Two readers took it back off: the budget-alert cron and the
 * billing card. Neither of them is the discount guardrail.
 *
 * So the guardrail priced six meters that together measured $0.0000054 for
 * the largest real org, and was blind to the only line item that can clear
 * the $2/site floor on its own. A 93%-off coupon on an org burning $40 a
 * month of tokens rated green, and the constraint the telemetry was built to
 * enforce was enforced by nothing.
 *
 * WHAT THIS FILE HAS TO CATCH, and why each assertion is shaped as it is:
 *
 *  - The estimator is right but the wire is dead. Asserting that
 *    `orgMonthlyCogsUsd` *can* price an `assistCostUsd` proves nothing about
 *    whether anything ever hands it one. So the load-bearing tests drive
 *    `latestMeasuredCogsUsd` — the function `/api/admin/org-discount` and
 *    `/api/billing/retention` actually call — against a Firestore double.
 *  - The wire is live but carries a constant. `THE MEASURED VALUE, NOT A
 *    CONSTANT` below varies `estCostUsd` across three seeds and demands the
 *    answer move by exactly the delta. A writer that recorded a fixed number,
 *    or dropped the read and defaulted, survives every "is it non-zero" check
 *    and dies here.
 *  - The value moves but changes no outcome. `AN OUTCOME, NOT A FIGURE`
 *    requires a discount VERDICT to flip. Cost that reaches a field nobody
 *    rates against is the same dead data one indirection later.
 */

import { render, screen } from '@testing-library/react'
import {
  checkDiscountMargin,
  orgCogsInputFrom,
  orgMonthlyCogsUsd,
} from '@aglyn/aglyn/server'

import StaffOrgUsageTable from '../components/staff-org-usage-table.component'

/*==========================================
 * THE FIRESTORE DOUBLE.
 *
 * Models exactly two shapes, because `latestMeasuredCogsUsd` uses exactly
 * two: `collection(usage).orderBy('month','desc').limit(1).get()` and
 * `collection(assistUsage).doc(month).get()`.
 *
 * `get(field)` on an ABSENT document returns `undefined` rather than
 * throwing, which is what the real SDK does — an unfaithful double here would
 * turn "this org has never used Assist" into an exception, and the caller's
 * catch would swallow it into `null`. That reads as "no rollup" and every
 * assertion below would pass for the wrong reason.
 *=========================================*/
const mockDocs = new Map<string, Record<string, unknown>>()

function mockDoc(path: string): any {
  return {
    get: async () => ({
      exists: mockDocs.has(path),
      id: path.split('/').pop(),
      data: () => mockDocs.get(path) ?? {},
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

function mockCollection(path: string): any {
  return {
    doc: (id: string) => mockDoc(`${path}/${id}`),
    orderBy: (field: string, direction?: string) => ({
      limit: (count: number) => ({
        get: async () => {
          const prefix = `${path}/`
          const docs = [...mockDocs.keys()]
            .filter(
              (key) =>
                key.startsWith(prefix) &&
                !key.slice(prefix.length).includes('/'),
            )
            .sort((a, b) => {
              const av = String(mockDocs.get(a)?.[field] ?? '')
              const bv = String(mockDocs.get(b)?.[field] ?? '')
              return direction === 'desc'
                ? bv.localeCompare(av)
                : av.localeCompare(bv)
            })
            .slice(0, count)
            .map((key) => ({
              id: key.split('/').pop(),
              exists: true,
              data: () => mockDocs.get(key) ?? {},
              get: (f: string) => (mockDocs.get(key) ?? {})[f],
            }))
          return { empty: docs.length === 0, docs }
        },
      }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockCollection(name),
      }),
    }),
  },
}))

const { latestMeasuredCogsUsd } = require('../app/api/_lib/org-cogs')

const ORG = 'org-1'
const MONTH = '2026-07'

/**
 * A month of real but ordinary infrastructure use — deliberately WELL under
 * the $2/site floor, matching every real org measured in production. It is
 * the shape in which Assist is the only thing that can move a verdict, which
 * is the shape this defect lived in.
 */
const QUIET_ROLLUP = {
  month: MONTH,
  hostCount: 2,
  storageGb: 0.0002,
  pageViews: 120,
  formSubmissions: 3,
  dataStorageMb: 0,
  apiRequests: 0,
  contactsCount: 4,
}

/** Two sites, so `checkDiscountMargin`'s flat floor is $4. */
const ORG_DOC = {
  plan: 'business',
  subscription: { status: 'active', interval: 'month' },
  hosts: { siteOne: true, siteTwo: true },
} as never

beforeEach(() => {
  mockDocs.clear()
  mockDocs.set(`orgs/${ORG}/usage/${MONTH}`, { ...QUIET_ROLLUP })
})

describe('the cost model prices Assist spend', () => {
  it('adds estCostUsd at ×1 — it is dollars, not a meter', () => {
    const withoutAssist = orgMonthlyCogsUsd(QUIET_ROLLUP, 0).measuredUsd
    const withAssist = orgMonthlyCogsUsd(
      { ...QUIET_ROLLUP, assistCostUsd: 12.5 },
      0,
    )
    // Exactly the dollar figure, not a figure times some invented per-token
    // rate. A second cost model for the same tokens is the drift AGL-1134
    // removed once already.
    expect(withAssist.measuredUsd - withoutAssist).toBeCloseTo(12.5, 10)
    expect(withAssist.breakdown.assist).toBeCloseTo(12.5, 10)
  })

  it('projects assistCostUsd out of a raw rollup', () => {
    // The other half of the AGL-1134 hazard: a model that prices a field and
    // a projection that drops it produce a SMALLER cost, and smaller is the
    // direction that approves a discount.
    expect(orgCogsInputFrom({ ...QUIET_ROLLUP, assistCostUsd: 7 }))
      .toMatchObject({ assistCostUsd: 7 })
  })

  it('refuses a negative or garbage Assist figure', () => {
    // A negative cost would be a COGS CREDIT that pays for a discount.
    for (const bad of [-40, Number.NaN, 'lots' as unknown as number]) {
      expect(
        orgMonthlyCogsUsd({ assistCostUsd: bad }, 0).measuredUsd,
      ).toBe(0)
    }
  })
})

describe('latestMeasuredCogsUsd reads the Assist document', () => {
  it('THE MEASURED VALUE, NOT A CONSTANT — the answer tracks estCostUsd', async () => {
    /*
      The mutation this exists to kill: a writer (or this reader) that records
      a fixed figure while the estimator stays correct. Every "Assist cost is
      included" assertion that checks a single seed passes against
      `assistCostUsd: 0.001` hardcoded. Three seeds, and the answer must move
      by exactly the delta between them.
    */
    const meterOnly = orgMonthlyCogsUsd(QUIET_ROLLUP, 0).measuredUsd

    const seen: number[] = []
    for (const estCostUsd of [0.5, 9, 61.25]) {
      mockDocs.set(`orgs/${ORG}/assistUsage/${MONTH}`, {
        month: MONTH,
        estCostUsd,
      })
      seen.push(await latestMeasuredCogsUsd(ORG))
    }

    expect(seen[0]).toBeCloseTo(meterOnly + 0.5, 8)
    expect(seen[1]).toBeCloseTo(meterOnly + 9, 8)
    expect(seen[2]).toBeCloseTo(meterOnly + 61.25, 8)
    // Stated as a difference too, so a reader that returned the Assist figure
    // ALONE — dropping the six meters on the way past — is also red.
    expect(seen[2] - seen[1]).toBeCloseTo(52.25, 8)
    expect(seen[0]).toBeGreaterThan(meterOnly)
  })

  it('pairs the SAME month, never "now"', async () => {
    // The cron writes the CLOSED month, so the newest rollup is usually last
    // month. Charging this month's Assist against it would report two periods
    // as one figure — the mistake `/api/billing/usage-budget` refuses one
    // field over.
    mockDocs.set(`orgs/${ORG}/assistUsage/2026-08`, {
      month: '2026-08',
      estCostUsd: 500,
    })
    const measured = await latestMeasuredCogsUsd(ORG)
    expect(measured).toBeCloseTo(orgMonthlyCogsUsd(QUIET_ROLLUP, 0).measuredUsd, 8)
  })

  it('an org that has never used Assist is unchanged, not broken', async () => {
    // No `assistUsage` document at all. The absent case has to stay exactly
    // what it was, or this change would re-rate every org on the platform.
    const measured = await latestMeasuredCogsUsd(ORG)
    expect(measured).toBeCloseTo(orgMonthlyCogsUsd(QUIET_ROLLUP, 0).measuredUsd, 8)
  })
})

describe('AN OUTCOME, NOT A FIGURE', () => {
  it('flips a discount verdict that Assist spend should have refused', async () => {
    /*
      The whole point, stated as money. Same org, same coupon, same six
      meters. The ONLY difference is a month of Assist tokens — and it has to
      change the guardrail's answer, or the cost is being measured into a
      field nobody rates against, which is the same dead data one indirection
      further along.
    */
    const coupon = { percentOff: 55 }

    const quiet = await latestMeasuredCogsUsd(ORG)
    const before = checkDiscountMargin(ORG_DOC, coupon, {
      measuredCogsUsd: quiet,
    })

    mockDocs.set(`orgs/${ORG}/assistUsage/${MONTH}`, {
      month: MONTH,
      estCostUsd: 44,
    })
    const busy = await latestMeasuredCogsUsd(ORG)
    const after = checkDiscountMargin(ORG_DOC, coupon, {
      measuredCogsUsd: busy,
    })

    // The measured arm has to actually beat the $4 two-site floor, or the
    // verdicts below would be equal for a reason that has nothing to do with
    // this change.
    expect(quiet).toBeLessThan(4)
    expect(busy).toBeGreaterThan(4)
    expect(after.infraCogsUsd).toBeGreaterThan(before.infraCogsUsd)
    expect(after.rating).not.toBe(before.rating)
    expect(after.rating).not.toBe('ok')
  })
})

describe('the console shows it', () => {
  it('renders an Assist column carrying the month’s spend', () => {
    // A capability is not a feature until the console exposes it. Staff
    // rating a deal have to be able to SEE the line that moved the verdict.
    render(
      <StaffOrgUsageTable
        months={[
          {
            month: MONTH,
            storageGb: 0.0002,
            pageViews: 120,
            formSubmissions: 3,
            costUsd: 0.01,
            assistCostUsd: 44.125,
            deltas: null,
          },
        ]}
      />,
    )
    expect(screen.getByText('Assist')).toBeTruthy()
    // FOUR decimals: Assist arrives in thousandths of a dollar per exchange,
    // and `$0.00` under a month that really cost eight cents is the same
    // silence this column exists to end.
    expect(screen.getByText('$44.1250')).toBeTruthy()
  })

  it('does not print $0.00 for a sub-cent month', () => {
    render(
      <StaffOrgUsageTable
        months={[
          {
            month: MONTH,
            storageGb: 0,
            pageViews: 0,
            formSubmissions: 0,
            costUsd: 0,
            assistCostUsd: 0.085,
            deltas: null,
          },
        ]}
      />,
    )
    expect(screen.getByText('$0.0850')).toBeTruthy()
  })
})
