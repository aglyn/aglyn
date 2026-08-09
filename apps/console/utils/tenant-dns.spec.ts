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
  CNAME_TARGET,
  HOST_APEX_ADDRESSES,
  isApexDomain,
  RECOMMENDED_APEX_ADDRESS,
} from './tenant-dns'

describe('isApexDomain (AGL-1275)', () => {
  it('treats a two-label name as an apex', () => {
    expect(isApexDomain('example.com')).toBe(true)
    expect(isApexDomain('aglyn.io')).toBe(true)
    // Case and a trailing root dot are both legal ways to write the same name.
    expect(isApexDomain('EXAMPLE.COM.')).toBe(true)
  })

  it('treats a subdomain as not an apex', () => {
    expect(isApexDomain('www.example.com')).toBe(false)
    expect(isApexDomain('shop.eu.example.com')).toBe(false)
  })

  it('sees through multi-label public suffixes', () => {
    // The whole point: label counting alone calls these subdomains, and the
    // wizard then offers `example.co.uk` a CNAME its registrar cannot accept
    // on the zone root while its apex line still shows a placeholder.
    expect(isApexDomain('example.co.uk')).toBe(true)
    expect(isApexDomain('example.com.au')).toBe(true)
    expect(isApexDomain('www.example.co.uk')).toBe(false)
  })

  it('does not mistake a bare label or empty input for an apex', () => {
    expect(isApexDomain('')).toBe(false)
    expect(isApexDomain('localhost')).toBe(false)
  })
})

describe('the wizard and the verify route share one source of truth', () => {
  it('recommends an address the verify route actually accepts', () => {
    // Both surfaces read THIS module now (AGL-1275). Before it, the card had
    // its own `NEXT_PUBLIC_AGLYN_TENANT_APEX_A` and the route its own
    // `AGLYN_TENANT_APEX_ADDRESSES`, so widening the pool by env edit — the
    // move the route documents as supported — left the wizard printing an
    // address the route would no longer match on.
    expect(HOST_APEX_ADDRESSES).toContain(RECOMMENDED_APEX_ADDRESS)
  })

  it('never recommends the legacy address', () => {
    // `76.76.21.21` still resolves and must keep verifying, but a newly
    // pointed apex does not land there — recommending it would re-create the
    // failure AGL-1264 fixed.
    expect(RECOMMENDED_APEX_ADDRESS).not.toBe('76.76.21.21')
  })

  it('defaults to the shipped platform values', () => {
    expect(CNAME_TARGET).toBe('sites.aglyn.app')
    expect(RECOMMENDED_APEX_ADDRESS).toBe('216.198.79.1')
    // The whole pool, so a zone on any of the host's anycast addresses (and
    // the legacy one) still verifies.
    expect(HOST_APEX_ADDRESSES).toEqual([
      '216.198.79.1',
      '216.198.79.65',
      '64.29.17.1',
      '64.29.17.65',
      '76.76.21.21',
    ])
  })
})
