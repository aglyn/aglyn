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
 * The server half of the leaving notice (AGL-3452): who is in the window,
 * which hosts are exempt, which addresses a page is signed for, and the
 * signature that keeps the notice from vouching for anyone else's links.
 */

import {
  collectLeavingDestinations,
  LEAVING_NOTICE_DAYS,
  leavingNoticeConfig,
  leavingNoticeEndsAt,
  leavingNoticeHosts,
  leavingNoticeSignatures,
  signLeavingDestination,
  verifyLeavingDestination,
} from './leaving-notice'
import { orgAgeDays, orgCreatedMs } from './org-age'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 1, 12)
const SIX_DAYS_AGO = NOW - 6 * DAY
const A_MONTH_AGO = NOW - 30 * DAY

const SITE = { subdomain: 'juenes', cname: 'juenes.example.com' }
const HOST_ID = 'host-juenes'
const HARVESTER = 'https://secure-docs.example.net/login'

/** A Firestore Timestamp as the Admin SDK hands it back. */
const timestamp = (ms: number) => ({
  toMillis: () => ms,
  seconds: Math.floor(ms / 1000),
})
/** The same Timestamp after the render cache's JSON round trip. */
const jsonTimestamp = (ms: number) => ({
  _seconds: Math.floor(ms / 1000),
  _nanoseconds: 0,
})

const youngFree = { plan: 'free', createdAt: timestamp(SIX_DAYS_AGO) }
const youngPaid = {
  plan: 'pro',
  billingStatus: 'active',
  createdAt: timestamp(SIX_DAYS_AGO),
}
const oldFree = { plan: 'free', createdAt: timestamp(A_MONTH_AGO) }

const ORIGINAL_SECRET = process.env['TOKEN_SIGNING_SECRET']
beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
})
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env['TOKEN_SIGNING_SECRET']
  else process.env['TOKEN_SIGNING_SECRET'] = ORIGINAL_SECRET
})

describe('who gets the notice', () => {
  it('a FREE workspace in its first 14 days, until the 14th day', () => {
    expect(LEAVING_NOTICE_DAYS).toBe(14)
    expect(leavingNoticeEndsAt(youngFree, NOW)).toBe(SIX_DAYS_AGO + 14 * DAY)
  })

  it('not a young PAID workspace', () => {
    expect(leavingNoticeEndsAt(youngPaid, NOW)).toBeNull()
  })

  it('a young workspace whose paid subscription died, which resolves as free', () => {
    expect(
      leavingNoticeEndsAt({ ...youngPaid, billingStatus: 'canceled' }, NOW),
    ).toBe(SIX_DAYS_AGO + 14 * DAY)
  })

  it('not an OLD free workspace', () => {
    expect(leavingNoticeEndsAt(oldFree, NOW)).toBeNull()
    // The boundary: day 14 is out, the last moment of day 13 is in.
    expect(
      leavingNoticeEndsAt({ plan: 'free', createdAt: NOW - 14 * DAY }, NOW),
    ).toBeNull()
    expect(
      leavingNoticeEndsAt({ plan: 'free', createdAt: NOW - 14 * DAY + 1 }, NOW),
    ).toBe(NOW + 1)
  })

  it('not a workspace whose creation date cannot be read — an existing customer', () => {
    expect(leavingNoticeEndsAt({ plan: 'free' }, NOW)).toBeNull()
    expect(leavingNoticeEndsAt(null, NOW)).toBeNull()
  })

  it('reads the render cache’s JSON copy of a Timestamp like the live one', () => {
    // The tenant's org comes out of the render cache with its `createdAt`
    // flattened to `{ _seconds, _nanoseconds }`; read as missing, every new
    // free site would have skipped the notice.
    const cached = { plan: 'free', createdAt: jsonTimestamp(SIX_DAYS_AGO) }
    expect(orgCreatedMs(cached.createdAt)).toBe(Math.floor(SIX_DAYS_AGO / 1000) * 1000)
    expect(orgAgeDays(cached.createdAt, NOW)).toBe(6)
    expect(leavingNoticeEndsAt(cached, NOW)).not.toBeNull()
  })
})

describe('which hosts are exempt', () => {
  const hosts = leavingNoticeHosts(SITE)

  it('the site’s own subdomain and custom domain, with www.', () => {
    expect(hosts).toEqual(
      expect.arrayContaining([
        'juenes.aglyn.app',
        'juenes.example.com',
        'www.juenes.example.com',
      ]),
    )
  })

  it('the platform’s own domains, and the bare tenant apex', () => {
    expect(hosts).toEqual(expect.arrayContaining(['aglyn.app', '.aglyn.com']))
  })

  it('never every site on the tenant apex', () => {
    expect(hosts).not.toContain('.aglyn.app')
  })
})

describe('what a page is signed for', () => {
  const hosts = leavingNoticeHosts(SITE)

  it('every outside address the page renders from, normalized', () => {
    const props = {
      nodes: {
        button: { props: { href: HARVESTER } },
        protocolRelative: { props: { href: '//cdn-docs.example.org/file' } },
        markdown: {
          props: {
            body: 'Read [the brief](https://brief.example.org/q3). Or https://plain.example.org.',
          },
        },
        html: {
          props: {
            html: '<a href="https://shop.example.org/?a=1&amp;b=2">shop</a>',
          },
        },
      },
    }
    const found = collectLeavingDestinations(props, hosts)
    expect(found).toEqual(
      expect.arrayContaining([
        HARVESTER,
        'https://cdn-docs.example.org/file',
        'https://brief.example.org/q3',
        'https://plain.example.org/',
        'https://shop.example.org/?a=1&b=2',
      ]),
    )
  })

  it('not the site’s own domains, the platform’s, mailto: or tel:', () => {
    const found = collectLeavingDestinations(
      {
        own: 'https://juenes.aglyn.app/about',
        custom: 'https://juenes.example.com/shop',
        platform: 'https://aglyn.com/pricing',
        console: 'https://app.aglyn.com/',
        mail: 'mailto:owner@example.org',
        phone: 'tel:+15125550100',
        path: '/contact',
      },
      hosts,
    )
    expect(found).toEqual([])
  })

  it('stops at the cap rather than signing a link farm', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://farm${i}.example.org/`)
    expect(collectLeavingDestinations(many, hosts, 5)).toHaveLength(5)
  })
})

describe('the signature', () => {
  it('verifies the address it was issued for, on the site it was issued for', () => {
    const sig = signLeavingDestination(HOST_ID, HARVESTER)
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, sig)).toBe(true)
  })

  it('refuses a FORGED destination — an address the site never linked', () => {
    const sig = signLeavingDestination(HOST_ID, HARVESTER)
    expect(
      verifyLeavingDestination(HOST_ID, 'https://another-harvester.example/', sig),
    ).toBe(false)
    expect(
      verifyLeavingDestination(HOST_ID, `${HARVESTER}?extra=1`, sig),
    ).toBe(false)
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, 'made-up')).toBe(false)
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, null)).toBe(false)
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, '')).toBe(false)
  })

  it('refuses another site’s signature for the same address', () => {
    const theirs = signLeavingDestination('host-review', HARVESTER)
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, theirs)).toBe(false)
  })

  it('refuses everything when the deployment has no secret', () => {
    const sig = signLeavingDestination(HOST_ID, HARVESTER)
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, sig)).toBe(false)
    expect(() => signLeavingDestination(HOST_ID, HARVESTER)).toThrow()
  })

  it('refuses to sign what is not an outside address', () => {
    expect(() => signLeavingDestination(HOST_ID, 'mailto:a@example.org')).toThrow()
    expect(() => signLeavingDestination('', HARVESTER)).toThrow()
  })
})

describe('the page config', () => {
  const content = { nodes: { button: { props: { href: HARVESTER } } } }

  it('a young free site: the window, the exempt hosts and a signature per address', () => {
    const config = leavingNoticeConfig({
      hostId: HOST_ID,
      site: SITE,
      org: youngFree,
      content,
      nowMs: NOW,
    })
    expect(config?.until).toBe(SIX_DAYS_AGO + 14 * DAY)
    expect(config?.hosts).toContain('juenes.aglyn.app')
    const sig = config?.sigs[HARVESTER] as string
    expect(verifyLeavingDestination(HOST_ID, HARVESTER, sig)).toBe(true)
  })

  it('nothing for a young paid site or an old free one', () => {
    for (const org of [youngPaid, oldFree]) {
      expect(
        leavingNoticeConfig({ hostId: HOST_ID, site: SITE, org, content, nowMs: NOW }),
      ).toBeNull()
    }
  })

  it('nothing, loudly, on a deployment that cannot sign', () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(
      leavingNoticeConfig({ hostId: HOST_ID, site: SITE, org: youngFree, content, nowMs: NOW }),
    ).toBeNull()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('only the signatures, for a gated tree that arrives after its page', () => {
    expect(
      leavingNoticeSignatures({
        hostId: HOST_ID,
        site: SITE,
        org: youngFree,
        content,
        nowMs: NOW,
      }),
    ).toEqual({ [HARVESTER]: expect.any(String) })
    expect(
      leavingNoticeSignatures({ hostId: HOST_ID, site: SITE, org: oldFree, content, nowMs: NOW }),
    ).toBeNull()
  })
})
