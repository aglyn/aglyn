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
  authIdentityFillFromIdp,
  resolveAccountIdentity,
  sanitizeAccountPhotoUrl,
} from './account-identity'

/*
 * AGL-3721. The staff Users list and user page showed a grey initial and "—"
 * for an SSO account whose own account menu shows a name and a photo: the
 * staff surfaces read the Auth record alone, and a SAML sign-in leaves it
 * blank. These pin the one precedence every surface now shares.
 */
describe('resolveAccountIdentity precedence (AGL-3721)', () => {
  const auth = {
    displayName: 'Auth Name',
    photoURL: 'https://auth.example/a.png',
    providerData: [{ displayName: 'Provider Name', photoURL: 'https://idp.example/p.png' }],
  }
  const profile = {
    firstName: 'Profile',
    lastName: 'Name',
    photoUrl: 'https://cdn.example/profile.png',
  }
  const idp = { displayName: 'Directory Name', photoURL: 'https://dir.example/d.png' }

  it('prefers the Auth record when it holds both fields', () => {
    expect(resolveAccountIdentity({ auth, profile, idp })).toEqual({
      displayName: 'Auth Name',
      photoUrl: 'https://auth.example/a.png',
      label: 'Auth Name',
      displayNameSource: 'auth',
      photoUrlSource: 'auth',
    })
  })

  it('THE BUG: a blank SSO Auth record falls through to the profile document', () => {
    // The shape of an SSO account in the `aglyn-org-y5v14` tenant:
    // no name, no photo, one provider entry as blank as the record.
    const sso = {
      displayName: null,
      photoURL: undefined,
      providerData: [{ displayName: null, photoURL: null }],
    }
    const resolved = resolveAccountIdentity({ auth: sso, profile, email: 'owner@aglyn.com' })
    expect(resolved.displayName).toBe('Profile Name')
    expect(resolved.photoUrl).toBe('https://cdn.example/profile.png')
    expect(resolved.displayNameSource).toBe('profile')
    expect(resolved.photoUrlSource).toBe('profile')
  })

  it('reaches providerData after the profile, and the IdP copy last', () => {
    const blankAuth = { ...auth, displayName: '', photoURL: '' }
    expect(resolveAccountIdentity({ auth: blankAuth, idp })).toMatchObject({
      displayName: 'Provider Name',
      photoUrl: 'https://idp.example/p.png',
      displayNameSource: 'provider',
      photoUrlSource: 'provider',
    })
    expect(
      resolveAccountIdentity({ auth: { ...blankAuth, providerData: [] }, idp }),
    ).toMatchObject({
      displayName: 'Directory Name',
      photoUrl: 'https://dir.example/d.png',
      displayNameSource: 'idp',
      photoUrlSource: 'idp',
    })
  })

  it('resolves each field independently — a blank never beats a value further down', () => {
    const resolved = resolveAccountIdentity({
      auth: { displayName: 'Auth Name', photoURL: '   ' },
      profile,
    })
    expect(resolved.displayNameSource).toBe('auth')
    expect(resolved.photoUrlSource).toBe('profile')
  })

  it('takes either half of a profile name, and a legacy single name last', () => {
    expect(resolveAccountIdentity({ profile: { firstName: 'Ada' } }).displayName).toBe('Ada')
    expect(resolveAccountIdentity({ profile: { displayName: 'Legacy' } }).displayName).toBe(
      'Legacy',
    )
  })

  it('labels with the email only when no source holds a name', () => {
    const resolved = resolveAccountIdentity({ auth: {}, email: 'a@b.co' })
    expect(resolved).toMatchObject({ displayName: null, photoUrl: null, label: 'a@b.co' })
    expect(resolved.displayNameSource).toBeNull()
  })

  it('never hands a hostile photo to an <img src>', () => {
    const resolved = resolveAccountIdentity({
      auth: { photoURL: 'javascript:alert(1)' },
      profile: { photoUrl: 'data:image/png;base64,AAAA' },
      idp: { photoUrl: 'https://ok.example/x.png' },
    })
    expect(resolved.photoUrl).toBe('https://ok.example/x.png')
    expect(sanitizeAccountPhotoUrl('/media/abc.png')).toBe('/media/abc.png')
    expect(sanitizeAccountPhotoUrl('relative.png')).toBe('')
  })
})

describe('authIdentityFillFromIdp never overwrites (AGL-3721)', () => {
  const idp = { displayName: 'Zach Gover', photoUrl: 'https://dir.example/z.png' }

  it('fills both fields of a blank SSO record', () => {
    expect(authIdentityFillFromIdp({ auth: { displayName: null, photoURL: null }, idp })).toEqual({
      displayName: 'Zach Gover',
      photoURL: 'https://dir.example/z.png',
    })
  })

  it('leaves a name and a photo the person set alone', () => {
    expect(
      authIdentityFillFromIdp({
        auth: { displayName: 'Chosen', photoURL: 'https://mine.example/me.png' },
        idp,
      }),
    ).toEqual({})
    expect(authIdentityFillFromIdp({ auth: { displayName: 'Chosen' }, idp })).toEqual({
      photoURL: 'https://dir.example/z.png',
    })
  })

  it('does not put back an avatar the person removed', () => {
    expect(authIdentityFillFromIdp({ auth: {}, idp, photoErased: true })).toEqual({
      displayName: 'Zach Gover',
    })
  })

  it('fills nothing from an IdP that sent nothing, or a non-https photo', () => {
    expect(authIdentityFillFromIdp({ auth: {}, idp: {} })).toEqual({})
    expect(
      authIdentityFillFromIdp({ auth: {}, idp: { photoUrl: 'http://dir.example/z.png' } }),
    ).toEqual({})
  })
})
