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
 * Metered storage: bills by default, warns before it does, caps only if asked
 * (AGL-1886, inverted 2026-08-18).
 *
 * ZACH, 2026-08-18, verbatim: "don't let it make us lose revenue or cost us
 * money, it should be a control by the end user, to prevent overage or usage
 * alerts rather, we just want to minimize churn" — and "We also need to make
 * sure the free/hobby tier does hard cap so it always actually stays free".
 *
 * ## What this suite is for
 *
 * The design it replaced refused every metered org past its band until the org
 * acknowledged a consent, and the route writing that consent had no caller —
 * so the gate failed closed on the entire customer base and Aglyn collected
 * nothing. This suite's FIRST job is to make that shape impossible to restore
 * silently: the inversion is asserted directly, and every assertion below was
 * forced red against the pre-inversion code.
 *
 * Its SECOND job is the opposite failure. A suite that only proves refusals is
 * satisfied by a product nobody can use — which is exactly the state AGL-1957
 * found. So every refusal here is paired with a positive control that proves
 * the same org is served in the neighbouring case.
 *
 * The free tier's "always actually stays free" property is NOT proven here.
 * The upload refusal is only the braces; the belt is that free has no metered
 * price on any billable dimension, so the invoice is zero even if a gate is
 * bypassed. `free-tier-never-billed.spec.ts` decomposes that per dimension.
 */

import {
  checkStorageCap,
  mediaStorageGate,
  resolveStorageCap,
  storageOveragePricePerGbUsd,
  storageOverageUsd,
  STORAGE_CAP_FALLBACK_USD,
  usageAlertApproachPct,
  usageAlertThreshold,
  USAGE_ALERT_APPROACH_PCT_DEFAULT,
} from '../utils/storage-overage'
import { estimateMonthlyUsageCost } from '../utils/usage-metering'
import { PLAN_ENTITLEMENTS, planMetersInfraOverage } from '@aglyn/aglyn/server'

/** Pro meters infra overage, includes 10240 MB per scope, and has 3 sites. */
const PRO_SCOPE_MB = PLAN_ENTITLEMENTS.pro.storagePerHostMb
const MB = 1024 * 1024

const proOrg = (storageOverage?: unknown) =>
  ({
    plan: 'pro',
    subscription: { status: 'active' },
    ...(storageOverage ? { storageOverage } : {}),
  }) as any

/** A cap exactly as `/api/billing/storage-overage` writes it on `setCap`. */
const writtenBySetCap = (capUsd: number) => ({
  capUsd,
  capSetAt: new Date('2026-08-18T12:00:00Z'),
  capSetBy: 'uid-admin',
})

describe('THE INVERSION: a metered org past its band is BILLED, not blocked', () => {
  /**
   * The single most important assertion in the file. Forced red by restoring
   * the `if (!overage.acknowledged) return { allowed: false }` branch this
   * replaced: every case here fails at once, which is the point — the guard
   * exists to make that restoration loud.
   */

  it('accepts the upload and marks it billable', () => {
    const gate = mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB + 1024 })
    expect(gate.allowed).toBe(true)
    expect(gate.status).toBe(200)
    expect(gate.code).toBeNull()
    expect(gate.error).toBeNull()
    // The bytes land AND an invoice line exists for them. Both halves matter:
    // `allowed` alone would be satisfied by giving the storage away free,
    // which is the other way to lose the revenue.
    expect(gate.billed).toBe(true)
    // 1 GB over × $0.026 × 1.30. LITERAL, not derived from the rate constant —
    // a guard that recomputes the expression it is testing cannot fail when
    // the expression is wrong.
    expect(gate.projectedOverageUsd).toBeCloseTo(0.0338, 6)
  })

  it('asks the customer for NOTHING first — no consent, no acknowledgement', () => {
    // The org doc has no `storageOverage` at all, which is the normal state.
    const org = proOrg()
    expect((org as any).storageOverage).toBeUndefined()
    expect(resolveStorageCap(org).capSet).toBe(false)
    expect(mediaStorageGate({ org, usedMb: PRO_SCOPE_MB + 4096 }).allowed).toBe(
      true,
    )
  })

  it('a legacy acknowledgement is not REQUIRED, and its ceiling is still honoured', () => {
    // Orgs written by the pre-inversion route carry `{ acknowledgedAt,
    // monthlyCeilingUsd }`. Two properties, and they pull apart:
    //   - its absence must not block (the inversion), and
    //   - its presence must still cap at the number somebody typed, because
    //     silently raising a ceiling a customer chose is the surprise bill.
    const legacy = proOrg({
      acknowledgedAt: new Date('2026-08-18T09:00:00Z'),
      acknowledgedBy: 'uid-admin',
      monthlyCeilingUsd: 3,
    })
    expect(resolveStorageCap(legacy)).toEqual({ capSet: true, monthlyCapUsd: 3 })
    // Under the ceiling: served.
    expect(
      mediaStorageGate({ org: legacy, usedMb: PRO_SCOPE_MB + 1024 }).allowed,
    ).toBe(true)
    // Past it: refused, at THEIR number.
    const over = mediaStorageGate({ org: legacy, usedMb: PRO_SCOPE_MB + 1024 * 1024 })
    expect(over.allowed).toBe(false)
    expect(over.monthlyCapUsd).toBe(3)
  })

  it('an inside-the-band upload is untouched and bills nothing', () => {
    const gate = mediaStorageGate({ org: proOrg(), usedMb: 100 })
    expect(gate.allowed).toBe(true)
    expect(gate.billed).toBe(false)
    expect(gate.projectedOverageUsd).toBe(0)
    expect(gate.limitMb).toBe(PRO_SCOPE_MB)
  })

  it('keeps the AGL-471 off-by-one exactly where it was', () => {
    // `usedMb` includes the incoming file and the integer cap is INCLUSIVE.
    // The inversion changed what happens PAST the band, never where the band
    // is — a drift here would move every plan's storage limit by 1 MB on four
    // ingress routes at once, and would now do it silently, since past the
    // band is no longer a visible refusal on a metered plan.
    expect(mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB }).billed).toBe(
      false,
    )
    expect(
      mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB + 0.5 }).billed,
    ).toBe(true)
  })
})

describe("THE CUSTOMER'S CAP: their control, their number, and only theirs", () => {
  it('refuses past the cap, citing the limit THEY set and not ours', () => {
    // Forced red by dropping the `cap.capSet` branch: an org that asked to be
    // stopped at $5 uploaded 40 TB and was invoiced for all of it.
    const capped = proOrg(writtenBySetCap(5))
    const over = mediaStorageGate({
      org: capped,
      usedMb: PRO_SCOPE_MB + 1024 * 1024,
    })
    expect(over.allowed).toBe(false)
    expect(over.status).toBe(403)
    expect(over.code).toBe('storage_cap_reached')
    expect(over.billed).toBe(false)
    expect(over.monthlyCapUsd).toBe(5)
    // THEIR number in the message, and the word that says whose it is. A
    // refusal that reads as a platform limit would send them to support to
    // ask for an increase we cannot give, because we did not set it.
    expect(over.error).toContain('$5.00')
    expect(over.error).toContain('cap you set')
    // Never the plan's band, which is not what stopped them.
    expect(over.error).not.toContain(String(PRO_SCOPE_MB))
  })

  it('POSITIVE CONTROL: the same capped org is SERVED below its cap', () => {
    // Without this, "refuses past the cap" is satisfied by a cap that refuses
    // everything — a universal block wearing a customer's number. This is the
    // assertion that fails if the cap is ever compared the wrong way round, or
    // if `capSet` starts meaning "block".
    //
    // Forced red by flipping `>` to `>=` AND by returning the refusal
    // unconditionally once `capSet`: both make an opted-in customer worse off
    // than one who never touched the setting.
    const capped = proOrg(writtenBySetCap(5))
    const under = mediaStorageGate({ org: capped, usedMb: PRO_SCOPE_MB + 1024 })
    expect(under.allowed).toBe(true)
    expect(under.status).toBe(200)
    expect(under.code).toBeNull()
    // And it BILLS — a cap bounds the invoice, it does not zero it.
    expect(under.billed).toBe(true)
    expect(under.projectedOverageUsd).toBeCloseTo(0.0338, 6)
    expect(under.monthlyCapUsd).toBe(5)
  })

  it('the boundary belongs to the customer: exactly AT the cap is served', () => {
    // $0.0338 of overage is 1 GB. A cap of exactly that must not refuse the
    // gigabyte it was sized for.
    const capped = proOrg(writtenBySetCap(storageOverageUsd(1024)))
    expect(
      mediaStorageGate({ org: capped, usedMb: PRO_SCOPE_MB + 1024 }).allowed,
    ).toBe(true)
  })

  it('no cap set means NO cap — never an invented default', () => {
    // The failure that would quietly restore the old design: resolving an
    // absent cap to `STORAGE_CAP_FALLBACK_USD` would hard-stop every org on
    // the platform at $25 without anyone choosing it. Forced red by returning
    // `{ capSet: true, monthlyCapUsd: STORAGE_CAP_FALLBACK_USD }` from the
    // final branch of `resolveStorageCap`.
    for (const org of [proOrg(), undefined, null, proOrg({})]) {
      expect(resolveStorageCap(org as never)).toEqual({
        capSet: false,
        monthlyCapUsd: null,
      })
    }
    // $500 of overage on an uncapped org: still served.
    const far = mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB + 1024 * 1024 * 4 })
    expect(far.allowed).toBe(true)
    expect(far.billed).toBe(true)
  })

  it('a cap the customer SET but that stored badly falls back — never to "no cap"', () => {
    // The one direction this must not fail in, now that absent means uncapped:
    // a corrupt number must not be read as consent to any amount. Literal 25,
    // not the constant — a guard that reads its expectation from the value it
    // is testing stays green at every value, including 0.
    expect(STORAGE_CAP_FALLBACK_USD).toBe(25)
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 'lots', null]) {
      const resolved = resolveStorageCap(proOrg({ capUsd: bad }))
      expect(resolved.capSet).toBe(true)
      expect(resolved.monthlyCapUsd).toBe(25)
      expect(Number.isFinite(resolved.monthlyCapUsd)).toBe(true)
    }
  })

  it('honours the exact number typed, across the whole legal range', () => {
    // The card offers $1–$5000 because the route allows it. A $2 cap enforced
    // as the $25 fallback would bill an org twelve times what it asked for.
    for (const cap of [1, 25, 5000]) {
      expect(resolveStorageCap(proOrg(writtenBySetCap(cap)))).toEqual({
        capSet: true,
        monthlyCapUsd: cap,
      })
    }
  })

  it('clearing the cap returns the org to billing, not to blocking', () => {
    // `clearCap` deletes the whole `storageOverage` document, so the org is
    // indistinguishable from one that never set a cap — and is SERVED, which
    // is what makes removal real rather than a trap.
    const cleared = proOrg()
    expect(resolveStorageCap(cleared).capSet).toBe(false)
    const gate = mediaStorageGate({ org: cleared, usedMb: PRO_SCOPE_MB + 4096 })
    expect(gate.allowed).toBe(true)
    expect(gate.billed).toBe(true)
  })

  it('checkStorageCap agrees with the gate it backs', () => {
    const verdict = checkStorageCap({
      org: proOrg(writtenBySetCap(5)),
      usedMb: PRO_SCOPE_MB + 1024 * 1024,
      allowanceMb: PRO_SCOPE_MB,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('storage_cap_reached')
    expect(verdict.monthlyCapUsd).toBe(5)
  })
})

describe('WHAT STILL HARD-BANDS: free/hobby, so it always actually stays free', () => {
  it('refuses a free org past its band, and does not mark it billable', () => {
    // Zach, 2026-08-18: free "always actually stays free". Forced red by
    // dropping the `planMetersInfraOverage` arm — the free org fell through to
    // the cap logic, was allowed, and came back `billed: true`, which is
    // unbilled storage AND a false invoice signal in one result.
    const free = { plan: 'free' } as any
    const gate = mediaStorageGate({
      org: free,
      usedMb: PLAN_ENTITLEMENTS.free.storagePerHostMb + 100,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.status).toBe(403)
    expect(gate.code).toBe('plan_limit_reached')
    expect(gate.billed).toBe(false)
    expect(gate.projectedOverageUsd).toBe(0)
    // The band cited is the plan's 250 MB — literal, so a change to the free
    // allowance has to be looked at rather than absorbed.
    expect(gate.limitMb).toBe(250)
    expect(gate.error).toContain('Storage limit reached (250 MB)')
  })

  it('POSITIVE CONTROL: a free org INSIDE its band is served', () => {
    // The hard band must not be a block on free storage generally, only on
    // free storage past what the plan includes.
    const gate = mediaStorageGate({ org: { plan: 'free' } as any, usedMb: 100 })
    expect(gate.allowed).toBe(true)
    expect(gate.billed).toBe(false)
  })

  it('a forged cap or acknowledgement cannot open the free band', () => {
    // `storageOverage` is admin-written and rules-denied to clients, so this
    // is defence in depth rather than a live path. It is asserted because the
    // ordering it depends on is invisible: `planMetersInfraOverage` is checked
    // BEFORE any cap logic, so no shape of this field reaches code that can
    // return `billed: true` on an unmetered plan.
    for (const forged of [
      { capUsd: 500 },
      { capUsd: 0 },
      { acknowledgedAt: 1, monthlyCeilingUsd: 500 },
    ]) {
      const gate = mediaStorageGate({
        org: { plan: 'free', storageOverage: forged } as any,
        usedMb: PLAN_ENTITLEMENTS.free.storagePerHostMb + 100,
      })
      expect(gate.allowed).toBe(false)
      expect(gate.billed).toBe(false)
      expect(gate.code).toBe('plan_limit_reached')
    }
  })

  it('an org with no plan at all resolves free, and hard-bands', () => {
    // "Billing usage to someone with no subscription is the one error
    // direction with no recovery" — an unknown org must land on the refusing
    // side of the inversion, not the billing side.
    const gate = mediaStorageGate({ org: {} as any, usedMb: 100_000 })
    expect(gate.allowed).toBe(false)
    expect(gate.billed).toBe(false)
    expect(gate.code).toBe('plan_limit_reached')
  })

  it('enterprise is UNLIMITED and never reaches any of the three outcomes', () => {
    const gate = mediaStorageGate({
      org: { plan: 'enterprise' } as any,
      usedMb: 50_000_000,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.billed).toBe(false)
    expect(gate.projectedOverageUsd).toBe(0)
  })
})

describe('INGRESS AND report-usage TELL THE SAME STORY', () => {
  /**
   * The reconciliation AGL-1957 flagged and the inversion made load-bearing.
   *
   * `report-usage` bills stored bytes past the org-wide band and has never
   * consulted the storage-overage document — so before the inversion the
   * ingress refusal was the ONLY thing between a metered org and an invoice
   * line, and the two surfaces disagreed by construction: ingress said "you
   * may not store this", billing said "I would bill it if you did".
   *
   * They now answer the same plan-level question. The claim under test is
   * exactly that: **the plans on which ingress accepts billable bytes are
   * precisely the plans on which the rollup bills them.** Decomposed per plan,
   * because an aggregate assertion over eight plans passes while any one of
   * them is wrong.
   */

  const ALL_PLANS = [
    'free',
    'starter',
    'pro',
    'business',
    'scale',
    'advanced',
    'agency',
    'enterprise',
  ] as const

  it.each(ALL_PLANS)('%s: gate.billed matches whether the rollup charges', (plan) => {
    const org = { plan } as any
    const entitlements = PLAN_ENTITLEMENTS[plan]
    // Well past BOTH bands: the per-scope one the gate reads and the org-wide
    // `hostLimit × storagePerHostMb` one the rollup subtracts. Finite plans
    // only — enterprise's Infinity band cannot be exceeded, which is itself
    // the answer for enterprise.
    const scopeMb = Number.isFinite(entitlements.storagePerHostMb)
      ? entitlements.storagePerHostMb * 4 + 4096
      : 50_000_000
    const orgWideBytes = Number.isFinite(entitlements.storagePerHostMb)
      ? (entitlements.storagePerHostMb as number) *
        (Number.isFinite(entitlements.hostLimit) ? entitlements.hostLimit : 1) *
        4 *
        MB
      : 50_000_000 * MB

    const gate = mediaStorageGate({ org, usedMb: scopeMb })
    const rollup = estimateMonthlyUsageCost(
      [{ storageBytes: orgWideBytes, pageViews: 0, formSubmissions: 0 }],
      org,
    )

    // The one equation. If ingress ever accepts billable bytes a rollup will
    // not charge for, that is given-away storage; if it refuses bytes the
    // rollup would charge for, that is the lost revenue Zach named.
    expect(gate.billed).toBe(rollup.billedCents > 0)
    // And both agree with the plan predicate they are supposed to share.
    expect(gate.billed).toBe(planMetersInfraOverage(org))
  })

  it('names the plans on each side, so a silent reclassification is visible', () => {
    // Literal expectation, not derived from `PLAN_PRICING` — a guard that
    // reads the table it is checking stays green when the table is wrong.
    const billing = ALL_PLANS.filter((plan) =>
      planMetersInfraOverage({ plan } as any),
    )
    expect(billing).toEqual([
      'starter',
      'pro',
      'business',
      'scale',
      'advanced',
      'agency',
    ])
    expect(planMetersInfraOverage({ plan: 'free' } as any)).toBe(false)
    expect(planMetersInfraOverage({ plan: 'enterprise' } as any)).toBe(false)
  })

  it('the price the card quotes is the price the rollup bills', () => {
    // AGL-1957's fix, preserved verbatim through the inversion: the card's
    // `pricePerGbUsd` is served from this helper, and the rollup prices from
    // the same constants. LITERAL 0.0338 on both sides — deriving one from the
    // other is the tautology that cannot fail.
    expect(storageOveragePricePerGbUsd()).toBeCloseTo(0.0338, 8)
    expect(storageOverageUsd(1024)).toBeCloseTo(0.0338, 8)
    // One GB over the band, priced by the rollup: the same 3.38 cents.
    const included = PLAN_ENTITLEMENTS.pro.storagePerHostMb * 3 // hostLimit 3
    const rollup = estimateMonthlyUsageCost(
      [
        {
          storageBytes: (included + 1024) * MB,
          pageViews: 0,
          formSubmissions: 0,
        },
      ],
      { plan: 'pro' } as any,
    )
    expect(rollup.billedCents).toBe(3)
  })

  it('prices nothing for a non-overage', () => {
    expect(storageOverageUsd(0)).toBe(0)
    expect(storageOverageUsd(-100)).toBe(0)
    expect(storageOverageUsd(Number.NaN)).toBe(0)
  })
})

describe('THE ALERT is the protection now, so it has to be able to fire', () => {
  /**
   * ⚠️ THE TRAP THIS SUITE EXISTS TO AVOID. The pre-AGL-1886 storage alert
   * compared a summed org-wide total to `hostLimit × storagePerHostMb`, while
   * uploads are enforced PER SCOPE against `storagePerHostMb`. On a plan with
   * one site those two numbers are IDENTICAL, so a test written on free or
   * starter passes whether or not the bug is present — the guard could not
   * fail on the only plan where the question could be asked.
   *
   * Every case here is therefore on **Pro: hostLimit 3**, where the org-wide
   * band is 30720 MB and the library's own band is 10240 MB. A full library
   * reads as 33% org-wide and 100% on its own, and the two answers differ.
   */

  const ORG_WIDE_MB =
    PLAN_ENTITLEMENTS.pro.hostLimit * PLAN_ENTITLEMENTS.pro.storagePerHostMb

  it('the two bands really are different on this plan (the trap, pinned)', () => {
    // Literal, so a plan-table edit that collapses them re-arms the trap
    // loudly instead of quietly making every case below vacuous.
    expect(PLAN_ENTITLEMENTS.pro.hostLimit).toBe(3)
    expect(PRO_SCOPE_MB).toBe(10240)
    expect(ORG_WIDE_MB).toBe(30720)
    expect(ORG_WIDE_MB).not.toBe(PRO_SCOPE_MB)
  })

  it('a FULL org library fires its own alert, and cannot fire the org-wide one', () => {
    const fullLibraryMb = PRO_SCOPE_MB
    // Against its own band: at the cap, so the 100% notification.
    expect(usageAlertThreshold(fullLibraryMb, PRO_SCOPE_MB)).toBe(100)
    // Against the org-wide band: 33%, silent — this is the defect, preserved
    // as a fact so nobody "fixes" the per-library check by folding it back in.
    expect(usageAlertThreshold(fullLibraryMb, ORG_WIDE_MB)).toBe(0)
    expect((fullLibraryMb / ORG_WIDE_MB) * 100).toBeCloseTo(33.33, 1)
  })

  it('warns on APPROACH, before any money — again on a plan where it can', () => {
    // 80% of the library's own 10240 MB is 8192 MB. That is a warning with
    // days of headroom, not an announcement.
    expect(usageAlertThreshold(8192, PRO_SCOPE_MB)).toBe(80)
    expect(usageAlertThreshold(8191, PRO_SCOPE_MB)).toBe(0)
    // And the same reading is silent org-wide: 8192/30720 = 26.7%.
    expect(usageAlertThreshold(8192, ORG_WIDE_MB)).toBe(0)
  })

  it('warns at 80 and again at the band', () => {
    expect(USAGE_ALERT_APPROACH_PCT_DEFAULT).toBe(80)
    expect(usageAlertThreshold(79, 100)).toBe(0)
    expect(usageAlertThreshold(80, 100)).toBe(80)
    expect(usageAlertThreshold(99.9, 100)).toBe(80)
    expect(usageAlertThreshold(100, 100)).toBe(100)
    expect(usageAlertThreshold(400, 100)).toBe(100)
  })

  it('never alerts on a limit that is zero, negative or not a number', () => {
    // A quota of 0 is "this plan does not sell it", not "you are infinitely
    // over" — alerting there would notify every free org about every paid
    // feature, every day, forever.
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(usageAlertThreshold(50, limit)).toBe(0)
    }
    expect(usageAlertThreshold(Number.NaN, 100)).toBe(0)
    expect(usageAlertThreshold(-5, 100)).toBe(0)
  })

  it('takes a configured percentage', () => {
    expect(usageAlertApproachPct('70')).toBe(70)
    expect(usageAlertApproachPct('90')).toBe(90)
    expect(usageAlertThreshold(75, 100, usageAlertApproachPct('70'))).toBe(70)
  })

  it('FAILS TO 80 on anything malformed, rather than going silent', () => {
    // Now that overage BILLS, an alert that cannot fire is the surprise bill.
    // Forced red by returning `parsed` unguarded: `''` → 0 (alert always),
    // `'yes'` → NaN (alert never), `'100'` → the approach warning disappears
    // into the cap notice. Literal 80, never the constant.
    for (const bad of ['', ' ', 'yes', '0', '-10', '100', '250', undefined, null]) {
      expect(usageAlertApproachPct(bad as never)).toBe(80)
    }
  })
})
