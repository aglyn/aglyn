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

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_TRUSTED_PROXY_COUNT,
  normalizeClientIp,
  readClientIp,
  resolveTrustedProxyCount,
  TRUSTED_PROXY_COUNT_VAR,
} from './request-ip'

/**
 * The client-address reader (AGL-2014).
 *
 * These pin the SECURITY property, not the parsing: the question is never
 * "does it split a comma-separated list" but "can a caller decide what their
 * own address is". Every assertion below is written so that the leftmost,
 * caller-supplied hop becoming the answer FAILS it.
 *
 * No `jest.isolateModulesAsync`: the configured depth is read per call rather
 * than frozen at module scope, so the env can be handed in directly and a
 * cold isolated import cannot cascade a phantom second failure.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')

/** One reverse proxy in front — the shape `docker-compose.yml` describes. */
const ONE_PROXY = { trustedProxyCount: 1 }

describe('readClientIp · a caller may not choose their own address', () => {
  /**
   * THE case this module exists for.
   *
   * nginx's `$proxy_add_x_forwarded_for` and the usual Traefik/Caddy chains
   * APPEND. A direct caller who sends `X-Forwarded-For: 1.2.3.4` arrives as
   * `1.2.3.4, <their real address>`, and every limiter in the product used to
   * key on `1.2.3.4` — a fresh budget per forged value, per request.
   */
  it('a spoofed X-Forwarded-For is NOT the client address behind one proxy', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4, 198.51.100.23',
    })
    const ip = readClientIp(headers, ONE_PROXY)
    expect(ip).toBe('198.51.100.23')
    // Named explicitly: this is the assertion the work exists for, and a
    // regression to leftmost-hop reading has to fail on the value itself.
    expect(ip).not.toBe('1.2.3.4')
  })

  it('a whole forged chain buys nothing — only the trusted hop is read', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.23',
    })
    expect(readClientIp(headers, ONE_PROXY)).toBe('198.51.100.23')
  })

  /**
   * The CONTROL. Without it every refusal above could be passing because the
   * reader returns null for everything, and the suite would be green while
   * the product had no address to key on at all.
   */
  it('CONTROL: a genuine visitor behind one proxy is read correctly', () => {
    // An overwriting proxy leaves exactly one entry.
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }), ONE_PROXY),
    ).toBe('203.0.113.7')
    // An appending proxy behind no caller-supplied header leaves one too.
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }), {
        trustedProxyCount: 1,
      }),
    ).toBe('203.0.113.7')
  })

  it('a genuine visitor behind the configured number of proxies is read', () => {
    // CDN → operator's nginx → app. The CDN appended the visitor, nginx
    // appended the CDN's egress address.
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 198.51.100.10',
    })
    expect(readClientIp(headers, { trustedProxyCount: 2 })).toBe('203.0.113.7')
  })

  it('MORE hops than configured: the extra left-hand entries are ignored', () => {
    const headers = new Headers({
      'x-forwarded-for': 'evil, 203.0.113.7, 198.51.100.10',
    })
    // Two trusted proxies, three entries: the forged one is outside the
    // trusted depth and never considered.
    expect(readClientIp(headers, { trustedProxyCount: 2 })).toBe('203.0.113.7')
  })

  it('FEWER hops than configured: clamps to the leftmost, still a trusted entry', () => {
    // Configured for two proxies, but the outer one overwrites rather than
    // appends, so only one entry arrives. It was still written by a trusted
    // proxy, so refusing it would lose a real address for nothing.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' })
    expect(readClientIp(headers, { trustedProxyCount: 2 })).toBe('203.0.113.7')
  })

  it('an empty header is not an address', () => {
    expect(readClientIp(new Headers({ 'x-forwarded-for': '' }), ONE_PROXY)).toBeNull()
    expect(readClientIp(new Headers({ 'x-forwarded-for': ' , ' }), ONE_PROXY)).toBeNull()
    expect(readClientIp(new Headers(), ONE_PROXY)).toBeNull()
  })

  it('never invents an address when nothing is readable', () => {
    // The contract every caller depends on: no `'unknown'`, no `127.0.0.1`,
    // no placeholder that would put every anonymous caller in one bucket.
    const ip = readClientIp(new Headers(), ONE_PROXY)
    expect(ip).toBeNull()
    expect(ip).not.toBe('unknown')
  })

  it('a malformed trusted hop falls to the next SOURCE, never to a neighbour', () => {
    const headers = new Headers({
      // The forged left-hand entry is a perfectly valid address; the trusted
      // hop is junk. Sliding one entry left would hand the caller the win.
      'x-forwarded-for': '1.2.3.4, not-an-address',
      'x-real-ip': '198.51.100.23',
    })
    expect(readClientIp(headers, ONE_PROXY)).toBe('198.51.100.23')
  })

  it('a malformed trusted hop with no other source is null, not the neighbour', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 999.999.999.999' })
    expect(readClientIp(headers, ONE_PROXY)).toBeNull()
  })

  it("squid's `unknown` token is not an address", () => {
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, unknown' }), ONE_PROXY),
    ).toBeNull()
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': 'unknown' }), ONE_PROXY),
    ).toBeNull()
  })

  it('IPv6 with a port, bracketed, loses the port and keeps the address', () => {
    expect(
      readClientIp(
        new Headers({ 'x-forwarded-for': '[2001:db8::1]:41234' }),
        ONE_PROXY,
      ),
    ).toBe('2001:db8::1')
    // Bare IPv6, no port to strip.
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': '2001:DB8::1' }), ONE_PROXY),
      // Lower-cased, because a rate-limit key is an exact string and one
      // visitor must not hold two budgets.
    ).toBe('2001:db8::1')
  })

  it('IPv4 with a port loses the port', () => {
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': '203.0.113.7:52118' }), ONE_PROXY),
    ).toBe('203.0.113.7')
  })
})

describe('readClientIp · the other headers an operator’s proxy may set', () => {
  it('reads x-real-ip when no forwarded chain arrives', () => {
    expect(
      readClientIp(new Headers({ 'x-real-ip': '203.0.113.7' }), ONE_PROXY),
    ).toBe('203.0.113.7')
  })

  it('the chain outranks x-real-ip, so a forged x-real-ip cannot demote it', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4, 198.51.100.23',
      'x-real-ip': '1.2.3.4',
    })
    expect(readClientIp(headers, ONE_PROXY)).toBe('198.51.100.23')
  })

  it('reads RFC 7239 Forwarded at the same trusted hop', () => {
    const headers = new Headers({
      forwarded: 'for=1.2.3.4;proto=http, for="198.51.100.23";proto=https',
    })
    expect(readClientIp(headers, ONE_PROXY)).toBe('198.51.100.23')
  })

  it('a quoted IPv6 Forwarded node with a port is read', () => {
    const headers = new Headers({ forwarded: 'for="[2001:db8::1]:4711"' })
    expect(readClientIp(headers, ONE_PROXY)).toBe('2001:db8::1')
  })

  it('RFC 7239 obfuscated identifiers are not addresses', () => {
    expect(
      readClientIp(new Headers({ forwarded: 'for=_hidden' }), ONE_PROXY),
    ).toBeNull()
    expect(
      readClientIp(new Headers({ forwarded: 'for=unknown' }), ONE_PROXY),
    ).toBeNull()
  })

  it('the transport peer is the last resort, below every header', () => {
    expect(
      readClientIp(new Headers(), { ...ONE_PROXY, remoteAddress: '::ffff:203.0.113.7' }),
      // IPv4-mapped collapses, so a socket address and a header value key the
      // same bucket for the same visitor.
    ).toBe('203.0.113.7')
    expect(
      readClientIp(new Headers({ 'x-forwarded-for': '198.51.100.23' }), {
        ...ONE_PROXY,
        remoteAddress: '10.0.0.5',
      }),
    ).toBe('198.51.100.23')
  })

  it('depth 0 trusts no proxy: forwarding headers are ignored entirely', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '1.2.3.4',
      forwarded: 'for=1.2.3.4',
    })
    expect(
      readClientIp(headers, { trustedProxyCount: 0, remoteAddress: '198.51.100.23' }),
    ).toBe('198.51.100.23')
    expect(readClientIp(headers, { trustedProxyCount: 0 })).toBeNull()
  })

  it('reads a node-style header record, including a repeated header', () => {
    expect(
      readClientIp({ 'X-Forwarded-For': ['1.2.3.4', '198.51.100.23'] }, ONE_PROXY),
    ).toBe('198.51.100.23')
    expect(readClientIp({ 'x-real-ip': '203.0.113.7' }, ONE_PROXY)).toBe('203.0.113.7')
  })
})

describe('normalizeClientIp · what may become a rate-limit key', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['  203.0.113.7  ', '203.0.113.7'],
    ['"203.0.113.7"', '203.0.113.7'],
    ['2001:DB8::1', '2001:db8::1'],
    ['fe80::1%eth0', 'fe80::1'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeClientIp(raw)).toBe(expected)
  })

  it.each([
    ['unknown'],
    ['_hidden'],
    [''],
    ['   '],
    ['999.0.0.1'],
    ['010.0.0.1'],
    ['1.2.3'],
    ['example.com'],
    ['<script>'],
    ['203.0.113.7 203.0.113.8'],
  ])('%s is not an address', (raw) => {
    expect(normalizeClientIp(raw)).toBeNull()
  })
})

describe('resolveTrustedProxyCount · the default is chosen, not guessed', () => {
  it('AGLYN-OPERATED: on Vercel the platform edge decides', () => {
    expect(resolveTrustedProxyCount({ VERCEL: '1' })).toBeNull()
  })

  /**
   * Aglyn's own production must not read differently than it did. Before this
   * module every call site took the LEFTMOST hop; in platform mode it still
   * does, and the platform's own unspoofable value simply wins when present.
   */
  it('AGLYN-OPERATED: platform mode still reads the leftmost hop', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(readClientIp(headers, { env: { VERCEL: '1' } })).toBe('203.0.113.7')
  })

  it('AGLYN-OPERATED: the platform’s own value outranks the chain', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-forwarded-for': '1.2.3.4',
    })
    expect(readClientIp(headers, { env: { VERCEL: '1' } })).toBe('203.0.113.7')
  })

  it('SELF-HOST: the platform header is not read off the wire without the platform', () => {
    // An operator's proxy passing a caller's forged `x-vercel-*` header must
    // reach nothing — the mode comes from the runtime, not from the request.
    const headers = new Headers({
      'x-vercel-forwarded-for': '1.2.3.4',
      'x-forwarded-for': '1.2.3.4, 198.51.100.23',
    })
    expect(readClientIp(headers, { env: {} })).toBe('198.51.100.23')
  })

  it('SELF-HOST: unset means one proxy in front', () => {
    expect(resolveTrustedProxyCount({})).toBe(DEFAULT_TRUSTED_PROXY_COUNT)
    expect(resolveTrustedProxyCount({})).toBe(1)
  })

  it('an operator names how many proxies they run', () => {
    expect(resolveTrustedProxyCount({ [TRUSTED_PROXY_COUNT_VAR]: '2' })).toBe(2)
    expect(resolveTrustedProxyCount({ [TRUSTED_PROXY_COUNT_VAR]: ' 3 ' })).toBe(3)
    expect(resolveTrustedProxyCount({ [TRUSTED_PROXY_COUNT_VAR]: '0' })).toBe(0)
  })

  it('a configured count wins over the platform', () => {
    expect(
      resolveTrustedProxyCount({ VERCEL: '1', [TRUSTED_PROXY_COUNT_VAR]: '2' }),
    ).toBe(2)
  })

  it.each([['abc'], ['-1'], ['1.5'], ['999'], ['']])(
    'a junk count (%s) falls back rather than becoming a depth',
    (raw) => {
      // `Number('abc')` is NaN, which compares false against every bound and
      // would have quietly indexed the leftmost hop.
      expect(resolveTrustedProxyCount({ [TRUSTED_PROXY_COUNT_VAR]: raw })).toBe(1)
    },
  )

  it('the self-host environment reference documents the variable', () => {
    const doc = readFileSync(
      join(REPO_ROOT, 'apps/docs/docs/developers/self-hosting-environment.md'),
      'utf8',
    )
    expect(doc).toContain(TRUSTED_PROXY_COUNT_VAR)
  })
})
