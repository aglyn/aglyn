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
 * ONE DESIGN, MEASURED ACROSS EVERY CAMPAIGN THAT USED IT.
 *
 * ## What this adds to `campaign-report.ts`
 *
 * A campaign report divides two numbers that were recorded by the same send.
 * A design report divides two SUMS, and a sum has a membership: which
 * campaigns went into it. That is the whole difficulty, and it is a new way
 * for the repo's rule — every rate names its denominator — to be broken.
 *
 * ## The rule, restated for a sum
 *
 * **A rate's numerator and its denominator are summed over the SAME set of
 * campaigns, and the screen is told how large that set is.**
 *
 * `delivered` is written only by the delivery webhook, so a design used by
 * five campaigns may have three that recorded it and two that never did.
 * Summing `uniqueOpens` over all five and dividing by `delivered` summed over
 * three produces an open rate that can exceed 100% and is, in every case,
 * the flattering substitution `campaign-report.ts` exists to refuse — carried
 * out by addition instead of by picking the wrong field.
 *
 * So each rate here is built from a FILTERED subset, and
 * {@link TemplateRate.denominatorLabel} names the subset as well as the
 * quantity: `delivered across 3 of 5 campaigns`. A reader comparing this
 * design's open rate with another's can see the two were taken over different
 * populations without being told separately.
 *
 * ## Counts are over everything; rates are over what can be divided
 *
 * The COUNTS — opens, clicks, unsubscribes — are summed over every campaign,
 * because a count is true whatever else was recorded. Only the rates narrow.
 * The two are labelled differently on screen for that reason, and the caveats
 * say how many campaigns each rate left out.
 *
 * ## Why this is a pure module
 *
 * Same reason as `campaign-report.ts`: a division written in JSX is a
 * denominator chosen by whoever writes the next card. Here it is worse — the
 * subset is invisible in the output unless something carries it — so the
 * subset is data, computed once, and the screen renders it.
 */

import {
  campaignRate,
  type CampaignRate,
  type CampaignStats,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-report'
import {
  emailAudienceLabel,
} from '@aglyn/shared-ui-email-campaigns/model/email-record'

/** A rate over a sum, carrying how many campaigns the sum covers. */
export type TemplateRate = CampaignRate

/**
 * One campaign that used the design, as the report reads it.
 *
 * `sentAtMs` is nullable because a campaign document can exist without ever
 * having been sent — a scheduled campaign holds `sendAtMs` and no `sentAt`.
 * Those carry no engagement and the reader is shown their status rather than
 * a row of zeroes.
 */
export interface TemplateCampaign {
  campaignId: string
  subject: string
  /** Epoch ms, or null for a campaign that has not been sent. */
  sentAtMs: number | null
  /** `'sent'`, `'scheduled'`, `'canceled'`. A persisted value; not relabeled. */
  status: string
  /** The audience KIND — `'leads'`, `'members'`, `'segment'`, `'list'`. */
  audience: string
  /** Set when `audience` is `'list'`. */
  listId?: string
  /** The list's name AS IT WAS at send time, when the send recorded one. */
  listName?: string
  stats: CampaignStats | undefined
}

/**
 * One audience the design was sent to.
 *
 * A LIST is named by the name the send recorded, not by the name the list
 * carries today: a renamed or deleted list would otherwise rewrite the
 * history of a campaign that went out months ago, and a deleted one would
 * erase it. The same reasoning as the campaign report's populations.
 */
export interface TemplateAudience {
  /** Stable key — the list id, or the audience kind for the built-ins. */
  id: string
  label: string
  /** How many campaigns using this design went to this audience. */
  campaigns: number
  /** Addresses those campaigns ADDRESSED, summed. */
  addressed: number
  /**
   * The named list has since been deleted or renamed out of reach.
   *
   * Only ever true for a `list` audience, and only when the send recorded no
   * name — an older send, before the name was stored. The screen says "list
   * no longer named" rather than printing a raw document id as if it were
   * something a merchant would recognise.
   */
  unnamed?: boolean
}

/** Why a number the design report would otherwise show is being withheld. */
export interface TemplateCaveat {
  id:
    | 'no-campaigns'
    | 'delivery-partial'
    | 'click-tracking-partial'
    | 'campaigns-truncated'
    | 'audience-truncated'
  message: string
}

/** Everything the design report screen renders. */
export interface TemplateReport {
  /** Campaigns that used this design AND were sent. */
  sentCampaigns: number
  /** Campaigns that used this design, sent or not. */
  totalCampaigns: number
  /** Epoch ms of the most recent send, or null. */
  lastSentAtMs: number | null

  /*========================================
   * COUNTS — over every sent campaign.
   *=======================================*/
  recipients: number
  sent: number
  /** Summed over the campaigns that recorded it; null when none did. */
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
    delivery: TemplateRate | null
    open: TemplateRate | null
    click: TemplateRate | null
    clickToOpen: TemplateRate | null
    bounce: TemplateRate | null
    complaint: TemplateRate | null
    unsubscribe: TemplateRate | null
  }

  audiences: TemplateAudience[]
  caveats: TemplateCaveat[]
}

/** A campaign that actually went out. The only kind engagement can describe. */
function wasSent(campaign: TemplateCampaign): boolean {
  return campaign.sentAtMs !== null
}

/** Sums one stats field over a set of campaigns, defaulting absent to zero. */
function total(
  campaigns: readonly TemplateCampaign[],
  field: keyof CampaignStats,
): number {
  return campaigns.reduce(
    (running, campaign) => running + Number(campaign.stats?.[field] ?? 0),
    0,
  )
}

/**
 * `${quantity} across N of M campaigns` — the denominator label for a sum.
 *
 * The `of M` half is what makes a narrowed rate readable. `delivered across 3
 * campaigns` is true and still invites the reader to assume the design has
 * three; `across 3 of 5` says on its face that two are missing from this
 * number and not from the counts above it.
 */
function acrossLabel(quantity: string, covered: number, all: number): string {
  return covered === all
    ? `${quantity} across ${covered} ${covered === 1 ? 'campaign' : 'campaigns'}`
    : `${quantity} across ${covered} of ${all} campaigns`
}

/**
 * Aggregates every campaign that used one design.
 *
 * @param campaigns every campaign document naming this design, sent or not.
 * @param truncated the query that produced `campaigns` stopped at its read
 *        ceiling, so every total here is a FLOOR. Reported as a caveat rather
 *        than hidden, on the same reasoning as `audienceSizeTruncated`: a
 *        figure that is at least this large is useful, and a figure presented
 *        as complete when it is not is worse than none.
 */
export function templateReport(
  campaigns: readonly TemplateCampaign[],
  truncated = false,
): TemplateReport {
  const sentCampaigns = campaigns.filter(wasSent)
  const all = sentCampaigns.length

  /*
   * THE SUBSETS. Each rate divides sums taken over one of these and nothing
   * else, which is what makes the numerator and denominator describe the same
   * population — see this module's header.
   */
  const withDelivery = sentCampaigns.filter(
    (campaign) => campaign.stats?.delivered !== undefined,
  )
  const withUniqueOpens = withDelivery.filter(
    (campaign) => campaign.stats?.uniqueOpens !== undefined,
  )
  /*
   * Click rates need BOTH a delivery denominator and the record that the send
   * carried an HTML part. A send with no HTML part reports zero clicks
   * whatever recipients did, so including it in a click rate's denominator
   * drags the rate down by however many untrackable sends this design has —
   * a measurement of our own sending code presented as a measurement of the
   * audience. `campaign-report.ts` refuses the same substitution for one
   * campaign; a sum must refuse it per campaign, not for the design as a
   * whole, or one old send would withhold the design's whole click rate.
   */
  const withClickTracking = withDelivery.filter(
    (campaign) =>
      campaign.stats?.clickTracked === true &&
      campaign.stats?.uniqueClicks !== undefined,
  )
  const withOpenersAndClicks = withClickTracking.filter(
    (campaign) => campaign.stats?.uniqueOpens !== undefined,
  )

  const sent = total(sentCampaigns, 'sent')
  const delivered = withDelivery.length
    ? total(withDelivery, 'delivered')
    : null
  const uniqueOpens = withUniqueOpens.length
    ? total(withUniqueOpens, 'uniqueOpens')
    : null
  const uniqueClicks = withClickTracking.length
    ? total(withClickTracking, 'uniqueClicks')
    : null

  const rates: TemplateReport['rates'] = {
    /*
     * Over the campaigns that recorded a delivery, and `sent` summed over
     * those SAME campaigns rather than over all of them. The alternative —
     * delivered over the design's whole `sent` — reads as a delivery failure
     * proportional to how many of this design's sends predate the webhook.
     */
    delivery: delivered === null
      ? null
      : campaignRate(
          delivered,
          total(withDelivery, 'sent'),
          acrossLabel('sent', withDelivery.length, all),
        ),
    open: campaignRate(
      uniqueOpens ?? undefined,
      withUniqueOpens.length ? total(withUniqueOpens, 'delivered') : undefined,
      acrossLabel('delivered', withUniqueOpens.length, all),
    ),
    click: campaignRate(
      uniqueClicks ?? undefined,
      withClickTracking.length
        ? total(withClickTracking, 'delivered')
        : undefined,
      acrossLabel('delivered', withClickTracking.length, all),
    ),
    clickToOpen: campaignRate(
      withOpenersAndClicks.length
        ? total(withOpenersAndClicks, 'uniqueClicks')
        : undefined,
      withOpenersAndClicks.length
        ? total(withOpenersAndClicks, 'uniqueOpens')
        : undefined,
      acrossLabel('unique openers', withOpenersAndClicks.length, all),
    ),
    /*
     * Bounces and their rate are over every sent campaign, because both
     * halves are recorded for all of them: `sent` by the send itself and
     * `bounced` by a webhook whose absence is a genuine zero — no bounce
     * event means nothing bounced, unlike `delivered`, whose absence means
     * nothing was measured.
     */
    bounce: campaignRate(
      total(sentCampaigns, 'bounced'),
      sent,
      acrossLabel('sent', all, all),
    ),
    complaint: campaignRate(
      withDelivery.length ? total(withDelivery, 'complained') : undefined,
      delivered ?? undefined,
      acrossLabel('delivered', withDelivery.length, all),
    ),
    unsubscribe: campaignRate(
      withDelivery.length ? total(withDelivery, 'unsubscribes') : undefined,
      delivered ?? undefined,
      acrossLabel('delivered', withDelivery.length, all),
    ),
  }

  const caveats: TemplateCaveat[] = []
  if (!all) {
    caveats.push({
      id: 'no-campaigns',
      message: campaigns.length
        ? 'No campaign using this design has been sent yet, so there is ' +
          'nothing to measure. The campaigns below are scheduled or were ' +
          'canceled before they went out.'
        : 'This design has never been sent, so there is nothing to measure.',
    })
  } else if (withDelivery.length < all) {
    caveats.push({
      id: 'delivery-partial',
      message:
        `${all - withDelivery.length} of ${all} campaigns using this design ` +
        'recorded no delivery events, so they are left out of every rate ' +
        'taken over delivered — open, click, complaint and unsubscribe. ' +
        'Their counts are still included above.',
    })
  }
  if (all && withClickTracking.length < withDelivery.length) {
    caveats.push({
      id: 'click-tracking-partial',
      message:
        `${withDelivery.length - withClickTracking.length} of these campaigns ` +
        'did not record carrying an HTML part. Click tracking rewrites links ' +
        'in the HTML, so those sends report zero clicks whatever recipients ' +
        'did, and they are left out of the click rates rather than counted ' +
        'as sends nobody clicked.',
    })
  }
  if (truncated) {
    caveats.push({
      id: 'campaigns-truncated',
      message:
        'This design has been used by more campaigns than one read returns, ' +
        'so every total here is a floor — the real figures are at least ' +
        'this large.',
    })
  }
  if (sentCampaigns.some((campaign) => campaign.stats?.audienceSizeTruncated)) {
    caveats.push({
      id: 'audience-truncated',
      message:
        'At least one of these sends stopped audience resolution at its read ' +
        'ceiling, so the audience figures it contributed are floors.',
    })
  }

  return {
    sentCampaigns: all,
    totalCampaigns: campaigns.length,
    lastSentAtMs: sentCampaigns.reduce<number | null>(
      (latest, campaign) =>
        latest === null || (campaign.sentAtMs ?? 0) > latest
          ? campaign.sentAtMs
          : latest,
      null,
    ),
    recipients: total(sentCampaigns, 'recipients'),
    sent,
    delivered,
    opens: total(sentCampaigns, 'opens'),
    clicks: total(sentCampaigns, 'clicks'),
    uniqueOpens,
    uniqueClicks,
    bounced: total(sentCampaigns, 'bounced'),
    complained: total(sentCampaigns, 'complained'),
    unsubscribes: total(sentCampaigns, 'unsubscribes'),
    rates,
    audiences: templateAudiences(sentCampaigns),
    caveats,
  }
}

/**
 * The audiences the design actually went to, largest first.
 *
 * Keyed on the LIST ID for a list send and on the audience kind otherwise, so
 * two campaigns to the same list are one row and two campaigns to "all leads"
 * are one row — but a list send and a segment send are never merged, because
 * they are different questions about who received this design.
 *
 * A list send whose campaign recorded no list id at all is dropped rather
 * than filed under a generic "List" heading: a row that cannot name which
 * list is a row that answers the question wrongly.
 */
function templateAudiences(
  campaigns: readonly TemplateCampaign[],
): TemplateAudience[] {
  const rows = new Map<string, TemplateAudience>()
  for (const campaign of campaigns) {
    const isList = campaign.audience === 'list'
    if (isList && !campaign.listId) continue
    const id = isList ? `list:${campaign.listId}` : campaign.audience
    const existing = rows.get(id)
    const addressed = Number(campaign.stats?.recipients ?? 0)
    if (existing) {
      existing.campaigns += 1
      existing.addressed += addressed
      // A later send that DID record the name fills one that did not, so a
      // list mailed twice is named whenever any of those sends named it.
      if (existing.unnamed && campaign.listName) {
        existing.label = campaign.listName
        delete existing.unnamed
      }
      continue
    }
    rows.set(id, {
      id,
      // Named once, in `email-record.ts`, so a list row on this table and
      // the same list on a message's own page cannot disagree about what to
      // call it.
      label: emailAudienceLabel(campaign),
      campaigns: 1,
      addressed,
      ...(isList && !campaign.listName ? { unnamed: true as const } : {}),
    })
  }
  return [...rows.values()].sort(
    (a, b) => b.addressed - a.addressed || a.label.localeCompare(b.label),
  )
}
