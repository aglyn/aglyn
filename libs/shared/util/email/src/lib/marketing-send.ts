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
   * This site has been mailing this person for longer than the sunset window
   * and nothing in that window says they are still listening.
   *
   * NOT retryable by a sweep — the condition does not clear on a schedule,
   * it clears when the person engages. See {@link marketingSunsetVerdict}.
   */
  | 'unengaged'

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

/*==========================================
 * ENGAGEMENT-BASED SUNSETTING.
 *
 * Stop mailing an address that has gone quiet. The whole design fits in one
 * sentence and three refusals it must never become.
 *
 * ## ⛔ It refuses a SEND. It never reduces a person.
 *
 * `over-limit.ts` states the rule for capacity and this is the same
 * instrument pointed at attention rather than at count. A sunset does NOT
 * unsubscribe anybody, does NOT remove them from a list, does NOT delete a
 * contact and does NOT write a suppression. Every one of those would be a
 * ceiling performing a deletion, and every one of them is irreversible in a
 * way the condition that triggered it is not.
 *
 * ## It is reversible without anybody doing anything
 *
 * The only state is two timestamps: when this site first mailed this person,
 * and when this person last engaged with our mail. A person who opens or
 * clicks anything moves the second one, and the very next send finds them
 * inside the window and mailable. Nothing has to be undone, because nothing
 * was done.
 *
 * ## The three ways it could refuse somebody it should not, and the guards
 *
 *  1. **A brand-new subscriber has no engagement yet.** So the window is
 *     measured from when we STARTED mailing them, and somebody we have not
 *     been mailing for longer than the window is never refused, however
 *     little they have engaged.
 *  2. **We might have no record at all.** An unknown `firstSentAtMs` refuses
 *     nobody. Missing evidence is not evidence of absence, and the reading
 *     that mails somebody once more is the recoverable one.
 *  3. **A campaign is a reviewed act with its recipient count on screen.**
 *     Sunsetting yields to it exactly as the frequency ceiling does, through
 *     the same `capped` flag, so the number a merchant read before pressing
 *     Send stays true. It governs the automated paths, which fire with no
 *     human present.
 *
 * ## Opens are a weak signal and this leans on the broader one anyway
 *
 * The industry lesson is to sunset on clicks, because Apple's Mail Privacy
 * Protection prefetches images and inflates opens. That argument is about
 * choosing an audience. This is a refusal, and for a refusal the weaker,
 * more generous signal is the correct one: counting an open as engagement
 * refuses FEWER people. The audience rules
 * (`DynamicListEngagement`) keep opens and clicks apart so a merchant
 * segmenting on engagement can lean on clicks; this deliberately does not.
 *=========================================*/

/** Floor and ceiling on a configured sunset window — a typo guard. */
export const MARKETING_SUNSET_MIN_DAYS = 30
export const MARKETING_SUNSET_MAX_DAYS = 3_650

/**
 * The window, in days, or 0 for OFF.
 *
 * **Off unless an operator turns it on**, and that default is the honest one:
 * no compared vendor automates this, so a platform that silently stopped
 * mailing a merchant's quiet subscribers would be doing something none of
 * their previous tools did and none of their recipients asked for. The value
 * is a number of days rather than a boolean because the only interesting
 * question about a sunset is where it starts.
 *
 * Read per call rather than captured at module load, matching the frequency
 * cap beside it: these run in serverless handlers where the module may be
 * evaluated during a build.
 *
 * An unparseable or out-of-range value reads as OFF rather than falling back
 * to a default. This is the opposite of {@link marketingFrequencyCap}'s
 * handling and deliberately so — a typo there weakens a guard that is on by
 * default, and a typo here would ENABLE a refusal nobody asked for.
 */
export function marketingSunsetDays(): number {
  const raw = Number(process.env.AGLYN_EMAIL_SUNSET_AFTER_DAYS)
  if (!Number.isFinite(raw)) return 0
  const whole = Math.floor(raw)
  if (whole < MARKETING_SUNSET_MIN_DAYS || whole > MARKETING_SUNSET_MAX_DAYS) {
    return 0
  }
  return whole
}

/** What the sunset needs to know about one person. */
export interface MarketingSunsetFacts {
  /**
   * When this site first sent this person marketing mail, or null when we
   * have no record. Null never refuses.
   */
  firstSentAtMs: number | null
  /** When they last opened or clicked any of our mail, or null for never. */
  lastEngagedAtMs: number | null
}

/**
 * Whether this person has gone quiet for longer than the window.
 *
 * Pure, so the decision is testable without a Firestore harness — the same
 * split {@link marketingFrequencyVerdict} makes.
 *
 * @param days 0 disables the sunset entirely and this always allows.
 */
export function marketingSunsetVerdict(
  facts: MarketingSunsetFacts,
  nowMs: number,
  days: number = marketingSunsetDays(),
): { allowed: boolean; days: number; quietForDays: number | null } {
  if (!days || days <= 0) {
    return { allowed: true, days: 0, quietForDays: null }
  }
  const floor = nowMs - days * 86_400_000
  const first = Number(facts.firstSentAtMs ?? 0)
  // Guard 1 and 2 together: no record, or a relationship younger than the
  // window, allows. A person cannot have been quiet for longer than we have
  // been mailing them.
  if (!Number.isFinite(first) || first <= 0 || first >= floor) {
    return { allowed: true, days, quietForDays: null }
  }
  const engaged = Number(facts.lastEngagedAtMs ?? 0)
  if (Number.isFinite(engaged) && engaged > 0 && engaged >= floor) {
    return { allowed: true, days, quietForDays: null }
  }
  const since = Number.isFinite(engaged) && engaged > 0 ? engaged : first
  return {
    allowed: false,
    days,
    quietForDays: Math.floor((nowMs - since) / 86_400_000),
  }
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
