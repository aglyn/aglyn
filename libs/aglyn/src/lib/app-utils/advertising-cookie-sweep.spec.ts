/**
 * @jest-environment jsdom
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
 * AGL-2486 — withdrawing ADVERTISING actually deletes the advertising cookies.
 *
 * `_gcl_au` is written by the GA4 gtag once `ad_storage` is granted, and until
 * now nothing deleted it, on any surface, ever:
 *
 * - `ANALYTICS_COOKIE_PREFIXES` is `['_ga', '_gid']`, and `_gcl_au` starts
 *   with neither.
 * - `revokeAdvertisingTags` iterates vendors and skips any with no MARKED
 *   script element. Google has never had one — the tag belongs to
 *   `site-analytics.tsx` — so the loop skipped it entirely.
 * - That function is installed only on our own marketing host anyway, so on a
 *   customer site, where the advertising question is equally available,
 *   withdrawal ran no advertising sweep at all.
 *
 * The fix registers Google as a SWEEP-ONLY vendor and moves the sweep onto
 * `storeVisitorConsent`, the one path every site shares.
 *
 * The asymmetry these tests exist to hold is the dangerous one:
 * **withdrawing advertising must not take analytics with it, and withdrawing
 * analytics must not leave advertising behind.** A sweep that is too wide
 * silently breaks measurement a visitor consented to; one that is too narrow
 * is the defect. Both directions are pinned.
 */

import {
  ADVERTISING_COOKIE_PREFIXES,
  ANALYTICS_COOKIE_PREFIXES,
  storeVisitorConsent,
} from './visitor-consent'
import {
  ADVERTISING_VENDORS,
  GOOGLE_ADS_VENDOR,
  META_PIXEL_VENDOR,
  resolveAdvertisingTags,
  revokeAdvertisingTags,
} from './advertising-tags'
import { PLATFORM_GA_MEASUREMENT_ID } from './platform-marketing-host'

const HOST_ID = 'host-1'

/** Everything a granted GA4 + Ads visitor carries, plus a bystander. */
function plantCookies() {
  // Analytics — must SURVIVE an advertising-only withdrawal.
  document.cookie = '_ga=GA1.1.1234567890.1700000000; path=/'
  document.cookie = '_ga_TEST1234=GS1.1.1700000000; path=/'
  document.cookie = '_gid=GA1.1.99; path=/'
  // Advertising — must GO.
  document.cookie = '_gcl_au=1.1.ytss.1700000000; path=/'
  document.cookie = '_gac_UA-1=1.170; path=/'
  // Strictly necessary, and never any sweep's business.
  document.cookie = 'aglyn_cart_x=abc; path=/'
}

const cookieNames = (): string[] =>
  String(document.cookie ?? '')
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter(Boolean)
    .sort()

beforeEach(() => {
  for (const name of cookieNames()) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
  try {
    window.localStorage.clear()
  } catch {
    // Nothing stored is the same starting point.
  }
})

describe('the prefixes cannot reach across categories (AGL-2486)', () => {
  // Guarding the sweep at its narrowest point. `clearCookiesWithPrefixes` is
  // `startsWith`, so a prefix of `_ga` would have swallowed all of analytics.
  it('no advertising prefix matches an analytics cookie name', () => {
    for (const name of ['_ga', '_ga_TEST1234', '_gid']) {
      for (const prefix of ADVERTISING_COOKIE_PREFIXES) {
        expect(name.startsWith(prefix)).toBe(false)
      }
    }
  })

  it('the advertising prefixes DO match the cookies they are for', () => {
    // Anti-vacuity: the assertion above is also true of prefixes that match
    // nothing at all.
    expect(
      ADVERTISING_COOKIE_PREFIXES.some((p) => '_gcl_au'.startsWith(p)),
    ).toBe(true)
  })

  it('`_gac_<id>` is ANALYTICS-owned, not advertising', () => {
    // Deliberate, and it cost a red to learn. `_gac_*` is written under the
    // analytics grant, so putting it in the advertising set made every
    // analytics-only GRANT delete it — on a site that never asks the
    // advertising question `stored.advertising` is always false, so the sweep
    // fired on the way IN. `consent-cookie-cleanup.spec.tsx` caught it.
    expect(
      ADVERTISING_COOKIE_PREFIXES.some((p) => '_gac_UA-1'.startsWith(p)),
    ).toBe(false)
    expect(ANALYTICS_COOKIE_PREFIXES.some((p) => '_gac_UA-1'.startsWith(p))).toBe(
      true,
    )
  })

  it('analytics prefixes never reached `_gcl_au` — the original defect', () => {
    expect(
      ANALYTICS_COOKIE_PREFIXES.some((p) => '_gcl_au'.startsWith(p)),
    ).toBe(false)
  })
})

describe('storeVisitorConsent sweeps by category (AGL-2486)', () => {
  it('withdrawing ADVERTISING deletes it and LEAVES ANALYTICS RUNNING', () => {
    plantCookies()
    // Accepted, analytics yes, advertising no — the visitor unticked one box.
    storeVisitorConsent(HOST_ID, { status: 'accepted', advertising: false })
    const names = cookieNames()
    expect(names).not.toContain('_gcl_au')
    // The half that a too-wide sweep would have destroyed. `_gac_UA-1` is
    // here on purpose: it is written under the ANALYTICS grant, which this
    // visitor still has, so an advertising withdrawal is not entitled to it.
    expect(names).toContain('_ga')
    expect(names).toContain('_ga_TEST1234')
    expect(names).toContain('_gid')
    expect(names).toContain('_gac_UA-1')
    expect(names).toContain('aglyn_cart_x')
  })

  it('withdrawing ANALYTICS takes advertising with it, not the reverse', () => {
    plantCookies()
    // A refusal cannot carry an advertising grant, so this is both categories
    // going at once — and the advertising cookies must not be left behind by
    // the analytics-only sweep that used to be the whole story.
    storeVisitorConsent(HOST_ID, { status: 'declined', advertising: true })
    const names = cookieNames()
    expect(names).not.toContain('_ga')
    expect(names).not.toContain('_ga_TEST1234')
    expect(names).not.toContain('_gid')
    expect(names).not.toContain('_gcl_au')
    expect(names).not.toContain('_gac_UA-1')
    expect(names).toContain('aglyn_cart_x')
  })

  it('granting BOTH sweeps nothing', () => {
    plantCookies()
    storeVisitorConsent(HOST_ID, { status: 'accepted', advertising: true })
    // The control that proves the two above are the sweep firing, not the
    // store clearing cookies indiscriminately.
    expect(cookieNames()).toEqual([
      '_ga',
      '_ga_TEST1234',
      '_gac_UA-1',
      '_gcl_au',
      '_gid',
      'aglyn_cart_x',
    ])
  })

  it('gpc-opt-out sweeps both categories', () => {
    plantCookies()
    storeVisitorConsent(HOST_ID, { status: 'gpc-opt-out' })
    const names = cookieNames()
    expect(names).toEqual(['aglyn_cart_x'])
  })
})

describe('Google is a registered sweep-only vendor (AGL-2486)', () => {
  it('revokeAdvertisingTags sweeps Google with NO script element present', () => {
    // The exact shape of the bug: the vendor loop gated every vendor on a
    // marked element, and Google has never had one, so this returned without
    // touching a cookie.
    plantCookies()
    const acted = revokeAdvertisingTags('example.com')
    expect(acted).toContain(GOOGLE_ADS_VENDOR.id)
    expect(cookieNames()).not.toContain('_gcl_au')
    expect(cookieNames()).toContain('_ga')
  })

  /**
   * The host has to be the PLATFORM marketing host, carrying our real GA id.
   * With any other id `resolveAdvertisingTags` returns `[]` at its first
   * condition and never reaches the vendor loop — so a test written with a
   * `G-TEST1234` host passes without exercising a single line of what it
   * claims to check. The Meta assertion below is what proves the loop ran.
   */
  const platformHost = {
    analytics: {
      gaMeasurementId: PLATFORM_GA_MEASUREMENT_ID,
      adTags: {
        [GOOGLE_ADS_VENDOR.id]: '12345678',
        [META_PIXEL_VENDOR.id]: '123456789012345',
      },
    },
    consent: { advertising: true },
  }
  const grantedRecord = {
    v: 1 as const,
    at: Date.now(),
    status: 'accepted' as const,
    analytics: true,
    advertising: true,
    country: 'US',
  }
  const production = { nodeEnv: 'production', deployEnv: 'production' }

  it('is never MOUNTED, even if a host configures an account id for it', () => {
    const tags = resolveAdvertisingTags(
      platformHost as never,
      grantedRecord,
      production,
    )
    // It has no script, so a stray `adTags` entry must not conjure one.
    expect(tags.some((t) => t.vendor.id === GOOGLE_ADS_VENDOR.id)).toBe(false)
  })

  it('CONTROL — the same call DOES mount Meta, so the loop was reached', () => {
    // Without this, the assertion above is satisfied by `resolveAdvertisingTags`
    // bailing out early for an unrelated reason, which is exactly how it was
    // first written.
    const tags = resolveAdvertisingTags(
      platformHost as never,
      grantedRecord,
      production,
    )
    expect(tags.map((t) => t.vendor.id)).toEqual([META_PIXEL_VENDOR.id])
  })

  it('every vendor we MOUNT still declares its full teardown contract', () => {
    // The invariant the optional fields could otherwise erode: only a
    // sweep-only vendor is excused, and nothing else may be added load-only.
    for (const vendor of ADVERTISING_VENDORS) {
      expect(vendor.cookiePrefixes.length).toBeGreaterThan(0)
      if (vendor.sweepOnly) continue
      expect(vendor.accountIdPattern).toBeDefined()
      expect(vendor.scriptSrc).toBeTruthy()
      expect(vendor.scriptMatch).toBeTruthy()
      expect(typeof vendor.bootSnippet).toBe('function')
      expect(typeof vendor.setConsent).toBe('function')
    }
  })

  it('CONTROL — the loop above iterates something meaningful', () => {
    // It used to assert one vendor of EACH shape, which stopped being true
    // when Google gained a loader (AGL-1152): a site wanting Google Ads and
    // no analytics had no route, so `sweepOnly` was the wrong answer for it.
    // No vendor is sweep-only today; the shape stays supported because a
    // vendor we can tear down but not load is a real thing to be.
    expect(ADVERTISING_VENDORS.length).toBeGreaterThanOrEqual(3)
    expect(ADVERTISING_VENDORS.every((v) => !v.sweepOnly)).toBe(true)
  })

  it('only an alwaysSweep vendor clears cookies with NO element present', () => {
    /*
     * I got this wrong once and the guards caught it, so the reasoning is
     * written down rather than left in the diff.
     *
     * The element check is an OWNERSHIP test, not a liveness one. A pixel we
     * did not load is running on a basis that is not ours to withdraw — a
     * customer's own Custom HTML, on their own site, under their own notice —
     * so its cookies are not ours to clear either. `advertising-tag-gate`
     * case (e) pins that from the other side.
     *
     * `alwaysSweep` is the narrow exception, and it is a property of the
     * COOKIE: `_gcl_*` is written by any Google tag, including a GTM
     * container we never marked, which is exactly why it survived every
     * withdrawal until AGL-2486. Google gaining a loader must not quietly
     * take that back.
     */
    plantCookies()
    for (const vendor of ADVERTISING_VENDORS) {
      for (const prefix of vendor.cookiePrefixes) {
        document.cookie = `${prefix}=1; path=/`
      }
    }
    revokeAdvertisingTags('example.com')
    const after = cookieNames()

    for (const vendor of ADVERTISING_VENDORS) {
      for (const prefix of vendor.cookiePrefixes) {
        if (vendor.alwaysSweep || vendor.sweepOnly) {
          expect([vendor.label, prefix, after.includes(prefix)]).toEqual([
            vendor.label,
            prefix,
            false,
          ])
        } else {
          // Untouched: nothing of ours loaded it.
          expect([vendor.label, prefix, after.includes(prefix)]).toEqual([
            vendor.label,
            prefix,
            true,
          ])
        }
      }
    }
  })
})
