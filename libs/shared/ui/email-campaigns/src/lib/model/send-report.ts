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
 * BULK SEND REPORTING MATH — the only place a rate is computed.
 *
 * Owned by none of the plugins that read it: the plugin that sends a
 * campaign, the one that keeps the email templates a send is built from and
 * the one that runs one-to-one sequences all report what their mail did, and
 * each divides the same counters a send records. Putting the division here
 * makes them peers of one rule rather than three copies of it.
 *
 * ## Why a pure module and not a component
 *
 * Every number on a report screen is a division, and a division is where
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
 * higher than the same send measured anywhere else.
 *
 * So {@link SendRate} carries `denominatorLabel`, and the screen is required
 * to render it. There is no overload that omits it.
 *
 * ## Why some rates are deliberately absent
 *
 * {@link sendRate} answers `null`, not zero, when it cannot divide:
 *
 *  - **A zero denominator.** 0 opens out of 0 delivered is not a 0% open
 *    rate, it is no open rate. Rendering 0% invites the reader to compare it
 *    with a send that really did fail.
 *  - **An UNKNOWN denominator.** `delivered` is counted by the delivery
 *    webhook, which was connected after some sends went out. A send with 400
 *    messages and no delivery events has an unknown denominator, not a
 *    denominator of zero — and dividing by `sent` instead is precisely the
 *    flattering substitution above.
 *
 * ## The structural-zero window
 *
 * Click tracking rewrites links in the HTML part. Sends that carried no HTML
 * part were therefore untrackable, and every one of them reports 0 clicks
 * whatever the recipients actually did — a real 0 and a structural 0
 * rendered identically. `send-email.ts` now synthesises an HTML part for a
 * text-only send, so every send after that carries one, and the sender
 * records {@link SendStats.clickTracked} to say so. A send with no such
 * marker predates the record: its click COUNT is still shown — it is a real
 * count of real events — but no click RATE is computed from it, because a
 * rate presents the number as a measurement of the audience and for those
 * sends it is a measurement of the sender.
 */

/**
 * The `stats` map one bulk send keeps — a campaign send's on
 * `orgs/{orgId}/campaigns/{sendId}`.
 *
 * Every field is optional and every reader defaults it, because these are
 * written by three different writers at three different times — the send, the
 * delivery webhook, the unsubscribe handler — and a campaign is a legitimate,
 * readable document from the instant the first of them lands.
 */
export interface SendStats {
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
  /** Of `recipients`, how many asked this site for mail less often than this
   * send would have arrived. Still subscribed; reached by a later campaign. */
  cadenceHeld?: number
  /**
   * Of `recipients`, how many the deliverability check took out (AGL-3328):
   * their domain has no mail server, or their mail gateway refused this
   * sending domain twice in thirty days and delivered nothing.
   */
  noMailServer?: number
  gatewayHeld?: number
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
export interface SendRate {
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
export function sendRate(
  numerator: number | undefined,
  denominator: number | undefined,
  denominatorLabel: string,
): SendRate | null {
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

/*==========================================
 * LINK-LEVEL CLICKS.
 *
 * Resend's `email.clicked` payload carries `data.click.link`, the destination
 * the recipient followed; the mail provider's `deliveryEvents` already reads it
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
 * {@link SendLinkRollup.overflowClicks} rather than dropped, so the
 * table's total still reconciles with `stats.clicks`.
 */
export const SEND_LINK_ROLLUP_MAX = 50

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
export function sendLinkKey(link: string | null | undefined): string | null {
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
export interface SendLinkRow {
  url: string
  /** Click EVENTS on this destination. One reader clicking twice counts two. */
  clicks: number
  /** Share of the campaign's counted link clicks. */
  share: SendRate | null
}

/** The stored shape of `campaigns/{campaignId}/reports/links`. */
export interface SendLinkRollup {
  links?: Record<string, { url?: string; clicks?: number }>
  /** Clicks on destinations past {@link SEND_LINK_ROLLUP_MAX}. */
  overflowClicks?: number
  /** Click events that arrived carrying no destination at all. */
  unattributedClicks?: number
}

/** What the link table renders. */
export interface SendLinkReport {
  rows: SendLinkRow[]
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
export function sendLinkReport(
  rollup: SendLinkRollup | undefined,
): SendLinkReport {
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
      share: sendRate(entry.clicks, attributedClicks, 'link clicks counted'),
    }))
  const overflowClicks = Number(rollup?.overflowClicks ?? 0)
  return {
    rows,
    attributedClicks,
    overflowClicks,
    unattributedClicks: Number(rollup?.unattributedClicks ?? 0),
    truncated: entries.length >= SEND_LINK_ROLLUP_MAX || overflowClicks > 0,
  }
}
