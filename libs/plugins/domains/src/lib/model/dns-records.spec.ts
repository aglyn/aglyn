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
  invalidDnsRecordFields,
  isAglynManagedRecord,
  normalizeRecordName,
  toRecordInput,
  toRegistrarRecord,
  wouldReplaceSiteAddress,
  type DnsRecordView,
} from './dns-records'

/** The DNS record editor's rules (AGL-4040): one record, ordinary fields. */

const DOMAIN = 'testbakery.com'

describe('record names', () => {
  it('reads the domain itself, @, and a full name as the part before the domain', () => {
    expect(normalizeRecordName('@', DOMAIN)).toBe('')
    expect(normalizeRecordName('TestBakery.com.', DOMAIN)).toBe('')
    expect(normalizeRecordName('WWW', DOMAIN)).toBe('www')
    expect(normalizeRecordName('mail.testbakery.com', DOMAIN)).toBe('mail')
    expect(normalizeRecordName('_dmarc', DOMAIN)).toBe('_dmarc')
  })
})

describe('validation', () => {
  it('takes a well-formed record of every type', () => {
    expect(invalidDnsRecordFields({ type: 'A', name: '', value: '76.76.21.21' }, DOMAIN)).toEqual([])
    expect(invalidDnsRecordFields({ type: 'AAAA', name: 'v6', value: '2001:db8::1' }, DOMAIN)).toEqual([])
    expect(invalidDnsRecordFields({ type: 'CNAME', name: 'shop', value: 'shops.example.com' }, DOMAIN)).toEqual([])
    expect(invalidDnsRecordFields({ type: 'ALIAS', name: '', value: 'example.com' }, DOMAIN)).toEqual([])
    expect(invalidDnsRecordFields({ type: 'MX', name: '', value: 'mx1.example.com', priority: 10 }, DOMAIN)).toEqual([])
    expect(invalidDnsRecordFields({ type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' }, DOMAIN)).toEqual([])
    expect(
      invalidDnsRecordFields({ type: 'CAA', name: '', value: 'letsencrypt.org', caaTag: 'issue' }, DOMAIN),
    ).toEqual([])
    expect(
      invalidDnsRecordFields(
        { type: 'SRV', name: '_sip._tcp', value: 'sip.example.com', priority: 10, weight: 5, port: 5060 },
        DOMAIN,
      ),
    ).toEqual([])
  })

  it('names each bad field', () => {
    expect(invalidDnsRecordFields({ type: 'A', name: '', value: '300.1.1.1' }, DOMAIN)).toEqual(['value'])
    expect(invalidDnsRecordFields({ type: 'AAAA', name: '', value: '1.2.3.4' }, DOMAIN)).toEqual(['value'])
    expect(invalidDnsRecordFields({ type: 'CNAME', name: '', value: 'example.com' }, DOMAIN)).toEqual(['name'])
    expect(invalidDnsRecordFields({ type: 'MX', name: '', value: 'mx.example.com' }, DOMAIN)).toEqual(['priority'])
    expect(invalidDnsRecordFields({ type: 'SRV', name: '_x._tcp', value: 'x.example.com', priority: 1 }, DOMAIN)).toEqual([
      'weight',
      'port',
    ])
    expect(invalidDnsRecordFields({ type: 'CAA', name: '', value: 'a b' }, DOMAIN)).toEqual(['value', 'caaTag'])
    expect(invalidDnsRecordFields({ type: 'TXT', name: 'bad name!', value: 'x' }, DOMAIN)).toEqual(['name'])
    expect(invalidDnsRecordFields({ type: 'TXT', name: '', value: 'x', ttl: 5 }, DOMAIN)).toEqual(['ttl'])
    expect(invalidDnsRecordFields({ type: 'NS' as never, name: '', value: 'x' }, DOMAIN)).toEqual(['type'])
  })
})

describe('what the registrar stores', () => {
  it('composes CAA and SRV from their fields, so nobody writes record syntax', () => {
    expect(
      toRegistrarRecord({ type: 'CAA', name: '@', value: 'letsencrypt.org', caaTag: 'issue' }, DOMAIN),
    ).toEqual({ type: 'CAA', name: '', value: '0 issue "letsencrypt.org"' })
    expect(
      toRegistrarRecord(
        { type: 'SRV', name: '_sip._tcp', value: 'SIP.example.com', priority: 10, weight: 5, port: 5060, ttl: 300 },
        DOMAIN,
      ),
    ).toEqual({
      type: 'SRV',
      name: '_sip._tcp',
      srv: { priority: 10, weight: 5, port: 5060, target: 'sip.example.com' },
      ttl: 300,
    })
    expect(toRegistrarRecord({ type: 'MX', name: '', value: 'mx.example.com', priority: 10 }, DOMAIN)).toEqual({
      type: 'MX',
      name: '',
      value: 'mx.example.com',
      mxPriority: 10,
    })
  })

  it('reads a listed record back into the form', () => {
    const base: DnsRecordView = {
      id: 'rec_1',
      type: 'CAA',
      name: '',
      value: '0 issue "letsencrypt.org"',
      ttl: 60,
      priority: null,
      managed: false,
      editable: true,
    }
    expect(toRecordInput(base)).toEqual({ type: 'CAA', name: '', ttl: 60, caaTag: 'issue', value: 'letsencrypt.org' })
    expect(toRecordInput({ ...base, type: 'SRV', value: '5 5060 sip.example.com', priority: 10 })).toEqual({
      type: 'SRV',
      name: '',
      ttl: 60,
      priority: 10,
      weight: 5,
      port: 5060,
      value: 'sip.example.com',
    })
    expect(toRecordInput({ ...base, type: 'NS', value: 'ns1.vercel-dns.com' })).toBeNull()
  })
})

describe('records Aglyn manages', () => {
  it('protects the registrar’s own records, and a connected site’s addresses', () => {
    expect(isAglynManagedRecord({ type: 'ALIAS', name: '', creator: 'system' }, false)).toBe(true)
    expect(isAglynManagedRecord({ type: 'A', name: '', creator: 'user' }, true)).toBe(true)
    expect(isAglynManagedRecord({ type: 'CNAME', name: 'www', creator: 'user' }, true)).toBe(true)
    expect(isAglynManagedRecord({ type: 'A', name: '', creator: 'user' }, false)).toBe(false)
    expect(isAglynManagedRecord({ type: 'MX', name: '', creator: 'user' }, true)).toBe(false)
    expect(isAglynManagedRecord({ type: 'CNAME', name: 'shop', creator: 'user' }, true)).toBe(false)
  })

  it('refuses a new address record where a connected site is served', () => {
    expect(wouldReplaceSiteAddress({ type: 'A', name: '', value: '1.2.3.4' }, true)).toBe(true)
    expect(wouldReplaceSiteAddress({ type: 'CNAME', name: 'www', value: 'x.com' }, true)).toBe(true)
    expect(wouldReplaceSiteAddress({ type: 'TXT', name: '', value: 'x' }, true)).toBe(false)
    expect(wouldReplaceSiteAddress({ type: 'A', name: '', value: '1.2.3.4' }, false)).toBe(false)
  })

  it('keeps CAA records while a site is connected, so its certificate authority cannot be blocked', () => {
    expect(isAglynManagedRecord({ type: 'CAA', name: '', creator: 'user' }, true)).toBe(true)
    expect(isAglynManagedRecord({ type: 'CAA', name: '', creator: 'user' }, false)).toBe(false)
    expect(wouldReplaceSiteAddress({ type: 'CAA', name: '', value: '0 issue "x.example"' }, true)).toBe(true)
    expect(wouldReplaceSiteAddress({ type: 'CAA', name: '', value: '0 issue "x.example"' }, false)).toBe(false)
  })
})
