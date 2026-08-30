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
 * MARKETING MAIL — the policy half.
 *
 * A message is MARKETING when a merchant's audience receives it because the
 * merchant decided to mail them, rather than because the recipient just did
 * something. Campaigns are the obvious case; so are a member post, an
 * abandoned-cart reminder, a back-in-stock alert and a merchant-authored
 * workflow email.
 *
 * ## The three things marketing mail owes, and where they were
 *
 * Before this module they were owed by every bulk sender and discharged by
 * exactly one of them:
 *
 *  1. **An unsubscribe mechanism.** `List-Unsubscribe` plus
 *     `List-Unsubscribe-Post` is what Gmail's and Yahoo's bulk-sender rules
 *     ask for, and a visible link is what CAN-SPAM asks for. The campaign
 *     sender adds both; the shared `sendEmail` added neither, so four
 *     merchant-triggered bulk paths mailed people with no way out.
 *  2. **A suppression check.** An address that hard-bounced or pressed
 *     "report spam" must not be mailed again. Those four paths consulted
 *     neither list.
 *  3. **A ceiling on how much one person receives.** There was none at any
 *     scope, so a single recipient could take a campaign, a cart reminder, a
 *     restock alert, a member post and a workflow email in one day.
 *
 * All three are the same shape — a question asked once, per recipient, at the
 * moment a marketing message is about to leave — so they are one seam rather
 * than three, and `sendEmail` asks it whenever a caller declares
 * {@link MarketingSendContext}.
 *
 * ## Why the gate is injected rather than imported
 *
 * The same split as the send-rate governor beside it. Answering the question
 * needs Firestore: two suppression collections and a per-recipient counter.
 * The durable half therefore lives in `@aglyn/tenant-data-admin`, which is
 * the only layer that may hold the Admin SDK — this library is `scope:shared`
 * and the dependency edge already runs the other way. So the gate reaches
 * `sendEmail` through {@link setMarketingSendGate}.
 *
 * Nothing installed means UNGATED, not refused: a unit test, a preview build
 * and a self-host that never installs one all keep sending. A control that
 * turns its own absence into an outage is worse than the burst it guards.
 *
 * ## Why this file holds no crypto and mints no URL
 *
 * The unsubscribe URL is an HMAC over the recipient's address, and
 * `node:crypto` cannot ride into a browser bundle — console components import
 * this library's barrel. The gate returns the minted URL instead, from the
 * server layer that already signs one.
 */

/** What a marketing send declares about itself. */
export interface MarketingSendContext {
  /** The site whose audience this is. Both suppression lists key on it. */
  hostId: string
  /**
   * The site's public origin, for the unsubscribe link.
   *
   * The CALLER resolves it — through `hostPublicOrigin`, from the host
   * document — because the shared subdomain policy lives in the framework
   * library and neither this module nor the gate may import it. Empty when a
   * host has no custom domain and no subdomain, which is a site nobody can
   * reach; the send then carries no unsubscribe URL and says so in the logs
   * rather than minting a link that resolves to nothing.
   */
  siteBase: string
  /**
   * An unsubscribe URL the caller has already minted, and the campaign it
   * belongs to.
   *
   * The campaign sender builds its own, because the same URL has to reach the
   * designed template as an `{{unsubscribeUrl}}` merge value long before the
   * message is handed over. Supplied, it is used verbatim and nothing is
   * minted — one link per message, whoever made it.
   */
  unsubscribeUrl?: string
  /**
   * Whether a frequency cap may refuse this message.
   *
   * `false` for a campaign. A campaign is a merchant's deliberate, reviewed
   * act with a recipient count on screen before they press Send; a cap that
   * silently removed people from it would make that number a lie, and a
   * one-shot send has nowhere to hold the remainder for later. So a campaign
   * COUNTS toward what a recipient has received — it is most of the load a
   * person feels — and yields the refusal to the automated paths, which fire
   * with no human present and are the ones that stack.
   *
   * Defaults to true: an unmarked caller is a machine.
   */
  capped?: boolean
}

/** What the gate is asked, once per marketing message. */
export interface MarketingSendGateRequest {
  hostId: string
  siteBase: string
  /** The single recipient. A marketing message addresses exactly one person. */
  email: string
  /** The caller's `context` label, for the log line on a refusal. */
  context?: string
  /** Whether a frequency cap may refuse — see {@link MarketingSendContext}. */
  capped: boolean
}

/** Why a marketing message was not sent, or `null` when it may go. */
export type MarketingSendRefusal =
  /** On a suppression list: unsubscribed, hard-bounced, or a complaint. */
  | 'suppressed'
  /** This person has already received their ceiling from this site. */
  | 'frequency-capped'
  /**
   * The RECIPIENT asked for less than this, and it has not been long enough.
   *
   * Kept apart from `frequency-capped` even though both are refusals about
   * pace, because they are refusals on behalf of different people: the
   * ceiling protects a shared sending domain from a merchant, and this
   * carries out a request the person on the other end made on the preference
   * page. Reporting them as one would make "why did this not send" answerable
   * only by guessing, and it is the merchant-facing half of a promise the
   * product made to a recipient.
   */
  | 'cadence-limited'

export interface MarketingSendGateVerdict {
  allowed: boolean
  /** Set when `allowed` is false. */
  refusal?: MarketingSendRefusal
  /** Human-readable, for the log and the `detail` on the result. */
  detail?: string
  /**
   * The signed unsubscribe URL for this recipient, when the gate could mint
   * one. Absent leaves the message without unsubscribe headers, which is a
   * misconfiguration to fix and not a reason to refuse mail.
   */
  unsubscribeUrl?: string
}

export type MarketingSendGate = (
  request: MarketingSendGateRequest,
) => Promise<MarketingSendGateVerdict>

let installedGate: MarketingSendGate | null = null

/** Installs the durable gate. Called once, from `@aglyn/tenant-data-admin`. */
export function setMarketingSendGate(gate: MarketingSendGate | null): void {
  installedGate = gate
}

/** The installed gate, or null when nothing has been installed. */
export function getMarketingSendGate(): MarketingSendGate | null {
  return installedGate
}

/** Test seam: forget any installed gate. */
export function resetMarketingSendGateForTests(): void {
  installedGate = null
}

/**
 * The rolling window a frequency cap counts over. One day, because that is
 * the unit a recipient experiences ("this shop mailed me four times today")
 * and the unit every published vendor cap is expressed in.
 */
export const MARKETING_FREQUENCY_WINDOW_MS = 86_400_000

/**
 * How many marketing messages one person may receive from one site inside the
 * window, by default.
 *
 * **A runaway guard, not a marketing policy.** It is deliberately above what
 * an ordinary merchant produces: the worst legitimate day is a campaign plus
 * a cart reminder plus a restock alert plus a member post, which is four. Set
 * lower and the first thing it would refuse is a real message somebody meant
 * to send; set higher and it stops describing a ceiling at all. What it does
 * remove is the unbounded case — a member post that mails 200 subscribers per
 * click with no limit on clicks, and a workflow whose email step fires on
 * every anonymous form submission.
 *
 * The same number for every plan. This is a deliverability control on a
 * shared sending domain, so it protects every tenant from every other tenant
 * and cannot be something one plan buys its way past.
 */
export const MARKETING_FREQUENCY_DEFAULT_PER_WINDOW = 5

/** Floor and ceiling on a configured cap — a typo guard, not a policy. */
export const MARKETING_FREQUENCY_MIN_PER_WINDOW = 1
export const MARKETING_FREQUENCY_MAX_PER_WINDOW = 1_000

/**
 * The live cap.
 *
 * Read from the environment so a self-host operator can set their own —
 * `docs/design` states that every dependency is configurable — and read per
 * call rather than captured at module load, matching `getEmailConfig`: these
 * run in serverless handlers where the module may be evaluated during a build.
 *
 * An unparseable or out-of-range value falls back to the default rather than
 * throwing or disabling the cap. A control that a typo can switch off is not
 * a control.
 */
export function marketingFrequencyCap(): number {
  const raw = Number(process.env.AGLYN_EMAIL_MARKETING_CAP_PER_DAY)
  if (!Number.isFinite(raw)) return MARKETING_FREQUENCY_DEFAULT_PER_WINDOW
  const whole = Math.floor(raw)
  if (
    whole < MARKETING_FREQUENCY_MIN_PER_WINDOW ||
    whole > MARKETING_FREQUENCY_MAX_PER_WINDOW
  ) {
    return MARKETING_FREQUENCY_DEFAULT_PER_WINDOW
  }
  return whole
}

/**
 * Whether one more message fits, given what this person has already received.
 *
 * Pure, so the decision is testable without a Firestore harness — the same
 * split `emailSendRateVerdict` makes for the platform hour.
 *
 * @param recentSendsAtMs every marketing send to this person from this site,
 *        newest or oldest first, in any order.
 * @returns the verdict and the trimmed window, so the caller writes back only
 *          what still counts instead of growing the record forever.
 */
export function marketingFrequencyVerdict(
  recentSendsAtMs: readonly number[],
  nowMs: number,
  cap: number = marketingFrequencyCap(),
): { allowed: boolean; used: number; cap: number; inWindow: number[] } {
  const floor = nowMs - MARKETING_FREQUENCY_WINDOW_MS
  const inWindow = recentSendsAtMs
    .filter((at) => Number.isFinite(at) && at > floor && at <= nowMs)
    .sort((a, b) => a - b)
    // Keep the NEWEST when a record has somehow grown past the cap. The
    // oldest entries are the ones about to leave the window anyway, so
    // dropping them loses the least information about when this person is
    // mailable again.
    .slice(-Math.max(cap, MARKETING_FREQUENCY_MIN_PER_WINDOW))
  return {
    allowed: inWindow.length < cap,
    used: inWindow.length,
    cap,
    inWindow,
  }
}

/**
 * HOW OFTEN THE RECIPIENT ASKED TO HEAR FROM THIS SITE.
 *
 * `docs/specs/email-competitive-gaps.md` G10 shipped its cap half and left
 * this one: unsubscribe was all-or-nothing plus, since topics, per-stream —
 * and a recipient who wanted the same mail LESS OFTEN still had only two
 * levers, one of which is the spam button. On a shared sending domain under
 * `p=reject` that button is charged to every other tenant, which is what
 * makes "monthly" a platform control wearing a courtesy's clothes.
 *
 * ## A minimum interval, not a second rolling window
 *
 * {@link marketingFrequencyVerdict} counts messages inside a day because the
 * thing it guards against is a burst. This guards against a DRIP, and the
 * question a drip asks is "how long since the last one" — one stored instant,
 * not a window that would have to be kept for a month to answer a monthly
 * choice. Two instruments, because they are two different questions.
 *
 * ## New values, so the vocabulary is chosen rather than inherited
 *
 * `'all'` is the default and the absence: a record with no cadence, and every
 * record written before this existed, means the person has expressed no
 * preference — which is not the same as having asked for everything, but is
 * the only reading that does not silently withhold mail from people who never
 * chose.
 */
export type MarketingCadence = 'all' | 'daily' | 'weekly' | 'monthly'

/** The default: no expressed preference, so only the platform ceiling binds. */
export const DEFAULT_MARKETING_CADENCE: MarketingCadence = 'all'

/**
 * The minimum gap each choice asks for, in millis.
 *
 * Calendar-naive on purpose. "At most one a week" is a promise about pace,
 * and honoring it as seven days from the last message is both what the words
 * say and what a recipient can check; anchoring it to a calendar week would
 * let two messages land on a Sunday and a Monday and still be "one a week".
 */
export const MARKETING_CADENCE_INTERVAL_MS: Record<MarketingCadence, number> = {
  all: 0,
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
}

/** How each choice reads, wherever one is named to a person or an operator. */
export const MARKETING_CADENCE_LABELS: Record<MarketingCadence, string> = {
  all: 'As they come',
  daily: 'At most one a day',
  weekly: 'At most one a week',
  monthly: 'At most one a month',
}

/**
 * Coerces a stored or submitted value to a cadence.
 *
 * Everything unrecognized becomes {@link DEFAULT_MARKETING_CADENCE}. The
 * direction matters and is the opposite of the consent policy's: a malformed
 * consent value must not become a way to switch enforcement off, because its
 * failure mode is mail to somebody who declined. A malformed cadence falling
 * to `'monthly'` would withhold mail from everybody whose record got
 * corrupted, and nobody asked for that either — so an unreadable preference
 * reads as no preference, and the person keeps whatever the ceiling allows.
 */
export function normalizeMarketingCadence(value: unknown): MarketingCadence {
  return value === 'daily' || value === 'weekly' || value === 'monthly'
    ? value
    : DEFAULT_MARKETING_CADENCE
}

/**
 * Whether enough time has passed for one more message at this pace.
 *
 * Pure, so the rule can be asserted without a Firestore harness — the same
 * split {@link marketingFrequencyVerdict} makes.
 *
 * @param lastSentAtMs when this site last sent this person marketing mail, or
 *        `null` for somebody it has never mailed. Never mailed always allows:
 *        a cadence is a gap between messages and there is no first gap.
 * @returns the verdict and, on a refusal, the instant the next message may go
 *          — so a caller that defers has something to defer UNTIL rather than
 *          a retry loop that discovers the answer by asking again.
 */
export function marketingCadenceVerdict(
  cadence: MarketingCadence,
  lastSentAtMs: number | null | undefined,
  nowMs: number,
): { allowed: boolean; cadence: MarketingCadence; nextAllowedAtMs: number } {
  const interval = MARKETING_CADENCE_INTERVAL_MS[cadence] ?? 0
  const last = Number(lastSentAtMs)
  if (!interval || !Number.isFinite(last) || last <= 0) {
    return { allowed: true, cadence, nextAllowedAtMs: nowMs }
  }
  const nextAllowedAtMs = last + interval
  /*
   * A stored instant in the FUTURE allows rather than refusing until it
   * passes. Clocks disagree across processes and a record written a few
   * seconds ahead would otherwise hold a recipient's mail for a whole
   * interval, which is a much larger error than the one it would prevent.
   */
  if (last > nowMs) return { allowed: true, cadence, nextAllowedAtMs: nowMs }
  return { allowed: nowMs >= nextAllowedAtMs, cadence, nextAllowedAtMs }
}

/**
 * The RFC 8058 header pair.
 *
 * Both or neither: `List-Unsubscribe` alone does not satisfy the bulk-sender
 * rules, and `List-Unsubscribe-Post` without a URL to post to advertises a
 * verb nothing serves.
 */
export function unsubscribeHeaders(
  unsubscribeUrl: string,
): Record<string, string> {
  if (!unsubscribeUrl) return {}
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * The visible opt-out, appended to the plain-text part.
 *
 * The headers are for the mailbox provider; this is for the person. CAN-SPAM
 * asks for a mechanism the recipient can see and use, and a header is neither
 * — most clients render no control for it at all unless the sender's domain
 * reputation is high enough for the provider to offer one.
 *
 * Idempotent by URL: a body that already carries the link is returned
 * untouched, so a sender that writes its own footer does not get two.
 */
export function appendUnsubscribeText(
  text: string,
  unsubscribeUrl: string,
): string {
  if (!unsubscribeUrl || (text && text.includes(unsubscribeUrl))) return text
  return `${text ?? ''}\n\n—\nUnsubscribe: ${unsubscribeUrl}`
}

/**
 * The same visible opt-out for the HTML part.
 *
 * Appended to whatever the sender produced rather than woven into it, because
 * the HTML may be a merchant-designed template this module knows nothing
 * about. A designed template that already renders `{{unsubscribeUrl}}`
 * carries the URL, so the `includes` check leaves it alone and the merchant's
 * own placement wins.
 *
 * Styles are inline and literal because this is email HTML: mail clients
 * strip `<style>` blocks and support no CSS variables, so a theme token
 * cannot reach the wire.
 */
export function appendUnsubscribeHtml(
  html: string,
  unsubscribeUrl: string,
): string {
  if (!unsubscribeUrl || (html && html.includes(unsubscribeUrl))) return html
  const footer =
    '<div style="margin:24px auto 0;max-width:600px;padding:16px 24px;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto," +
    'Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;' +
    'color:#616161;text-align:center">' +
    `<a href="${unsubscribeUrl}" style="color:#616161">Unsubscribe</a>` +
    '</div>'
  return `${html ?? ''}${footer}`
}
