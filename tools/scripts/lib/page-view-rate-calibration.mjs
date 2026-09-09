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
 *   **Priced-for** (KB ↔ KB). The rate is divided back through the fixed
 *   per-KB cost to recover the page weight it is priced for, and that has to
 *   be the weight the record CLAIMS it is priced for. This is the rate
 *   agreeing with its own stated basis, so it is red the moment either is
 *   edited alone.
 *
 *   **Coverage** (KB ↔ KB). What a page measures now, over what the rate is
 *   priced for. The rate must be priced for AT LEAST what the page weighs —
 *   see `evaluateRateCalibration` for why that ceiling is recorded as a
 *   reviewed number rather than hard-coded at 1.
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
 * The third is a STALENESS TRIPWIRE, not a weight estimate. It never claims
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
 *
 * What differs between the two directions is the URGENCY, and that asymmetry
 * is why the coverage ceiling is a recorded number. Charging under cost is
 * wrong and can only be fixed by charging more, which is a price rise. So the
 * peg is deliberately set on the safe side and the record says how far.
 */

/**
 * Cost per encoded KB of page weight, fixed by the original calibration.
 *
 * $0.0001 per view was measured against a 627 KB cold load, and that pairing
 * is the only thing here that is not re-derived: it carries the Firestore
 * reads and the edge/ISR share of a render as well as the transfer, so it is
 * not a bandwidth price and must not be re-based on an egress rate card.
 *
 * The 2026-09-09 re-peg (AGL-2711) did NOT move this pair. It moved the weight
 * the pair is applied to, from 627 KB to 1012.8 KB. Keeping the anchor fixed
 * is what makes the new rate checkable: a re-peg that also re-based the cost
 * per KB would be two changes wearing one number, and no gate could tell which
 * of them a later edit had undone.
 *
 * @see PAGE_VIEW_CALIBRATION_BASIS_KB
 */
export const CALIBRATED_USD_PER_VIEW = 0.0001

/** The encoded page weight `CALIBRATED_USD_PER_VIEW` was measured against. */
export const PAGE_VIEW_CALIBRATION_BASIS_KB = 627

/**
 * The grid `pricedForKb` and `measuredKb` are recorded on: a tenth of a KB.
 *
 * Both are wire measurements read off a browser, and a tenth of a KB is
 * already finer than the run-to-run spread of one. Rounding the comparison to
 * the grid the record is written on is what lets the rate carry a price that
 * is round in DOLLARS rather than round in kilobytes.
 */
const RECORDED_KB_DECIMALS = 1

/*
 * Scale-then-divide rather than divide-then-scale: `Math.round(kb / 0.1) * 0.1`
 * reintroduces the error it is rounding away, because 0.1 is not representable
 * and the multiply back puts a tail on an otherwise exact tenth.
 */
const KB_GRID = 10 ** RECORDED_KB_DECIMALS
const toRecordedKb = (kb) => Math.round(kb * KB_GRID) / KB_GRID

/**
 * Dollars the rate table would carry for a page of exactly `weightKb`.
 *
 * The exact per-KB implication, unrounded. It is a DIAGNOSTIC — printed so a
 * reader can see what the measured page alone would cost — and not the value
 * the gate compares against, for the reason `basisKbForRate` gives.
 */
export function rateForWeightKb(weightKb) {
  return (CALIBRATED_USD_PER_VIEW * weightKb) / PAGE_VIEW_CALIBRATION_BASIS_KB
}

/**
 * The page weight a rate is priced for — `rateForWeightKb` run backwards.
 *
 * The comparison runs in THIS direction, in kilobytes, rather than forwards in
 * dollars, because the checked-in rate is not a round number of dollars per
 * view and cannot be. It is pinned so the PUBLISHED figure is round: $0.21 per
 * 1,000 views is $0.00016153846 per view once `METERED_MARKUP` is divided out,
 * and no rounding of dollars-per-view reproduces that from a weight.
 *
 * Kilobytes have no such problem. The record already writes both weights to a
 * tenth of a KB, so rounding the recovered weight to the same grid compares
 * two numbers of the same kind at the precision they are actually known to.
 *
 * This is TIGHTER than the dollar comparison it replaced, not looser. A tenth
 * of a KB out of 1012.8 is one part in ten thousand; the old comparison
 * rounded the rate to the nearest millionth of a dollar, which at a rate of
 * $0.00016 is one part in a hundred and sixty.
 */
export function basisKbForRate(rate) {
  return toRecordedKb(
    (rate * PAGE_VIEW_CALIBRATION_BASIS_KB) / CALIBRATED_USD_PER_VIEW,
  )
}

/**
 * Grade the rate against its calibration, and the calibration against the code.
 *
 * ## Why `pricedForKb` and `measuredKb` are two fields and not one
 *
 * They are the same quantity at two different moments, and collapsing them
 * would destroy the only honest record of the distance between them.
 *
 * `pricedForKb` is the weight `perPageView` is calibrated against.
 * `measuredKb` is what a published page weighs now. Where they sit relative to
 * each other is the whole finding, and it belongs in the file where anyone can
 * read it rather than in a rate that quietly absorbed it.
 *
 * ## The ceiling, and why it is 0.9638 rather than 1
 *
 * `acceptedWeightRatio` is `measuredKb / pricedForKb` as reviewed and signed
 * off. It is a CEILING: the gate stays green while the page is the size
 * somebody looked at, and goes red the moment a re-measurement pushes it up.
 *
 * Until 2026-09-09 that ratio was 1.62 — the rate priced a 627 KB page while
 * the published one measured over a thousand, so the meter billed under its
 * own cost and the ceiling recorded how far under. The re-peg inverted it. The
 * basis is now set ABOVE the measurement on purpose, so the ratio is 0.9638
 * and the meter prices slightly more than the page weighs.
 *
 * Two things follow, and both are checked:
 *
 *   1. A recorded ceiling ABOVE 1 is refused outright. That is the state the
 *      re-peg ended — a rate priced for less than the page it serves — and it
 *      must not be re-entered by editing a number in a JSON file. Re-entering
 *      it deliberately means moving `acceptedWeightRatio` past 1 AND arguing
 *      for it, which is a pricing decision with an owner.
 *   2. Below that, the reviewed figure is what holds. A page creeping from
 *      0.96 to 0.99 of its basis has not broken the promise yet, but it has
 *      spent the margin somebody deliberately left, and the gate says so
 *      before the page eats through it.
 *
 * A rate correction is a pricing decision and this gate does not make it — it
 * refuses to let it be made silently, in either direction.
 *
 * @param {object} input
 * @param {number} input.meteredRate `METERED_UNIT_RATES_USD.perPageView`
 * @param {number} input.cogsRate `ORG_COGS_UNIT_RATES_USD.perPageView`
 * @param {{pricedForKb: number, measuredKb: number, acceptedWeightRatio: number, sourceGraphBytes: number, sourceGraphTolerance: number}} input.calibration
 * @param {number} input.sourceGraphBytes the graph as measured on this checkout
 */
export function evaluateRateCalibration({
  meteredRate,
  cogsRate,
  calibration,
  sourceGraphBytes,
}) {
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

  const recordedBasisKb = toRecordedKb(calibration.pricedForKb)
  const impliedBasisKb =
    unreadable.length === 0 ? basisKbForRate(meteredRate) : Number.NaN

  const tablesDisagree = unreadable.length === 0 && meteredRate !== cogsRate
  const rateMispriced =
    unreadable.length === 0 && impliedBasisKb !== recordedBasisKb

  const weightRatio = calibration.measuredKb / calibration.pricedForKb
  const weightRatioExceeded = weightRatio > calibration.acceptedWeightRatio
  const acceptedRatioUnderprices = calibration.acceptedWeightRatio > 1

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
      !weightRatioExceeded &&
      !acceptedRatioUnderprices &&
      !calibrationStale,
    unreadable,
    tablesDisagree,
    rateMispriced,
    weightRatioExceeded,
    acceptedRatioUnderprices,
    calibrationStale,
    /** The weight the rate is priced for, recovered from the rate itself. */
    impliedBasisKb,
    recordedBasisKb,
    weightRatio,
    /** What the rate would be if it were pegged to the measured page exactly. */
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
  'settling until the network goes quiet rather than stopping at first ' +
  'paint, counting FIRST-PARTY encoded bytes only, since third-party tags ' +
  "are served from somebody else's egress and cost us nothing. Then record " +
  'the new figure and the graph it was measured against in ' +
  '`tools/tenant-page-budget.json`.\n\n' +
  'A page that got lighter is red for the same reason a page that got ' +
  'heavier is: the published term is "at cost + 30%", and an unchanged rate ' +
  'against a changed page breaks that claim in whichever direction it moved. ' +
  'What the two directions do NOT share is the remedy. A page that grew past ' +
  'its basis can only be fixed by charging more, so the basis is pegged ' +
  'above the page on purpose and a re-measurement that eats that headroom is ' +
  'the warning. A page that shrank is fixed by charging less, which is not ' +
  'an emergency — re-peg it at the next deliberate pass, and re-peg BOTH ' +
  'rate tables when you do.'
