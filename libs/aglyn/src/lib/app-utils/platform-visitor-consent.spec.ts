/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://app.aglyn.com/"}
 *
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
 * The console's consent decision, and the three things it answers differently
 * from a customer site.
 *
 * This module is deliberately thin — every grant rule, record shape and sweep
 * belongs to `visitor-consent.ts` — so what is worth pinning is exactly the
 * seams: which region set it answers over, what it writes (and does not write)
 * for a first-time visitor, that the advertising question is DERIVED from what
 * this surface declares rather than set by hand beside it, and that an answer
 * given on one of the console's hostnames reaches the other.
 *
 * PLANTED REDS (all four run, counts observed):
 *  1. Answer the posture over the TENANT's `PRIOR_CONSENT_COUNTRY_CODES`
 *     instead of the platform's → 1 fails, the Switzerland case, and it is the
 *     only difference between the two sets.
 *  2. Record an `accepted` default in the opt-in branch of
 *     `decidePlatformConsent` → 1 fails, and it is the case that says no
 *     consent is fabricated for a visitor who never gave one.
 *  3. Drop the `isExplicitConsentStatus` clause so GPC overwrites an explicit
 *     accept → 1 fails, and it is the override CONTROL rather than the GPC
 *     case, which is the pair working: the signal still opts out, it just
 *     stopped losing to a real choice.
 *  4. Hardcode `platformAsksAboutAdvertising` to `true` → 2 fail, the
 *     derivation and the "grants nothing today" case together.
 *
 * PLANTED REDS for the cross-hostname mirror (all four run, counts observed):
 *  5. Drop the mirror write from `storePlatformConsent` → 2 fail, the refusal
 *     and the accept; the "does not share" control stays green, which is what
 *     says the two are not the same assertion.
 *  6. Let `hydratePlatformConsentFromMirror` overwrite a local record → 1
 *     fails, and it is the one about a fresh answer surviving a stale sibling.
 *  7. Default sharing to ON → 1 fails, the polarity case, and only it: every
 *     other case sets the flag itself, so without that case the default could
 *     be flipped unnoticed.
 *  8. Return `true` from the hydrate without re-reading through the shared
 *     reader → 1 fails, the unreadable-mirror case. That is the whole reason
 *     the value goes through storage instead of being parsed here.
 *
 * PLANTED REDS for the region resolver (all four run, counts observed):
 *  9. Restore the defect exactly — cache every answer AND read a cached null
 *     as a hit → 5 fail, the headline case among them. Worth stating that it
 *     takes BOTH halves: the write guard and the read guard each cover for the
 *     other, which is deliberate, because the read guard is also what heals a
 *     tab that cached a null before this rule existed.
 * 10. Cache the answer unconditionally, read guard intact → 3 fail, all of
 *     them time-zone cases: a cached null starves the fallback of the "no
 *     header" state it exists for.
 * 11. Read a cached null as a hit, write guard intact → 1 fails, the
 *     older-build case, which is the migration this has to survive.
 * 12. Consult the time zone BEFORE the endpoint → 1 fails, and it is the
 *     control that says a header outranks a clock.
 */

/**
 * The zone the browser reports, driven per case.
 *
 * Only the READING is mocked; `geoHintFromTimeZone` stays real, so these cases
 * exercise the actual zone-to-posture mapping rather than a stub of it. The
 * jest process pins `TZ` before any worker forks and V8 realizes the zone when
 * the context is created, so a zone cannot be moved from inside a test at all.
 */
let mockTimeZone = ''
jest.mock('./timezone-geo-hint', () => ({
  ...jest.requireActual('./timezone-geo-hint'),
  readBrowserTimeZone: () => mockTimeZone,
}))

import {
  PLATFORM_CONSENT_DEFAULT_COMMANDS,
  PLATFORM_PRIOR_CONSENT_REGIONS,
} from './platform-consent-default'
import {
  decidePlatformConsent,
  hydratePlatformConsentFromMirror,
  PLATFORM_CONSENT_COOKIE,
  platformAdvertisingAllowed,
  platformAnalyticsAllowed,
  platformAsksAboutAdvertising,
  PLATFORM_CONSENT_SUBJECT,
  platformConsentPosture,
  platformRefusalStatus,
  readPlatformConsent,
  PLATFORM_CONSENT_REGION_CACHE_KEY,
  resetPlatformConsentPriming,
  resolvePlatformConsentRegion,
  setPlatformConsentSharesAcrossSubdomains,
  storePlatformConsent,
} from './platform-visitor-consent'
import {
  PRIOR_CONSENT_COUNTRY_CODES,
  visitorConsentStorageKey,
} from './visitor-consent'

const KEY = visitorConsentStorageKey(PLATFORM_CONSENT_SUBJECT)

function serveRegion(country: string | null): void {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ country }),
  }))
}

function setGlobalPrivacyControl(on: boolean): void {
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    value: on ? true : undefined,
    configurable: true,
  })
}

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim()
    if (!name) continue
    document.cookie = `${name}=; Max-Age=0; Path=/`
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.aglyn.com`
  }
}

/**
 * Land on the SIBLING origin: same cookie jar, empty `localStorage`.
 *
 * jsdom gives one document per suite, so a second origin cannot be visited —
 * but the only thing that differs between `app.` and `auth.` is which store
 * has the record, and that is exactly what this drops. The cookie survives,
 * as it would in the browser.
 */
function arriveOnSiblingHost(): void {
  window.localStorage.clear()
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearCookies()
  setGlobalPrivacyControl(false)
  resetPlatformConsentPriming()
  // An unrecognized zone, which the hint answers `null` for — i.e. no signal,
  // exactly like a missing header. Cases that want the fallback say so.
  mockTimeZone = 'Etc/GMT+3'
  // `resetPlatformConsentPriming` switches sharing back OFF, which is the
  // module's own default; the cases that need it say so.
})

describe('the console consent posture', () => {
  it('asks first in Switzerland, which the TENANT set does not', () => {
    // The one deliberate disagreement between the two country sets, and the
    // reason this module answers over its own. Aglyn's brief treats CH as
    // prior opt-in for Aglyn's OWN surfaces; widening the tenant set would
    // change customers' compliance posture on their behalf, which is the thing
    // that work is scoped out of.
    expect(PRIOR_CONSENT_COUNTRY_CODES.has('CH')).toBe(false)
    expect(platformConsentPosture('CH')).toBe('opt-in')
  })

  it('asks first across the UK, the EU and the EEA', () => {
    for (const code of ['GB', 'DE', 'FR', 'IE', 'NO', 'IS', 'LI', 'GI']) {
      expect(platformConsentPosture(code)).toBe('opt-in')
    }
    // The set is READ, not restated: a country that leaves the EU is edited
    // once, in `platform-consent-default.ts`, and this follows.
    expect(PLATFORM_PRIOR_CONSENT_REGIONS).toContain('DE')
  })

  it('applies implied consent everywhere else — the control', () => {
    for (const code of ['US', 'CA', 'BR', 'AU', 'JP', 'IN']) {
      expect(platformConsentPosture(code)).toBe('opt-out')
    }
  })

  it('treats an unknown region as prior-consent', () => {
    expect(platformConsentPosture(null)).toBe('opt-in')
    expect(platformConsentPosture('')).toBe('opt-in')
  })
})

describe('resolving a first-time console visitor', () => {
  it('records implied consent outside the prior-consent regions', async () => {
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.posture).toBe('opt-out')
    expect(resolved.stored).toMatchObject({ status: 'implied', analytics: true })
    expect(platformAnalyticsAllowed()).toBe(true)
  })

  it('records NOTHING inside them, and grants nothing', async () => {
    serveRegion('DE')
    const resolved = await decidePlatformConsent()
    expect(resolved.posture).toBe('opt-in')
    expect(resolved.stored).toBeNull()
    // The half that matters for an existing user with no record: resolution
    // must not manufacture one. An `accepted` written on their behalf here
    // would be a consent nobody gave.
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(platformAnalyticsAllowed()).toBe(false)
  })

  it('honours GPC as an opt-out even where consent would be implied', async () => {
    setGlobalPrivacyControl(true)
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.stored?.status).toBe('gpc-opt-out')
    expect(platformAnalyticsAllowed()).toBe(false)
  })

  it('lets an explicit accept outrank GPC — the control for the case above', async () => {
    // A signal is a default; a specific, informed choice is not. Without this
    // the GPC case above would also pass against code that simply never grants.
    storePlatformConsent({ status: 'accepted', country: 'US' })
    setGlobalPrivacyControl(true)
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.stored?.status).toBe('accepted')
    expect(platformAnalyticsAllowed()).toBe(true)
  })

  it('keeps a stored refusal without asking the region endpoint again', async () => {
    storePlatformConsent({ status: 'declined', country: 'DE' })
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.stored?.status).toBe('declined')
    expect(platformAnalyticsAllowed()).toBe(false)
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled()
  })
})

describe('withdrawal', () => {
  it('drops the grant and the analytics identifiers', async () => {
    serveRegion('US')
    await decidePlatformConsent()
    document.cookie = '_ga=GA1.1.1.1'
    document.cookie = '_ga_YW5PG16YTM=GS1.1.1'

    storePlatformConsent({ status: 'opted-out', country: 'US' })

    expect(platformAnalyticsAllowed()).toBe(false)
    expect(readPlatformConsent()?.status).toBe('opted-out')
    // The sweep is the shared writer's, not this module's — asserted because
    // "stops adding" and "cleans up" are different promises and only the
    // second one is the one that was made.
    expect(document.cookie).not.toContain('_ga=')
    expect(document.cookie).not.toContain('_ga_YW5PG16YTM')
  })

  it('names the refusal by how the visitor got here', () => {
    // `opted-out` for someone defaulted in, `declined` for someone asked
    // first. Same gate, different record — and the difference is the answer to
    // "how many visitors were tracked before they said no".
    expect(
      platformRefusalStatus(
        { v: 1, at: 0, status: 'implied', analytics: true },
        null,
      ),
    ).toBe('opted-out')
    expect(platformRefusalStatus(null, 'opt-in')).toBe('declined')
    expect(platformRefusalStatus(null, 'opt-out')).toBe('opted-out')
  })
})

describe('the advertising question on this surface', () => {
  it('is asked only where the declaration grants ad storage somewhere', () => {
    // DERIVED, not declared twice. The predicate and the consent-mode defaults
    // are two statements about the same fact, and a hand-kept flag beside them
    // is how a surface comes to ask about a category it denies — or to deny
    // one it has quietly started using.
    const declarationGrantsAds = PLATFORM_CONSENT_DEFAULT_COMMANDS.some(
      (command) => command.ad_storage !== 'denied',
    )
    expect(platformAsksAboutAdvertising()).toBe(declarationGrantsAds)
  })

  it('follows implied consent outside the prior-consent regions', async () => {
    // Aglyn advertises and retargets on its own surfaces, so a US visitor is
    // measured for advertising from the first visit, exactly as they are for
    // analytics — and the persistent control is how they stop it.
    serveRegion('US')
    await decidePlatformConsent()
    expect(readPlatformConsent()?.advertising).toBe(true)
    expect(platformAdvertisingAllowed()).toBe(true)
  })

  it('a refusal withdraws it, and outranks the implied grant', () => {
    // The half that matters more than the grant: a declined record must beat
    // the regional default, or the opt-out control is decoration.
    storePlatformConsent({ status: 'declined', country: 'US' })
    expect(platformAdvertisingAllowed()).toBe(false)
  })

  it('grants nothing in a prior-consent region until the visitor accepts', async () => {
    /*
     * THE CASE THAT MUST NOT MOVE. A European visitor gets no advertising
     * signal on the strength of a regional default, and only an explicit
     * acceptance carrying `advertising` turns it on.
     */
    serveRegion('DE')
    await decidePlatformConsent()
    expect(readPlatformConsent()?.advertising ?? false).toBe(false)
    expect(platformAdvertisingAllowed()).toBe(false)

    storePlatformConsent({ status: 'accepted', country: 'DE', advertising: true })
    expect(platformAdvertisingAllowed()).toBe(true)
  })
})

describe('carrying an answer between the console hostnames', () => {
  // `app.<domain>` and `auth.<domain>` are one application on two origins —
  // interactive sign-in is delegated to the auth host for mobile visitors and
  // for every workspace subdomain — and `localStorage` is per origin. Without
  // a mirror the second host finds no record at all.

  it('carries a REFUSAL, which is the case that is not fail-safe', () => {
    // An accept that does not carry costs a second ask. A refusal that does
    // not carry is overturned: outside the prior-consent regions the sibling
    // host finds nothing, resolves the posture afresh and writes `implied`.
    setPlatformConsentSharesAcrossSubdomains(true)
    storePlatformConsent({ status: 'opted-out', country: 'US' })

    arriveOnSiblingHost()
    expect(readPlatformConsent()).toBeNull()
    expect(hydratePlatformConsentFromMirror()).toBe(true)
    expect(readPlatformConsent()?.status).toBe('opted-out')
    expect(platformAnalyticsAllowed()).toBe(false)
  })

  it('carries an accept too', () => {
    setPlatformConsentSharesAcrossSubdomains(true)
    storePlatformConsent({ status: 'accepted', country: 'DE' })

    arriveOnSiblingHost()
    expect(hydratePlatformConsentFromMirror()).toBe(true)
    expect(platformAnalyticsAllowed()).toBe(true)
  })

  it('shares NOTHING until a surface asks it to', () => {
    // The polarity, pinned on a module nobody has registered anything with —
    // the same asymmetry `originPersistenceClass` uses. Writing at the
    // registrable domain is only correct where the whole registrable domain is
    // ours, so the default has to be the narrow one; every case below sets the
    // flag, so without this the default could be flipped and none of them
    // would notice.
    let fresh: typeof import('./platform-visitor-consent')
    jest.isolateModules(() => {
      fresh = require('./platform-visitor-consent')
    })
    fresh.storePlatformConsent({ status: 'opted-out', country: 'US' })
    expect(document.cookie).not.toContain(PLATFORM_CONSENT_COOKIE)
    expect(fresh.hydratePlatformConsentFromMirror()).toBe(false)
  })

  it('carries nothing when the origin does not share — the control', () => {
    // A custom console domain answers `ephemeral`: it has no sibling console
    // origin to carry to, and its registrable domain is the customer's. Left
    // out, every case above would pass against a mirror that always wrote.
    setPlatformConsentSharesAcrossSubdomains(false)
    storePlatformConsent({ status: 'opted-out', country: 'US' })
    expect(document.cookie).not.toContain(PLATFORM_CONSENT_COOKIE)

    arriveOnSiblingHost()
    expect(hydratePlatformConsentFromMirror()).toBe(false)
    expect(readPlatformConsent()).toBeNull()
  })

  it("lets this origin's own answer win over the mirror", () => {
    // A decision made here is mirrored outward on the way in, so a local
    // record is the more recent statement by definition. Adopting over it
    // would let a stale sibling answer undo a fresh one.
    setPlatformConsentSharesAcrossSubdomains(true)
    storePlatformConsent({ status: 'opted-out', country: 'US' })
    arriveOnSiblingHost()
    storePlatformConsent({ status: 'accepted', country: 'US' })

    expect(hydratePlatformConsentFromMirror()).toBe(false)
    expect(readPlatformConsent()?.status).toBe('accepted')
  })

  it('VALIDATES the mirror rather than trusting it', () => {
    // The cookie is readable and writable by anything on the registrable
    // domain, so it is re-read through the shared reader, which re-derives
    // both grants from the status. A record claiming a grant its status
    // cannot carry adopts as the refusal it actually is.
    setPlatformConsentSharesAcrossSubdomains(true)
    document.cookie =
      `${PLATFORM_CONSENT_COOKIE}=` +
      encodeURIComponent(
        JSON.stringify({
          v: 1,
          at: 1,
          status: 'declined',
          analytics: true,
          advertising: true,
          country: 'DE',
        }),
      ) +
      '; Path=/; Domain=.aglyn.com'

    expect(hydratePlatformConsentFromMirror()).toBe(true)
    expect(readPlatformConsent()?.status).toBe('declined')
    expect(platformAnalyticsAllowed()).toBe(false)
    expect(platformAdvertisingAllowed()).toBe(false)
  })

  it('adopts nothing from an unreadable mirror', () => {
    setPlatformConsentSharesAcrossSubdomains(true)
    document.cookie = `${PLATFORM_CONSENT_COOKIE}=not-json; Path=/; Domain=.aglyn.com`
    expect(hydratePlatformConsentFromMirror()).toBe(false)
    expect(readPlatformConsent()).toBeNull()
    // And it leaves nothing behind. The reader already answers null for an
    // unreadable value, but a key holding one is what the next person
    // debugging this finds and believes.
    expect(
      window.localStorage.getItem(
        visitorConsentStorageKey(PLATFORM_CONSENT_SUBJECT),
      ),
    ).toBeNull()
  })
})

describe('resolving the region signal', () => {
  const fetchMock = () => (global as unknown as { fetch: jest.Mock }).fetch

  it('re-asks after a response with no country, and takes the next one', () => {
    // The defect this closes. A miss used to be cached as `{country: null}`
    // and read back as a hit, so ONE headerless response — a cold edge, a
    // request that skipped the proxy, a blip — pinned the strictest posture
    // for the rest of the session with nothing left to re-ask. The banner
    // could not be got rid of and analytics never resumed.
    serveRegion(null)
    return resolvePlatformConsentRegion()
      .then((first) => {
        expect(first.country).toBeNull()
        serveRegion('US')
        return resolvePlatformConsentRegion()
      })
      .then((second) => {
        expect(second.country).toBe('US')
        expect(platformConsentPosture(second.country)).toBe('opt-out')
      })
  })

  it('asks once for a country it DID resolve — the control', () => {
    // Without this, "do not cache" could be satisfied by not caching at all,
    // which is a fetch per pageview for every visitor forever.
    serveRegion('FR')
    return resolvePlatformConsentRegion()
      .then(() => resolvePlatformConsentRegion())
      .then((again) => {
        expect(again.country).toBe('FR')
        expect(fetchMock()).toHaveBeenCalledTimes(1)
      })
  })

  it('ignores a null already cached by an older build', async () => {
    // The migration case, and the one that was actually observed: a tab that
    // cached the failure before this rule existed must heal on its next
    // pageview rather than carry it to the end of the session.
    window.sessionStorage.setItem(
      PLATFORM_CONSENT_REGION_CACHE_KEY,
      JSON.stringify({ country: null }),
    )
    serveRegion('US')
    expect((await resolvePlatformConsentRegion()).country).toBe('US')
  })

  it('falls back to the time zone only when no header answers', async () => {
    // A self-hosted container behind a plain reverse proxy: no geo header on
    // any request, so every visitor would otherwise read as unlocatable and be
    // asked to opt in.
    serveRegion(null)
    mockTimeZone = 'America/Chicago'
    const region = await resolvePlatformConsentRegion()
    // No country named, because the zone cannot name one honestly — and the
    // posture does not need it.
    expect(region.country).toBeNull()
    expect(region.posture).toBe('opt-out')
  })

  it('lets a header outrank the zone — the control', async () => {
    // The zone is the LAST resort. A visitor on a US clock behind an edge that
    // reports Germany is in Germany.
    serveRegion('DE')
    mockTimeZone = 'America/Chicago'
    const region = await resolvePlatformConsentRegion()
    expect(region.country).toBe('DE')
    expect(region.posture).toBeNull()
  })

  it('keeps a European zone on the strict side, with no country claimed', async () => {
    serveRegion(null)
    mockTimeZone = 'Europe/Berlin'
    const region = await resolvePlatformConsentRegion()
    expect(region.posture).toBe('opt-in')
    // The record must not carry a country the zone only made probable.
    expect(region.country).toBeNull()
  })

  it('treats a zone it does not recognize as a missing header', async () => {
    // `null` from the hint is not permission. A visitor hiding their zone gets
    // the same answer as a visitor with no header at all.
    serveRegion(null)
    mockTimeZone = 'Etc/GMT+3'
    const region = await resolvePlatformConsentRegion()
    expect(region.posture).toBeNull()
    expect(platformConsentPosture(region.country)).toBe('opt-in')
  })

  it('never caches what the zone said', async () => {
    // It costs no request, so re-reading is free — and caching it would let a
    // guess outrank a header that appears on the very next pageview.
    serveRegion(null)
    mockTimeZone = 'America/Chicago'
    await resolvePlatformConsentRegion()
    expect(
      window.sessionStorage.getItem(PLATFORM_CONSENT_REGION_CACHE_KEY),
    ).toBeNull()
  })
})
