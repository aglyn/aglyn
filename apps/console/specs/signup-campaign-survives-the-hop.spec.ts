/**
 * @jest-environment jsdom
 */

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
 * AGL-1731 — the campaign has to survive the hop, not just the parse.
 *
 * `signup-campaign-attribution.spec.tsx` proves the signup page attributes
 * whatever URL it is handed. That is necessary and it is not sufficient: the
 * page can only read the URL it is GIVEN, so every hop between the ad click
 * and that mount is a place attribution dies silently. A dropped param does
 * not fail, does not log, and does not look different afterwards from a
 * campaign that produced no signups — which is the single conclusion ad spend
 * must not be drawn against.
 *
 * `sendToConsentGate` is the one such hop whose URL is built in this
 * repository. It is the fourth account-creation door (AGL-1497): "Sign in with
 * Google" on `/signin` turns out to have CREATED an account, so the person is
 * bounced to `/signup` to be shown the Terms. It used to build a bare
 * `/signup?consent=required`, discarding whatever the marketing link put on
 * `/signin`.
 *
 * The other hops are NOT testable here and are recorded on the issue instead:
 * the `aglyn.com` → `app.aglyn.com` cross-origin link is besigner content, not
 * a repo file, so no spec in this tree can assert what its hrefs carry.
 */

import {
  CONSENT_REQUIRED_SEARCH,
  sendToConsentGate,
} from '../utils/legal-consent'

const mockNavigate = jest.fn()

jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockNavigate(url),
  hardNavigate: (url: string) => mockNavigate(url),
}))

/**
 * The real campaign contract. Stubbing it would leave the hop asserted against
 * a fiction — and the allowlist is the privacy mechanism this hop depends on.
 */
jest.mock('@aglyn/aglyn', () => {
  const campaign = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/campaign-attribution',
  )
  return {
    campaignAttributionQuery: campaign.campaignAttributionQuery,
    parseCampaignAttribution: campaign.parseCampaignAttribution,
  }
})

/** Put a query string on the page the bounce is leaving FROM. */
const landOn = (search: string) => {
  window.history.replaceState({}, '', `/signin${search}`)
}

/** The single URL the bounce navigated to. */
const bouncedTo = () => {
  expect(mockNavigate).toHaveBeenCalledTimes(1)
  return new URL(mockNavigate.mock.calls[0][0], 'https://app.aglyn.com')
}

describe('the campaign survives the /signin → /signup bounce (AGL-1731)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    landOn('')
  })

  it('carries the campaign across the door that used to drop it', () => {
    landOn('?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch')

    sendToConsentGate()

    const url = bouncedTo()
    expect(url.pathname).toBe('/signup')
    // The reason for the bounce still has to reach the page — the signup page
    // reads it both to explain the move and to report `method: google_signin`.
    expect(url.searchParams.get('consent')).toBe('required')
    expect(url.searchParams.get('utm_source')).toBe('google')
    expect(url.searchParams.get('utm_medium')).toBe('cpc')
    expect(url.searchParams.get('utm_campaign')).toBe('sept-launch')
  })

  it('adds NOTHING when the visitor arrived with no campaign', () => {
    landOn('?plan=pro')

    sendToConsentGate()

    // Exactly the old URL. "Arrived from nowhere" must not become "arrived
    // from a campaign with empty fields" just because this hop now exists.
    expect(mockNavigate).toHaveBeenCalledWith(`/signup?${CONSENT_REQUIRED_SEARCH}`)
    expect([...bouncedTo().searchParams.keys()]).toEqual(['consent'])
  })

  it('re-serialises through the allowlist instead of forwarding the query', () => {
    // The whole reason this is a parse-and-rebuild and not a string copy: a
    // marketing link is untrusted input, and this hop writes a URL we own.
    landOn(
      '?utm_source=hn&utm_term=headless+cms&gclid=xyz&email=someone@example.com&plan=pro',
    )

    sendToConsentGate()

    const url = bouncedTo()
    expect([...url.searchParams.keys()].sort()).toEqual([
      'consent',
      'utm_source',
    ])
    expect(mockNavigate.mock.calls[0][0]).not.toContain('@')
    expect(mockNavigate.mock.calls[0][0]).not.toContain('gclid')
  })

  it('refuses an email-shaped campaign value on this hop too', () => {
    // The scrub lives in the parser, so every exit inherits it — including one
    // added months after the parser was written. That is the property being
    // pinned, not the individual case.
    landOn('?utm_source=someone@example.com&utm_campaign=sept-launch')

    sendToConsentGate()

    const url = bouncedTo()
    expect(url.searchParams.get('utm_source')).toBeNull()
    expect(url.searchParams.get('utm_campaign')).toBe('sept-launch')
  })
})
