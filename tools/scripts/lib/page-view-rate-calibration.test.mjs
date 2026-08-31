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
 * Pins `perPageView` to the page weight it is priced for.
 *
 *   node --test tools/scripts/lib/page-view-rate-calibration.test.mjs
 *
 * Written the way `tenant-page-weight.test.mjs` is: every FORCED RED is paired
 * with a POSITIVE CONTROL, because a detector asserted only on what it should
 * catch is half-tested, and the untested half is the one that produces false
 * positives until somebody deletes the gate.
 *
 * The forced reds mutate the RECORDED MEASUREMENT and the real module graph,
 * never the detector. A test that proved a gate red by breaking the gate would
 * pass just as happily with the comparison deleted.
 *
 * Nothing here writes to the tree. This is a shared checkout — a file swapped
 * on disk to prove a red is a file that rides along in whichever agent commits
 * next.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createResolver } from '../../lint-rules/lib/app-router-graph.mjs'
import {
  CALIBRATED_USD_PER_VIEW,
  PAGE_VIEW_CALIBRATION_BASIS_KB,
  evaluateRateCalibration,
  rateForWeightKb,
} from './page-view-rate-calibration.mjs'
import { parseUnitRates } from './pricing-drift.mjs'
import {
  TENANT_PAGE_ENTRY,
  budgetFor,
  measurePageWeight,
} from './tenant-page-weight.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-page-view-rate.mjs')
const BUDGET = JSON.parse(
  readFileSync(join(REPO_ROOT, 'tools', 'tenant-page-budget.json'), 'utf8'),
)
const CALIBRATION = BUDGET.wireCalibration

/**
 * The rate tables read through the CLI's own parser.
 *
 * Deliberately not a second regex written for the test: a fixture that parsed
 * the files its own way could agree with the checked-in numbers while the
 * gate's parser silently returned nothing, which is the failure the
 * `unreadable` verdict exists for.
 */
function realRates() {
  const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8')
  return {
    meteredRate: parseUnitRates(
      read('apps', 'console', 'utils', 'usage-metering.ts'),
      'METERED_UNIT_RATES_USD',
    )?.perPageView,
    cogsRate: parseUnitRates(
      read('libs', 'aglyn', 'src', 'lib', 'app-utils', 'plan-entitlements.ts'),
      'ORG_COGS_UNIT_RATES_USD',
    )?.perPageView,
  }
}

function measureRealGraph() {
  return measurePageWeight({
    entry: join(REPO_ROOT, TENANT_PAGE_ENTRY),
    read: (file) => readFileSync(file, 'utf8'),
    resolve: createResolver(REPO_ROOT),
    size: (file) => statSync(file).size,
  }).bytes
}

/** A record that agrees with itself, built from the real checked-in one. */
function consistentInput(overrides = {}) {
  const calibration = { ...CALIBRATION, ...(overrides.calibration ?? {}) }
  const rate = overrides.rate ?? rateForWeightKb(calibration.pricedForKb)
  return {
    meteredRate: rate,
    cogsRate: overrides.cogsRate ?? rate,
    calibration,
    sourceGraphBytes:
      overrides.sourceGraphBytes ?? calibration.sourceGraphBytes,
  }
}

// ── the formula's anchor ───────────────────────────────────────────────────

test('the formula reproduces the calibration it was derived from', () => {
  // The one fixed point: $0.0001 was measured at 627 KB. If this ever fails,
  // the rate for every other weight is being derived from a moved anchor.
  assert.equal(
    rateForWeightKb(PAGE_VIEW_CALIBRATION_BASIS_KB),
    CALIBRATED_USD_PER_VIEW,
  )
})

test('the formula is linear in page weight', () => {
  assert.equal(
    rateForWeightKb(PAGE_VIEW_CALIBRATION_BASIS_KB * 2),
    CALIBRATED_USD_PER_VIEW * 2,
  )
  // Half the page, half the cost — asserted separately so a formula that
  // happened to double correctly but clamped downward is still caught.
  assert.equal(
    rateForWeightKb(PAGE_VIEW_CALIBRATION_BASIS_KB / 2),
    CALIBRATED_USD_PER_VIEW / 2,
  )
})

test('the rate is a number a human can check in', () => {
  // Six decimal places, because the gate recomputes the expected value and
  // compares it EXACTLY. An unrounded product would force a tolerance, and a
  // tolerance on a pricing gate is a dial someone widens instead of measuring.
  const rate = rateForWeightKb(1000)
  assert.equal(rate, Number(rate.toFixed(6)))
})

// ── the checked-in record ──────────────────────────────────────────────────

test('POSITIVE CONTROL — the checked-in record is self-consistent', () => {
  const verdict = evaluateRateCalibration(consistentInput())
  assert.equal(verdict.ok, true)
})

test('POSITIVE CONTROL — the real tree passes the real gate', () => {
  const { meteredRate, cogsRate } = realRates()
  const verdict = evaluateRateCalibration({
    meteredRate,
    cogsRate,
    calibration: CALIBRATION,
    sourceGraphBytes: measureRealGraph(),
  })
  // Spelled out rather than a bare `ok`, so a failure names which of the four
  // went red instead of printing `false !== true`.
  assert.equal(
    `mispriced=${verdict.rateMispriced} widened=${verdict.shortfallWidened} ` +
      `stale=${verdict.calibrationStale} disagree=${verdict.tablesDisagree} ` +
      `unreadable=${verdict.unreadable}`,
    'mispriced=false widened=false stale=false disagree=false unreadable=',
  )
  assert.equal(verdict.ok, true)
})

test('the rate matches the weight it CLAIMS to be priced for', () => {
  const { meteredRate, cogsRate } = realRates()
  assert.equal(meteredRate, rateForWeightKb(CALIBRATION.pricedForKb))
  assert.equal(cogsRate, meteredRate)
})

test('the recorded shortfall is the arithmetic, not a rounder number', () => {
  // The gap is a reviewed CEILING, so it must actually cover the measurement
  // it was recorded for — and not by so much that a real regression fits
  // underneath it unnoticed.
  const actual = CALIBRATION.measuredKb / CALIBRATION.pricedForKb
  assert.ok(
    CALIBRATION.acknowledgedShortfall >= actual,
    `${CALIBRATION.acknowledgedShortfall} must cover ${actual}`,
  )
  assert.ok(CALIBRATION.acknowledgedShortfall - actual < 0.05)
})

// ── forced reds: the rate parted from its own stated basis ─────────────────

test('FORCED RED — the rate edited without its calibration', () => {
  const verdict = evaluateRateCalibration(
    consistentInput({
      rate: rateForWeightKb(CALIBRATION.pricedForKb) * 2,
      cogsRate: rateForWeightKb(CALIBRATION.pricedForKb) * 2,
    }),
  )
  assert.equal(verdict.rateMispriced, true)
  assert.equal(verdict.ok, false)
})

test('FORCED RED — the calibration edited without the rate', () => {
  // The same break from the other side: someone records that the rate is now
  // priced for a heavier page but leaves the rate alone.
  // The rate is pinned at the value the REAL record carries, so only the
  // calibration moves — otherwise the helper would re-derive the rate from
  // the mutated field and the two would agree again.
  const verdict = evaluateRateCalibration(
    consistentInput({
      rate: rateForWeightKb(CALIBRATION.pricedForKb),
      calibration: { pricedForKb: 1200 },
    }),
  )
  assert.equal(verdict.rateMispriced, true)
  assert.equal(verdict.expectedRate, rateForWeightKb(1200))
  assert.equal(verdict.ok, false)
})

test('FORCED RED — the two rate tables disagree', () => {
  const rate = rateForWeightKb(CALIBRATION.pricedForKb)
  const verdict = evaluateRateCalibration(
    consistentInput({ rate, cogsRate: rate + 0.00001 }),
  )
  assert.equal(verdict.tablesDisagree, true)
  assert.equal(verdict.ok, false)
})

test('FORCED RED — an unreadable rate is not a silent pass', () => {
  // A parser that stopped matching returns undefined, and `undefined !==
  // expected` would have read as "mispriced" while `undefined === undefined`
  // would have read as "the tables agree". Neither is a verdict about pricing.
  const verdict = evaluateRateCalibration({
    ...consistentInput(),
    meteredRate: undefined,
  })
  assert.deepEqual(verdict.unreadable, ['METERED_UNIT_RATES_USD'])
  assert.equal(verdict.ok, false)
  // It must NOT claim the tables disagree — that would send the reader to the
  // wrong file for a fault that is in the parser.
  assert.equal(verdict.tablesDisagree, false)
  assert.equal(verdict.rateMispriced, false)
})

// ── forced reds: the page moved past what the rate is priced for ───────────

test('FORCED RED — a re-measurement widens the gap past the reviewed one', () => {
  // THE DEFECT THIS GATE EXISTS FOR. The page grew, somebody recorded the new
  // weight honestly, and the rate underneath it did not move. The MEASUREMENT
  // is mutated, not the gate.
  const heavier = CALIBRATION.acknowledgedShortfall * CALIBRATION.pricedForKb + 1
  const verdict = evaluateRateCalibration(
    consistentInput({ calibration: { measuredKb: heavier } }),
  )
  assert.equal(verdict.shortfallWidened, true)
  assert.equal(verdict.ok, false)
  // …and it says what the rate would have to become, so the reader is not
  // left to re-derive it from a ratio.
  assert.equal(verdict.rateForMeasured, rateForWeightKb(heavier))
})

test('POSITIVE CONTROL — exactly the reviewed gap is not a red', () => {
  // Deliberately synthetic, and deliberately powers of ten. Deriving the
  // boundary from the real record — `acknowledgedShortfall * pricedForKb`,
  // divided by `pricedForKb` again inside the gate — lands a hair BELOW the
  // threshold in floating point, so the case never reached the comparison and
  // an off-by-one there survived. These divide exactly.
  const boundary = {
    pricedForKb: 100,
    measuredKb: 200,
    acknowledgedShortfall: 2,
    sourceGraphBytes: CALIBRATION.sourceGraphBytes,
    sourceGraphTolerance: CALIBRATION.sourceGraphTolerance,
  }
  const verdict = evaluateRateCalibration(
    consistentInput({ rate: rateForWeightKb(100), calibration: boundary }),
  )
  assert.equal(verdict.shortfall, 2)
  assert.equal(verdict.shortfallWidened, false)
  assert.equal(verdict.ok, true)
})

test('FORCED RED — one part in a thousand past the reviewed gap', () => {
  // The other side of the same boundary, so the comparison cannot be widened
  // to `>=` or narrowed to a range without one of the pair failing.
  const boundary = {
    pricedForKb: 100,
    measuredKb: 200.1,
    acknowledgedShortfall: 2,
    sourceGraphBytes: CALIBRATION.sourceGraphBytes,
    sourceGraphTolerance: CALIBRATION.sourceGraphTolerance,
  }
  const verdict = evaluateRateCalibration(
    consistentInput({ rate: rateForWeightKb(100), calibration: boundary }),
  )
  assert.equal(verdict.shortfallWidened, true)
  assert.equal(verdict.ok, false)
})

test('POSITIVE CONTROL — a page that got lighter is not a red here', () => {
  // Narrowing the gap is the direction that fixes the claim. It still needs a
  // rate decision, which the shortfall record carries; it is not a build
  // failure, or every page-weight win would land red.
  const verdict = evaluateRateCalibration(
    consistentInput({ calibration: { measuredKb: CALIBRATION.pricedForKb } }),
  )
  assert.equal(verdict.shortfallWidened, false)
  assert.equal(verdict.ok, true)
})

// ── forced reds: the code moved away from the measurement ──────────────────

test('FORCED RED — the module graph grew past the staleness tolerance', () => {
  const { sourceGraphBytes, sourceGraphTolerance } = CALIBRATION
  const verdict = evaluateRateCalibration(
    consistentInput({
      sourceGraphBytes: Math.ceil(
        sourceGraphBytes * (1 + sourceGraphTolerance) + 1,
      ),
    }),
  )
  assert.equal(verdict.calibrationStale, true)
  assert.equal(verdict.driftDirection, 'heavier')
  assert.equal(verdict.ok, false)
})

test('FORCED RED — the module graph shrank past the staleness tolerance', () => {
  // `check-tenant-page-weight.mjs` deliberately passes a lighter page: it pins
  // a CEILING. This one is asking whether the MEASUREMENT still describes the
  // code, and a graph that halved has invalidated it just as thoroughly.
  const { sourceGraphBytes, sourceGraphTolerance } = CALIBRATION
  const verdict = evaluateRateCalibration(
    consistentInput({
      sourceGraphBytes: Math.floor(
        sourceGraphBytes * (1 - sourceGraphTolerance) - 1,
      ),
    }),
  )
  assert.equal(verdict.calibrationStale, true)
  assert.equal(verdict.driftDirection, 'lighter')
  assert.equal(verdict.ok, false)
})

test('POSITIVE CONTROL — exactly at the tolerance is not stale', () => {
  // The boundary in both directions, so the comparison cannot be `>=` on one
  // side and `>` on the other without this failing.
  const { sourceGraphBytes, sourceGraphTolerance } = CALIBRATION
  for (const sign of [1, -1]) {
    const verdict = evaluateRateCalibration(
      consistentInput({
        sourceGraphBytes: sourceGraphBytes * (1 + sign * sourceGraphTolerance),
      }),
    )
    assert.equal(verdict.calibrationStale, false)
  }
})

test('FORCED RED — the REAL module graph doctored past the tolerance', () => {
  // Against the real measurement path rather than a literal, so the gate is
  // proved to consume what the CLI actually feeds it.
  const real = measureRealGraph()
  const padded = Math.ceil(real * (1 + CALIBRATION.sourceGraphTolerance) + 1)
  assert.ok(padded > real)
  const verdict = evaluateRateCalibration(
    consistentInput({
      calibration: { sourceGraphBytes: real },
      sourceGraphBytes: padded,
    }),
  )
  assert.equal(verdict.calibrationStale, true)
  assert.equal(verdict.ok, false)
})

test('POSITIVE CONTROL — the real graph is within tolerance of the record', () => {
  const real = measureRealGraph()
  const drift = Math.abs(real - CALIBRATION.sourceGraphBytes) / CALIBRATION.sourceGraphBytes
  assert.ok(
    drift <= CALIBRATION.sourceGraphTolerance,
    `graph drifted ${(drift * 100).toFixed(2)}% from the recorded review point`,
  )
})

// ── the record survives a deliberate re-baseline ───────────────────────────

test('a re-baseline carries the calibration through untouched', () => {
  // `--write` rewrites this file wholesale. If it dropped the calibration the
  // pricing gate would fail as UNREADABLE rather than as stale, and the
  // obvious fix would be to write a fresh calibration from thin air.
  const rebaselined = budgetFor({ bytes: 9_999_999, moduleCount: 1 }, BUDGET)
  assert.deepEqual(rebaselined.wireCalibration, CALIBRATION)
  // …and the baseline it re-records has genuinely moved away from it, which
  // is what drags the rate into the conversation.
  assert.notEqual(
    rebaselined.baselineBytes,
    rebaselined.wireCalibration.sourceGraphBytes,
  )
})

test('a first re-baseline invents no calibration', () => {
  const fresh = budgetFor({ bytes: 100, moduleCount: 1 })
  assert.equal('wireCalibration' in fresh, false)
})

test('the calibration was reviewed against the recorded baseline', () => {
  assert.equal(CALIBRATION.sourceGraphBytes, BUDGET.baselineBytes)
})

// ── the CLI ────────────────────────────────────────────────────────────────

test('the CLI passes on the real tree and states the gap', () => {
  const out = String(
    execFileSync('node', [CLI], { cwd: REPO_ROOT, stdio: 'pipe' }),
  )
  assert.match(out, /check:page-view-rate/)
  // A green run that did not mention the shortfall would let the open pricing
  // decision fall out of view, which is how it went unnoticed the first time.
  assert.match(out, /priced for 627 KB/)
})
