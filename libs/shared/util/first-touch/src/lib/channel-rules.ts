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

import type { FirstTouch, FirstTouchClickId } from './first-touch'

/**
 * Which channel a first touch belongs to, from our own small rule table.
 *
 * Deliberately not an analytics vendor's default channel grouping: that
 * grouping lives in a product a self-hosted install may not run, it changes
 * without notice, and it answers from a session the platform never sees. The
 * question here is narrower — which of six doors did this ACCOUNT's first
 * visit come through — and a table short enough to read in one sitting
 * answers it the same way on every install.
 *
 * ## How the table is read
 *
 * Rules are tried in order and the first match wins. Within one rule, the
 * conditions are alternatives: a rule matches when ANY of them does. The
 * order carries the judgment calls, and each is stated where it is made:
 *
 * 1. **Email** first — a link in a newsletter is email even when the mail
 *    client hands over a webmail referrer or a `utm_source` naming a vendor.
 * 2. **Paid search by click id** — an ad platform stamped the landing URL,
 *    which is the strongest evidence a visit can carry.
 * 3. **Social** — a social source or referrer, with any medium. A paid post
 *    is still social; the six channels have one paid bucket, and a promoted
 *    post is not a search ad.
 * 4. **Paid search by medium** — `cpc` and its spellings from any other
 *    source.
 * 5. **Organic search** — a search engine's referrer or source, or
 *    `utm_medium=organic`.
 * 6. **Referral** — any other external referrer, or any other tagged link.
 * 7. **Direct** — nothing external at all: no referrer, no `utm_*`, no click
 *    id. A visit that came from one of our own hosts before anything captured
 *    it is also direct, because nothing external is known about it.
 */

/** The channels, in the order a report should list them. */
export const ACQUISITION_CHANNELS = [
  'organic-search',
  'paid-search',
  'social',
  'referral',
  'email',
  'direct',
] as const

/**
 * A channel, or `unknown` for an account whose first visit was never
 * captured — one created before the capture existed, or through a door that
 * carried nothing.
 */
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number] | 'unknown'

/** One row of the table. */
export interface ChannelRule {
  readonly channel: Exclude<AcquisitionChannel, 'direct' | 'unknown'>
  /** Why the row exists, in words a staff member can read. */
  readonly reason: string
  /** Tested against `utm_medium`. */
  readonly medium?: RegExp
  /** Tested against `utm_source`. */
  readonly source?: RegExp
  /** Tested against the referrer HOST. */
  readonly referrer?: RegExp
  /** Matches when the landing URL carried any of these click ids. */
  readonly click?: readonly FirstTouchClickId[]
  /** Matches any external referrer or any `utm_*` at all — the catch-all. */
  readonly external?: true
}

const EMAIL_MEDIUM = /^(e[-_ ]?mail|newsletter)s?$/i
const WEBMAIL_HOSTS =
  /^(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|mail\.proton\.me|app\.fastmail\.com|mail\.aol\.com|webmail\..+)$/

const SOCIAL_SOURCE =
  /^(facebook|fb|instagram|ig|linkedin|twitter|x|t\.co|reddit|youtube|tiktok|pinterest|threads|bluesky|bsky|mastodon|hacker ?news|hn|ycombinator|discord|quora)$/i
const SOCIAL_MEDIUM = /^(social|social[-_ ]?(media|network|paid)|paid[-_ ]?social|sm)$/i
const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|twitter\.com|x\.com|reddit\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.com|pin\.it|threads\.net|bsky\.app|mastodon\.social|news\.ycombinator\.com|discord\.com|quora\.com)$/

const PAID_MEDIUM = /^(cpc|ppc|cpm|paid[-_ ]?search|paid|sem|retargeting)$/i

const SEARCH_SOURCE =
  /^(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|qwant|startpage|naver|seznam|kagi)$/i
const SEARCH_HOSTS =
  /^((www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?|(www\.|cn\.)?bing\.com|(html\.)?duckduckgo\.com|([a-z]+\.)?search\.yahoo\.com|(www\.)?yandex\.[a-z]{2,3}|ya\.ru|(www\.)?baidu\.com|(www\.)?ecosia\.org|search\.brave\.com|(www\.)?qwant\.com|(www\.)?startpage\.com|search\.naver\.com|search\.seznam\.cz|kagi\.com)$/

/**
 * The table. Exported so the staff documentation and the specs read the same
 * rows the classifier runs, and so an install that wants a different grouping
 * can pass its own to {@link classifyChannel}.
 */
export const DEFAULT_CHANNEL_RULES: readonly ChannelRule[] = [
  {
    channel: 'email',
    reason: 'An email link: an email medium or source, or a webmail referrer',
    medium: EMAIL_MEDIUM,
    source: EMAIL_MEDIUM,
    referrer: WEBMAIL_HOSTS,
  },
  {
    channel: 'paid-search',
    reason: 'A search ad click: the landing URL carried an ad click id',
    click: ['gclid', 'msclkid'],
  },
  {
    channel: 'social',
    reason: 'A social network: its source, its referrer, a social medium, or its click id',
    source: SOCIAL_SOURCE,
    medium: SOCIAL_MEDIUM,
    referrer: SOCIAL_HOSTS,
    click: ['fbclid'],
  },
  {
    channel: 'paid-search',
    reason: 'A paid placement tagged by its medium (cpc, ppc, paid)',
    medium: PAID_MEDIUM,
  },
  {
    channel: 'organic-search',
    reason: 'A search engine: its referrer or source, or utm_medium=organic',
    medium: /^organic$/i,
    source: SEARCH_SOURCE,
    referrer: SEARCH_HOSTS,
  },
  {
    channel: 'referral',
    reason: 'Any other external referrer or tagged link',
    external: true,
  },
]

function ruleMatches(rule: ChannelRule, touch: FirstTouch): boolean {
  const utm = touch.utm || {}
  if (rule.medium && utm.medium && rule.medium.test(utm.medium)) return true
  if (rule.source && utm.source && rule.source.test(utm.source)) return true
  if (rule.referrer && touch.ref && rule.referrer.test(touch.ref)) return true
  if (rule.click && touch.click?.some((id) => rule.click?.includes(id))) return true
  if (rule.external) return Boolean(touch.ref || Object.keys(utm).length)
  return false
}

/** The rule a touch matched, or null for a direct visit. */
export function matchChannelRule(
  touch: FirstTouch | null | undefined,
  rules: readonly ChannelRule[] = DEFAULT_CHANNEL_RULES,
): ChannelRule | null {
  if (!touch) return null
  for (const rule of rules) if (ruleMatches(rule, touch)) return rule
  return null
}

/** The channel a first touch belongs to; `unknown` when there is no touch. */
export function classifyChannel(
  touch: FirstTouch | null | undefined,
  rules: readonly ChannelRule[] = DEFAULT_CHANNEL_RULES,
): AcquisitionChannel {
  if (!touch) return 'unknown'
  return matchChannelRule(touch, rules)?.channel ?? 'direct'
}

/** A referrer host as a person reads it: without the `www.` a browser adds. */
export function displayHost(host: string | null | undefined): string {
  if (!host) return ''
  return host.startsWith('www.') ? host.slice(4) : host
}

/**
 * The ad network each click id belongs to, named the way the network's own
 * auto-tagging names itself as a source.
 */
const CLICK_ID_SOURCES: Record<FirstTouchClickId, string> = {
  gclid: 'google',
  msclkid: 'bing',
  fbclid: 'facebook',
}

/**
 * Source and medium in the familiar pair form: `utm_source`, else the
 * referrer, else the network a click id names; `utm_medium`, else what the
 * channel implies. `(direct)` / `(none)` for a visit with nothing external,
 * spelled the way analytics tools spell it, so a staff member comparing the
 * two reads the same words.
 */
export function sourceAndMedium(
  touch: FirstTouch | null | undefined,
  rules: readonly ChannelRule[] = DEFAULT_CHANNEL_RULES,
): { source: string; medium: string } {
  if (!touch) return { source: 'unknown', medium: 'unknown' }
  const channel = classifyChannel(touch, rules)
  const clickSource = touch.click?.length ? CLICK_ID_SOURCES[touch.click[0]] : ''
  const source =
    touch.utm?.source || displayHost(touch.ref) || clickSource || '(direct)'
  const medium =
    touch.utm?.medium ||
    (channel === 'organic-search'
      ? 'organic'
      : channel === 'paid-search'
        ? 'cpc'
        : channel === 'direct'
          ? '(none)'
          : channel)
  return { source, medium }
}
