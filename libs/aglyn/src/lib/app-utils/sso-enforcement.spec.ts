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

import { protectsIfDesignated, ssoEnforcementAccounts, ssoEnforcementLoses } from './sso-enforcement'

describe('single sign-on enforcement rehearsal rows', () => {
  it('protects only an account that holds a way in other than the identity provider', () => {
    expect(protectsIfDesignated({ unlinked: ['password'], kept: [] }, 'saml.acme')).toBe(true)
    expect(protectsIfDesignated({ unlinked: [], kept: ['google.com'] }, 'saml.acme')).toBe(true)
    expect(protectsIfDesignated({ unlinked: [], kept: ['saml.acme'] }, 'saml.acme')).toBe(false)
    expect(protectsIfDesignated({ unlinked: ['saml.acme'], kept: ['saml.acme'] }, 'saml.acme')).toBe(false)
    expect(protectsIfDesignated({ unlinked: [], kept: [] }, 'saml.acme')).toBe(false)
  })

  it('words what an account would lose', () => {
    expect(ssoEnforcementLoses({ unlinked: ['password', 'google.com'] })).toBe('password, google.com')
    expect(ssoEnforcementLoses({ unlinked: [] })).toBe('—')
    expect(ssoEnforcementLoses({ unlinked: ['password'], skipped: 'break-glass' })).toBe('Nothing — designated break-glass')
    expect(ssoEnforcementLoses({ unlinked: [], skipped: 'no-other-way-in' })).toBe('Nothing — it would be left with no way in')
  })

  it('makes one row per account, with the address, what it loses and keeps, and whether it can be break-glass', () => {
    expect(
      ssoEnforcementAccounts(
        [
          { uid: 'u1', email: 'a@acme.com', unlinked: ['password'], kept: ['saml.acme'] },
          { uid: 'u2', email: null, unlinked: [], kept: ['saml.acme'], skipped: 'no-other-way-in' },
          { uid: 'u3', email: 'c@acme.com', unlinked: [], kept: ['password'], skipped: 'break-glass' },
        ],
        'saml.acme',
        ['u3'],
      ),
    ).toEqual([
      { uid: 'u1', label: 'a@acme.com', wouldLose: 'password', keeps: 'saml.acme', eligible: true, designated: false },
      { uid: 'u2', label: 'u2', wouldLose: 'Nothing — it would be left with no way in', keeps: 'saml.acme', eligible: false, designated: false },
      { uid: 'u3', label: 'c@acme.com', wouldLose: 'Nothing — designated break-glass', keeps: 'password', eligible: true, designated: true },
    ])
  })

  it('reads a missing rehearsal as no rows', () => {
    expect(ssoEnforcementAccounts(null, undefined, null)).toEqual([])
    expect(ssoEnforcementAccounts(undefined, 'saml.acme', undefined)).toEqual([])
  })
})
