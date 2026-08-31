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
 * Ties `perPageView` to the page weight it claims to be priced for.
 *
 * `perPageView` is a COST PER PAGE VIEW, and the customer is billed it times
 * `METERED_MARKUP`. The published term is literally "at cost + 30%", so a
 * `perPageView` that no longer matches what a page weighs does not make us
 * expensive or cheap — it makes the published claim false, in whichever
 * direction the page moved.
 *
 * Before this gate nothing connected the two. `check-tenant-page-weight.mjs`
 * measured a published page and the rate priced one, and neither knew the
 * other existed, so the page grew for months against a rate calibrated once
 * and never revisited.
 *
 * ## Three quantities, three units, and the one comparison that is honest
 *
 * The trap here is that the repo holds three numbers about "page weight" and
 * only two of them are the same kind of thing:
 *
 *   1. `baselineBytes` — SOURCE bytes of the static first-party module graph.
 *      Pre-minification, no bundler, no network. Deterministic and free.
 *   2. `wireCalibration.measuredKb` — ENCODED bytes over HTTP for a real cold
 *      load of a real published page. What we actually pay egress on.
 *   3. `perPageView` — DOLLARS, calibrated against (2).
 *
 * (1) and (2) are not interchangeable and nothing here converts between them.
 * Source bytes are several times the wire figure and the ratio moves with
 * minification and compression, so a gate that multiplied one into the other
 * would be inventing a constant nobody measured.
 *
 * So the three comparisons this module makes each stay inside one unit:
 *
 *   **Priced-for** (dollars ↔ dollars). `perPageView` must equal the rate that
 *   the weight it CLAIMS to be calibrated against implies, at the per-KB cost
 *   the original calibration fixed. This is the rate agreeing with its own
 *   stated basis, so it is red the moment either is edited alone.
 *
 *   **Shortfall** (KB ↔ KB). What a page measures now, over what the rate is
 *   priced for. Red when a re-measurement makes that gap wider than the one on
 *   record — see `evaluateRateCalibration` for why this is deliberately not
 *   collapsed into the comparison above.
 *
 *   **Still-current** (source bytes ↔ source bytes). The calibration records
 *   the source graph as it stood when this record was last reviewed. Measuring
 *   that graph today says whether the code has moved far enough that the wire
 *   figure needs taking again — a wire measurement needs a browser and a
 *   deployed site, so what CI can afford is the cheap sentinel that tells you
 *   when to go and take the expensive one.
 *
 * `sourceGraphTolerance` is deliberately TIGHTER than the 25% headroom on the
 * weight budget next to it. That budget is a performance ceiling, and headroom
 * there stops a comment turning the build red. This one guards a published
 * claim about what a customer is charged, which is the more fragile promise of
 * the two, so it should be the first of the pair to ask for attention rather
 * than the second.
 *
 * The second is a STALENESS TRIPWIRE, not a weight estimate. It never claims
 * to know what the page now weighs on the wire — only that it has changed
 * enough that somebody has to go and measure it again. That is the whole
 * reason it can live in CI: the expensive measurement needs a browser and a
 * deployed site, and the cheap one that guards it needs neither.
 *
 * ## Why drift is red in BOTH directions
 *
 * `check-tenant-page-weight.mjs` deliberately treats a lighter page as a pass,
 * because it pins a ceiling and a ceiling that a win must be re-cut to reach
 * punishes the win. This gate is not a ceiling. A page that got materially
 * LIGHTER against an unchanged rate means we are charging more than cost plus
 * 30%, which is the same broken promise as charging less — it is just the
 * direction that flatters us. Both are re-measure-and-re-peg.
 */

/**
 * Cost per encoded KB of page weight, fixed by the original calibration.
 *
 * $0.0001 per view was measured against a 627 KB cold load, and that pairing
 * is the only thing here that is not re-derived: it carries the Firestore
 * reads and the edge/ISR share of a render as well as the transfer, so it is
 * not a bandwidth price and must not be re-based on an egress rate card.
 *
 * @see PAGE_VIEW_CALIBRATION_BASIS_KB
 */
export const CALIBRATED_USD_PER_VIEW = 0.0001

/** The encoded page weight `CALIBRATED_USD_PER_VIEW` was measured against. */
export const PAGE_VIEW_CALIBRATION_BASIS_KB = 627

/**
 * Dollars the rate table should carry for a page of `measuredKb`.
 *
 * Rounded to the nearest millionth of a dollar so the constant a human reads
 * in the rate table is the constant this recomputes — an unrounded product
 * would be a twenty-digit float that nobody would check in, and a gate whose
 * expected value cannot be written down is a gate that gets a tolerance
 * bolted on and then quietly widened.
 */
export function rateForWeightKb(measuredKb) {
  const exact =
    (CALIBRATED_USD_PER_VIEW * measuredKb) / PAGE_VIEW_CALIBRATION_BASIS_KB
  return Math.round(exact * 1e6) / 1e6
}

/**
 * Grade the rate against its calibration, and the calibration against the code.
 *
 * ## Why `pricedForKb` and `measuredKb` are two fields and not one
 *
 * They are the same quantity at two different moments, and collapsing them
 * would destroy the only honest record of the gap between them.
 *
 * `pricedForKb` is the weight `perPageView` was actually calibrated against.
 * `measuredKb` is what a published page weighs now. When they agree, the
 * published "at cost + 30%" is literally true. When they do not, the size of
 * the disagreement IS the finding, and it belongs in the file where anyone can
 * read it rather than in a rate that quietly absorbed it.
 *
 * `acknowledgedShortfall` is the ratio between them that has been reviewed and
 * signed off. It is a CEILING, not a license: the gate stays green while the
 * gap is the one somebody looked at, and goes red the moment a re-measurement
 * makes it wider. That is what turns "we know the rate is stale" from a fact
 * that decays into one that has to be re-argued every time the page grows.
 *
 * A rate correction is a pricing decision and this gate does not make it — it
 * refuses to let it be made silently, in either direction.
 *
 * @param {object} input
 * @param {number} input.meteredRate `METERED_UNIT_RATES_USD.perPageView`
 * @param {number} input.cogsRate `ORG_COGS_UNIT_RATES_USD.perPageView`
 * @param {{pricedForKb: number, measuredKb: number, acknowledgedShortfall: number, sourceGraphBytes: number, sourceGraphTolerance: number}} input.calibration
 * @param {number} input.sourceGraphBytes the graph as measured on this checkout
 */
export function evaluateRateCalibration({
  meteredRate,
  cogsRate,
  calibration,
  sourceGraphBytes,
}) {
  const expectedRate = rateForWeightKb(calibration.pricedForKb)
  // The two tables are read from two different files by one shared parser. A
  // parse that silently returned undefined for either would make every other
  // comparison here vacuously true, so an unreadable rate is its own verdict
  // rather than a falsy value flowing into the arithmetic.
  const unreadable = [
    ['METERED_UNIT_RATES_USD', meteredRate],
    ['ORG_COGS_UNIT_RATES_USD', cogsRate],
  ]
    .filter(([, value]) => !Number.isFinite(value))
    .map(([name]) => name)

  const tablesDisagree = unreadable.length === 0 && meteredRate !== cogsRate
  const rateMispriced = unreadable.length === 0 && meteredRate !== expectedRate

  const shortfall = calibration.measuredKb / calibration.pricedForKb
  const shortfallWidened = shortfall > calibration.acknowledgedShortfall

  const drift =
    (sourceGraphBytes - calibration.sourceGraphBytes) /
    calibration.sourceGraphBytes
  /*
   * Representation slack, not extra tolerance. `drift` is a quotient of
   * floats, so a graph sitting EXACTLY on the boundary can compute to a few
   * parts in 10^16 beyond it — 1130012 * (1 - 0.15) reads as a drift of
   * -0.15000000000000005, which a bare `>` calls stale.
   *
   * 1e-12 is five orders of magnitude above that error and, at this graph
   * size, four orders BELOW one byte: a single byte of real drift is 9e-7 in
   * relative terms, so nothing a measurement can actually produce hides here.
   */
  const FLOAT_SLACK = 1e-12
  const calibrationStale =
    Math.abs(drift) - calibration.sourceGraphTolerance > FLOAT_SLACK

  return {
    ok:
      unreadable.length === 0 &&
      !tablesDisagree &&
      !rateMispriced &&
      !shortfallWidened &&
      !calibrationStale,
    unreadable,
    tablesDisagree,
    rateMispriced,
    shortfallWidened,
    calibrationStale,
    expectedRate,
    shortfall,
    /** What the rate would have to become for the gap to close. */
    rateForMeasured: rateForWeightKb(calibration.measuredKb),
    drift,
    driftDirection: drift >= 0 ? 'heavier' : 'lighter',
  }
}

/** The paragraph a stale calibration prints, so the reader knows what to do. */
export const WHY_RECALIBRATE =
  'The wire weight behind `perPageView` was measured against a version of ' +
  "the published page's module graph that this checkout no longer matches, " +
  'so the rate is priced for a page that no longer exists.\n\n' +
  'This is not a number to nudge until the gate goes quiet. Re-measure a ' +
  'real cold load of a published page — HTTP cache disabled, ' +
  "`document.visibilityState === 'visible'` so lazy images actually load, " +
  'counting FIRST-PARTY encoded bytes only, since third-party tags are ' +
  "served from somebody else's egress and cost us nothing. Then record the " +
  'new figure and the graph it was measured against in ' +
  '`tools/tenant-page-budget.json`, and re-peg the rate in BOTH rate ' +
  'tables.\n\n' +
  'A page that got lighter is red for the same reason a page that got ' +
  'heavier is: the published term is "at cost + 30%", and an unchanged rate ' +
  'against a changed page breaks that claim in whichever direction it moved.'
