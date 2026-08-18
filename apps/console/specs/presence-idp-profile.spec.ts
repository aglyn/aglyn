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

import { readIdpProfile } from '../hooks/use-presence'

/**
 * Presence listed an SSO colleague by their email address while listing
 * everyone else by name (AGL-675). A SAML user's Firebase user object has
 * `displayName: undefined`, `photoURL: undefined` and an EMPTY
 * `providerData` — the identity is only in the ID token, under
 * `firebase.sign_in_attributes`.
 *
 * The claim shapes below are the ones actually observed on
 * `member@example.com` (SAML, `saml.aglyn-workspace`) and on the Google account,
 * read off the live tokens rather than invented.
 */
function tokenFor(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`
}

describe('readIdpProfile (AGL-675)', () => {
  it('reads a SAML name out of sign_in_attributes', () => {
    const token = tokenFor({
      email: 'member@example.com',
      firebase: {
        sign_in_provider: 'saml.aglyn-workspace',
        sign_in_attributes: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          phoneNumber: '+1 (555) 010-7788',
          email: 'member@example.com',
        },
      },
    })
    expect(readIdpProfile(token).displayName).toBe('Ada Lovelace')
  })

  /**
   * This IdP maps no photo attribute at all, and GCIP promotes nothing to a
   * top-level `picture`. Initials are the correct rendering — there is no
   * image being dropped on the floor.
   */
  it('returns no photo when the assertion carries none', () => {
    const token = tokenFor({
      firebase: {
        sign_in_attributes: { firstName: 'Ada', lastName: 'Lovelace' },
      },
    })
    expect(readIdpProfile(token).photoURL).toBe('')
  })

  it('uses a mapped photo attribute when an IdP does send one', () => {
    const token = tokenFor({
      firebase: {
        sign_in_attributes: {
          firstName: 'Ada',
          photoUrl: 'https://idp.example.com/ada.png',
        },
      },
    })
    expect(readIdpProfile(token)).toEqual({
      displayName: 'Ada',
      photoURL: 'https://idp.example.com/ada.png',
    })
  })

  /** An assertion is trusted to say who someone is, not to supply markup. */
  it('refuses a non-https photo URL', () => {
    const token = tokenFor({
      firebase: {
        sign_in_attributes: {
          firstName: 'Mallory',
          picture: 'javascript:alert(1)',
        },
      },
    })
    expect(readIdpProfile(token).photoURL).toBe('')
  })

  it('finds nothing in a Google token, which needs no fallback', () => {
    const token = tokenFor({
      name: 'Ada Lovelace',
      picture: 'https://lh3.googleusercontent.com/a/abc=s96-c',
      firebase: { sign_in_provider: 'google.com' },
    })
    // The top-level claims ARE resolvable, and harmlessly so — the hook
    // prefers the user object, which is already populated for OAuth.
    expect(readIdpProfile(token).displayName).toBe('Ada Lovelace')
  })

  it('never throws on a token it cannot read', () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.!!!!.c']) {
      expect(readIdpProfile(bad)).toEqual({ displayName: '', photoURL: '' })
    }
  })
})
