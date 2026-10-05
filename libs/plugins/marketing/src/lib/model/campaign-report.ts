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
 * WHAT ONE CAMPAIGN SEND DID, AND WHAT ITS SEQUENCES PRODUCED.
 *
 * The rate math and the link rollup every bulk sender divides by are the mail
 * model's (`@aglyn/shared-ui-email-campaigns/model/send-report`); this is the
 * campaign's reading of them — which population each rate is over, the
 * caveats that qualify a figure, and the funnel a campaign's sequences report
 * into. It keeps the rule that module states: a rate names its denominator,
 * or it is not reported.
 */

import {
  sendRate,
  type SendRate,
  type SendStats,
} from '@aglyn/shared-ui-email-campaigns/model/send-report'

/** Why a number the report would otherwise show is being withheld. */
export interface CampaignCaveat {
  /** Stable id, so a spec can assert on the caveat rather than its prose. */
  id:
    | 'delivery-unrecorded'
    | 'click-tracking-unrecorded'
    | 'audience-truncated'
    | 'send-deferred'
    /* Raised by `campaign-revenue.ts`, which reports through this shape so
     * the screen has one way of saying "a number is being withheld and here
     * is why" rather than one per section. */
    | 'revenue-denominator-unrecorded'
    | 'revenue-multi-currency'
    | 'revenue-mid-flight'
    | 'revenue-mixed-model'
    /* Raised by `campaign-conversions.ts`, through this shape for the same
     * reason: one way of saying "a number is being withheld, or must not be
     * read the obvious way, and here is why". The first two are the reasons
     * the four conversion kinds stand apart instead of totalling; the last
     * two qualify the uncredited figure rather than withholding it. */
    | 'conversions-kinds-overlap'
    | 'conversions-web-not-rolled-up'
    | 'conversions-unattributed-is-a-ceiling'
    | 'conversions-total-crosses-hosts'
    /* Raised by the Sequences block below (AGL-3254): the five figures are
     * a funnel read across, never a sum. */
    | 'sequences-funnel-not-summed'
  message: string
}

/** One population the send measured, for the audience breakdown. */
export interface CampaignPopulation {
  id: string
  label: string
  count: number
  /** What this count is a part OF, named. */
  ofLabel: string
  of: number
}

/** Everything the report screen renders, decided here rather than in JSX. */
export interface CampaignReport {
  sent: number
  recipients: number
  delivered: number | null
  opens: number
  clicks: number
  uniqueOpens: number | null
  uniqueClicks: number | null
  bounced: number
  complained: number
  unsubscribes: number
  /** Rates, each `null` when its denominator is zero or unrecorded. */
  rates: {
    /** Accepted by the receiving server, over what the provider accepted. */
    delivery: SendRate | null
    /** Distinct readers who opened, over delivered. */
    open: SendRate | null
    /** Distinct readers who clicked, over delivered. */
    click: SendRate | null
    /**
     * Distinct clickers over distinct OPENERS — a different question from
     * `click`, and the one the two get confused for. It answers "of the
     * people who read it, how many acted", not "of the people who received
     * it". Reported separately and labelled separately, never as "click
     * rate".
     */
    clickToOpen: SendRate | null
    /** Bounced over what the provider accepted. */
    bounce: SendRate | null
    /** Complaints over delivered — the number mailbox providers judge on. */
    complaint: SendRate | null
    /** Unsubscribes through this campaign's link, over delivered. */
    unsubscribe: SendRate | null
  }
  populations: CampaignPopulation[]
  caveats: CampaignCaveat[]
}

/**
 * Turns a stored `stats` map into the report.
 *
 * ## The denominator decisions, in one place
 *
 * - **`delivered`** carries the engagement rates — open, click, complaint,
 *   unsubscribe. Mail that bounced was never in front of a human, so
 *   including it in the denominator of an open rate depresses a number that
 *   describes the audience with a fact about the address list. This is also
 *   the convention every other tool reports, which matters: a merchant
 *   comparing our figure with their previous ESP's must be comparing the same
 *   quantity.
 * - **`sent`** carries the delivery and bounce rates, because those describe
 *   what happened to what we handed the provider, and `delivered` is the
 *   numerator of one of them — a rate cannot be over itself.
 * - **`uniqueOpens`** is the open-rate numerator, not `opens`. Open EVENTS
 *   over recipients can exceed 100% the moment one person opens twice, and a
 *   percentage above 100 is how a reader learns the number means something
 *   other than what it says. Both are shown; only the distinct count is
 *   divided.
 *
 * ## `delivered` unknown vs. zero
 *
 * A campaign predating the delivery webhook records no `delivered` at all.
 * That is reported as `null` and every rate over it is withheld, with a
 * caveat naming the reason — rather than substituting `sent`, which would
 * silently publish the flattered number this module exists to refuse.
 */
export function campaignReport(stats: SendStats | undefined): CampaignReport {
  const source = stats ?? {}
  const sent = Number(source.sent ?? 0)
  const recipients = Number(source.recipients ?? 0)
  const opens = Number(source.opens ?? 0)
  const clicks = Number(source.clicks ?? 0)
  const bounced = Number(source.bounced ?? 0)
  const complained = Number(source.complained ?? 0)
  const unsubscribes = Number(source.unsubscribes ?? 0)

  /*
   * ABSENT, not zero. `stats.delivered` is written only by the delivery
   * webhook, so `undefined` means "no delivery event has ever been recorded
   * for this campaign" — which for an old campaign means the webhook was not
   * connected, and for a campaign sent thirty seconds ago means the events
   * are still in flight. Neither is "nothing was delivered", and both are
   * ruined by `?? 0`, which would turn the unknown into a hard zero and make
   * every rate over it `null` for the RIGHT answer by the WRONG reasoning —
   * and would render "0 delivered" on screen beside "500 sent".
   */
  const delivered =
    source.delivered === undefined ? null : Number(source.delivered)
  const uniqueOpens =
    source.uniqueOpens === undefined ? null : Number(source.uniqueOpens)
  const uniqueClicks =
    source.uniqueClicks === undefined ? null : Number(source.uniqueClicks)

  /*
   * The click rate is withheld for a campaign that never recorded carrying an
   * HTML part, even when clicks are non-zero and `delivered` is known. See
   * the structural-zero note in the module header: for those sends 0 is the
   * only value the number could ever have taken, so a rate computed from it
   * measures our sending code rather than the recipients.
   */
  const clickTrackable = source.clickTracked === true

  const rates: CampaignReport['rates'] = {
    /*
     * `null` when `delivered` is UNRECORDED, and this is the one rate where
     * the numerator can be unknown rather than zero.
     *
     * Everywhere else an absent numerator is a genuine nought — a campaign
     * with delivery events and no opens really does have a 0% open rate, and
     * that is worth showing. Here the numerator IS the unrecorded quantity,
     * so `sendRate(undefined, 1000, 'sent')` would divide a missing
     * measurement by a real one and publish "0.0% delivery rate — 0 of 1,000
     * sent" for a campaign whose delivery events were merely never recorded.
     * That is the flattering-substitution failure this module exists to
     * refuse, running in the other direction: not a rate that reads too high,
     * but a campaign that reads as a total delivery failure.
     */
    delivery:
      delivered === null ? null : sendRate(delivered, sent, 'sent'),
    open: sendRate(uniqueOpens ?? undefined, delivered ?? undefined, 'delivered'),
    click: clickTrackable
      ? sendRate(uniqueClicks ?? undefined, delivered ?? undefined, 'delivered')
      : null,
    clickToOpen: clickTrackable
      ? sendRate(uniqueClicks ?? undefined, uniqueOpens ?? undefined, 'unique openers')
      : null,
    bounce: sendRate(bounced, sent, 'sent'),
    complaint: sendRate(complained, delivered ?? undefined, 'delivered'),
    unsubscribe: sendRate(unsubscribes, delivered ?? undefined, 'delivered'),
  }

  /*
   * The populations the SEND measured, reported as parts of a named whole
   * rather than as bare counts. "412 withheld" invites the question "out of
   * what"; the answer is the audience, and it is a different whole from the
   * one `suppressed` is measured against — consent is decided over the whole
   * audience and suppression over the capped recipient list, because that is
   * where each check runs. Netting them into one column would present two
   * different denominators as one.
   */
  const audienceSize = Number(source.audienceSize ?? 0)
  const populations: CampaignPopulation[] = []
  const addPopulation = (
    id: string,
    label: string,
    count: number | undefined,
    ofLabel: string,
    of: number,
  ) => {
    if (count === undefined) return
    populations.push({ id, label, count: Number(count), ofLabel, of })
  }
  addPopulation(
    'consented',
    'Had a consent basis',
    source.consented,
    'audience',
    audienceSize,
  )
  addPopulation(
    'consentedByOperator',
    'Consent asserted by an operator',
    source.consentedByOperator,
    'audience',
    audienceSize,
  )
  addPopulation(
    'grandfathered',
    'Reachable only because consent is not enforced retroactively',
    source.grandfathered,
    'audience',
    audienceSize,
  )
  addPopulation(
    'consentWithheld',
    'Withheld by the consent rule',
    source.consentWithheld,
    'audience',
    audienceSize,
  )
  addPopulation(
    'suppressed',
    'Already suppressed',
    source.suppressed,
    'addressed',
    recipients,
  )
  addPopulation(
    'cadenceHeld',
    'Asked for mail less often than this',
    source.cadenceHeld,
    'addressed',
    recipients,
  )
  addPopulation(
    'noMailServer',
    'Excluded: no mail server',
    source.noMailServer,
    'addressed',
    recipients,
  )
  addPopulation(
    'gatewayHeld',
    'Excluded: behind a gateway that refused this sender',
    source.gatewayHeld,
    'addressed',
    recipients,
  )

  const caveats: CampaignCaveat[] = []
  if (delivered === null) {
    caveats.push({
      id: 'delivery-unrecorded',
      message:
        'No delivery events have been recorded for this campaign, so open, ' +
        'click, complaint and unsubscribe rates cannot be computed — every ' +
        'one of them is taken over delivered. Counts below are still real.',
    })
  }
  if (!clickTrackable) {
    caveats.push({
      id: 'click-tracking-unrecorded',
      message:
        'This send did not record carrying an HTML part. Click tracking ' +
        'rewrites links in the HTML, so a send without one reports zero ' +
        'clicks whatever recipients did. The click count is shown; no click ' +
        'rate is computed from it.',
    })
  }
  if (source.audienceSizeTruncated) {
    caveats.push({
      id: 'audience-truncated',
      message:
        'Audience resolution stopped at its read ceiling, so the audience ' +
        'size is a floor — the real audience is at least this large, and ' +
        'every share taken over it is at most the figure shown.',
    })
  }
  if (Number(source.deferred ?? 0) > 0) {
    caveats.push({
      id: 'send-deferred',
      message:
        `${Number(source.deferred)} recipients were held back by the hourly ` +
        'send governor and never received this campaign. They are counted in ' +
        'addressed, not in sent.',
    })
  }

  return {
    sent,
    recipients,
    delivered,
    opens,
    clicks,
    uniqueOpens,
    uniqueClicks,
    bounced,
    complained,
    unsubscribes,
    rates,
    populations,
    caveats,
  }
}

/*==========================================
 * WHAT THE CAMPAIGN'S SEQUENCES PRODUCED (AGL-3254).
 *
 * A sequence joins a campaign the way a form does — `campaignIds` on its own
 * document — and its outcomes are then the campaign's to report: every
 * person enrolled, the first email each one was sent, the replies, the
 * meetings booked from a sequence link, and the enrolled leads that
 * converted. The Outreach runtime credits each outcome once per enrollment
 * to every campaign the sequence was in when the person was enrolled, into
 * `hosts/{hostId}/campaignSequenceReports/{campaignId}` — one document per
 * campaign, beside the conversions rollup and never inside the campaign
 * document, which the history list and the glance widget read.
 *
 * ## The five figures are a funnel, not a sum
 *
 * Each figure counts ENROLLMENTS at a stage: 40 enrolled, 38 sent, 6
 * replied, 2 meetings, 1 converted. They are read across, never added — a
 * person is in every stage they reached — and the model keeps them as an
 * ordered list rather than a total for the reason the conversion kinds are
 * kept apart.
 *
 * ## Absent is not zero
 *
 * A campaign no sequence was ever in has no document, and a stage nobody
 * reached has no field. Both are `null` here, so the screen can say
 * "nothing recorded" for the first and draw a dash for the second, rather
 * than printing a measured 0 replies for a campaign whose sequence went
 * out yesterday.
 *=========================================*/

/**
 * The outcomes the runtime credits, in funnel order. An array first, because
 * the ORDER is the reading order and a second list is a second chance to
 * leave one out; the union is derived from it.
 */
export const CAMPAIGN_SEQUENCE_OUTCOMES = [
  'enrolled',
  'sent',
  'replied',
  'meetings',
  'converted',
] as const

export type CampaignSequenceOutcome = (typeof CAMPAIGN_SEQUENCE_OUTCOMES)[number]

/**
 * The org collection holding one document per campaign container,
 * `orgs/{orgId}/campaignSequenceReports/{campaignId}`.
 */
export const CAMPAIGN_SEQUENCE_REPORTS_COLLECTION = 'campaignSequenceReports'

/** What a reader calls each outcome, and what the count means. */
export const CAMPAIGN_SEQUENCE_OUTCOME_COPY: Readonly<
  Record<CampaignSequenceOutcome, { label: string; note: string }>
> = {
  enrolled: { label: 'Enrolled', note: 'people enrolled in a sequence in this campaign' },
  sent: { label: 'Sent', note: 'of them, sent their first sequence email' },
  replied: { label: 'Replied', note: 'of them, who wrote back' },
  meetings: { label: 'Meetings', note: 'bookings made from a sequence link' },
  converted: { label: 'Converted', note: 'enrolled leads that became contacts' },
}

/**
 * The stored shape of `campaignSequenceReports/{campaignId}`.
 *
 * Read-side only, every field optional: another plugin's runtime wrote it,
 * and a reader that assumed a field was present would throw on the first
 * document written before the field existed.
 */
export interface CampaignSequencesRollup {
  byOutcome?: Partial<Record<CampaignSequenceOutcome, number>>
  /** When the runtime last credited anything, epoch ms. */
  updatedAtMs?: number
}

/** One outcome's figure on screen. */
export interface CampaignSequenceFigure {
  outcome: CampaignSequenceOutcome
  label: string
  /** The count, or `null` when the rollup holds no entry for the outcome. */
  value: number | null
  note: string
}

/** Everything the Sequences section renders. */
export interface CampaignSequencesReport {
  /** Always all five, always in {@link CAMPAIGN_SEQUENCE_OUTCOMES} order. */
  figures: CampaignSequenceFigure[]
  /** Whether the rollup document exists at all — see the block header. */
  recorded: boolean
  /** At least one outcome holds a figure. */
  any: boolean
  caveats: CampaignCaveat[]
}

/** Turns the stored rollup into the Sequences section. */
export function campaignSequencesReport(
  rollup: CampaignSequencesRollup | undefined,
): CampaignSequencesReport {
  const stored = rollup?.byOutcome ?? {}
  const figures: CampaignSequenceFigure[] = CAMPAIGN_SEQUENCE_OUTCOMES.map((outcome) => {
    const raw = stored[outcome]
    const value = Math.floor(Number(raw ?? 0))
    return {
      outcome,
      label: CAMPAIGN_SEQUENCE_OUTCOME_COPY[outcome].label,
      // Unrecorded, negative and non-numeric all read as "no figure": the
      // runtime only ever increments, so a stored 0 is not a count either.
      value: raw === undefined || !Number.isFinite(value) || value <= 0 ? null : value,
      note: CAMPAIGN_SEQUENCE_OUTCOME_COPY[outcome].note,
    }
  })
  const any = figures.some((figure) => figure.value !== null)
  const caveats: CampaignCaveat[] = any
    ? [
        {
          id: 'sequences-funnel-not-summed',
          message:
            'Each figure counts the people who reached that stage, so a person ' +
            'who replied is counted under Enrolled and Sent as well. Read them ' +
            'across; they are deliberately not added together.',
        },
      ]
    : []
  return { figures, recorded: rollup !== undefined, any, caveats }
}
