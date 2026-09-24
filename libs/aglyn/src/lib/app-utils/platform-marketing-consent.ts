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
 * Marketing consent for the PLATFORM's own product email (AGL-3185).
 *
 * The strict policy (`marketing-consent.ts`) means a person with no declared
 * basis is unsendable, and until this module the only doors that declared
 * one were the marketing site's forms. Somebody who created a console account
 * — the warmest audience the platform has — was never asked. Three console
 * doors ask now: a checkbox on the sign-up form, a switch in the account
 * preferences, and a one-time prompt for accounts that predate the checkbox.
 *
 * ## One wording, versioned
 *
 * Every door shows {@link PLATFORM_MARKETING_CONSENT_TEXT} and every record
 * stores {@link PLATFORM_MARKETING_CONSENT_TEXT_VERSION} beside the exact
 * timestamp, so "what did this person agree to" is answered by a version and
 * not by whatever the checkbox says today. Changing the sentence is a bump of
 * the version in the same edit.
 *
 * ## The record lives in two places, and the two do not disagree
 *
 * The decision is written by the server onto the person's own `users/{uid}`
 * document, so the console can show a preference without reading the
 * operator's CRM, and onto the operator's marketing contact for the same
 * person, so the send path sees a declared basis with provenance. The
 * contact half is written only when the deployment names a marketing host
 * (`PLATFORM_MARKETING_HOST_ID`, read in `@aglyn/tenant-data-admin`); a
 * self-hosted install with no audience of its own records the preference
 * and skips the contact — and keeps asking, so the answers are already on
 * file the day the operator names a marketing host.
 *
 * ## An unsubscribe reaches the account, for its own list only (AGL-3305)
 *
 * The marketing site's emails carry their own way out, and a person who uses
 * it has answered the console's question too — but only if what they left
 * is the list the question was about. Leaving
 * {@link PLATFORM_MARKETING_TOPIC_ID}, or everything the site sends, turns
 * the account's answer to No through an email door; leaving the newsletter
 * leaves it alone. The email doors write the account and nothing else: the
 * site's lists already say what was left, and declining the contact's basis
 * would stop every list, not the one the person chose.
 *
 * ## Absence is not refusal
 *
 * An unticked sign-up checkbox records nothing. A switch turned off and a
 * prompt answered "no" record a refusal, which the strict policy already
 * honors. A prompt dismissed without an answer records only the dismissal,
 * and the prompt stays away for {@link PLATFORM_MARKETING_PROMPT_SNOOZE_MS}.
 *
 * Pure and dependency-light on purpose: the sign-up page renders the text,
 * the console route validates the body, and the server library writes the
 * record, all from this one module.
 */

import { EMAIL_TOPIC_PRODUCT_UPDATES } from './email-topics'
import {
  MARKETING_CONSENT_FIELD,
  MARKETING_CONSENT_SOURCE_FIELD,
  type MarketingConsentSource,
} from './marketing-consent'
import { PLATFORM_BRAND_NAME } from './platform-brand'

/**
 * The list the account's answer stands for on the marketing site (AGL-3305):
 * the built-in "Product updates" topic, which is what the platform's own
 * announcements are sent on.
 *
 * Named so that "which unsubscribe is about this answer" has one spelling.
 * Leaving this list, or leaving everything the site sends, is a No to the
 * question the console asked. Leaving any other list is not, and must not
 * touch the answer: someone who stops the newsletter has said nothing about
 * product updates.
 */
export const PLATFORM_MARKETING_TOPIC_ID = EMAIL_TOPIC_PRODUCT_UPDATES

/** The console doors a decision can come through, as the record names them. */
export const PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS = [
  'console-signup',
  'console-preferences',
  'console-prompt',
] as const

export type PlatformMarketingConsoleSourceKind =
  (typeof PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS)[number]

/**
 * The email doors (AGL-3305): the marketing site's own unsubscribe,
 * preference and resubscribe pages, when what the person changed there was
 * {@link PLATFORM_MARKETING_TOPIC_ID} or everything.
 *
 * Kept apart from the console doors because nothing the console sends may
 * claim one. The server records these from the signed link a recipient
 * followed; a console request naming one is refused, because a click in the
 * console is not a click in a mailbox.
 */
export const PLATFORM_MARKETING_EMAIL_SOURCE_KINDS = [
  'email-unsubscribe',
  'email-preferences',
  'email-resubscribe',
] as const

export type PlatformMarketingEmailSourceKind =
  (typeof PLATFORM_MARKETING_EMAIL_SOURCE_KINDS)[number]

/** Every door a stored decision can name. */
export const PLATFORM_MARKETING_CONSENT_SOURCE_KINDS = [
  ...PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS,
  ...PLATFORM_MARKETING_EMAIL_SOURCE_KINDS,
] as const

export type PlatformMarketingConsentSourceKind =
  (typeof PLATFORM_MARKETING_CONSENT_SOURCE_KINDS)[number]

/** Any door, for READING a stored decision. */
export function isPlatformMarketingConsentSourceKind(
  value: unknown,
): value is PlatformMarketingConsentSourceKind {
  return (PLATFORM_MARKETING_CONSENT_SOURCE_KINDS as readonly unknown[]).includes(
    value,
  )
}

/** A console door: the only kind a console request may record. */
export function isPlatformMarketingConsoleSourceKind(
  value: unknown,
): value is PlatformMarketingConsoleSourceKind {
  return (PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS as readonly unknown[]).includes(
    value,
  )
}

/** An email door: a decision made from a link in one of the site's emails. */
export function isPlatformMarketingEmailSourceKind(
  value: unknown,
): value is PlatformMarketingEmailSourceKind {
  return (PLATFORM_MARKETING_EMAIL_SOURCE_KINDS as readonly unknown[]).includes(
    value,
  )
}

/** What a door records: a grant or a refusal. Absence is never recorded. */
export const PLATFORM_MARKETING_CONSENT_DECISIONS = ['granted', 'declined'] as const

export type PlatformMarketingConsentDecision =
  (typeof PLATFORM_MARKETING_CONSENT_DECISIONS)[number]

export function isPlatformMarketingConsentDecision(
  value: unknown,
): value is PlatformMarketingConsentDecision {
  return (PLATFORM_MARKETING_CONSENT_DECISIONS as readonly unknown[]).includes(
    value,
  )
}

/**
 * The version of the consent wording every door shows. Bumped in the same
 * edit as {@link platformMarketingConsentText}; a record stores the version
 * it was shown under, so the two must move together.
 */
export const PLATFORM_MARKETING_CONSENT_TEXT_VERSION = '2026-09-20'

/**
 * The sentence the person agrees to, with the deployment's brand in it.
 *
 * Affirmative and standalone: it names what is sent, who sends it, and that
 * it can be stopped — never bundled with the terms acceptance, and never
 * pre-ticked anywhere it is rendered.
 */
export function platformMarketingConsentText(brandName: string): string {
  return `Send me product updates from ${brandName}. You can opt out any time.`
}

/** {@link platformMarketingConsentText} for the brand this deployment wears. */
export const PLATFORM_MARKETING_CONSENT_TEXT = platformMarketingConsentText(
  PLATFORM_BRAND_NAME,
)

/**
 * The `users/{uid}` fields the decision is mirrored onto.
 *
 * The same names the contact record uses for the same facts, so one reader
 * can parse either document. The prompt-dismissal stamp has no contact
 * counterpart: it is about what the console asked, not what the person
 * agreed to.
 */
export const USER_MARKETING_CONSENT_FIELD = MARKETING_CONSENT_FIELD
export const USER_MARKETING_CONSENT_AT_FIELD = 'marketingConsentAtMs'
export const USER_MARKETING_CONSENT_SOURCE_FIELD = MARKETING_CONSENT_SOURCE_FIELD
export const USER_MARKETING_PROMPT_DISMISSED_AT_FIELD =
  'marketingConsentPromptDismissedAtMs'

/** How long a dismissed prompt stays away: ninety days. */
export const PLATFORM_MARKETING_PROMPT_SNOOZE_MS = 90 * 24 * 60 * 60 * 1000

/** What the person's own document says about product email. */
export interface PlatformMarketingConsentState {
  /** `null` when nothing has been recorded — asked, but not answered. */
  decision: PlatformMarketingConsentDecision | null
  /** When the decision was recorded. */
  atMs: number | null
  /** The wording version the decision was made under. */
  textVersion: string | null
  /**
   * Which door recorded it — a console door, or an email door for a decision
   * mirrored from the marketing site's own pages. `null` for a record another
   * writer left.
   */
  sourceKind: PlatformMarketingConsentSourceKind | null
  /** When the prompt was last dismissed without an answer. */
  promptDismissedAtMs: number | null
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads the decision off a `users/{uid}` document, or off no document.
 *
 * Every unusable value reads as its absent case rather than throwing: a
 * malformed field must degrade to "nothing recorded", which asks again,
 * never to a grant.
 */
export function readPlatformMarketingConsent(
  document: Record<string, unknown> | null | undefined,
): PlatformMarketingConsentState {
  const consent = document?.[USER_MARKETING_CONSENT_FIELD]
  const rawSource = document?.[USER_MARKETING_CONSENT_SOURCE_FIELD]
  const source =
    rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)
      ? (rawSource as Record<string, unknown>)
      : null
  const textVersion = source?.['textVersion']
  return {
    decision: consent === true ? 'granted' : consent === false ? 'declined' : null,
    atMs: finiteOrNull(document?.[USER_MARKETING_CONSENT_AT_FIELD]),
    textVersion:
      typeof textVersion === 'string' && textVersion ? textVersion : null,
    sourceKind: isPlatformMarketingConsentSourceKind(source?.['kind'])
      ? source['kind']
      : null,
    promptDismissedAtMs: finiteOrNull(
      document?.[USER_MARKETING_PROMPT_DISMISSED_AT_FIELD],
    ),
  }
}

/**
 * Whether the console should ask this person now.
 *
 * Never after a decision, in either direction: a "no" is an answer and a
 * "yes" needs no repeating. A dismissal is not an answer, so the prompt
 * returns once the snooze has run out.
 */
export function platformMarketingPromptDue(
  state: Pick<PlatformMarketingConsentState, 'decision' | 'promptDismissedAtMs'>,
  nowMs: number,
): boolean {
  if (state.decision !== null) return false
  if (state.promptDismissedAtMs === null) return true
  return nowMs - state.promptDismissedAtMs >= PLATFORM_MARKETING_PROMPT_SNOOZE_MS
}

/**
 * What each door did, in prose, for whoever audits the record later.
 *
 * Keyed by door and decision so the sentence is decided once, here, and the
 * three doors cannot describe the same act three different ways.
 */
const PROVENANCE_REASONS: Record<
  PlatformMarketingConsoleSourceKind,
  Record<PlatformMarketingConsentDecision, string>
> = {
  'console-signup': {
    granted: 'Ticked the product-updates checkbox on the console sign-up form.',
    declined: 'Declined product updates on the console sign-up form.',
  },
  'console-preferences': {
    granted: 'Turned product updates on in the console account preferences.',
    declined: 'Turned product updates off in the console account preferences.',
  },
  'console-prompt': {
    granted: 'Answered yes to the product-updates prompt in the console.',
    declined: 'Answered no to the product-updates prompt in the console.',
  },
}

/**
 * The provenance stored with a console decision, on both documents.
 *
 * `actor: 'person'` is what keeps {@link MarketingConsentSource} honest here:
 * the reader treats provenance as an operator's assertion unless it says
 * otherwise, and this is the person's own click, carrying which door and
 * which wording. `by` is the account that clicked — the subject and the
 * actor are the same human, which is the fact the field records.
 */
export function platformMarketingConsentSource(input: {
  kind: PlatformMarketingConsoleSourceKind
  decision: PlatformMarketingConsentDecision
  uid: string
  atMs: number
  textVersion: string
}): MarketingConsentSource {
  return {
    kind: input.kind,
    by: input.uid,
    atMs: input.atMs,
    reason: PROVENANCE_REASONS[input.kind][input.decision],
    textVersion: input.textVersion,
    actor: 'person',
  }
}

/**
 * What an email door did, and which decisions each door can make.
 *
 * The pairs are the whole vocabulary: an unsubscribe only ever refuses, a
 * resubscribe only ever restores, and only the preference page does both.
 * Typed as the union rather than a free kind and decision, so an
 * "unsubscribe that granted" cannot be written down at all.
 */
export type PlatformMarketingEmailDecision =
  | { kind: 'email-unsubscribe'; decision: 'declined' }
  | { kind: 'email-preferences'; decision: PlatformMarketingConsentDecision }
  | { kind: 'email-resubscribe'; decision: 'granted' }

const EMAIL_PROVENANCE_REASONS: {
  [K in PlatformMarketingEmailDecision as `${K['kind']}:${K['decision']}`]: string
} = {
  'email-unsubscribe:declined':
    'Unsubscribed from every email the marketing site sends, from a link in one of its emails.',
  'email-preferences:declined':
    'Left product updates on the marketing site’s email preference page.',
  'email-preferences:granted':
    'Chose product updates again on the marketing site’s email preference page.',
  'email-resubscribe:granted':
    'Resubscribed from the link in one of the marketing site’s emails.',
}

/**
 * The provenance stored with a decision mirrored from the marketing site's
 * own pages (AGL-3305), on the account only.
 *
 * Still `actor: 'person'`: the click was the recipient's, on a link signed
 * for their address. No `textVersion`, because those pages do not version
 * their wording; the field is absent rather than borrowing the console's
 * version for a sentence the person never saw.
 */
export function platformMarketingEmailSource(
  input: PlatformMarketingEmailDecision & { uid: string; atMs: number },
): MarketingConsentSource {
  return {
    kind: input.kind,
    by: input.uid,
    atMs: input.atMs,
    // The union narrows the pair; the template type cannot see that, so the
    // key is asserted to the table's own keys rather than widened to string.
    reason: EMAIL_PROVENANCE_REASONS[
      `${input.kind}:${input.decision}` as keyof typeof EMAIL_PROVENANCE_REASONS
    ],
    actor: 'person',
  }
}

/**
 * The `users/{uid}` fields a decision writes, as one merge-able object.
 *
 * `false` for a refusal, not a deleted field: absence is the third state and
 * means "never asked", which a person who said no must never read as again.
 */
export function platformMarketingUserFields(input: {
  decision: PlatformMarketingConsentDecision
  atMs: number
  source: MarketingConsentSource
}): Record<string, unknown> {
  return {
    [USER_MARKETING_CONSENT_FIELD]: input.decision === 'granted',
    [USER_MARKETING_CONSENT_AT_FIELD]: input.atMs,
    [USER_MARKETING_CONSENT_SOURCE_FIELD]: input.source,
  }
}
