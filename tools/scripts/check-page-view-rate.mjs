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
 * Keep `perPageView` honest about the page it is priced for.
 *
 * ```
 * npm run check:page-view-rate
 * npm run check:page-view-rate -- --json
 * ```
 *
 * `check:tenant-page-weight` pins a CEILING on how heavy a published page's
 * module graph may get. This one asks the question that ceiling cannot: is the
 * PRICE still the one that weight implies? The published term is "at cost +
 * 30%", so a `perPageView` calibrated against a page that no longer exists
 * makes the claim false rather than making us dear or cheap.
 *
 * The reasoning, and why the source-byte comparison is a staleness tripwire
 * rather than a weight estimate, lives in `lib/page-view-rate-calibration.mjs`;
 * the forced reds are in its test file.
 *
 * Exit codes: 0 consistent · 1 the rate and the measurement have parted ·
 * 2 something could not be read, which is never a pass.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createResolver } from '../lint-rules/lib/app-router-graph.mjs'
import {
  WHY_RECALIBRATE,
  evaluateRateCalibration,
} from './lib/page-view-rate-calibration.mjs'
import { parseUnitRates } from './lib/pricing-drift.mjs'
import { TENANT_PAGE_ENTRY, measurePageWeight } from './lib/tenant-page-weight.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BUDGET_PATH = join(REPO_ROOT, 'tools', 'tenant-page-budget.json')
const METERED_PATH = join(REPO_ROOT, 'apps', 'console', 'utils', 'usage-metering.ts')
const COGS_PATH = join(
  REPO_ROOT,
  'libs',
  'aglyn',
  'src',
  'lib',
  'app-utils',
  'plan-entitlements.ts',
)

const args = process.argv.slice(2)
const usd = (n) => `$${n.toFixed(6)}`
const pct = (n) => `${(n * 100).toFixed(1)}%`

function main() {
  let budget
  let meteredRate
  let cogsRate
  let sourceGraphBytes

  try {
    budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
    meteredRate = parseUnitRates(
      readFileSync(METERED_PATH, 'utf8'),
      'METERED_UNIT_RATES_USD',
    )?.perPageView
    cogsRate = parseUnitRates(
      readFileSync(COGS_PATH, 'utf8'),
      'ORG_COGS_UNIT_RATES_USD',
    )?.perPageView
    // Stat the entry first, for the reason `check-tenant-page-weight.mjs`
    // does: a resolver handed a path that does not exist walks no edges and
    // reports zero bytes, and zero bytes reads as a graph that shrank to
    // nothing rather than as a measurement that did not happen.
    const entry = join(REPO_ROOT, TENANT_PAGE_ENTRY)
    statSync(entry)
    sourceGraphBytes = measurePageWeight({
      entry,
      read: (file) => readFileSync(file, 'utf8'),
      resolve: createResolver(REPO_ROOT),
      size: (file) => statSync(file).size,
    }).bytes
  } catch (error) {
    console.error(`check:page-view-rate — cannot read the inputs: ${error.message}`)
    return 2
  }

  const calibration = budget.wireCalibration
  if (!calibration || !Number.isFinite(calibration.measuredKb)) {
    console.error(
      'check:page-view-rate — `wireCalibration` is missing from ' +
        'tools/tenant-page-budget.json. The rate has nothing to be priced ' +
        'against, which is the state this gate exists to end.',
    )
    return 2
  }

  const verdict = evaluateRateCalibration({
    meteredRate,
    cogsRate,
    calibration,
    sourceGraphBytes,
  })

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        { meteredRate, cogsRate, sourceGraphBytes, calibration, verdict },
        null,
        2,
      ),
    )
  }

  if (verdict.unreadable.length) {
    console.error(
      'check:page-view-rate — could not read `perPageView` from ' +
        `${verdict.unreadable.join(' and ')}. A rate this gate cannot see is ` +
        'a rate it cannot vouch for.',
    )
    return 2
  }

  if (verdict.tablesDisagree) {
    console.error(
      'check:page-view-rate — the two rate tables disagree about what a page ' +
        'view costs.\n\n' +
        `  METERED_UNIT_RATES_USD   ${usd(meteredRate)}\n` +
        `  ORG_COGS_UNIT_RATES_USD  ${usd(cogsRate)}\n\n` +
        'These are the same pass-through cost written in two files on ' +
        'purpose, and they must be changed together.',
    )
    return 1
  }

  if (verdict.rateMispriced) {
    console.error(
      'check:page-view-rate — `perPageView` is not the rate the weight it is ' +
        'recorded as priced for implies.\n\n' +
        `  priced for    ${calibration.pricedForKb} KB\n` +
        `  implies       ${usd(verdict.expectedRate)} per view\n` +
        `  tables carry  ${usd(meteredRate)} per view\n\n` +
        'One of the two was edited without the other. The customer is billed ' +
        'this times METERED_MARKUP and the published term is "at cost + 30%", ' +
        'so a rate that disagrees with its own stated basis makes the ' +
        'published claim unverifiable rather than merely stale.',
    )
    return 1
  }

  if (verdict.shortfallWidened) {
    console.error(
      'check:page-view-rate — a published page now weighs more, against a ' +
        'rate that has not moved.\n\n' +
        `  priced for   ${calibration.pricedForKb} KB → ${usd(meteredRate)} per view\n` +
        `  measured     ${calibration.measuredKb} KB → ${usd(verdict.rateForMeasured)} per view\n` +
        `  shortfall    ${verdict.shortfall.toFixed(2)}× ` +
        `(reviewed and accepted: ${calibration.acknowledgedShortfall}×)\n\n` +
        'The gap is wider than the one on record, so it has not been looked ' +
        'at in this shape. Re-pegging the rate is a PRICING DECISION and not ' +
        "this gate's to make: take it to whoever owns the price. If the new " +
        'gap is accepted as it stands, `acknowledgedShortfall` is where that ' +
        'is written down, and moving it is the argument.',
    )
    return 1
  }

  if (verdict.calibrationStale) {
    console.error(
      "check:page-view-rate — the published page's module graph has moved " +
        'away from the measurement the rate rests on.\n\n' +
        `  graph when measured  ${calibration.sourceGraphBytes} bytes\n` +
        `  graph now            ${sourceGraphBytes} bytes\n` +
        `  drift                ${pct(verdict.drift)} ${verdict.driftDirection} ` +
        `(tolerance ±${pct(calibration.sourceGraphTolerance)})\n\n` +
        WHY_RECALIBRATE,
    )
    return 1
  }

  if (!args.includes('--json')) {
    // The open gap is printed on a GREEN run too. A number that only appears
    // when something breaks is a number nobody reads, and this one is a
    // standing pricing decision rather than a transient failure.
    console.log(
      `check:page-view-rate — ${usd(meteredRate)} per view, priced for ` +
        `${calibration.pricedForKb} KB; last measured ` +
        `${calibration.measuredKb} KB (${verdict.shortfall.toFixed(2)}×, ` +
        `accepted ${calibration.acknowledgedShortfall}×, would imply ` +
        `${usd(verdict.rateForMeasured)}); graph within ` +
        `${pct(Math.abs(verdict.drift))} of the review point ` +
        `(tolerance ±${pct(calibration.sourceGraphTolerance)})`,
    )
  }
  return 0
}

process.exit(main())
