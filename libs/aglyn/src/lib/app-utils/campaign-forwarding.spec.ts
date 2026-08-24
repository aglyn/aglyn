/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://aglyn.com/"}
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
 * AGL-1731 — the campaign crossing the domain hop, asserted on the href the
 * BROWSER would follow.
 *
 * The capture on `app.aglyn.com` was verified twice and was correct twice; it
 * was fed nothing, because nothing on `aglyn.com` ever put a `utm_*` parameter
 * on a console-bound link. So the assertions that matter here are not "does
 * the parser work" — that is `campaign-attribution.spec.ts` — but "does a real
 * click on a real anchor leave with the campaign on it, and does a click with
 * no campaign leave with nothing invented".
 *
 * Both directions are load-bearing and the second is the one that goes wrong
 * quietly. A forwarder that defaults to `utm_source=direct`, or that copies an
 * author's static `utm_source=google` onto every visitor, produces a fully
 * populated report in which every row is a lie. Absent attribution is
 * survivable; confidently wrong attribution is not, because nothing about it
 * looks broken.
 */

import {
  CAMPAIGN_VISIT_STORAGE_KEY,
  campaignToForward,
  decorateCampaignHref,
  installCampaignForwarding,
  readVisitCampaign,
  rememberVisitCampaign,
  resetCampaignForwarding,
  setCampaignForwardingConsent,
} from './campaign-forwarding'

const CONSOLE = 'https://app.aglyn.com'

/** Put the visitor on a marketing URL, the way an ad click would. */
function landOn(url: string): void {
  window.history.replaceState({}, '', url)
}

/** Paint an anchor and hand it back — `#target` is the thing clicked. */
function paint(html: string): Element {
  document.body.innerHTML = html
  return document.getElementById('target') as Element
}

/** A real bubbling, cancelable click, dispatched the way a browser does. */
function clickOn(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function pointerDownOn(element: Element): void {
  element.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
}

/** What the browser would actually navigate to. */
function hrefOf(element: Element): string {
  return element.getAttribute('href') || ''
}

beforeEach(() => {
  resetCampaignForwarding()
  window.sessionStorage.clear()
  document.body.innerHTML = ''
  landOn('https://aglyn.com/')
})

afterEach(() => {
  resetCampaignForwarding()
})

describe('the hop, driven end to end', () => {
  const CTA =
    '<a id="target" class="MuiButton-root" href="https://app.aglyn.com/signup?plan=pro&interval=year">Start free</a>'

  it('CAMPAIGN PRESENT — a click leaves carrying the campaign the visitor arrived with', () => {
    landOn(
      'https://aglyn.com/?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch',
    )
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint(CTA)

    clickOn(cta)

    const destination = new URL(hrefOf(cta))
    expect(destination.origin).toBe('https://app.aglyn.com')
    expect(destination.pathname).toBe('/signup')
    expect(destination.searchParams.get('utm_source')).toBe('google')
    expect(destination.searchParams.get('utm_medium')).toBe('cpc')
    expect(destination.searchParams.get('utm_campaign')).toBe('sept-launch')
    // The AGL-1535 plan intent rides the same href and must survive untouched.
    expect(destination.searchParams.get('plan')).toBe('pro')
    expect(destination.searchParams.get('interval')).toBe('year')
  })

  it('CAMPAIGN ABSENT — the href is left exactly as authored, with nothing invented', () => {
    // The failure this asserts against is a forwarder that writes
    // `utm_source=direct` (or an empty `utm_source=`) when it finds nothing.
    // Either would make every organic signup indistinguishable from a
    // campaign, which is the bug AGL-1731 exists to end, arriving from the
    // other side.
    landOn('https://aglyn.com/pricing')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint(CTA)

    clickOn(cta)

    expect(hrefOf(cta)).toBe(
      'https://app.aglyn.com/signup?plan=pro&interval=year',
    )
    const destination = new URL(hrefOf(cta))
    expect([...destination.searchParams.keys()]).toStrictEqual([
      'plan',
      'interval',
    ])
  })

  it('survives the walk from the landing page to the pricing page', () => {
    // The majority path, and the one the live URL alone cannot serve: nobody
    // signs up from the page the ad landed on. By the time they click, the
    // campaign is off the address bar.
    landOn('https://aglyn.com/?utm_source=hn&utm_campaign=show-hn')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })

    landOn('https://aglyn.com/pricing')
    const cta = paint(CTA)
    clickOn(cta)

    const destination = new URL(hrefOf(cta))
    expect(destination.searchParams.get('utm_source')).toBe('hn')
    expect(destination.searchParams.get('utm_campaign')).toBe('show-hn')
  })

  it('reaches a rich-text anchor React never rendered', () => {
    // The population this listener exists for. A besigner rich-text or Custom
    // HTML link is a plain DOM anchor written with `dangerouslySetInnerHTML`
    // and has no React handler at all, so an `AppLink` prop would miss it.
    landOn('https://aglyn.com/?utm_source=partner&utm_medium=referral')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const inline = paint(
      '<p>Ready? <a id="target" href="https://app.aglyn.com/signup">sign up here</a>.</p>',
    )

    clickOn(inline)

    expect(new URL(hrefOf(inline)).searchParams.get('utm_source')).toBe(
      'partner',
    )
  })

  it('decorates before a middle-click or a copy-link, which never fire click', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint(CTA)

    pointerDownOn(cta)

    expect(new URL(hrefOf(cta)).searchParams.get('utm_source')).toBe('google')
  })

  it('does not accumulate when pointerdown and click both fire', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint(CTA)

    pointerDownOn(cta)
    const afterPointer = hrefOf(cta)
    clickOn(cta)
    clickOn(cta)

    expect(hrefOf(cta)).toBe(afterPointer)
    expect(new URL(hrefOf(cta)).searchParams.getAll('utm_source')).toStrictEqual(
      ['google'],
    )
  })
})

describe('what is never decorated', () => {
  beforeEach(() => {
    landOn('https://aglyn.com/?utm_source=google&utm_medium=cpc')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
  })

  it('leaves a third-party link alone', () => {
    // Decorating an outbound link would hand our campaign labels — which name
    // our spend and our partners — to someone else's analytics.
    const outbound = paint('<a id="target" href="https://github.com/aglyn">GitHub</a>')

    clickOn(outbound)

    expect(hrefOf(outbound)).toBe('https://github.com/aglyn')
  })

  it('leaves a link on the marketing site itself alone', () => {
    // Internal links keep clean URLs: `utm_*` on an internal hop restarts GA's
    // own campaign attribution on a page the visitor never arrived at from an
    // ad, and puts tracking cruft in the address bar for no gain.
    const internal = paint('<a id="target" href="/pricing">Pricing</a>')

    clickOn(internal)

    expect(hrefOf(internal)).toBe('/pricing')
  })

  it('leaves a mailto alone', () => {
    const mail = paint('<a id="target" href="mailto:sales@aglyn.com">Sales</a>')

    clickOn(mail)

    expect(hrefOf(mail)).toBe('mailto:sales@aglyn.com')
  })

  it('never breaks a link whose href the URL parser rejects', () => {
    const broken = paint('<a id="target" href="http://[::1">Broken</a>')

    expect(() => clickOn(broken)).not.toThrow()
    expect(hrefOf(broken)).toBe('http://[::1')
  })

  it('does nothing at all when the caller supplies no console origin', () => {
    // A self-host install with the variable unset must not fall back to
    // `app.aglyn.com` and start decorating links to someone else's console.
    resetCampaignForwarding()
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: '' })
    const cta = paint('<a id="target" href="https://app.aglyn.com/signup">Go</a>')

    clickOn(cta)

    expect(hrefOf(cta)).toBe('https://app.aglyn.com/signup')
  })
})

describe('whose campaign wins', () => {
  it('the VISITOR beats a campaign an author typed into the button', () => {
    // A static authored `utm_source=google` is worse than none: it attributes
    // every clicker to Google whatever their real origin. The visitor's own
    // inbound campaign is the only one that describes a real event.
    landOn('https://aglyn.com/?utm_source=hn&utm_medium=referral')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint(
      '<a id="target" href="https://app.aglyn.com/signup?utm_source=google&utm_medium=cpc&utm_campaign=always-on">Go</a>',
    )

    clickOn(cta)

    const destination = new URL(hrefOf(cta))
    expect(destination.searchParams.get('utm_source')).toBe('hn')
    expect(destination.searchParams.get('utm_medium')).toBe('referral')
    // WHOLESALE, not key by key: the author's `utm_campaign` must not be
    // married to the visitor's `utm_source`. That row would describe a
    // campaign nobody ran.
    expect(destination.searchParams.get('utm_campaign')).toBeNull()
  })

  it('the FIRST touch of the visit beats a later one', () => {
    // Last touch answers a different question and would disagree with GA4's
    // own session attribution.
    landOn('https://aglyn.com/?utm_source=hn')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })

    landOn('https://aglyn.com/pricing?utm_source=newsletter')
    const cta = paint('<a id="target" href="https://app.aglyn.com/signup">Go</a>')
    clickOn(cta)

    expect(new URL(hrefOf(cta)).searchParams.get('utm_source')).toBe('hn')
  })

  it('an authored campaign survives when the visitor brought none', () => {
    landOn('https://aglyn.com/pricing')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint(
      '<a id="target" href="https://app.aglyn.com/signup?utm_source=newsletter">Go</a>',
    )

    clickOn(cta)

    expect(hrefOf(cta)).toBe(
      'https://app.aglyn.com/signup?utm_source=newsletter',
    )
  })
})

describe('consent, and the three states of it', () => {
  it('UNRESOLVED is not denied — nothing is stored while the answer is unknown', () => {
    // `strictNullChecks` is off repo-wide, so `false` and "not yet" are both
    // falsy and collapse into each other unless something holds them apart.
    // Failing closed here costs an attribution; failing open writes to a
    // visitor's device before they have answered.
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(null)

    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBeNull()
    expect(readVisitCampaign()).toStrictEqual({ status: 'none' })
  })

  it('DENIED stores nothing', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(false)

    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBeNull()
  })

  it('refuses a DIRECT request to remember, denied or merely undecided', () => {
    // The setter reaches the store through one door and this is the other one.
    // Asserting only through the setter left the guard inside
    // `rememberVisitCampaign` unexecuted: a mutation that deleted it kept the
    // whole suite green, because a denial takes the `removeItem` branch and
    // never calls this function at all.
    landOn('https://aglyn.com/?utm_source=google')

    setCampaignForwardingConsent(false)
    expect(rememberVisitCampaign()).toBeNull()
    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBeNull()

    resetCampaignForwarding()
    setCampaignForwardingConsent(null)
    expect(rememberVisitCampaign()).toBeNull()
    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBeNull()
  })

  it('GRANTED stores the first touch, in the canonical wire form', () => {
    landOn(
      'https://aglyn.com/?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch',
    )
    setCampaignForwardingConsent(true)

    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBe(
      'utm_source=google&utm_medium=cpc&utm_campaign=sept-launch',
    )
  })

  it('a WITHDRAWAL drops what was stored, rather than merely ignoring it', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(true)
    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).not.toBeNull()

    setCampaignForwardingConsent(false)

    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBeNull()
  })

  it('the live URL still forwards without any consent at all — it writes nothing', () => {
    // Tier 1. Reading the parameters of the page the visitor asked for is not
    // storage access, so there is nothing here to grant; a visitor who
    // declined analytics and converts from the landing page is still
    // attributable, and no byte was left on their device to do it.
    landOn('https://aglyn.com/pricing?utm_source=google&utm_medium=cpc')
    setCampaignForwardingConsent(false)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint('<a id="target" href="https://app.aglyn.com/signup">Go</a>')

    clickOn(cta)

    expect(new URL(hrefOf(cta)).searchParams.get('utm_source')).toBe('google')
    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBeNull()
  })

  it('a declined visitor who walks to /pricing forwards nothing, rather than a guess', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(false)
    installCampaignForwarding({ consoleOrigin: CONSOLE })

    landOn('https://aglyn.com/pricing')
    const cta = paint('<a id="target" href="https://app.aglyn.com/signup">Go</a>')
    clickOn(cta)

    expect(hrefOf(cta)).toBe('https://app.aglyn.com/signup')
  })
})

/**
 * Break `sessionStorage` the way a privacy mode does — the property access
 * itself throws, not merely its methods. `jest.spyOn` cannot reach it: jsdom's
 * `Storage` is an exotic proxy object and its methods are not configurable.
 */
function withBrokenSessionStorage(body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('storage disabled')
    },
  })
  try {
    body()
  } finally {
    if (original) Object.defineProperty(window, 'sessionStorage', original)
    else delete (window as unknown as Record<string, unknown>)['sessionStorage']
  }
}

/**
 * The other way a store breaks: it is present and hands back a `getItem` that
 * throws. A different branch from the one above, and asserting only the first
 * left the second unexecuted — a mutation that collapsed the `getItem` catch
 * into "no campaign" kept the whole suite green.
 */
function withThrowingGetItem(body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  const fake = {
    getItem() {
      throw new Error('storage disabled')
    },
    setItem() {
      throw new Error('storage disabled')
    },
    removeItem() {
      /* a no-op, so the failure under test is the READ */
    },
  }
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get: () => fake,
  })
  try {
    body()
  } finally {
    if (original) Object.defineProperty(window, 'sessionStorage', original)
    else delete (window as unknown as Record<string, unknown>)['sessionStorage']
  }
}

describe('an unreadable store is not an organic visitor', () => {
  it('reports `unreadable` when the READ itself throws', () => {
    withThrowingGetItem(() => {
      setCampaignForwardingConsent(true)

      expect(readVisitCampaign()).toStrictEqual({ status: 'unreadable' })
      expect(readVisitCampaign()).not.toStrictEqual({ status: 'none' })
    })
  })

  it('falls through to the live URL when the READ throws', () => {
    landOn('https://aglyn.com/?utm_source=google')
    withThrowingGetItem(() => {
      setCampaignForwardingConsent(true)

      expect(campaignToForward()).toStrictEqual({ source: 'google' })
    })
  })

  it('reports `unreadable`, which is a third answer and not `none`', () => {
    // The whole reason the read is a tri-state. A `catch` returning null would
    // say "this visitor named no campaign" — a measured zero standing in for a
    // failure, which is how attribution silently becomes 100% direct.
    withBrokenSessionStorage(() => {
      setCampaignForwardingConsent(true)

      expect(readVisitCampaign()).toStrictEqual({ status: 'unreadable' })
      expect(readVisitCampaign()).not.toStrictEqual({ status: 'none' })
    })
  })

  it('falls through to the live URL rather than to silence', () => {
    landOn('https://aglyn.com/?utm_source=google')
    withBrokenSessionStorage(() => {
      setCampaignForwardingConsent(true)

      expect(campaignToForward()).toStrictEqual({ source: 'google' })
    })
  })
})

describe('the stored value is re-parsed, never trusted', () => {
  it('refuses an address someone put in the store by hand', () => {
    // `sessionStorage` is writable by anything on the page, so a stored string
    // may claim no more than an inbound URL could.
    setCampaignForwardingConsent(true)
    window.sessionStorage.setItem(
      CAMPAIGN_VISIT_STORAGE_KEY,
      'utm_source=someone@example.com&utm_campaign=real',
    )

    expect(readVisitCampaign()).toStrictEqual({
      status: 'campaign',
      campaign: { campaign: 'real' },
    })
  })

  it('drops a key the allowlist does not name', () => {
    setCampaignForwardingConsent(true)
    window.sessionStorage.setItem(
      CAMPAIGN_VISIT_STORAGE_KEY,
      'utm_source=google&gclid=abc123&utm_term=cheap+website',
    )

    expect(readVisitCampaign()).toStrictEqual({
      status: 'campaign',
      campaign: { source: 'google' },
    })
  })

  it('never replaces a first touch already remembered', () => {
    landOn('https://aglyn.com/?utm_source=hn')
    setCampaignForwardingConsent(true)

    landOn('https://aglyn.com/?utm_source=newsletter')
    expect(rememberVisitCampaign()).toStrictEqual({ source: 'hn' })
    expect(window.sessionStorage.getItem(CAMPAIGN_VISIT_STORAGE_KEY)).toBe(
      'utm_source=hn',
    )
  })
})

describe('decorateCampaignHref, decided rather than guessed', () => {
  it('returns null for "leave it alone", distinctly from an unchanged string', () => {
    expect(
      decorateCampaignHref('https://app.aglyn.com/signup', 'https://aglyn.com/', CONSOLE, null),
    ).toBeNull()
    expect(
      decorateCampaignHref('https://github.com/aglyn', 'https://aglyn.com/', CONSOLE, {
        source: 'google',
      }),
    ).toBeNull()
    expect(
      decorateCampaignHref(
        'https://app.aglyn.com/signup?utm_source=google',
        'https://aglyn.com/',
        CONSOLE,
        { source: 'google' },
      ),
    ).toBeNull()
  })

  it('honours a console origin that is not app.aglyn.com', () => {
    // A self-host install, and the localhost console every drive here runs on.
    expect(
      decorateCampaignHref(
        'http://localhost:4200/signup',
        'http://localhost:4300/',
        'http://localhost:4200',
        { source: 'google', medium: 'cpc' },
      ),
    ).toBe('http://localhost:4200/signup?utm_source=google&utm_medium=cpc')
  })
})

describe('installation', () => {
  it('installs once, however many times render calls it', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(true)
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    installCampaignForwarding({ consoleOrigin: CONSOLE })
    const cta = paint('<a id="target" href="https://app.aglyn.com/signup">Go</a>')

    clickOn(cta)

    expect(hrefOf(cta)).toBe('https://app.aglyn.com/signup?utm_source=google')
  })

  it('stops when uninstalled', () => {
    landOn('https://aglyn.com/?utm_source=google')
    setCampaignForwardingConsent(true)
    const uninstall = installCampaignForwarding({ consoleOrigin: CONSOLE })
    uninstall()
    const cta = paint('<a id="target" href="https://app.aglyn.com/signup">Go</a>')

    clickOn(cta)

    expect(hrefOf(cta)).toBe('https://app.aglyn.com/signup')
  })
})
