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
 * WHAT THE RECORDS FILED UNDER A CAMPAIGN HOLD — which is not what the
 * campaign caused.
 *
 * Every other figure on a campaign's page is ATTRIBUTION: the campaign's mail
 * carried a link, a visitor followed it, and the conversion, the money or the
 * landing is credited to the campaign because that chain was recorded. The
 * figures this module produces are MEMBERSHIP: somebody put a form in this
 * campaign, and the form has counters of its own.
 *
 * The two answer different questions and a reader who adds them together gets
 * a wrong number in a direction that flatters the campaign. So nothing here
 * is named for causation — nothing generated, nothing driven, nothing from
 * this campaign — and the rollup carries the three facts a caller needs in
 * order to describe the figure honestly rather than merely print it:
 *
 *  1. **Whether it is windowed.** A form's flat counters are lifetime and
 *     include everything from before it was ever filed under this campaign.
 *  2. **How many members recorded it.** A counter nothing recorded is `null`,
 *     and a sum over three of five forms is a different statement from a sum
 *     over five.
 *  3. **How many members are in another campaign too.** `campaignIds` holds
 *     up to twenty ids, so the same submissions legitimately count toward
 *     more than one campaign and no total here is exclusive.
 */

import {
  formPeriodKey,
  formStatsTotals,
  FORM_STAT_KINDS,
  type FormPeriodRange,
  type FormStatKind,
  type FormStats,
  type FormStatsTotals,
} from '@aglyn/aglyn'

/** The dates a campaign container carries, as this module reads them. */
export interface CampaignSpan {
  startAtMs?: number | null
  endAtMs?: number | null
}

/**
 * The months a campaign's dates cover, for {@link formStatsTotals}.
 *
 * Both ends are optional in the stored campaign and stay optional here: an
 * open-ended campaign is genuinely open-ended, and substituting today for a
 * missing end would silently exclude a month whose figures are still moving.
 *
 * A campaign with NEITHER date produces an empty range, which
 * {@link formStatsTotals} answers with lifetime totals. That is the correct
 * answer — there is no window to confine the figures to — and it is why the
 * caller must go on saying which of the two it is showing.
 */
export function campaignPeriodRange(span: CampaignSpan): FormPeriodRange {
  const from = formPeriodKey(span.startAtMs)
  const to = formPeriodKey(span.endAtMs)
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
}

/** Whether a range confines anything. */
export function isWindowedRange(range: FormPeriodRange): boolean {
  return Boolean(range.from || range.to)
}

/** One member's contribution to the rollup. */
export interface CampaignFormMember {
  /** The form's own counters, already summed over the range or lifetime. */
  totals: FormStatsTotals
  /** Campaigns the form is filed under, this one included. */
  campaigns: number
}

/**
 * One summed counter, with the population it was summed over named.
 *
 * The shape `CampaignAggregate` uses for the mail figures, deliberately: a
 * reader meets both on the same page, and a total that names its population
 * on one section and not the other teaches that the silent one is complete.
 */
export interface CampaignMemberFigure {
  /** `null` when no member recorded this counter at all. */
  value: number | null
  /** Members that recorded it. */
  recorded: number
  /** Members the sum ran over. */
  members: number
}

/** Every membership figure for one campaign's forms. */
export interface CampaignFormsRollup extends Record<FormStatKind, CampaignMemberFigure> {
  /** Forms filed under this campaign. */
  members: number
  /** Of those, the ones filed under at least one other campaign as well. */
  shared: number
}

/** A figure nothing has been added to yet. */
function emptyFigure(members: number): CampaignMemberFigure {
  return { value: null, recorded: 0, members }
}

/**
 * Add up what a campaign's forms hold.
 *
 * A counter stays `null` until some member records it, so a campaign whose
 * forms have never counted views reports views as unmeasured rather than as
 * zero. `recorded` is what lets the caller say "across 2 of 5 forms" where
 * the two disagree — the same admission the mail rollup makes when a send is
 * missing a counter.
 */
export function campaignFormsRollup(
  members: readonly CampaignFormMember[],
): CampaignFormsRollup {
  const rollup = {
    members: members.length,
    shared: 0,
  } as CampaignFormsRollup
  for (const kind of FORM_STAT_KINDS) rollup[kind] = emptyFigure(members.length)
  for (const member of members) {
    if (member.campaigns > 1) rollup.shared += 1
    for (const kind of FORM_STAT_KINDS) {
      const value = member.totals[kind]
      if (value === null) continue
      const figure = rollup[kind]
      figure.value = (figure.value ?? 0) + value
      figure.recorded += 1
    }
  }
  return rollup
}

/**
 * A form's counters as this campaign may report them.
 *
 * Thin on purpose — the windowing rule lives in `formStatsTotals` so the
 * forms surface and this one cannot disagree about which months a figure
 * covers.
 */
export function campaignFormTotals(
  stats: FormStats | undefined | null,
  range: FormPeriodRange,
): FormStatsTotals {
  return formStatsTotals(stats, isWindowedRange(range) ? range : null)
}
