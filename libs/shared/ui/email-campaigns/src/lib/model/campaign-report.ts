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
 * CAMPAIGN REPORTING MATH — the only place a rate is computed.
 *
 * ## Why a pure module and not a component
 *
 * Every number on the report screen is a division, and a division is where
 * email reporting goes wrong. Putting the arithmetic in JSX means the
 * denominator is chosen by whoever writes the next card, in a file nobody
 * tests for arithmetic; putting it here means each rate is named once,
 * carries its own denominator as data, and is provable.
 *
 * ## The rule this module exists to enforce
 *
 * **A rate is a triple — numerator, denominator, and the NAME of the
 * denominator — or it is not reported.** An open rate over `sent` and an open
 * rate over `delivered` are different numbers with the same label, and the
 * gap between them is exactly the mail that bounced. The industry convention
 * is over `delivered`, and a report that quietly used `sent` would read
 * higher than the same campaign measured anywhere else.
 *
 * So {@link CampaignRate} carries `denominatorLabel`, and the screen is
 * required to render it. There is no overload that omits it.
 *
 * ## Why some rates are deliberately absent
 *
 * {@link campaignRate} answers `null`, not zero, when it cannot divide:
 *
 *  - **A zero denominator.** 0 opens out of 0 delivered is not a 0% open
 *    rate, it is no open rate. Rendering 0% invites the reader to compare it
 *    with a campaign that really did fail.
 *  - **An UNKNOWN denominator.** `delivered` is counted by the delivery
 *    webhook, which was connected after some campaigns were sent. A campaign
 *    with 400 sends and no delivery events has an unknown denominator, not a
 *    denominator of zero — and dividing by `sent` instead is precisely the
 *    flattering substitution above.
 *
 * ## The structural-zero window
 *
 * Click tracking rewrites links in the HTML part. Sends that carried no HTML
 * part were therefore untrackable, and every one of those campaigns reports 0
 * clicks whatever the recipients actually did — a real 0 and a structural 0
 * rendered identically. `send-email.ts` now synthesises an HTML part for a
 * text-only send, so every send after that carries one, and
 * `campaign-send.ts` records {@link CampaignStats.clickTracked} to say so.
 *
 * A campaign with no such marker predates the record. Its click COUNT is
 * still shown — it is a real count of real events — but no click RATE is
 * computed from it, because a rate presents the number as a measurement of
 * the audience and for those campaigns it is a measurement of the sender.
 */

/**
 * The `stats` map on `hosts/{hostId}/campaigns/{campaignId}`.
 *
 * Every field is optional and every reader defaults it, because these are
 * written by three different writers at three different times — the send, the
 * delivery webhook, the unsubscribe handler — and a campaign is a legitimate,
 * readable document from the instant the first of them lands.
 */
export interface CampaignStats {
  /*========================================
   * WRITTEN BY THE SEND. Never recomputed.
   *
   * These are the truth of what happened, recorded once by the code that did
   * it. Re-deriving any of them at read time would produce a number that
   * disagrees with the send — the audience has moved on since, suppressions
   * have been added, consent has been recorded — and the recorded one is the
   * one that describes the campaign.
   *=======================================*/
  /** The whole audience the send was taken from, before the per-send cap. */
  audienceSize?: number
  /** `audienceSize` is a FLOOR: audience resolution hit its read ceiling. */
  audienceSizeTruncated?: boolean
  /** Addresses this send ADDRESSED — the audience after the per-send cap. */
  recipients?: number
  /** Messages the provider accepted. The `sent` in "sent/recipients". */
  sent?: number
  /** Of the audience, how many carry a recorded marketing consent basis. */
  consented?: number
  /** Of `consented`, how many hold a basis an operator asserted for them. */
  consentedByOperator?: number
  /** Of the audience, how many are reachable only because enforcement is
   * not retroactive — the population a strict consent policy removes. */
  grandfathered?: number
  /** Of the audience, how many the consent rule refused to mail. */
  consentWithheld?: number
  /** Of `recipients`, how many were already suppressed (unsubscribed,
   * bounced or complained on an earlier send). */
  suppressed?: number
  /** Recipients the hourly send governor refused mid-batch. */
  deferred?: number
  /**
   * This send carried an HTML part, so its links were trackable.
   *
   * Absent on every campaign sent before the field existed — see the
   * structural-zero note in this module's header. Absent is NOT false; it is
   * "not recorded", and the report says so rather than guessing.
   */
  clickTracked?: boolean
  /** Per-variant send counts for an A/B campaign. */
  variantSends?: Record<string, number>

  /*========================================
   * WRITTEN BY THE DELIVERY WEBHOOK, as increments.
   *=======================================*/
  /** Messages the receiving server accepted. The rate DENOMINATOR. */
  delivered?: number
  /** Open EVENTS. One reader opening four times counts four. */
  opens?: number
  /** Click EVENTS. One reader clicking three links counts three. */
  clicks?: number
  /** Messages whose FIRST open was seen — distinct readers who opened. */
  uniqueOpens?: number
  /** Messages whose FIRST click was seen — distinct readers who clicked. */
  uniqueClicks?: number
  /** Messages that bounced, permanent and transient together. */
  bounced?: number
  /** Recipients who pressed "report spam". */
  complained?: number

  /*========================================
   * WRITTEN BY THE UNSUBSCRIBE HANDLER.
   *=======================================*/
  /** Recipients who unsubscribed through THIS campaign's link. */
  unsubscribes?: number
}

/**
 * One rate, with the denominator it was taken over named as data.
 *
 * `denominatorLabel` is not a display nicety. It is the field that makes two
 * numbers called "open rate" distinguishable, and the screen renders it
 * beside the percentage for that reason.
 */
export interface CampaignRate {
  /** 0–1. Multiply for display; the model never formats. */
  value: number
  numerator: number
  denominator: number
  /** Reader-facing name of the denominator, e.g. `'delivered'`. */
  denominatorLabel: string
}

/**
 * A rate, or `null` when one cannot honestly be taken.
 *
 * `null` on a zero or unknown denominator — see the module header for why
 * that is not the same as 0%.
 */
export function campaignRate(
  numerator: number | undefined,
  denominator: number | undefined,
  denominatorLabel: string,
): CampaignRate | null {
  const top = Number(numerator ?? 0)
  const bottom = Number(denominator ?? 0)
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null
  if (bottom <= 0) return null
  return {
    value: top / bottom,
    numerator: top,
    denominator: bottom,
    denominatorLabel,
  }
}

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
    /* Raised by `campaign-conversions.ts`, through this shape for the same
     * reason: one way of saying "a number is being withheld, or must not be
     * read the obvious way, and here is why". The first two are the reasons
     * the four conversion kinds stand apart instead of totalling; the last
     * two qualify the uncredited figure rather than withholding it. */
    | 'conversions-kinds-overlap'
    | 'conversions-web-not-rolled-up'
    | 'conversions-unattributed-is-a-ceiling'
    | 'conversions-total-crosses-hosts'
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
    delivery: CampaignRate | null
    /** Distinct readers who opened, over delivered. */
    open: CampaignRate | null
    /** Distinct readers who clicked, over delivered. */
    click: CampaignRate | null
    /**
     * Distinct clickers over distinct OPENERS — a different question from
     * `click`, and the one the two get confused for. It answers "of the
     * people who read it, how many acted", not "of the people who received
     * it". Reported separately and labelled separately, never as "click
     * rate".
     */
    clickToOpen: CampaignRate | null
    /** Bounced over what the provider accepted. */
    bounce: CampaignRate | null
    /** Complaints over delivered — the number mailbox providers judge on. */
    complaint: CampaignRate | null
    /** Unsubscribes through this campaign's link, over delivered. */
    unsubscribe: CampaignRate | null
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
export function campaignReport(stats: CampaignStats | undefined): CampaignReport {
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
     * so `campaignRate(undefined, 1000, 'sent')` would divide a missing
     * measurement by a real one and publish "0.0% delivery rate — 0 of 1,000
     * sent" for a campaign whose delivery events were merely never recorded.
     * That is the flattering-substitution failure this module exists to
     * refuse, running in the other direction: not a rate that reads too high,
     * but a campaign that reads as a total delivery failure.
     */
    delivery:
      delivered === null ? null : campaignRate(delivered, sent, 'sent'),
    open: campaignRate(uniqueOpens ?? undefined, delivered ?? undefined, 'delivered'),
    click: clickTrackable
      ? campaignRate(uniqueClicks ?? undefined, delivered ?? undefined, 'delivered')
      : null,
    clickToOpen: clickTrackable
      ? campaignRate(uniqueClicks ?? undefined, uniqueOpens ?? undefined, 'unique openers')
      : null,
    bounce: campaignRate(bounced, sent, 'sent'),
    complaint: campaignRate(complained, delivered ?? undefined, 'delivered'),
    unsubscribe: campaignRate(unsubscribes, delivered ?? undefined, 'delivered'),
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
 * LINK-LEVEL CLICKS.
 *
 * Resend's `email.clicked` payload carries `data.click.link`, the destination
 * the recipient followed; `normalizeResendDeliveryEvents` already reads it
 * into `EmailDeliveryEvent.link`, and the per-recipient delivery log already
 * stores it. What did not exist was an aggregate — which is what "link
 * clicks" means, and it cannot be produced from the delivery log without
 * reading every recipient row for the campaign.
 *
 * So it is a WRITE-TIME rollup: one document per campaign,
 * `campaigns/{campaignId}/reports/links`, holding a bounded map. The report
 * reads exactly one document for the whole table.
 *=========================================*/

/**
 * How many distinct destinations one campaign's rollup keeps.
 *
 * A CAP rather than a page size, and it exists because the map lives in a
 * single document with a 1 MiB ceiling. Clicks past the cap are counted in
 * {@link CampaignLinkRollup.overflowClicks} rather than dropped, so the
 * table's total still reconciles with `stats.clicks`.
 */
export const CAMPAIGN_LINK_ROLLUP_MAX = 50

/**
 * Reduces a clicked URL to the key the rollup counts under.
 *
 * ## Why the query string is dropped
 *
 * Two reasons, and the second is the one that forces it:
 *
 * 1. **A campaign body goes through `resolveMergeTags` per recipient**, so a
 *    link may carry a personalised query. Keying on the full URL would then
 *    mint one rollup row per RECIPIENT — the aggregate degenerates into the
 *    per-recipient log it exists to summarise, and it blows the cap on the
 *    first campaign that does it.
 * 2. **A personalised query can carry the recipient's own address.** The
 *    rollup is an aggregate read by everyone on the site's team; it must not
 *    become a list of who clicked, and dropping the query is what guarantees
 *    it cannot.
 *
 * ⚠️ The cost is real and is stated on the screen: two links to the same page
 * distinguished only by their UTM parameters count as ONE row. That is a
 * known limitation, not an oversight — see the note in the report card.
 *
 * @returns the normalized URL, or `null` for anything unparseable or not
 *          http(s). A rollup key must be a URL a merchant recognises.
 */
export function campaignLinkKey(link: string | null | undefined): string | null {
  const raw = String(link ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // Trailing slash normalised away so `/pricing` and `/pricing/` are one
    // row; the bare origin keeps its slash so the key is still a valid URL.
    const path = url.pathname.length > 1
      ? url.pathname.replace(/\/+$/, '')
      : url.pathname
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

/** One destination in the rollup. */
export interface CampaignLinkRow {
  url: string
  /** Click EVENTS on this destination. One reader clicking twice counts two. */
  clicks: number
  /** Share of the campaign's counted link clicks. */
  share: CampaignRate | null
}

/** The stored shape of `campaigns/{campaignId}/reports/links`. */
export interface CampaignLinkRollup {
  links?: Record<string, { url?: string; clicks?: number }>
  /** Clicks on destinations past {@link CAMPAIGN_LINK_ROLLUP_MAX}. */
  overflowClicks?: number
  /** Click events that arrived carrying no destination at all. */
  unattributedClicks?: number
}

/** What the link table renders. */
export interface CampaignLinkReport {
  rows: CampaignLinkRow[]
  /** Clicks counted against a named destination — the table's total. */
  attributedClicks: number
  overflowClicks: number
  unattributedClicks: number
  /** True once the cap bit, so the table says it is not the whole list. */
  truncated: boolean
}

/**
 * The link table, sorted by clicks descending.
 *
 * `share` is over ATTRIBUTED clicks — the clicks this table accounts for —
 * and not over `stats.clicks`. The two differ by the overflow and the
 * unattributed, and a share column that did not sum to 100% because of rows
 * that are not on screen is the kind of arithmetic a reader cannot check.
 * Both excluded figures are returned so the screen can state them.
 */
export function campaignLinkReport(
  rollup: CampaignLinkRollup | undefined,
): CampaignLinkReport {
  const entries = Object.values(rollup?.links ?? {})
    .map((entry) => ({
      url: String(entry?.url ?? ''),
      clicks: Number(entry?.clicks ?? 0),
    }))
    .filter((entry) => entry.url && Number.isFinite(entry.clicks))
  const attributedClicks = entries.reduce((total, one) => total + one.clicks, 0)
  const rows = [...entries]
    .sort((a, b) => b.clicks - a.clicks || a.url.localeCompare(b.url))
    .map((entry) => ({
      ...entry,
      share: campaignRate(entry.clicks, attributedClicks, 'link clicks counted'),
    }))
  const overflowClicks = Number(rollup?.overflowClicks ?? 0)
  return {
    rows,
    attributedClicks,
    overflowClicks,
    unattributedClicks: Number(rollup?.unattributedClicks ?? 0),
    truncated: entries.length >= CAMPAIGN_LINK_ROLLUP_MAX || overflowClicks > 0,
  }
}
