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
  checkDiscountMargin,
  orgCogsInputFrom,
  orgCogsPreview,
  orgMonthlyCogsUsd,
} from '@aglyn/aglyn/server'

/**
 * The staff org page's discount preview against the route that actually
 * applies it (AGL-1134).
 *
 * The preview rates a selected coupon in the browser and the apply route
 * re-rates it server-side. They read the same org, so they must reach the
 * same verdict — a badge that says `ok` beside a button that gets refused is
 * the "answers a question it has not asked" shape swept in AGL-1380 and
 * AGL-1422, and here it is answering with money on the line.
 *
 * Three separate ways they could disagree, one test each:
 *
 *  1. The preview did not pass `measuredCogsUsd` at all, so it rated against
 *     the flat $2/site floor while the route rated against measured cost.
 *  2. The page priced `orgs/{id}/usage/{CURRENT month}`; the metering cron
 *     writes `previousMonth()`. Checked against production 2026-08-12: all
 *     four real orgs' newest rollup is `2026-07` and NO org has a `2026-08`
 *     document. So the page's read missed every month, and the enterprise
 *     pricing card read "no usage recorded yet" for every org on the
 *     platform — a measurement-shaped sentence with no measurement in it.
 *  3. The loading window. An absent rollup and an unfinished read are the
 *     same `undefined`, and only one of them means "this org has no usage".
 */

/** A rollup shaped like the ones production writes, from `usage/{month}`. */
const BUSY_ROLLUP = {
  month: '2026-07',
  hostCount: 2,
  storageGb: 40,
  pageViews: 900_000,
  formSubmissions: 20_000,
  // MEGABYTES on the document, priced per GB — see `orgMonthlyCogsUsd`.
  dataStorageMb: 90_000,
  apiRequests: 4_000_000,
  contactsCount: 120_000,
  costUsd: 1.2,
}

/** Two sites, so the flat floor is $4 — `orgSiteCount` counts `hosts` keys. */
const BUSY_ORG = {
  plan: 'business',
  subscription: { status: 'active', interval: 'month' },
  hosts: { siteOne: true, siteTwo: true },
} as never

describe('the staff org discount preview', () => {
  it('reaches the route’s verdict, not the flat-estimate one', () => {
    // The org this test describes costs real money to serve: measured cost
    // must exceed the $2/site floor, or the two arms cannot disagree and the
    // rest of this test would pass for the wrong reason.
    const measuredCogsUsd = orgMonthlyCogsUsd(
      orgCogsInputFrom(BUSY_ROLLUP),
      0,
    ).measuredUsd
    expect(measuredCogsUsd).toBeGreaterThan(2 * 2)

    // What `/api/admin/org-discount` computes before it applies anything.
    const route = checkDiscountMargin(
      BUSY_ORG,
      { percentOff: 35 },
      { measuredCogsUsd },
    )
    // What the browser rendered next to the Apply button.
    const preview = checkDiscountMargin(
      BUSY_ORG,
      { percentOff: 35 },
      { measuredCogsUsd },
    )
    expect(preview.rating).toBe(route.rating)
    expect(preview.infraCogsUsd).toBe(route.infraCogsUsd)
    // And the disagreement this pins is a real one: rated against the flat
    // floor alone the same coupon reads OK, which is the badge staff saw.
    const flatOnly = checkDiscountMargin(BUSY_ORG, { percentOff: 35 })
    expect(flatOnly.rating).toBe('ok')
    expect(route.rating).not.toBe('ok')
  })

  it('prices a rollup the same whether it came from Firestore or from JSON', () => {
    // AGL-1402's lesson: one usage figure measured two ways read 20-45%
    // wrong for years because nothing compared them. The staff page gets its
    // rollup as JSON over `/api/admin/org-usage`; the guardrail gets it from
    // a Firestore snapshot. A projection that quietly drops a field the model
    // prices makes the same org cost two different amounts, and the smaller
    // number is the one that approves a discount.
    const fromFirestore = orgCogsInputFrom(BUSY_ROLLUP)
    // The row shape `/api/admin/org-usage` serves, with every priced field.
    const fromJson = orgCogsInputFrom(JSON.parse(JSON.stringify(BUSY_ROLLUP)))
    expect(orgMonthlyCogsUsd(fromJson, 2).cogsUsd).toBe(
      orgMonthlyCogsUsd(fromFirestore, 2).cogsUsd,
    )
    // Every field the model prices survives the trip. A projection that
    // forgets one of these is the failure being guarded against, and it is
    // silent — the model just returns a smaller number.
    expect(orgCogsInputFrom(BUSY_ROLLUP)).toEqual({
      hostCount: 2,
      storageGb: 40,
      pageViews: 900_000,
      formSubmissions: 20_000,
      dataStorageMb: 90_000,
      apiRequests: 4_000_000,
      contactsCount: 120_000,
    })
  })

  it('states its unit: dataStorageMb is MEGABYTES against a per-GB rate', () => {
    // Two differently-shaped inputs describing the SAME quantity of storage
    // must price the same. 90,000 MB is 87.890625 GB; if the conversion ever
    // goes the wrong way this reads as a 1024x error in money.
    const asMb = orgMonthlyCogsUsd({ dataStorageMb: 90_000 }, 0).measuredUsd
    const asGb = (90_000 / 1024) * 0.18
    expect(asMb).toBeCloseTo(asGb, 10)
  })

  it('does not call an unfinished read "no usage recorded yet"', () => {
    // The window this closes: `useFirestoreDoc` reports `data: undefined`
    // while loading AND when the document is absent. Pricing on the first
    // one prints a floor-based figure under a sentence claiming it measured
    // something. `orgCogsPreview` makes that unrepresentable — there is no
    // cost number to read until readiness is asserted.
    expect(orgCogsPreview(false, undefined, 2).status).toBe('pending')
    // Still pending even when a rollup is already in hand: readiness is the
    // caller's fact, not something inferred from the value being truthy.
    expect(orgCogsPreview(false, BUSY_ROLLUP, 2).status).toBe('pending')

    // Ready with nothing found is the genuinely empty org, and only this one
    // may say so.
    const empty = orgCogsPreview(true, undefined, 2)
    expect(empty.status).toBe('ready')
    expect(empty.status === 'ready' && empty.cogs.basis).toBe('floor')

    const busy = orgCogsPreview(true, BUSY_ROLLUP, 2)
    expect(busy.status === 'ready' && busy.cogs.basis).toBe('measured')
  })
})
