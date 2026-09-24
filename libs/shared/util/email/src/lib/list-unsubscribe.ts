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
 * THE MAIL-CLIENT UNSUBSCRIBE BUTTON, AS A SETTING (AGL-3296, AGL-3307).
 *
 * `List-Unsubscribe` plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * (RFC 8058) is what makes Gmail, Yahoo, Apple Mail and Outlook draw their own
 * Unsubscribe button above a message. It is a per-sender SETTING in two
 * places, with opposite defaults:
 *
 * | Sender | Default | Why |
 * | --- | --- | --- |
 * | An outreach sequence | off | one-to-one mail; the header makes it read as a mailing list |
 * | A marketing campaign | on | bulk mail; Gmail and Yahoo require one-click from bulk senders |
 *
 * Everything the two share lives here, so neither keeps a copy: how a stored
 * value is read ({@link readListUnsubscribeSetting}), how the header pair is
 * written ({@link listUnsubscribeHeaders}), how a send decides whether it can
 * carry the pair it promised ({@link resolveListUnsubscribe}), and — for bulk
 * mail — the guard that turns the header back on when a send makes the
 * organization a bulk sender ({@link decideListUnsubscribe}).
 *
 * ## What the setting never touches
 *
 * The visible way out. A campaign's footer link and a sequence's "reply 'no'"
 * line are in the body whatever this says, because they are what CAN-SPAM
 * and the recipient rely on; the header is a convenience a mail client may or
 * may not draw. The routes that answer a one-click POST keep answering every
 * link already sent, whatever the setting says now.
 *
 * ## Provider-neutral
 *
 * Nothing here knows who delivers the mail. The pair is two ordinary headers,
 * handed to whatever transport the deployment runs — `sendEmail`'s provider
 * seam for campaigns, the mailbox's own API for a sequence — so a self-hosted
 * deployment on any provider gets the same behavior.
 */

/** The one value RFC 8058 defines for `List-Unsubscribe-Post`. */
export const LIST_UNSUBSCRIBE_ONE_CLICK = 'List-Unsubscribe=One-Click'

/*==========================================
 * THE SETTING.
 *=========================================*/

/**
 * A stored `listUnsubscribe` setting, read with the sender's own default.
 *
 * Only a real boolean is a choice. Anything else — absent on every record
 * written before the setting existed, `null`, a string — reads as the
 * default, which is `false` for a sequence and `true` for a campaign. So a
 * stored sequence never grows a header it did not ask for, and a stored
 * campaign never loses one.
 */
export function readListUnsubscribeSetting(
  raw: unknown,
  defaultOn: boolean,
): boolean {
  return typeof raw === 'boolean' ? raw : defaultOn
}

/*==========================================
 * THE HEADERS.
 *=========================================*/

/**
 * The `List-Unsubscribe` header pair for one message, or `{}`.
 *
 * `url` is the signed HTTPS link a mailbox provider POSTs with nobody present,
 * and `mailto` an address that unsubscribes whoever writes to it. Either can
 * stand alone in `List-Unsubscribe`; `List-Unsubscribe-Post` is written only
 * beside a URL, because advertising one-click with nothing to post to
 * promises a verb nothing serves.
 */
export function listUnsubscribeHeaders(input: {
  url?: string | null
  mailto?: string | null
}): Record<string, string> {
  const url = String(input.url ?? '').trim()
  const mailto = String(input.mailto ?? '').trim()
  const uris = [url, mailto].filter(Boolean)
  if (!uris.length) return {}
  return {
    'List-Unsubscribe': uris.map((uri) => `<${uri}>`).join(', '),
    ...(url ? { 'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_ONE_CLICK } : {}),
  }
}

/*==========================================
 * ONE SEND'S PAIR.
 *=========================================*/

/** The pair one send carries, or why it carries none. */
export type ListUnsubscribeResolution =
  | { status: 'off' }
  | { status: 'unavailable' }
  | { status: 'ready'; url: string; mailto: string | null }

/**
 * Decides what one send's `List-Unsubscribe` header says.
 *
 * `off` unless `enabled` is exactly `true`. On, the URL is minted — and the
 * mailto too, when the sender has one (`mintMailto` present) — and the result
 * is `unavailable` when any part cannot be: no signing secret, no HTTPS
 * origin, no mailbox address. What a caller does with `unavailable` is its
 * own policy; a sequence holds the send rather than leave without the way out
 * it promised.
 */
export function resolveListUnsubscribe(input: {
  enabled: boolean | null | undefined
  mintUrl: () => string | null | undefined
  mintMailto?: () => string | null | undefined
}): ListUnsubscribeResolution {
  if (input.enabled !== true) return { status: 'off' }
  const url = input.mintUrl() || ''
  if (!url) return { status: 'unavailable' }
  if (!input.mintMailto) return { status: 'ready', url, mailto: null }
  const mailto = input.mintMailto() || ''
  return mailto ? { status: 'ready', url, mailto } : { status: 'unavailable' }
}

/*==========================================
 * THE BULK-SENDER GUARD (AGL-3307).
 *=========================================*/

/**
 * Messages in {@link LIST_UNSUBSCRIBE_BULK_WINDOW_MS} at which an organization
 * is a bulk sender and a campaign's header is turned back on.
 *
 * 5,000 is the figure Gmail and Yahoo publish for their bulk-sender rules, and
 * one-click unsubscribe is one of those rules: a bulk sender without it is
 * rejected or foldered as spam. Their count is per mailbox provider, which a
 * send cannot see (a Google Workspace address is on a company's own domain),
 * and a count to any one provider can never exceed the organization's total —
 * so the total is the count, and it is never smaller than the provider's.
 */
export const LIST_UNSUBSCRIBE_BULK_THRESHOLD_DEFAULT = 5_000

/** The environment variable a deployment overrides the threshold with. */
export const LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV =
  'EMAIL_LIST_UNSUBSCRIBE_BULK_THRESHOLD'

/** The window the threshold counts over. */
export const LIST_UNSUBSCRIBE_BULK_WINDOW_MS = 86_400_000

/**
 * The deployment's bulk threshold.
 *
 * Unset, blank or unreadable resolves to the published default, never to
 * something smaller or larger by accident: a typo must not silently move a
 * deliverability control. A positive whole number is taken as written — a
 * self-hoster whose provider or audience draws the line elsewhere sets it
 * lower or higher. There is no value that disables the guard.
 *
 * Read per call rather than captured at module load, because these run in
 * serverless handlers whose module may be evaluated during a build, before
 * the runtime env exists.
 */
export function listUnsubscribeBulkThreshold(
  raw: unknown = typeof process === 'undefined'
    ? undefined
    : process.env?.[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV],
): number {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return LIST_UNSUBSCRIBE_BULK_THRESHOLD_DEFAULT
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1) {
    return LIST_UNSUBSCRIBE_BULK_THRESHOLD_DEFAULT
  }
  return Math.floor(value)
}

/** Why a send carries the header its setting turned off. */
export type ListUnsubscribeForcedReason =
  /** The send takes the organization to the bulk threshold. */
  | 'bulk-volume'
  /**
   * The send leaves on the shared pooled identity, whose reputation is every
   * site's on it, and which refuses marketing mail without a way out.
   */
  | 'pooled-identity'
  /**
   * The organization's recent volume could not be read, so whether the send
   * reaches the threshold is unknown — and the header is the safe answer.
   */
  | 'volume-unknown'

/** What one send does with the header, and why. */
export interface ListUnsubscribeDecision {
  /** What the sender's setting asked for. */
  requested: boolean
  /** Whether the send carries the header. */
  on: boolean
  /** True when the setting said off and the send carries it anyway. */
  forced: boolean
  /** Why it was forced; null when it was not. */
  reason: ListUnsubscribeForcedReason | null
  /**
   * The organization's volume the decision was made on: what it had sent in
   * the window plus what this send will address.
   */
  volume: number
  /** The threshold it was compared with. */
  threshold: number
}

/**
 * Whether one bulk send carries the header, honoring the sender's setting
 * unless the send would make the organization a bulk sender.
 *
 * `recentVolume` is what the organization has already sent in the window and
 * `sendVolume` what this send will address in total, so the question asked is
 * the one the rule asks — does the organization reach the threshold — and a
 * send that starts under it and would finish over it is caught at its start
 * rather than halfway through. Reaching the threshold counts, because the
 * rule's line is "5,000 or more".
 *
 * `forcedBefore` keeps a decision made for an earlier part of the same send:
 * a campaign delivered over several batches does not drop the header halfway
 * through because a day rolled over.
 */
export function decideListUnsubscribe(input: {
  requested: boolean
  recentVolume: number
  sendVolume: number
  threshold?: number
  pooled?: boolean
  forcedBefore?: ListUnsubscribeForcedReason | null
}): ListUnsubscribeDecision {
  const count = (raw: number) =>
    Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  const threshold = listUnsubscribeBulkThreshold(input.threshold)
  const volume = count(input.recentVolume) + count(input.sendVolume)
  const base = { requested: input.requested, volume, threshold }
  if (input.requested) {
    return { ...base, on: true, forced: false, reason: null }
  }
  const reason: ListUnsubscribeForcedReason | null = input.pooled
    ? 'pooled-identity'
    : volume >= threshold
      ? 'bulk-volume'
      : (input.forcedBefore ?? null)
  return reason
    ? { ...base, on: true, forced: true, reason }
    : { ...base, on: false, forced: false, reason: null }
}

/**
 * One sentence for a forced decision, for the page that shows it.
 *
 * Written here rather than in a component so the send record, the log line
 * and the campaign page say the same thing.
 */
export function listUnsubscribeForcedDetail(
  decision: Pick<ListUnsubscribeDecision, 'reason' | 'volume' | 'threshold'>,
): string {
  if (decision.reason === 'pooled-identity') {
    return (
      'Turned back on because this email left on the shared sending ' +
      'address, where every campaign carries it.'
    )
  }
  if (decision.reason === 'volume-unknown') {
    return (
      'Turned back on because your organization’s sending volume could not ' +
      'be read when this email went out, so it could not be shown to be ' +
      'under the bulk-sender threshold.'
    )
  }
  if (decision.reason === 'bulk-volume') {
    return (
      `Turned back on because this email took your organization to ` +
      `${decision.volume.toLocaleString('en-US')} campaign emails in 24 ` +
      `hours, at or over the ${decision.threshold.toLocaleString('en-US')} ` +
      'at which Gmail and Yahoo require a one-click unsubscribe.'
    )
  }
  return ''
}
