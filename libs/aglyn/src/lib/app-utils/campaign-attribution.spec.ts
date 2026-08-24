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
 * AGL-1731 — the campaign contract, and the two things it must refuse.
 *
 * The parser is the only place a URL parameter becomes something we store
 * against a person, so the interesting cases are not the happy ones. Two
 * refusals carry the whole privacy posture:
 *
 * - an ALLOWLIST, so `?utm_source=x&email=someone@example.com` stores the
 *   source and nothing else. A "copy the campaign-ish params" parser is one
 *   marketing link away from putting an address on `users/{uid}`.
 * - a SCRUB on the value, because the stored form does NOT pass through
 *   `sanitizeEventParams`. That sanitizer guards the GA4 hit; the Firestore
 *   write is a second exit this module owns alone.
 */

import {
  CAMPAIGN_QUERY_KEYS,
  campaignAttributionQuery,
  campaignEventParams,
  parseCampaignAttribution,
} from './campaign-attribution'

describe('parseCampaignAttribution (AGL-1731)', () => {
  it('reads the three allowlisted keys off a signup URL', () => {
    expect(
      parseCampaignAttribution(
        new URLSearchParams(
          '?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch',
        ),
      ),
    ).toEqual({
      source: 'google',
      medium: 'cpc',
      campaign: 'sept-launch',
    })
  })

  it('keeps a partial campaign rather than demanding all three', () => {
    // A partner link routinely carries only `utm_source`. Refusing it would
    // throw away the attribution the link exists to provide.
    expect(
      parseCampaignAttribution(new URLSearchParams('?utm_source=hn')),
    ).toEqual({ source: 'hn' })
  })

  it('is null when the URL names no campaign at all', () => {
    // Not `{}` — the callers branch on null to write nothing, and an empty
    // object stored against an account would read as "arrived from nowhere,
    // confirmed" rather than "never asked".
    expect(parseCampaignAttribution(new URLSearchParams('?plan=pro'))).toBeNull()
    expect(parseCampaignAttribution(null)).toBeNull()
    expect(parseCampaignAttribution(undefined)).toBeNull()
  })

  it('takes ONLY the allowlisted keys, whatever else rides the URL', () => {
    const parsed = parseCampaignAttribution(
      new URLSearchParams(
        '?utm_source=twitter&utm_term=free+cms&utm_content=variant-b&ref=hn&gclid=abc',
      ),
    )

    // `utm_term`/`utm_content` are deliberately out (see the module comment),
    // and `ref`/`gclid` were never in. The object must carry three keys at
    // most, ever.
    expect(parsed).toEqual({ source: 'twitter' })
    expect(Object.keys(parsed ?? {})).toEqual(['source'])
  })

  it('refuses an email-shaped value outright rather than storing it', () => {
    // The failure this exists to stop: a mail-merge campaign link built as
    // `?utm_source=newsletter-someone@example.com`. The address must not
    // reach `users/{uid}`, and dropping the one value beats dropping the
    // campaign.
    const parsed = parseCampaignAttribution(
      new URLSearchParams(
        '?utm_source=someone@example.com&utm_campaign=sept-launch',
      ),
    )

    expect(parsed).toEqual({ campaign: 'sept-launch' })
    expect(JSON.stringify(parsed)).not.toContain('@')
  })

  it('caps a value rather than storing an unbounded string', () => {
    const parsed = parseCampaignAttribution(
      new URLSearchParams(`?utm_campaign=${'a'.repeat(500)}`),
    )

    expect(parsed?.campaign).toHaveLength(100)
  })

  it('drops a blank or whitespace-only value instead of storing an empty one', () => {
    expect(
      parseCampaignAttribution(new URLSearchParams('?utm_source=&utm_medium=%20%20')),
    ).toBeNull()
  })

  it('accepts the plain-record shape a Server Component holds', () => {
    expect(
      parseCampaignAttribution({
        utm_source: 'google',
        // A repeated parameter arrives as an array; the first wins, rather
        // than the parser throwing or joining them into a nonsense value.
        utm_medium: ['cpc', 'organic'],
        utm_campaign: undefined,
      }),
    ).toEqual({ source: 'google', medium: 'cpc' })
  })
})

describe('campaignAttributionQuery — the stored wire form (AGL-1731)', () => {
  it('round-trips through the parser, which is what makes storing it safe', () => {
    const original = { source: 'google', medium: 'cpc', campaign: 'sept' }
    const query = campaignAttributionQuery(original)

    expect(query).toBe('utm_source=google&utm_medium=cpc&utm_campaign=sept')
    // The stored value is re-PARSED on read, never trusted: `users/{uid}` is
    // owner-writable, so a hand-edited document must not be a second, more
    // trusting path into what we record as an acquisition source.
    expect(parseCampaignAttribution(new URLSearchParams(query))).toEqual(original)
  })

  it('omits the keys it does not have, so a partial stays partial', () => {
    expect(campaignAttributionQuery({ source: 'hn' })).toBe('utm_source=hn')
  })

  it('names the keys through the exported constant, not a second spelling', () => {
    // Two spellings of `utm_source` would read as two dimensions in GA and
    // the reports would silently split.
    expect(CAMPAIGN_QUERY_KEYS).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
    ])
  })
})

describe('campaignEventParams — what rides the GA4 hit (AGL-1731)', () => {
  it('maps to the registerable param names, not the raw utm_ spellings', () => {
    expect(
      campaignEventParams({ source: 'google', medium: 'cpc', campaign: 'sept' }),
    ).toEqual({
      campaign_source: 'google',
      campaign_medium: 'cpc',
      campaign_name: 'sept',
    })
  })

  it('is an EMPTY object for no campaign, so the spread adds nothing', () => {
    // The call site spreads this into `sign_up`'s params. Returning undefined
    // keys instead of no keys would put `campaign_source: undefined` on every
    // organic signup and make the dimension unreadable.
    //
    // Asserted on the KEYS, not with `toEqual({})`. `toEqual` ignores
    // properties whose value is `undefined`, so it passes on
    // `{ campaign_source: undefined }` — the exact defect this test names.
    // Found by mutation: the `toEqual` version of these two lines survived a
    // helper rewritten to emit undefined keys. With `strictNullChecks` off the
    // types would not have objected either.
    expect(Object.keys(campaignEventParams(null))).toEqual([])
    expect(campaignEventParams(null)).toStrictEqual({})
    expect(Object.keys(campaignEventParams({}))).toEqual([])
    expect(campaignEventParams({})).toStrictEqual({})
  })
})
