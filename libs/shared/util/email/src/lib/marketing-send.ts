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

/*
 * `send-rate.ts` imports nothing, so this cannot be half of a cycle — which
 * matters, because this module is imported by `send-email.ts` alongside that
 * one and a cycle between the two would resolve differently under swc and
 * jest.
 */
import { escapeEmailHtml } from './email-render'
import { resolveSendPriority, type EmailSendPriority } from './send-rate'

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
   * The `List-Unsubscribe` URL, when the caller minted its own pair.
   *
   * Separate from {@link unsubscribeUrl} because the two are read by
   * different readers. This one is POSTed by a mailbox provider with nobody
   * present, so it must name the route that writes on POST; the other is
   * clicked by a person, so it names the preference page. Absent, the header
   * falls back to `unsubscribeUrl` — which is right for a caller that minted
   * only one link, and wrong only for one that minted a page and did not say
   * so.
   */
  oneClickUrl?: string
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
  /**
   * The STREAM this message belongs to, so a recipient who left that stream
   * is not mailed it.
   *
   * ## Absent refuses nobody, and that is the whole safety property
   *
   * A topic opt-out governs marketing STREAMS — "Promotions and offers",
   * "Newsletter". It is not a thing anybody can untick off a receipt, a
   * password reset or a booking confirmation, and a gate that refused those
   * on a topic preference would be the failure mode this control is most
   * capable of causing. Two guards make that unreachable rather than
   * unlikely:
   *
   *  1. transactional mail declares no `marketing` context at all, so it
   *     never reaches the gate; and
   *  2. a marketing caller that names no stream gets no topic refusal here.
   *     `filterTopicSendable` already reads an empty topic that way — there
   *     is no stream to have left — and this preserves it rather than
   *     defaulting to one.
   *
   * So the check binds exactly the senders that declare what they are, which
   * is the same polarity `isMarketingMessage` chose: enumerate what is
   * restricted, and a forgotten caller sends rather than silently drops.
   *
   * ## Why the gate asks it at all, when the consent split does not
   *
   * The two used to travel together in `email-flow-gate.ts`, and they are not
   * the same kind of fact. The consent split is the ORG's policy over its own
   * audience, which is why it stays a caller-side question. A topic opt-out
   * is the RECIPIENT talking to the platform, recorded by the same preference
   * page that records their cadence and reached by the same
   * `List-Unsubscribe` link — so it belongs with the suppression and cadence
   * checks, at the one chokepoint every marketing message crosses.
   */
  topicId?: string
}

/** What the gate is asked, once per marketing message. */
export interface MarketingSendGateRequest {
  hostId: string
  siteBase: string
  /** The single recipient. A marketing message addresses exactly one person. */
  email: string
  /** The caller's `context` label, for the log line on a refusal. */
  context?: string
  /**
   * The stream this message belongs to, or absent for a message that belongs
   * to none. See {@link MarketingSendContext.topicId} — absent refuses
   * nobody.
   */
  topicId?: string
  /** Whether a frequency cap may refuse — see {@link MarketingSendContext}. */
  capped: boolean
}

/** Why a marketing message was not sent, or `null` when it may go. */
export type MarketingSendRefusal =
  /** On a suppression list: unsubscribed, hard-bounced, or a complaint. */
  | 'suppressed'
  /**
   * They have left the STREAM this message belongs to.
   *
   * Kept apart from `suppressed` even though both are terminal for this
   * message, because they describe different people: somebody on a
   * suppression list has left the site, and somebody here has left one of its
   * streams and still wants the others. A merchant reading why a send shrank
   * has a different thing to do about each, and only one of them is a list
   * that has to be rebuilt.
   *
   * NOT retryable — the condition clears when the person re-subscribes, not
   * when time passes.
   */
  | 'topic-unsubscribed'
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
   * The signed opt-out URL a PERSON clicks, when the gate could mint one.
   * Points at the preference page, where the stream this message belongs to
   * is one of the things they can stop instead of all of it. Absent leaves
   * the message without unsubscribe headers, which is a misconfiguration to
   * fix and not a reason to refuse mail.
   */
  unsubscribeUrl?: string
  /**
   * The same signature over the one-click route, for `List-Unsubscribe`.
   *
   * A mailbox provider POSTs that header with no human present and expects
   * the act to have happened when it reads the 200, so it must never name a
   * page of checkboxes somebody has to submit. Absent, the header falls back
   * to {@link unsubscribeUrl}.
   */
  oneClickUrl?: string
}

/**
 * Whether a message is MARKETING, derived from what it already carries.
 *
 * ## Nothing new to remember, on purpose
 *
 * The obvious design is a `kind: 'marketing' | 'transactional'` option on
 * `sendEmail`. It is rejected for the reason the `from` override was deleted
 * and the `context` tag was derived rather than threaded: twenty call sites
 * cannot each be relied on to set a field, and the twenty-first is the one that
 * does not. The consequence of forgetting here is a merchant's campaign leaving
 * on the pooled identity that carries every other site's password resets — a
 * failure nobody sees until the pool stops delivering.
 *
 * So the answer is read off two things a marketing send is ALREADY obliged to
 * carry, neither of which is optional and neither of which was added for this:
 *
 * 1. **`marketing`** — the context object. A message that declares it gets the
 *    RFC 8058 header pair, the suppression check and the frequency cap, so a
 *    marketing sender cannot omit it and still be correct; it would be shipping
 *    mail with no unsubscribe link. Four of the five marketing senders in the
 *    tree take this arm.
 * 2. **`priority === 'campaign'`** — which `resolveSendPriority` derives from
 *    `context: 'campaign'`. The campaign sender mints its own unsubscribe
 *    headers upstream and so passes no `marketing` context, but it is the one
 *    sender that cannot avoid this label: the hourly governor is allowed to
 *    refuse a campaign, and a campaign that hid from the priority would be
 *    hiding from that too.
 *
 * A sender would have to defeat BOTH — no unsubscribe context and no campaign
 * priority — to reach the pool with promotional mail, and a message in that
 * state is already broken in ways its author would notice.
 *
 * ## Polarity
 *
 * A message matching neither is transactional, which is the permissive answer,
 * and that is deliberate — the same choice `resolveSendPriority` makes for the
 * same reason. Enumerating what is RESTRICTED means a forgotten caller sends a
 * receipt that goes out. Enumerating what is PERMITTED means a forgotten caller
 * drops one, and a dropped password reset is the failure you learn about from a
 * support ticket.
 */
export function isMarketingMessage(options: {
  marketing?: unknown
  priority?: string | null
  context?: string | null
}): boolean {
  if (options?.marketing) return true
  // `context` is consulted only through the same rule the governor uses, so a
  // context that stops meaning "campaign" cannot leave the two disagreeing.
  return resolveSendPriority(
    options?.context ?? undefined,
    (options?.priority as EmailSendPriority) || undefined,
  ) === 'campaign'
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
 * What the visible opt-out is CALLED, in every part of every message.
 *
 * The link opens the preference page, where leaving one stream is a choice
 * alongside leaving all of them — and a footer that says only "Unsubscribe"
 * is the only place a recipient would have learned that, so it never gets
 * said. The word "unsubscribe" stays in the line because that is what a
 * recipient scans a footer for.
 *
 * Named once and shared with `renderCampaignEmail`, which writes this same
 * line into a campaign's text part: two spellings of one sentence is how the
 * idempotency checks below come to append a second footer to a message that
 * already had one.
 */
export const UNSUBSCRIBE_FOOTER_LABEL =
  'Choose which emails you get, or unsubscribe'

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
  return `${text ?? ''}\n\n—\n${UNSUBSCRIBE_FOOTER_LABEL}: ${unsubscribeUrl}`
}

/**
 * The same visible opt-out for the HTML part.
 *
 * Appended to whatever the sender produced rather than woven into it, because
 * the HTML may be a merchant-designed template this module knows nothing
 * about. A designed template that already renders `{{unsubscribeUrl}}`
 * carries the URL, so the check below leaves it alone and the merchant's own
 * placement wins.
 *
 * ⚠️ That check has to look for the ESCAPED URL as well. A signed opt-out
 * link carries `&` between its query parameters, and a renderer putting it
 * into an `href` escapes it — so `renderEmailHtml` emits `…&amp;sig=…` and a
 * plain `includes` of the unescaped URL matches nothing. Every designed
 * template in the product goes through that renderer, which means the
 * merchants who DID place the token were the ones getting two footers.
 *
 * Styles are inline and literal because this is email HTML: mail clients
 * strip `<style>` blocks and support no CSS variables, so a theme token
 * cannot reach the wire.
 */
export function appendUnsubscribeHtml(
  html: string,
  unsubscribeUrl: string,
): string {
  if (!unsubscribeUrl) return html
  if (
    html &&
    (html.includes(unsubscribeUrl) ||
      html.includes(escapeEmailHtml(unsubscribeUrl)))
  ) {
    return html
  }
  const footer =
    '<div style="margin:24px auto 0;max-width:600px;padding:16px 24px;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto," +
    'Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;' +
    'color:#616161;text-align:center">' +
    `<a href="${escapeEmailHtml(unsubscribeUrl)}" style="color:#616161">` +
    `${UNSUBSCRIBE_FOOTER_LABEL}</a>` +
    '</div>'
  return `${html ?? ''}${footer}`
}
