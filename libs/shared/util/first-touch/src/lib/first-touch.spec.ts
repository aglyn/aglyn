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

import {
  buildFirstTouch,
  decodeFirstTouch,
  encodeFirstTouch,
  FIRST_TOUCH_COOKIE,
  isFirstPartyHost,
  mergeFirstTouch,
  normalizeFirstTouchHost,
  readFirstTouchCookie,
  sanitizeFirstTouch,
  type FirstTouch,
} from './first-touch'

const HOSTS = ['example.com', '*.example.com', '!*.sites.example.com']
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0)

const touch = (overrides: Partial<FirstTouch> = {}): FirstTouch => ({
  v: 1,
  at: NOW,
  host: 'example.com',
  path: '/',
  ref: null,
  ...overrides,
})

describe('the first-party host registry', () => {
  it('matches an exact host, and a wildcard at any depth but not its apex', () => {
    expect(isFirstPartyHost('example.com', ['example.com'])).toBe(true)
    expect(isFirstPartyHost('docs.example.com', ['example.com'])).toBe(false)
    expect(isFirstPartyHost('docs.example.com', ['*.example.com'])).toBe(true)
    expect(isFirstPartyHost('a.b.example.com', ['*.example.com'])).toBe(true)
    expect(isFirstPartyHost('example.com', ['*.example.com'])).toBe(false)
  })

  it('never matches a host that merely ends in the same letters', () => {
    expect(isFirstPartyHost('notexample.com', HOSTS)).toBe(false)
    expect(isFirstPartyHost('example.com.evil.test', HOSTS)).toBe(false)
  })

  it('lets an exclusion carve customer sites out of the operator domain', () => {
    expect(isFirstPartyHost('app.example.com', HOSTS)).toBe(true)
    expect(isFirstPartyHost('shop.sites.example.com', HOSTS)).toBe(false)
    // The exclusion wins whichever order the entries come in.
    expect(isFirstPartyHost('shop.sites.example.com', [...HOSTS].reverse())).toBe(false)
  })

  it('normalizes case, a trailing dot and whitespace, and refuses what is not a host', () => {
    expect(normalizeFirstTouchHost(' Docs.Example.COM. ')).toBe('docs.example.com')
    expect(isFirstPartyHost('DOCS.EXAMPLE.COM', HOSTS)).toBe(true)
    expect(normalizeFirstTouchHost('https://example.com/path')).toBe('')
    expect(normalizeFirstTouchHost('exa mple.com')).toBe('')
    expect(normalizeFirstTouchHost(42)).toBe('')
    expect(isFirstPartyHost('', HOSTS)).toBe(false)
  })
})

describe('building a first touch from a landing', () => {
  it('records an external referrer as the source, by host only', () => {
    const built = buildFirstTouch({
      href: 'https://example.com/pricing?plan=pro#faq',
      referrer: 'https://www.g2.com/products/aglyn/reviews?page=2',
      hosts: HOSTS,
      now: NOW,
    })
    expect(built).toEqual({
      v: 1,
      at: NOW,
      host: 'example.com',
      path: '/pricing',
      ref: 'www.g2.com',
    })
  })

  it('never takes an internal referrer as the source — it is kept as `via`', () => {
    const built = buildFirstTouch({
      href: 'https://app.example.com/signup',
      referrer: 'https://docs.example.com/guides/start',
      hosts: HOSTS,
      now: NOW,
    })
    expect(built?.ref).toBeNull()
    expect(built?.via).toBe('docs.example.com')
  })

  it('treats an excluded host as external, so a customer site is a referral', () => {
    const built = buildFirstTouch({
      href: 'https://example.com/',
      referrer: 'https://shop.sites.example.com/',
      hosts: HOSTS,
      now: NOW,
    })
    expect(built?.ref).toBe('shop.sites.example.com')
    expect(built?.via).toBeUndefined()
  })

  it('records neither for a same-host referrer or none at all', () => {
    for (const referrer of ['https://example.com/blog', '', null, 'not a url']) {
      const built = buildFirstTouch({ href: 'https://example.com/', referrer, hosts: HOSTS, now: NOW })
      expect(built?.ref).toBeNull()
      expect(built?.via).toBeUndefined()
    }
  })

  it('keeps all five utm parameters, scrubbed, and drops what a person typed', () => {
    const built = buildFirstTouch({
      href:
        'https://example.com/?utm_source=%20newsletter%20&utm_medium=email' +
        '&utm_campaign=sept-launch&utm_content=hero&utm_term=someone%40example.com' +
        `&utm_extra=nope&utm_campaign=second`,
      hosts: HOSTS,
      now: NOW,
    })
    expect(built?.utm).toEqual({
      source: 'newsletter',
      medium: 'email',
      campaign: 'sept-launch',
      content: 'hero',
    })
  })

  it('caps a utm value and strips control characters', () => {
    const long = 'x'.repeat(250)
    const built = buildFirstTouch({
      href: `https://example.com/?utm_campaign=${long}&utm_source=a%0Ab`,
      hosts: HOSTS,
      now: NOW,
    })
    expect(built?.utm?.campaign).toHaveLength(100)
    expect(built?.utm?.source).toBe('ab')
  })

  it('keeps the PRESENCE of a click id and never its value', () => {
    const built = buildFirstTouch({
      href: 'https://example.com/?gclid=Cj0KCQ-secret&fbclid=&msclkid=abc',
      hosts: HOSTS,
      now: NOW,
    })
    expect(built?.click).toEqual(['gclid', 'msclkid'])
    expect(JSON.stringify(built)).not.toContain('Cj0KCQ')
    expect(JSON.stringify(built)).not.toContain('abc')
  })

  it('refuses a landing that is not a web page, or has no time', () => {
    expect(buildFirstTouch({ href: 'file:///etc/passwd', hosts: HOSTS, now: NOW })).toBeNull()
    expect(buildFirstTouch({ href: 'nonsense', hosts: HOSTS, now: NOW })).toBeNull()
    expect(buildFirstTouch({ href: 'https://example.com/', hosts: HOSTS, now: 0 })).toBeNull()
  })
})

describe('the first-touch merge', () => {
  const early = touch({ at: NOW - 1000, ref: 'www.g2.com' })
  const late = touch({ at: NOW, via: 'docs.example.com' })

  it('keeps the earlier record, whichever side it arrives on', () => {
    expect(mergeFirstTouch(early, late)).toBe(early)
    expect(mergeFirstTouch(late, early)).toBe(early)
  })

  it('keeps the incumbent on a tie, so a replayed record changes nothing', () => {
    const replay = { ...early }
    expect(mergeFirstTouch(early, replay)).toBe(early)
  })

  it('takes whichever side exists', () => {
    expect(mergeFirstTouch(null, late)).toBe(late)
    expect(mergeFirstTouch(early, undefined)).toBe(early)
    expect(mergeFirstTouch(null, null)).toBeNull()
  })
})

describe('reading an untrusted record', () => {
  it('keeps only known fields, re-scrubbed', () => {
    const cleaned = sanitizeFirstTouch({
      v: 1,
      at: NOW,
      host: 'Example.COM',
      path: '/pricing?secret=1',
      ref: 'www.g2.com',
      via: 'bad host!',
      utm: { source: 'g2', term: 'a@b.co', evil: 'x' },
      click: ['gclid', 'gclid', 'value'],
      email: 'someone@example.com',
    })
    expect(cleaned).toEqual({
      v: 1,
      at: NOW,
      host: 'example.com',
      path: '/pricing',
      ref: 'www.g2.com',
      utm: { source: 'g2' },
      click: ['gclid'],
    })
  })

  it('refuses another version, a missing host, a bad time, or a far-future stamp', () => {
    expect(sanitizeFirstTouch({ ...touch(), v: 2 })).toBeNull()
    expect(sanitizeFirstTouch({ ...touch(), host: '' })).toBeNull()
    expect(sanitizeFirstTouch({ ...touch(), at: 'yesterday' })).toBeNull()
    expect(sanitizeFirstTouch({ ...touch(), at: NOW + 2 * 86_400_000 }, NOW)).toBeNull()
    expect(sanitizeFirstTouch({ ...touch(), at: NOW + 60_000 }, NOW)).not.toBeNull()
    expect(sanitizeFirstTouch('a string')).toBeNull()
  })
})

describe('the cookie form', () => {
  it('round-trips, and survives being one of several cookies', () => {
    const record = touch({ ref: 'www.g2.com', utm: { campaign: 'a;b c' }, click: ['fbclid'] })
    const encoded = encodeFirstTouch(record)
    expect(encoded).not.toMatch(/[;\s,]/)
    expect(decodeFirstTouch(encoded)).toEqual(record)
    const header = `__session=abc; ${FIRST_TOUCH_COOKIE}=${encoded}; theme-color-mode=dark`
    expect(readFirstTouchCookie(header)).toEqual(record)
  })

  it('reads nothing from garbage, a missing cookie, or a lookalike name', () => {
    expect(decodeFirstTouch('%E0%A4%A')).toBeNull()
    expect(decodeFirstTouch('{"v":1}')).toBeNull()
    expect(readFirstTouchCookie(null)).toBeNull()
    expect(readFirstTouchCookie(`x${FIRST_TOUCH_COOKIE}=${encodeFirstTouch(touch())}`)).toBeNull()
  })
})
