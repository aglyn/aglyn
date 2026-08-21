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
 * Where an account came from (AGL-1731) — the campaign contract between the
 * marketing site's links and the console's signup.
 *
 * Until this existed a paid click, an organic visit and a partner link
 * arrived indistinguishable: `sign_up` carried `method` and nothing else, so
 * no report could say which spend produced a customer. That is tolerable
 * while nothing is being spent and not tolerable the day advertising starts,
 * because the measurement has to exist BEFORE the traffic — a signup that
 * lands unattributed is unattributed forever.
 *
 * ## Why an allowlist, and why exactly three
 *
 * `utm_source`, `utm_medium` and `utm_campaign` are the three axes an ad
 * report is read on: which channel, what kind of placement, which push. They
 * are also the three the marketing site can be told to emit without further
 * decisions.
 *
 * `utm_term` and `utm_content` are deliberately OUT, matching the refusal the
 * tenant's own first-party collector already made for its visitors
 * (`apps/tenant/app/api/analytics/collect/route.ts`): keyword- and
 * variant-level labels multiply cardinality without answering a question
 * anyone asks of a signup, and a keyword string is the most likely of the
 * five to carry something a person typed. `gclid` and bare `ref` are out for
 * the same reason plus a stronger one — `gclid` is an ads-click identifier,
 * and this property runs with ads personalization off in all 307 regions.
 *
 * The allowlist is the privacy mechanism, not a convenience. A parser that
 * copied "the campaign-ish parameters" would be one marketing link away from
 * storing `?email=` against a person, and the standing rule is that personal
 * data never travels in a URL parameter in the first place.
 *
 * ## Two exits, and only one of them is already guarded
 *
 * A parsed campaign leaves this process twice: onto the GA4 `sign_up` hit,
 * and into `users/{uid}` so revenue can be attributed to it months later.
 * Only the first passes `sanitizeEventParams`. The Firestore write does not,
 * so the scrub — email shape refused, length capped, blanks dropped — lives
 * HERE, on the way in, and both exits inherit it.
 *
 * ## Why the wire form is what gets stored
 *
 * Same contract as the AGL-1535 plan intent it rides beside: the stored value
 * is the query string, re-parsed by this parser on the way out. `users/{uid}`
 * is owner-writable, so a stored field is a client-FORGEABLE field. Re-parsing
 * means a hand-edited document can claim no more than a hand-edited URL could,
 * which is a marketing label and nothing that touches entitlement.
 */

/**
 * The URL parameter names, in report order. Exported because the marketing
 * site's links, the stored wire form and this parser all have to spell them
 * identically — two spellings would read as two dimensions in GA4 and split
 * every report in half.
 */
export const CAMPAIGN_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
] as const

/** A campaign, with every field optional — a partial one is still worth having. */
export interface CampaignAttribution {
  /** `utm_source` — the channel: `google`, `hn`, a partner's name. */
  source?: string
  /** `utm_medium` — the kind of placement: `cpc`, `email`, `referral`. */
  medium?: string
  /** `utm_campaign` — which push: `sept-launch`. */
  campaign?: string
}

/** Longest value stored or sent, matching `sanitizeEventParams`'s own cap. */
const MAX_VALUE_LENGTH = 100

/** The same shape test the event sanitizer uses, applied to the stored exit too. */
const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/

/** Which `CampaignAttribution` field each URL key fills. */
const FIELD_FOR_KEY: Record<
  (typeof CAMPAIGN_QUERY_KEYS)[number],
  keyof CampaignAttribution
> = {
  utm_source: 'source',
  utm_medium: 'medium',
  utm_campaign: 'campaign',
}

/** What a Server Component holds before it has a `URLSearchParams`. */
export type CampaignParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined

function rawValue(params: CampaignParamSource, key: string): string | null {
  if (!params) return null
  if (typeof (params as URLSearchParams).get === 'function') {
    return (params as URLSearchParams).get(key)
  }
  const value = (params as Record<string, string | string[] | undefined>)[key]
  // A repeated parameter arrives as an array. The first one wins rather than
  // being joined: `utm_medium=cpc&utm_medium=organic` is a malformed link, and
  // inventing `cpc,organic` would put a value in the reports that no campaign
  // ever set.
  if (Array.isArray(value)) return value.length ? value[0] : null
  return typeof value === 'string' ? value : null
}

/**
 * Reduce one raw parameter to something storable, or null to drop it.
 *
 * Dropping the single value rather than the whole campaign is deliberate: a
 * mail-merge link that puts an address in `utm_source` still names a real
 * `utm_campaign`, and keeping the half that is safe beats losing the
 * attribution to protect the half that is not.
 */
function scrubValue(value: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (EMAIL_SHAPED.test(trimmed)) return null
  return trimmed.slice(0, MAX_VALUE_LENGTH)
}

/**
 * Read the campaign off a signup URL, or null when it names none.
 *
 * Null rather than `{}` so a caller can branch on "was there a campaign at
 * all". An empty object written to an account would read as "arrived from
 * nowhere, confirmed" instead of "never asked", and those are different facts.
 */
export function parseCampaignAttribution(
  params: CampaignParamSource,
): CampaignAttribution | null {
  if (!params) return null
  const attribution: CampaignAttribution = {}
  for (const key of CAMPAIGN_QUERY_KEYS) {
    const value = scrubValue(rawValue(params, key))
    if (value) attribution[FIELD_FOR_KEY[key]] = value
  }
  return Object.keys(attribution).length ? attribution : null
}

/**
 * The canonical query string for a campaign — the ONLY place the stored form
 * is written, so it cannot drift from what the parser reads back.
 */
export function campaignAttributionQuery(
  attribution: CampaignAttribution | null | undefined,
): string {
  if (!attribution) return ''
  const params = new URLSearchParams()
  for (const key of CAMPAIGN_QUERY_KEYS) {
    const value = attribution[FIELD_FOR_KEY[key]]
    if (value) params.set(key, value)
  }
  return params.toString()
}

/**
 * The campaign as GA4 event parameters, ready to spread into `sign_up`.
 *
 * Renamed off the `utm_` spellings on purpose. These are OUR event parameters,
 * registered as custom dimensions on the property (see `docs/ANALYTICS.md`);
 * the `utm_` names belong to GA's own automatic campaign collection, and
 * shipping a custom parameter under a name the platform also owns is how a
 * dimension ends up meaning two things.
 *
 * Returns an empty object — never keys with `undefined` values — so that
 * spreading it into an organic signup's params adds nothing at all. A
 * `campaign_source: undefined` on every unattributed signup would survive the
 * sanitizer as an absence but read, to whoever writes the report, as a
 * dimension that is populated sometimes and broken the rest of the time.
 */
export function campaignEventParams(
  attribution: CampaignAttribution | null | undefined,
): {
  campaign_source?: string
  campaign_medium?: string
  campaign_name?: string
} {
  if (!attribution) return {}
  return {
    ...(attribution.source ? { campaign_source: attribution.source } : {}),
    ...(attribution.medium ? { campaign_medium: attribution.medium } : {}),
    ...(attribution.campaign ? { campaign_name: attribution.campaign } : {}),
  }
}
