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
 *
 * @jest-environment node
 */

import { normalizeOutreachDomain, outreachEmailDomain } from './do-not-contact-domain'

describe('normalizeOutreachDomain (AGL-3244)', () => {
  it('spells a domain one way: lower-cased, with what people paste around it dropped', () => {
    expect(normalizeOutreachDomain('Example.COM')).toBe('example.com')
    expect(normalizeOutreachDomain('  @kcorp.kendal.org ')).toBe('kcorp.kendal.org')
    expect(normalizeOutreachDomain('https://www.example.co.uk/about?x=1')).toBe('example.co.uk')
    expect(normalizeOutreachDomain('example.com.')).toBe('example.com')
    expect(normalizeOutreachDomain('someone@Example.net')).toBe('example.net')
    expect(normalizeOutreachDomain('mail.example-corp.io')).toBe('mail.example-corp.io')
  })

  it('refuses what is not a domain', () => {
    expect(normalizeOutreachDomain('')).toBeNull()
    expect(normalizeOutreachDomain(null)).toBeNull()
    expect(normalizeOutreachDomain('localhost')).toBeNull()
    expect(normalizeOutreachDomain('-bad.example.com')).toBeNull()
    expect(normalizeOutreachDomain('exa mple.com')).toBeNull()
    expect(normalizeOutreachDomain('203.0.113.7')).toBeNull()
    expect(normalizeOutreachDomain(`${'a'.repeat(64)}.com`)).toBeNull()
    expect(normalizeOutreachDomain(`${'ab.'.repeat(90)}com`)).toBeNull()
  })
})

describe('outreachEmailDomain', () => {
  it('is the domain of the normalized address', () => {
    expect(outreachEmailDomain(' Morgan.Lamphere@KCorp.Kendal.org ')).toBe('kcorp.kendal.org')
    expect(outreachEmailDomain('not an address')).toBeNull()
    expect(outreachEmailDomain(null)).toBeNull()
  })
})
