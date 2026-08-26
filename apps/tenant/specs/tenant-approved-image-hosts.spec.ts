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
 * THE TENANT `img-src` IS BUILT FROM CUSTOMER-EDITABLE DATA (AGL-1152).
 *
 * Making the directive per-site is what makes AGL-1726's enforcing flip
 * reachable — an owner-approved list revokes no advertised capability, and it
 * is a Firestore write rather than a build-time constant, which is the
 * deploy-free rollback that issue said did not exist.
 *
 * It also moves a security policy's contents into a text box a customer types
 * into, so the parse is the boundary. The failure that matters is NOT a broken
 * header: it is a header that silently permits more than the owner asked for,
 * or one whose directive list has been extended by something pasted into a
 * hostname field. `img-src` sources are space-delimited and directives are
 * `;`-delimited, so both characters are injection points.
 *
 * Refusal is total, never repair. A value that has to be sanitised to be safe
 * is a value nobody should be shipping into a policy, and a "cleaned" version
 * of `evil.com; script-src *` is indistinguishable in the header from an entry
 * the owner meant.
 */
const {
  tenantImgSrcDirective,
  normalizeApprovedImageHost,
  approvedImageHostSources,
  APPROVED_IMAGE_HOSTS_MAX,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('../../../security-origins.js')

describe('approved image hosts — the parse is the security boundary (AGL-1152)', () => {
  it('accepts an ordinary host and a single-label wildcard', () => {
    expect(normalizeApprovedImageHost('cdn.example.com')).toBe(
      'https://cdn.example.com',
    )
    // Image CDNs are routinely per-account subdomains, and CSP understands
    // this form, so refusing it would push owners toward listing nothing.
    expect(normalizeApprovedImageHost('*.imgix.net')).toBe('https://*.imgix.net')
  })

  it('lowercases and trims, so one host cannot be listed twice', () => {
    expect(normalizeApprovedImageHost('  CDN.Example.COM ')).toBe(
      'https://cdn.example.com',
    )
    expect(
      approvedImageHostSources(['cdn.example.com', 'CDN.EXAMPLE.COM']),
    ).toEqual(['https://cdn.example.com'])
  })

  describe('REFUSES, rather than repairs', () => {
    it.each([
      ['a directive injection', 'evil.com; script-src *'],
      ['a source-list injection', 'evil.com *'],
      ['a comma-separated list', 'a.com,b.com'],
      ['an explicit scheme', 'http://x.com'],
      ['an https scheme', 'https://x.com'],
      ['a path', 'x.com/foo'],
      ['a port', 'x.com:8080'],
      ['credentials', 'user@x.com'],
      ['a bare wildcard', '*'],
      ['a wildcard TLD', '*.com'],
      ['a single label', 'localhost'],
      ['an IPv4 literal', '127.0.0.1'],
      ['a newline', 'x.com\nevil.com'],
      ['an empty string', ''],
      ['a non-string', 42],
    ])('%s', (_label, input) => {
      expect(normalizeApprovedImageHost(input as never)).toBeNull()
    })

    it('drops the bad entries and keeps the good ones', () => {
      // A single bad paste must not blank an owner's whole list, and must not
      // survive in any form either.
      expect(
        approvedImageHostSources([
          'good.example.com',
          'evil.com; script-src *',
          'other.example.net',
        ]),
      ).toEqual(['https://good.example.com', 'https://other.example.net'])
    })
  })

  it('is bounded — the header ships on every response of every page', () => {
    const many = Array.from(
      { length: APPROVED_IMAGE_HOSTS_MAX + 25 },
      (_unused, i) => `h${i}.example.com`,
    )
    expect(approvedImageHostSources(many)).toHaveLength(
      APPROVED_IMAGE_HOSTS_MAX,
    )
  })

  it.each([undefined, null, 'not-an-array', {}, 0])(
    'treats %p as no approvals rather than throwing',
    (input) => {
      // Host data is whatever is in the document. A middleware that throws
      // here fails every request for that site.
      expect(approvedImageHostSources(input as never)).toEqual([])
    },
  )
})

describe('tenantImgSrcDirective composes the site policy (AGL-1152)', () => {
  it('PINS firebasestorage regardless of what the owner approved', () => {
    // AGL-1726 condition 5: free-tier orgs store absolute download URLs, so an
    // owner who could remove this would blank their own images while paying
    // customers' sites kept working — the worst shape a regression can take.
    expect(tenantImgSrcDirective(true, [])).toContain(
      'https://firebasestorage.googleapis.com',
    )
    expect(tenantImgSrcDirective(true, ['cdn.example.com'])).toContain(
      'https://firebasestorage.googleapis.com',
    )
  })

  it('adds the approved hosts and nothing else', () => {
    const directive = tenantImgSrcDirective(true, ['cdn.example.com'])
    expect(directive).toBe(
      "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://cdn.example.com",
    )
  })

  it('a site that has approved nothing gets exactly the shipped policy', () => {
    // The migration property: before any owner touches the setting, the
    // directive must be byte-identical to what production serves today, or
    // this change is a silent policy change for every existing site.
    expect(tenantImgSrcDirective(true, [])).toBe(
      "img-src 'self' data: blob: https://firebasestorage.googleapis.com",
    )
    expect(tenantImgSrcDirective(true, undefined)).toBe(
      tenantImgSrcDirective(true, []),
    )
  })

  it('THE INJECTION GUARD: no approved value can add a directive', () => {
    const directive = tenantImgSrcDirective(true, [
      "evil.com; default-src *; script-src 'unsafe-inline'",
    ])
    expect(directive).not.toContain(';')
    expect(directive).not.toContain('script-src')
    expect(directive).not.toContain('unsafe-inline')
  })

  it('keeps the localhost affordance off production only', () => {
    expect(tenantImgSrcDirective(false, [])).toContain('http://localhost:*')
    expect(tenantImgSrcDirective(true, [])).not.toContain('localhost')
  })
})
