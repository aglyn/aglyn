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
 * Overage protection for stored bytes (AGL-1886).
 *
 * Zach, 2026-08-17, on billing org-library storage from today — verbatim:
 * "also give overage protection and usage alerts, so customers don't get a
 * surprise bill." This suite guards the protection half; the alert half is
 * `org-library-storage-alert.spec.ts` and the billing switch is
 * `org-library-storage-metering.spec.ts`.
 *
 * THE PROPERTY, and it is structural rather than procedural: an org that has
 * not acknowledged metered storage cannot be billed a cent of storage
 * overage, because the bytes that would have been billed were never accepted.
 * An org that HAS acknowledged agreed to a bounded amount, and is refused
 * again at that bound. Neither outcome depends on an alert having worked.
 *
 * Every expectation here was forced red once against the code it guards.
 */

import {
  checkStorageCeiling,
  mediaStorageGate,
  resolveStorageOverage,
  storageOveragePricePerGbUsd,
  storageOverageUsd,
  STORAGE_OVERAGE_DEFAULT_CEILING_USD,
  usageAlertApproachPct,
  usageAlertThreshold,
  USAGE_ALERT_APPROACH_PCT_DEFAULT,
} from '../utils/storage-overage'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/server'

/** Pro meters infra overage and includes 10240 MB per scope. */
const PRO_SCOPE_MB = PLAN_ENTITLEMENTS.pro.storagePerHostMb
const proOrg = (storageOverage?: unknown) =>
  ({
    plan: 'pro',
    subscription: { status: 'active' },
    ...(storageOverage ? { storageOverage } : {}),
  }) as any

describe('alert thresholds are config, and fail to the default (AGL-1886)', () => {
  it('warns at 80 and again at the cap', () => {
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
    // And a corrupt usage figure is not an alert either.
    expect(usageAlertThreshold(Number.NaN, 100)).toBe(0)
    expect(usageAlertThreshold(-5, 100)).toBe(0)
  })

  it('takes a configured percentage', () => {
    expect(usageAlertApproachPct('70')).toBe(70)
    expect(usageAlertApproachPct('90')).toBe(90)
    expect(usageAlertThreshold(75, 100, usageAlertApproachPct('70'))).toBe(70)
  })

  it('FAILS TO 80 on anything malformed, rather than going silent', () => {
    // The defect this whole issue exists to remove is an alert that cannot
    // fire. A blank or mistyped env var must not become one. Forced red by
    // returning `parsed` unguarded: `''` → 0 (alert always), `'yes'` → NaN
    // (alert never), `'100'` → the warning collapses into the cap notice and
    // the approach warning disappears.
    for (const bad of ['', ' ', 'yes', '0', '-10', '100', '250', undefined, null]) {
      expect(usageAlertApproachPct(bad as never)).toBe(80)
    }
  })
})

describe('the storage ceiling (AGL-1886)', () => {
  it('is a no-op inside the allowance', () => {
    const verdict = checkStorageCeiling({
      org: proOrg(),
      usedMb: PRO_SCOPE_MB - 1,
      allowanceMb: PRO_SCOPE_MB,
    })
    expect(verdict.allowed).toBe(true)
    expect(verdict.code).toBeNull()
    expect(verdict.projectedOverageUsd).toBe(0)
  })

  it('REFUSES past the allowance with no acknowledgement, and names the price', () => {
    const verdict = checkStorageCeiling({
      org: proOrg(),
      usedMb: PRO_SCOPE_MB + 1024,
      allowanceMb: PRO_SCOPE_MB,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('overage_optin_required')
    // The refusal has to be actionable. Today's bare "Storage limit reached"
    // offers no way through, which is the half of the hard cap that costs
    // money as well as goodwill.
    expect(verdict.message).toContain('Billing')
    expect(verdict.message).toContain('/GB')
  })

  it('allows an acknowledged org inside its ceiling', () => {
    const verdict = checkStorageCeiling({
      org: proOrg({ acknowledgedAt: 1, monthlyCeilingUsd: 25 }),
      usedMb: PRO_SCOPE_MB + 1024,
      allowanceMb: PRO_SCOPE_MB,
    })
    expect(verdict.allowed).toBe(true)
    // 1 GB × $0.026 × 1.30 = $0.0338.
    expect(verdict.projectedOverageUsd).toBeCloseTo(0.0338, 6)
  })

  it('REFUSES again at the ceiling — consent is bounded, never open', () => {
    // The ceiling is what makes an acknowledgement safe to give. Forced red by
    // returning `allowed: true` once acknowledged: an org that agreed to $25
    // then uploaded 40 TB would be invoiced for all of it, having agreed to
    // twenty-five dollars.
    const verdict = checkStorageCeiling({
      org: proOrg({ acknowledgedAt: 1, monthlyCeilingUsd: 5 }),
      usedMb: PRO_SCOPE_MB + 1024 * 1024,
      allowanceMb: PRO_SCOPE_MB,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('overage_ceiling_reached')
    expect(verdict.message).toContain('$5.00')
  })

  it('treats a missing or corrupt ceiling as the default, never as unbounded', () => {
    // The one direction this must not fail in. Forced red by reading
    // `raw.monthlyCeilingUsd` straight through: `undefined` and `Infinity`
    // each became "no bound", which is consent to any amount.
    for (const bad of [undefined, null, 0, -5, Number.NaN, 'lots']) {
      const resolved = resolveStorageOverage(
        proOrg({ acknowledgedAt: 1, monthlyCeilingUsd: bad }),
      )
      expect(resolved.acknowledged).toBe(true)
      expect(resolved.monthlyCeilingUsd).toBe(STORAGE_OVERAGE_DEFAULT_CEILING_USD)
      expect(Number.isFinite(resolved.monthlyCeilingUsd)).toBe(true)
    }
    // An `Infinity` ceiling would be the same defect spelled differently.
    expect(
      resolveStorageOverage(
        proOrg({ acknowledgedAt: 1, monthlyCeilingUsd: Number.POSITIVE_INFINITY }),
      ).monthlyCeilingUsd,
    ).toBe(STORAGE_OVERAGE_DEFAULT_CEILING_USD)
  })

  it('reads an org with no acknowledgement as not acknowledged', () => {
    expect(resolveStorageOverage(proOrg()).acknowledged).toBe(false)
    expect(resolveStorageOverage(undefined).acknowledged).toBe(false)
    expect(resolveStorageOverage(null).acknowledged).toBe(false)
    // A ceiling with no acknowledgement is not consent.
    expect(
      resolveStorageOverage(proOrg({ monthlyCeilingUsd: 500 })).acknowledged,
    ).toBe(false)
  })

  it('prices the overage the way the rollup does', () => {
    // Same rate × the same markup the invoice uses, so the number a customer
    // is shown before the upload is the number they are later charged.
    expect(storageOverageUsd(1024)).toBeCloseTo(0.026 * 1.3, 8)
    expect(storageOverageUsd(0)).toBe(0)
    expect(storageOverageUsd(-100)).toBe(0)
    expect(storageOverageUsd(Number.NaN)).toBe(0)
  })
})

describe('the media ingress gate (AGL-1886)', () => {
  it('is unchanged inside the allowance', () => {
    const gate = mediaStorageGate({ org: proOrg(), usedMb: 100 })
    expect(gate.allowed).toBe(true)
    expect(gate.limitMb).toBe(PRO_SCOPE_MB)
  })

  it('keeps FREE a hard cap — there is no subscription to bill on', () => {
    // A free org allowed past its cap on an acknowledgement would be unbilled
    // storage with nothing to invoice it against, which is the direction that
    // loses money. Forced red by dropping the `planMetersInfraOverage` check:
    // a free org with a forged acknowledgement uploaded without limit.
    const free = { plan: 'free' } as any
    const gate = mediaStorageGate({
      org: { ...free, storageOverage: { acknowledgedAt: 1, monthlyCeilingUsd: 500 } },
      usedMb: PLAN_ENTITLEMENTS.free.storagePerHostMb + 100,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.code).toBeNull()
    expect(gate.error).toContain('Storage limit reached')
  })

  it('refuses a metered plan past the allowance until it opts in', () => {
    const gate = mediaStorageGate({
      org: proOrg(),
      usedMb: PRO_SCOPE_MB + 512,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.status).toBe(403)
    expect(gate.code).toBe('overage_optin_required')
    // NOTHING is billed for a refused upload, because the bytes never land.
    // This is the whole "no surprise bill" argument in one assertion.
    expect(gate.projectedOverageUsd).toBeGreaterThan(0)
    expect(gate.ceilingUsd).toBe(0)
  })

  it('lets an acknowledged org through, and stops it at its bound', () => {
    const acknowledged = proOrg({ acknowledgedAt: 1, monthlyCeilingUsd: 10 })
    expect(
      mediaStorageGate({ org: acknowledged, usedMb: PRO_SCOPE_MB + 1024 })
        .allowed,
    ).toBe(true)
    const over = mediaStorageGate({
      org: acknowledged,
      usedMb: PRO_SCOPE_MB + 1024 * 1024,
    })
    expect(over.allowed).toBe(false)
    expect(over.code).toBe('overage_ceiling_reached')
  })

  it('prices the refusal from the SAME rate the card quotes (AGL-1957)', () => {
    // The Billing card names a price before asking for consent, and it reads
    // that price from `storageOveragePricePerGbUsd()` via the route. If the
    // refusal message computed its own, the two could drift and a customer
    // would agree to one rate and be refused in the language of another.
    const gate = mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB + 512 })
    expect(gate.error).toContain(
      `$${storageOveragePricePerGbUsd().toFixed(3)}/GB`,
    )
  })

  it('keeps the AGL-471 off-by-one exactly where it was', () => {
    // `usedMb` includes the incoming file and the integer cap is INCLUSIVE.
    // A change here would silently move every plan's storage limit by 1 MB,
    // in whichever direction, on four ingress routes at once.
    expect(
      mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB }).allowed,
    ).toBe(true)
    expect(
      mediaStorageGate({ org: proOrg(), usedMb: PRO_SCOPE_MB + 0.5 }).allowed,
    ).toBe(false)
  })
})

describe('the consent ROUND TRIP: surface → store → gate (AGL-1957)', () => {
  /**
   * The gap AGL-1957 found was not in the gate and not in the route — each was
   * correct alone. It was that **nothing connected them**: the route is the
   * only writer of `org.storageOverage` and it had no caller, so the branch
   * every test above exercises with a hand-built org was unreachable in the
   * running product.
   *
   * The suite above proves the gate honours a consent. This one proves the
   * consent the surface actually produces is the one the gate reads — which is
   * the assertion that would have failed before the card existed, and the one
   * that fails again if either side renames its field.
   */

  /** Exactly what `/api/billing/storage-overage` writes on `acknowledge`. */
  const writtenByAcknowledge = (ceilingUsd: number) => ({
    // `FieldValue.serverTimestamp()` resolves to a Timestamp on read; the
    // resolver only asks whether it is truthy, so any stamp models it.
    acknowledgedAt: new Date('2026-08-18T12:00:00Z'),
    acknowledgedBy: 'uid-admin',
    monthlyCeilingUsd: ceilingUsd,
  })

  it('NEGATIVE CONTROL: no opt-in means the bytes are refused, so nothing bills', () => {
    // An org that never reached the card cannot be billed a cent of storage
    // overage — not because billing skips it, but because the upload never
    // landed. `report-usage` bills whatever bytes are stored and does NOT
    // consult the acknowledgement, so this refusal is the ONLY thing standing
    // between a metered org and an invoice line. That is why it is asserted
    // here and not left to the rollup.
    const gate = mediaStorageGate({
      org: proOrg(),
      usedMb: PRO_SCOPE_MB + 4096,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.code).toBe('overage_optin_required')
  })

  it('POSITIVE CONTROL: the acknowledgement the route writes DOES open the gate', () => {
    // Without this, the suite would pass by refusing everything — a guard that
    // only tests refusal is satisfied by a product that can never be used, and
    // that is precisely the state AGL-1957 found. Forced red by writing
    // `{ acknowledged: true }` instead of `acknowledgedAt` (the shape the
    // route's response body uses, and the natural typo): `resolveStorageOverage`
    // reads it as NOT acknowledged, the gate keeps refusing, and every
    // customer who clicked "Turn on metered storage" stays hard-capped with a
    // stored consent nothing reads.
    const gate = mediaStorageGate({
      org: proOrg(writtenByAcknowledge(40)),
      usedMb: PRO_SCOPE_MB + 4096,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.status).toBe(200)
    expect(gate.projectedOverageUsd).toBeGreaterThan(0)
  })

  it('the ceiling the customer TYPED is the ceiling enforced', () => {
    // The card sends the number from its field; the route stores it; the gate
    // bounds on it. A $2 consent must not be enforced as the $25 default —
    // that would bill an org twelve times what it agreed to.
    const org = proOrg(writtenByAcknowledge(2))
    expect(resolveStorageOverage(org).monthlyCeilingUsd).toBe(2)
    // ~59 GB of overage ≈ $2.00; well past it must refuse.
    const over = mediaStorageGate({
      org,
      usedMb: PRO_SCOPE_MB + 1024 * 1024,
    })
    expect(over.allowed).toBe(false)
    expect(over.code).toBe('overage_ceiling_reached')
    expect(over.ceilingUsd).toBe(2)
  })

  it('revoke returns the org to the refusing state', () => {
    // `revoke` deletes the whole `storageOverage` field, so the org is
    // indistinguishable from one that never opted in — and is refused again
    // immediately, which is what makes withdrawal real rather than cosmetic.
    const revoked = proOrg()
    expect(resolveStorageOverage(revoked).acknowledged).toBe(false)
    expect(
      mediaStorageGate({ org: revoked, usedMb: PRO_SCOPE_MB + 4096 }).code,
    ).toBe('overage_optin_required')
  })

  it('the route’s own ceiling bound is inside what the resolver will honour', () => {
    // The card offers $1–$5000 because the route allows it. If the route ever
    // permitted a ceiling the resolver then rewrote, the customer would agree
    // to one number and be enforced at another.
    for (const ceiling of [1, 25, 5000]) {
      expect(
        resolveStorageOverage(proOrg(writtenByAcknowledge(ceiling)))
          .monthlyCeilingUsd,
      ).toBe(ceiling)
    }
  })
})
