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
  UTM_TOUCH_STORAGE_KEY,
  notePageCampaigns,
  pageTouchWire,
  parsePageTouch,
  readPageTouch,
  utmTouchField,
  utmTouchWire,
  parseUtmTouch,
  readUtmTouch,
  rememberUtmTouch,
  setUtmTouchConsent,
} from './utm-touch'

const DAY = 24 * 60 * 60 * 1000
const LANDED_AT = 1_700_000_000_000

/** Put the visitor on a URL, the way a click on a campaign link would. */
function landOn(url: string): void {
  window.history.replaceState({}, '', url)
}

/** What is actually sitting on the visitor's device. */
function stored(): string | null {
  return window.localStorage.getItem(UTM_TOUCH_STORAGE_KEY)
}

beforeEach(() => {
  window.localStorage.clear()
  // Unresolved, which is the state every pageview starts in.
  setUtmTouchConsent(null)
  // And on no page filed under a campaign.
  notePageCampaigns(null)
  landOn('https://shop.example.com/')
})

describe('the wire form', () => {
  it('round-trips the three labels and the instant', () => {
    const wire = utmTouchWire({
      source: 'google',
      medium: 'cpc',
      campaign: 'sept-launch',
      atMs: LANDED_AT,
    })

    expect(parseUtmTouch(wire, LANDED_AT + DAY)).toEqual({
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
    expect(utmTouchWire({ atMs: LANDED_AT })).toBe('')
    expect(utmTouchWire(null)).toBe('')
  })

  it('is empty for a touch with no usable instant', () => {
    expect(utmTouchWire({ source: 'google', atMs: 0 })).toBe('')
    expect(utmTouchWire({ source: 'google', atMs: Number.NaN })).toBe('')
  })

  it('drops a label the allowlist refuses and keeps the rest', () => {
    // An address in a marketing link is the exact thing the standing rule
    // forbids putting in a query string, so the parser refuses the VALUE
    // rather than the whole touch — the campaign is still nameable.
    const wire = utmTouchWire({
      source: 'buyer@example.com',
      campaign: 'sept-launch',
      atMs: LANDED_AT,
    })

    const touch = parseUtmTouch(wire, LANDED_AT)
    expect(touch?.source).toBeUndefined()
    expect(touch?.campaign).toBe('sept-launch')
  })

  it('carries no parameter outside the three allowlisted labels', () => {
    const wire = utmTouchWire({
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
  const wire = utmTouchWire({ campaign: 'sept-launch', atMs: LANDED_AT })

  it('CONVERTED THREE DAYS LATER — still the campaign that brought them', () => {
    expect(parseUtmTouch(wire, LANDED_AT + 3 * DAY)?.campaign).toBe(
      'sept-launch',
    )
  })

  it('holds at exactly the window and lets go one millisecond past it', () => {
    expect(parseUtmTouch(wire, LANDED_AT + ATTRIBUTION_WINDOW_MS)).not.toBe(
      null,
    )
    expect(
      parseUtmTouch(wire, LANDED_AT + ATTRIBUTION_WINDOW_MS + 1),
    ).toBe(null)
  })

  it('refuses a touch dated after the conversion', () => {
    // A touch that has not happened yet did not cause anything. The revenue
    // join refuses the same shape and calls it the receipt, not the cause.
    expect(parseUtmTouch(wire, LANDED_AT - 1)).toBe(null)
  })
})

describe('consent', () => {
  it('UNRESOLVED — nothing is written and nothing is read', () => {
    landOn('https://shop.example.com/?utm_campaign=sept-launch')

    // The default state, never touched by `setUtmTouchConsent(true)`.
    expect(rememberUtmTouch(undefined, LANDED_AT)).toBe(null)
    expect(stored()).toBe(null)
  })

  it('GRANTED — the arrival is remembered', () => {
    landOn('https://shop.example.com/?utm_source=google&utm_campaign=sept')
    setUtmTouchConsent(true)

    expect(rememberUtmTouch(undefined, LANDED_AT)?.campaign).toBe('sept')
    expect(stored()).toContain('utm_campaign=sept')
  })

  it('WITHDRAWN — the stored touch is removed, not merely ignored', () => {
    landOn('https://shop.example.com/?utm_campaign=sept')
    setUtmTouchConsent(true)
    rememberUtmTouch(undefined, LANDED_AT)
    expect(stored()).not.toBe(null)

    setUtmTouchConsent(false)

    expect(stored()).toBe(null)
  })

  it('a grant remembers the arrival without a separate call', () => {
    // The component calls this on every render, so the grant itself has to be
    // what captures the landing URL — a visitor who accepts the banner on the
    // page the ad landed them on must not lose the campaign to the ordering.
    landOn('https://shop.example.com/?utm_campaign=sept')

    setUtmTouchConsent(true)

    expect(stored()).toContain('utm_campaign=sept')
  })
})

describe('last touch, not first', () => {
  it('a later campaign REPLACES the one already remembered', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberUtmTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/?utm_campaign=autumn')
    rememberUtmTouch(undefined, LANDED_AT + DAY)

    // Last touch is the revenue join's rule, and a lead attributing by a
    // different rule than an order is the split this whole area exists to
    // avoid.
    expect(parseUtmTouch(stored(), LANDED_AT + DAY)?.campaign).toBe(
      'autumn',
    )
  })

  it('an organic page view does not erase the campaign that brought them', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberUtmTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/pricing')
    rememberUtmTouch(undefined, LANDED_AT + 60_000)

    expect(parseUtmTouch(stored(), LANDED_AT + 60_000)?.campaign).toBe(
      'spring',
    )
  })
})

describe('reading a touch at the moment of conversion', () => {
  it('the LIVE URL wins over what was remembered', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberUtmTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/offer?utm_campaign=autumn')

    expect(readUtmTouch(LANDED_AT + DAY)?.campaign).toBe('autumn')
  })

  it('the LIVE URL needs no consent at all', () => {
    // Nothing is written to the device: the parameters are already in the
    // page the visitor asked for. A visitor under a prior-consent posture who
    // converts on the landing page is still attributed.
    landOn('https://shop.example.com/?utm_campaign=sept')

    expect(readUtmTouch(LANDED_AT)?.campaign).toBe('sept')
  })

  it('CONVERTED THREE DAYS LATER, on a page with no parameters', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_source=google&utm_campaign=sept')
    rememberUtmTouch(undefined, LANDED_AT)

    landOn('https://shop.example.com/contact')

    const touch = readUtmTouch(LANDED_AT + 3 * DAY)
    expect(touch?.source).toBe('google')
    expect(touch?.campaign).toBe('sept')
    expect(touch?.atMs).toBe(LANDED_AT)
  })

  it('EXPIRED — the entry is deleted rather than left to linger', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=sept')
    rememberUtmTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/contact')

    expect(readUtmTouch(LANDED_AT + ATTRIBUTION_WINDOW_MS + 1)).toBe(null)

    // Not merely refused. A touch that can never be credited again is a
    // record of where somebody came from that nothing reads.
    expect(stored()).toBe(null)
  })
})

describe('what a conversion request carries', () => {
  it('DIRECT TRAFFIC — the field is absent entirely', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/contact')

    // Not `campaignTouch: ''` and not `utm_source=direct`. A door that
    // reports nothing and a visitor who came from nowhere have to stay
    // distinguishable on the wire, and an invented value would make every
    // organic conversion look like a campaign's.
    expect(utmTouchField(LANDED_AT)).toEqual({})
  })

  it('CAMPAIGN PRESENT — the field carries the touch and its instant', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_source=google&utm_campaign=sept')
    rememberUtmTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/contact')

    const field = utmTouchField(LANDED_AT + 3 * DAY)

    expect(parseUtmTouch(field.campaignTouch, LANDED_AT + 3 * DAY)).toEqual(
      { source: 'google', campaign: 'sept', atMs: LANDED_AT },
    )
  })

  it('EXPIRED — the field is absent, and an aged-out visitor reads as direct', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=sept')
    rememberUtmTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/contact')

    expect(utmTouchField(LANDED_AT + ATTRIBUTION_WINDOW_MS + 1)).toEqual({})
  })
})

describe('a store that is writable by anything on the page', () => {
  it('re-parses a hand-edited entry through the same allowlist', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/contact')
    window.localStorage.setItem(
      UTM_TOUCH_STORAGE_KEY,
      `utm_source=buyer%40example.com&utm_term=secret&utm_campaign=sept&t=${LANDED_AT}`,
    )

    const touch = readUtmTouch(LANDED_AT + DAY)

    // The email shape is refused and the un-allowlisted label never existed
    // as far as the parser is concerned, so a hand-edited entry can claim no
    // more than a hand-edited URL could.
    expect(touch).toEqual({ campaign: 'sept', atMs: LANDED_AT })
  })

  it('answers none for an entry naming no campaign', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/contact')
    window.localStorage.setItem(UTM_TOUCH_STORAGE_KEY, `t=${LANDED_AT}`)

    expect(readUtmTouch(LANDED_AT)).toBe(null)
  })
})


/*==========================================
 * THE PAGE TOUCH (AGL-3461): a page filed under a campaign is a touch, with
 * no label on the address at all — held in the SAME entry as the labels, so
 * remembering it puts nothing new on the visitor's device.
 *=========================================*/

const LANDING = { screenId: 'scr_landing', containerIds: ['camp_ai'], path: '/ai-website-draft' }

/** Every key this module has left on the device. */
function storedKeys(): string[] {
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key) keys.push(key)
  }
  return keys
}

describe('the page touch', () => {
  it('round-trips the campaigns, the screen, the path and the instant', () => {
    const wire = pageTouchWire({ ...LANDING, atMs: LANDED_AT })

    expect(parsePageTouch(wire, LANDED_AT + DAY)).toEqual({ ...LANDING, atMs: LANDED_AT })
  })

  it('is refused past the window, in the future, or naming no campaign', () => {
    const wire = pageTouchWire({ ...LANDING, atMs: LANDED_AT })

    expect(parsePageTouch(wire, LANDED_AT + ATTRIBUTION_WINDOW_MS + 1)).toBe(null)
    expect(parsePageTouch(wire, LANDED_AT - 1)).toBe(null)
    expect(pageTouchWire({ ...LANDING, containerIds: [], atMs: LANDED_AT })).toBe('')
    expect(parsePageTouch(`ps=scr_landing&pt=${LANDED_AT}`, LANDED_AT)).toBe(null)
  })

  it('carries ids and a path only — a hand-edited entry claims nothing else', () => {
    const touch = parsePageTouch(
      `pc=${encodeURIComponent('camp_ai,../etc,camp_ai,x y')}&ps=scr_landing&pp=https%3A%2F%2Fevil.example&pt=${LANDED_AT}`,
      LANDED_AT,
    )

    expect(touch).toEqual({ containerIds: ['camp_ai'], screenId: 'scr_landing', path: '', atMs: LANDED_AT })
  })

  it('THE PAGE THE VISITOR IS ON is reported with no grant and nothing written', () => {
    landOn('https://shop.example.com/ai-website-draft')
    notePageCampaigns(LANDING, LANDED_AT)

    expect(readPageTouch(LANDED_AT + 60_000)).toEqual({ ...LANDING, atMs: LANDED_AT })
    expect(storedKeys()).toEqual([])
    expect(utmTouchField(LANDED_AT + 60_000)).toEqual({
      campaignTouch: pageTouchWire({ ...LANDING, atMs: LANDED_AT }),
    })
  })

  it('a re-render of the same page keeps the instant it was first viewed', () => {
    notePageCampaigns(LANDING, LANDED_AT)
    notePageCampaigns(LANDING, LANDED_AT + 5_000)

    expect(readPageTouch(LANDED_AT + 6_000)?.atMs).toBe(LANDED_AT)
  })

  it('survives the walk to a page filed under nothing, under the grant', () => {
    setUtmTouchConsent(true)
    notePageCampaigns(LANDING, LANDED_AT)
    // The pricing page is filed under no campaign.
    notePageCampaigns(null, LANDED_AT + DAY)

    expect(readPageTouch(LANDED_AT + 2 * DAY)).toEqual({ ...LANDING, atMs: LANDED_AT })
  })

  it('without the grant, the walk away from the page loses it', () => {
    notePageCampaigns(LANDING, LANDED_AT)
    notePageCampaigns(null, LANDED_AT + DAY)

    expect(readPageTouch(LANDED_AT + DAY)).toBe(null)
    expect(storedKeys()).toEqual([])
  })

  it('a grant given after the landing remembers the page being read', () => {
    notePageCampaigns(LANDING, LANDED_AT)
    setUtmTouchConsent(true)

    expect(parsePageTouch(stored(), LANDED_AT)).toEqual({ ...LANDING, atMs: LANDED_AT })
  })

  it('a withdrawal removes the one entry, page and labels together', () => {
    landOn('https://shop.example.com/ai-website-draft?utm_campaign=onejob-ai')
    setUtmTouchConsent(true)
    notePageCampaigns(LANDING, LANDED_AT)
    rememberUtmTouch(undefined, LANDED_AT)

    setUtmTouchConsent(false)

    expect(storedKeys()).toEqual([])
  })

  it('rides the same wire field as the labels, each half parsed by its own reader', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/ai-website-draft?utm_source=google&utm_campaign=onejob-ai')
    notePageCampaigns(LANDING, LANDED_AT)

    const wire = utmTouchField(LANDED_AT)['campaignTouch']

    expect(parseUtmTouch(wire, LANDED_AT)).toEqual({
      source: 'google',
      campaign: 'onejob-ai',
      atMs: LANDED_AT,
    })
    expect(parsePageTouch(wire, LANDED_AT)).toEqual({ ...LANDING, atMs: LANDED_AT })
  })
})

describe('one entry on the device for both touches', () => {
  it('the page and the labels share the existing key — no second key is written', () => {
    landOn('https://shop.example.com/ai-website-draft?utm_source=google&utm_campaign=onejob-ai')
    setUtmTouchConsent(true)
    rememberUtmTouch(undefined, LANDED_AT)
    notePageCampaigns(LANDING, LANDED_AT + 1_000)

    expect(storedKeys()).toEqual([UTM_TOUCH_STORAGE_KEY])
    expect(parseUtmTouch(stored(), LANDED_AT + 2_000)?.campaign).toBe('onejob-ai')
    expect(parsePageTouch(stored(), LANDED_AT + 2_000)?.containerIds).toEqual(['camp_ai'])
  })

  it('a new label keeps the page, and a new page keeps the label', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberUtmTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/ai-website-draft')
    notePageCampaigns(LANDING, LANDED_AT + DAY)
    landOn('https://shop.example.com/?utm_campaign=autumn')
    rememberUtmTouch(undefined, LANDED_AT + 2 * DAY)

    expect(parseUtmTouch(stored(), LANDED_AT + 2 * DAY)?.campaign).toBe('autumn')
    expect(parsePageTouch(stored(), LANDED_AT + 2 * DAY)?.atMs).toBe(LANDED_AT + DAY)
  })

  it('reads an entry written before the page touch existed', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/contact')
    window.localStorage.setItem(UTM_TOUCH_STORAGE_KEY, `utm_campaign=sept&t=${LANDED_AT}`)

    expect(readUtmTouch(LANDED_AT + DAY)).toEqual({ campaign: 'sept', atMs: LANDED_AT })
    expect(readPageTouch(LANDED_AT + DAY)).toBe(null)
    // An entry already in its canonical form is not rewritten by a read.
    expect(stored()).toBe(`utm_campaign=sept&t=${LANDED_AT}`)
  })

  it('an aged-out half is dropped and the other kept', () => {
    setUtmTouchConsent(true)
    landOn('https://shop.example.com/?utm_campaign=spring')
    rememberUtmTouch(undefined, LANDED_AT)
    landOn('https://shop.example.com/ai-website-draft')
    notePageCampaigns(LANDING, LANDED_AT + 5 * DAY)
    notePageCampaigns(null)
    landOn('https://shop.example.com/contact')

    const at = LANDED_AT + ATTRIBUTION_WINDOW_MS + DAY
    expect(readUtmTouch(at)).toBe(null)
    expect(readPageTouch(at)?.atMs).toBe(LANDED_AT + 5 * DAY)
    expect(stored()).toBe(pageTouchWire({ ...LANDING, atMs: LANDED_AT + 5 * DAY }))
  })
})

/*==========================================
 * THE FIRST CAMPAIGN TOUCH IN THE WINDOW — read off the entry above, once per
 * page load. Each case loads the module afresh, because a page load is what
 * the answer is scoped to.
 *=========================================*/

type UtmTouchModule = typeof import('./utm-touch')

/** The module as a fresh page load sees it. */
function freshPageLoad(): UtmTouchModule {
  let fresh: UtmTouchModule | undefined
  jest.isolateModules(() => {
    fresh = require('./utm-touch')
  })
  return fresh as UtmTouchModule
}

describe('the first campaign touch', () => {
  it('a device holding nothing is a first touch, answered once per page load', () => {
    const page = freshPageLoad()
    page.setUtmTouchConsent(true)
    page.notePageCampaigns(LANDING, LANDED_AT)

    expect(page.claimFirstCampaignTouch(['c:camp_ai', 'u:onejob-ai'], LANDED_AT)).toEqual([
      'c:camp_ai',
      'u:onejob-ai',
    ])
    // A second page in the same visit was preceded by this one.
    page.notePageCampaigns({ ...LANDING, screenId: 'scr_other', containerIds: ['camp_b'] }, LANDED_AT + 60_000)
    expect(page.claimFirstCampaignTouch(['c:camp_b'], LANDED_AT + 60_000)).toEqual([])
  })

  it('the next page load reads the touch it left, and is not a first', () => {
    const first = freshPageLoad()
    first.setUtmTouchConsent(true)
    first.notePageCampaigns(LANDING, LANDED_AT)
    first.claimFirstCampaignTouch(['c:camp_ai'], LANDED_AT)

    const next = freshPageLoad()
    next.setUtmTouchConsent(true)
    next.notePageCampaigns(LANDING, LANDED_AT + DAY)

    expect(next.claimFirstCampaignTouch(['c:camp_ai'], LANDED_AT + DAY)).toEqual([])
  })

  it('a touch past the window no longer counts, so the visit is a first again', () => {
    const first = freshPageLoad()
    first.setUtmTouchConsent(true)
    first.notePageCampaigns(LANDING, LANDED_AT)

    const later = freshPageLoad()
    later.setUtmTouchConsent(true)
    const at = LANDED_AT + ATTRIBUTION_WINDOW_MS + DAY
    later.notePageCampaigns(LANDING, at)

    expect(later.claimFirstCampaignTouch(['c:camp_ai'], at)).toEqual(['c:camp_ai'])
  })

  it('is read BEFORE this page load writes — a grant given on the page still counts it', () => {
    const page = freshPageLoad()
    landOn('https://shop.example.com/ai-website-draft?utm_campaign=onejob-ai')
    page.notePageCampaigns(LANDING, LANDED_AT)
    let claimed: string[] = []
    page.whenUtmTouchConsentSettles(() => {
      claimed = page.claimFirstCampaignTouch(['c:camp_ai', 'u:onejob-ai'], LANDED_AT)
    })

    page.setUtmTouchConsent(true)

    expect(claimed).toEqual(['c:camp_ai', 'u:onejob-ai'])
    expect(storedKeys()).toEqual([UTM_TOUCH_STORAGE_KEY])
  })

  it('claims nothing without the grant — a visit it cannot tell from the next is not a first', () => {
    const page = freshPageLoad()
    page.notePageCampaigns(LANDING, LANDED_AT)

    expect(page.claimFirstCampaignTouch(['c:camp_ai'], LANDED_AT)).toEqual([])
    expect(storedKeys()).toEqual([])
  })

  it('claims nothing when nothing could be remembered', () => {
    const page = freshPageLoad()
    page.setUtmTouchConsent(true)
    landOn('https://shop.example.com/pricing')

    // No page filed under a campaign and no label: no touch to remember.
    expect(page.claimFirstCampaignTouch(['u:onejob-ai'], LANDED_AT)).toEqual([])
  })
})
