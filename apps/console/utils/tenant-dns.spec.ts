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
  DNS_INSTRUCTIONS_INTRO,
  dnsInstructionsFor,
  formatDnsInstruction,
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

  it('recommends the ALIAS hostname the route resolves, not a pinned address', () => {
    // The ALIAS names `CNAME_TARGET`, so the registrar flattens it to whatever
    // that hostname resolves to — which is precisely the intersection
    // `apexPointsAtTenantEdge` compares against. An apex on an ALIAS therefore
    // survives a pool change with no customer action; that is the whole point
    // of leading with it (AGL-1327).
    const alias = dnsInstructionsFor('example.com').find(
      (record) => record.type === 'ALIAS',
    )
    expect(alias?.value).toBe(CNAME_TARGET)
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

describe('dnsInstructionsFor (AGL-1327)', () => {
  const types = (domain: string) =>
    dnsInstructionsFor(domain).map((record) => record.type)

  it('leads with ALIAS for a bare apex', () => {
    expect(types('example.com')[0]).toBe('ALIAS')
    // The multi-label suffix case has to reach the apex branch too, or a UK
    // customer is back to being offered a CNAME on their zone root (AGL-1275).
    expect(types('example.co.uk')[0]).toBe('ALIAS')
  })

  it('keeps the A record as a fallback for registrars without ALIAS', () => {
    const apex = dnsInstructionsFor('example.com')
    const fallback = apex.find((record) => record.type === 'A')
    expect(fallback).toBeDefined()
    expect(fallback?.name).toBe('example.com')
    expect(fallback?.value).toBe(RECOMMENDED_APEX_ADDRESS)
    // ALIAS first, then the address it falls back to.
    expect(apex.indexOf(fallback!)).toBeGreaterThan(0)
    expect(fallback?.note).toContain('only if your registrar offers no ALIAS')
  })

  it('is unchanged for a subdomain — CNAME first, pointed at the typed name', () => {
    expect(types('www.example.com')[0]).toBe('CNAME')
    expect(types('shop.example.co.uk')[0]).toBe('CNAME')
    const [cname] = dnsInstructionsFor('www.example.com')
    expect(formatDnsInstruction(cname)).toBe(
      'CNAME  www.example.com  →  sites.aglyn.app',
    )
  })

  it('derives each line from the SHAPE of name it applies to', () => {
    // A bare apex gains www. on the CNAME line…
    const apex = dnsInstructionsFor('example.com')
    expect(apex.find((r) => r.type === 'CNAME')?.name).toBe('www.example.com')
    expect(apex.find((r) => r.type === 'ALIAS')?.name).toBe('example.com')
    // …a www name sheds it on the apex lines…
    const www = dnsInstructionsFor('www.example.co.uk')
    expect(www.find((r) => r.type === 'ALIAS')?.name).toBe('example.co.uk')
    // …and a deeper subdomain keeps its placeholder rather than guessing.
    const deep = dnsInstructionsFor('shop.eu.example.com')
    expect(deep.find((r) => r.type === 'CNAME')?.name).toBe(
      'shop.eu.example.com',
    )
    expect(deep.find((r) => r.type === 'A')?.name).toBe('your-domain.com')
  })

  it('shows all three shapes with placeholders before anything is typed', () => {
    expect(types('')).toEqual(['CNAME', 'ALIAS', 'A'])
    expect(dnsInstructionsFor('  ').map((record) => record.name)).toEqual([
      'www.your-domain.com',
      'your-domain.com',
      'your-domain.com',
    ])
  })

  it('formats a line the docs can quote verbatim', () => {
    const [alias, fallback] = dnsInstructionsFor('example.com')
    expect(formatDnsInstruction(alias)).toBe(
      'ALIAS  example.com  →  sites.aglyn.app',
    )
    expect(formatDnsInstruction(fallback)).toBe(
      'A      example.com  →  216.198.79.1',
    )
  })

  it('says ALIAS before it says A in the intro the docs quote', () => {
    expect(DNS_INSTRUCTIONS_INTRO.indexOf('ALIAS')).toBeLessThan(
      DNS_INSTRUCTIONS_INTRO.indexOf('A record'),
    )
  })
})
