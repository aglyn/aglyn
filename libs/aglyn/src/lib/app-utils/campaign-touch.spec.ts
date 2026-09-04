/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://shop.example.com/"}
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
 * The visitor's half of campaign attribution, driven the way a browser does
 * it: land on a URL, walk to another page, convert days later.
 *
 * The assertions that matter here are the two that go wrong quietly. A
 * carrier that never expires attributes next month's organic return to this
 * month's ad; a carrier that invents a value where there was none produces a
 * fully populated report in which every row is a lie. Both look healthier
 * than the truth, which is why each has a case in both directions.
 */

import {
  ATTRIBUTION_WINDOW_MS,
  CAMPAIGN_TOUCH_STORAGE_KEY,
  campaignTouchField,
  campaignTouchWire,
  parseCampaignTouch,
  readCampaignTouch,
  rememberCampaignTouch,
  setCampaignTouchConsent,
} from './campaign-touch'

const DAY = 24 * 60 * 60 * 1000
const LANDED_AT = 1_700_000_000_000

/** Put the visitor on a URL, the way a click on a campaign link would. */
function landOn(url: string): void {
  window.history.replaceState({}, '', url)
}

/** What is actually sitting on the visitor's device. */
function stored(): string | null {
  return window.localStorage.getItem(CAMPAIGN_TOUCH_STORAGE_KEY)
}

beforeEach(() => {
  window.localStorage.clear()
  // Unresolved, which is the state every pageview starts in.
  setCampaignTouchConsent(null)
  landOn('https://shop.example.com/')
})

describe('the wire form', () => {
  it('round-trips the three labels and the instant', () => {
    const wire = campaignTouchWire({
      source: 'google',
      medium: 'cpc',
      campaign: 'sept-launch',
      atMs: LANDED_AT,
    })

    expect(parseCampaignTouch(wire, LANDED_AT + DAY)).toEqual({
      source: 'google',
      medium: 'cpc',
      campaign: 'sept-launch',
      atMs: LANDED_AT,
    })
  })

  it('is empty for a touch that names no campaign', () => {
    // Not `t=…` on its own. A wire value carrying an instant and no labels
    // would parse back as a touch that credits nobody, which is a different
    // and much worse thing than no touch at all.
    expect(campaignTouchWire({ atMs: LANDED_AT })).toBe('')
    expect(campaignTouchWire(null)).toBe('')
  })

  it('is empty for a touch with no usable instant', () => {
    expect(campaignTouchWire({ source: 'google', atMs: 0 })).toBe('')
    expect(campaignTouchWire({ source: 'google', atMs: Number.NaN })).toBe('')
  })

  it('drops a label the allowlist refuses and keeps the rest', () => {
    // An address in a marketing link is the exact thing the standing rule
    // forbids putting in a query string, so the parser refuses the VALUE
    // rather than the whole touch — the campaign is still nameable.
    const wire = campaignTouchWire({
      source: 'buyer@example.com',
      campaign: 'sept-launch',
      atMs: LANDED_AT,
    })

    const touch = parseCampaignTouch(wire, LANDED_AT)
    expect(touch?.source).toBeUndefined()
    expect(touch?.campaign).toBe('sept-launch')
  })

  it('carries no parameter outside the three allowlisted labels', () => {
    const wire = campaignTouchWire({
      source: 'google',
      medium: 'cpc',
      campaign: 'sept-launch',
      atMs: LANDED_AT,
    })

    expect([...new URLSearchParams(wire).keys()].sort()).toEqual([
      't',
      'utm_campaign',
      'utm_medium',
      'utm_source',
    ])
  })
})

describe('the window', () => {
  const wire = campaignTouchWire({ campaign: 'sept-launch', atMs: LANDED_AT })

  it('CONVERTED THREE DAYS LATER — still the campaign that brought them', () => {
    expect(parseCampaignTouch(wire, LANDED_AT + 3 * DAY)?.campaign).toBe(
      'sept-launch',
    )
  })

  it('holds at exactly the window and lets go one millisecond past it', () => {
    expect(parseCampaignTouch(wire, LANDED_AT + ATTRIBUTION_WINDOW_MS)).not.toBe(
      null,
    )
    expect(
      parseCampaignTouch(wire, LANDED_AT + ATTRIBUTION_WINDOW_MS + 1),
    ).toBe(null)
  })

  it('refuses a touch dated after the conversion', () => {
    // A touch that has not happened yet did not cause anything. The revenue
    // join refuses the same shape and calls it the receipt, not the cause.
    expect(parseCampaignTouch(wire, LANDED_AT - 1)).toBe(null)
  })
})

describe('consent', () => {
  it('UNRESOLVED — nothing is written and nothing is read', () => {
    landOn('https://shop.example.com/?utm_campaign=sept-launch')

    // The default state, never touched by `setCampaignTouchConsent(true)`.
    expect(rememberCampaignTouch(undefined, LANDED_AT)).toBe(null)
    expect(stored()).toBe(null)
  })

  it('GRANTED — the arrival is remembered', () => {
    landOn('https://shop.example.com/?utm_source=google&utm_campaign=sept')
    setCampaignTouchConsent(true)

    expect(rememberCampaignTouch(undefined, LANDED_AT)?.campaign).toBe('sept')
    expect(stored()).toContain('utm_campaign=sept')
  })

  it('WITHDRAWN — the stored touch is removed, not merely ignored', () => {
    landOn('https://shop.example.com/?utm_campaign=sept')
    setCampaignTouchConsent(true)
    rememberCampaignTouch(undefined, LANDED_AT)
    expect(stored()).not.toBe(null)

    setCampaignTouchConsent(false)

    expect(stored()).toBe(null)
  })

  it('a grant remembers the arrival without a separate call', () => {
    // The component calls this on every render, so the grant itself has to be
    // what captures the landing URL — a visitor who accepts the banner on the
    // page the ad landed them on must not lose the campaign to the ordering.
    landOn('https://shop.example.com/?utm_campaign=sept')

    setCampaignTouchConsent(true)

    expect(stored()).toContain('utm_campaign=sept')
  })
})

describe('last touch, not first', () => {
  it('a later campaign REPLACES the one already remembered', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberCampaignTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/?utm_campaign=autumn')
    rememberCampaignTouch(undefined, LANDED_AT + DAY)

    // Last touch is the revenue join's rule, and a lead attributing by a
    // different rule than an order is the split this whole area exists to
    // avoid.
    expect(parseCampaignTouch(stored(), LANDED_AT + DAY)?.campaign).toBe(
      'autumn',
    )
  })

  it('an organic page view does not erase the campaign that brought them', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberCampaignTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/pricing')
    rememberCampaignTouch(undefined, LANDED_AT + 60_000)

    expect(parseCampaignTouch(stored(), LANDED_AT + 60_000)?.campaign).toBe(
      'spring',
    )
  })
})

describe('reading a touch at the moment of conversion', () => {
  it('the LIVE URL wins over what was remembered', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberCampaignTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/offer?utm_campaign=autumn')

    expect(readCampaignTouch(LANDED_AT + DAY)?.campaign).toBe('autumn')
  })

  it('the LIVE URL needs no consent at all', () => {
    // Nothing is written to the device: the parameters are already in the
    // page the visitor asked for. A visitor under a prior-consent posture who
    // converts on the landing page is still attributed.
    landOn('https://shop.example.com/?utm_campaign=sept')

    expect(readCampaignTouch(LANDED_AT)?.campaign).toBe('sept')
  })

  it('CONVERTED THREE DAYS LATER, on a page with no parameters', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_source=google&utm_campaign=sept')
    rememberCampaignTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/contact')

    const touch = readCampaignTouch(LANDED_AT + 3 * DAY)
    expect(touch?.source).toBe('google')
    expect(touch?.campaign).toBe('sept')
    expect(touch?.atMs).toBe(LANDED_AT)
  })

  it('EXPIRED — the entry is deleted rather than left to linger', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=sept')
    rememberCampaignTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/contact')

    expect(readCampaignTouch(LANDED_AT + ATTRIBUTION_WINDOW_MS + 1)).toBe(null)

    // Not merely refused. A touch that can never be credited again is a
    // record of where somebody came from that nothing reads.
    expect(stored()).toBe(null)
  })
})

describe('what a conversion request carries', () => {
  it('DIRECT TRAFFIC — the field is absent entirely', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/contact')

    // Not `campaignTouch: ''` and not `utm_source=direct`. A door that
    // reports nothing and a visitor who came from nowhere have to stay
    // distinguishable on the wire, and an invented value would make every
    // organic conversion look like a campaign's.
    expect(campaignTouchField(LANDED_AT)).toEqual({})
  })

  it('CAMPAIGN PRESENT — the field carries the touch and its instant', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_source=google&utm_campaign=sept')
    rememberCampaignTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/contact')

    const field = campaignTouchField(LANDED_AT + 3 * DAY)

    expect(parseCampaignTouch(field.campaignTouch, LANDED_AT + 3 * DAY)).toEqual(
      { source: 'google', campaign: 'sept', atMs: LANDED_AT },
    )
  })

  it('EXPIRED — the field is absent, and an aged-out visitor reads as direct', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=sept')
    rememberCampaignTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/contact')

    expect(campaignTouchField(LANDED_AT + ATTRIBUTION_WINDOW_MS + 1)).toEqual({})
  })
})

describe('a store that is writable by anything on the page', () => {
  it('re-parses a hand-edited entry through the same allowlist', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/contact')
    window.localStorage.setItem(
      CAMPAIGN_TOUCH_STORAGE_KEY,
      `utm_source=buyer%40example.com&utm_term=secret&utm_campaign=sept&t=${LANDED_AT}`,
    )

    const touch = readCampaignTouch(LANDED_AT + DAY)

    // The email shape is refused and the un-allowlisted label never existed
    // as far as the parser is concerned, so a hand-edited entry can claim no
    // more than a hand-edited URL could.
    expect(touch).toEqual({ campaign: 'sept', atMs: LANDED_AT })
  })

  it('answers none for an entry naming no campaign', () => {
    setCampaignTouchConsent(true)
    landOn('https://shop.example.com/contact')
    window.localStorage.setItem(CAMPAIGN_TOUCH_STORAGE_KEY, `t=${LANDED_AT}`)

    expect(readCampaignTouch(LANDED_AT)).toBe(null)
  })
})
