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
  resolveIdpAddress,
  resolveIdpDisplayName,
  resolveIdpPhone,
  resolveIdpPhotoUrl,
} from './idp-profile'

/** A decoded token shaped like GCIP's, with SAML attributes where it puts them. */
const saml = (attributes: Record<string, unknown>) => ({
  firebase: { tenant: 'aglyn-org-y5v14', sign_in_attributes: attributes },
})

/**
 * The measured SHAPE of a production SSO ID token payload, with every value
 * replaced by a synthetic one (AGL-2029).
 *
 * It was originally transcribed verbatim from a live member@example.com SSO
 * session on 2026-08-01, which put a real personal phone number and a real
 * production uid into a PUBLIC repository for no test-carrying reason —
 * nothing here asserts anything about the VALUES, only that each claim is read
 * from the right place. So the values are now fictional (555-01xx is the
 * reserved not-a-real-number range) and the fixture proves exactly what it did
 * before.
 *
 * What is preserved, because it IS the point of the fixture, is the structure:
 * the claims live under `firebase.sign_in_attributes`, and note what is NOT
 * here — no top-level `name`, no `picture`. The claim the old code read did not
 * merely hold the wrong value, it was absent, which is why a correct IdP
 * mapping still produced a blank roster row.
 */
const MEASURED_TOKEN = {
  uid: 'QQ7fixtureUid0000000000000001',
  email: 'member@example.com',
  firebase: {
    tenant: 'aglyn-org-y5v14',
    sign_in_provider: 'saml.aglyn-workspace',
    sign_in_attributes: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+1 (555) 010-7788',
      email: 'member@example.com',
    },
  },
}

describe('the measured production SSO token', () => {
  it('yields the name that the console rendered blank', () => {
    expect(resolveIdpDisplayName(MEASURED_TOKEN)).toBe('Ada Lovelace')
  })

  it('yields the phone, in the format the directory holds it', () => {
    expect(resolveIdpPhone(MEASURED_TOKEN)).toBe('+1 (555) 010-7788')
  })

  it('yields no photo, because this IdP maps no photo attribute', () => {
    // Not a bug to chase in code: Workspace has no photo row mapped on this
    // app. Recorded so a later blank avatar is read as an IdP config gap.
    expect(resolveIdpPhotoUrl(MEASURED_TOKEN)).toBe('')
  })

  it('confirms the claim the old code read is absent, not merely wrong', () => {
    expect(MEASURED_TOKEN).not.toHaveProperty('name')
  })
})

describe('resolveIdpDisplayName', () => {
  it('reads a SAML assertion the way GCIP actually delivers it', () => {
    // The regression this exists for. Mapping First/Last name in Workspace and
    // reading `decoded.name` produced nothing, because SAML attributes never
    // land as a top-level claim — they land under sign_in_attributes.
    expect(
      resolveIdpDisplayName(saml({ firstName: 'Ada', lastName: 'Lovelace' })),
    ).toBe('Ada Lovelace')
  })

  it('still prefers a top-level name, which is what OIDC sends', () => {
    expect(
      resolveIdpDisplayName({
        name: 'Ada Lovelace',
        ...saml({ firstName: 'Wrong' }),
      }),
    ).toBe('Ada Lovelace')
  })

  it('accepts the attribute spellings other IdPs use', () => {
    // The customer's IdP admin names these, not us. Okta and ADFS do not
    // follow Workspace's suggestion, and a mismatch renders a blank roster.
    expect(
      resolveIdpDisplayName(saml({ given_name: 'Ada', family_name: 'Lovelace' })),
    ).toBe('Ada Lovelace')
    expect(
      resolveIdpDisplayName(saml({ first_name: 'Ada', last_name: 'Lovelace' })),
    ).toBe('Ada Lovelace')
    expect(
      resolveIdpDisplayName(
        saml({
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Ada',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': 'Lovelace',
        }),
      ),
    ).toBe('Ada Lovelace')
  })

  it('unwraps a single-element array', () => {
    // A SAML attribute may repeat, so the value arrives as an array. Passing
    // that straight through would have written the literal "["Ada"]".
    expect(
      resolveIdpDisplayName(saml({ firstName: ['Ada'], lastName: ['Lovelace'] })),
    ).toBe('Ada Lovelace')
  })

  it('prefers a whole-name attribute over reassembling halves', () => {
    expect(
      resolveIdpDisplayName(
        saml({ displayName: 'Ada, Countess of Lovelace', firstName: 'Ada' }),
      ),
    ).toBe('Ada, Countess of Lovelace')
  })

  it('keeps a first name when the IdP releases only one half', () => {
    expect(resolveIdpDisplayName(saml({ firstName: 'Ada' }))).toBe('Ada')
    expect(resolveIdpDisplayName(saml({ lastName: 'Lovelace' }))).toBe('Lovelace')
  })

  it('returns empty rather than a placeholder when nothing was sent', () => {
    // Callers seed only absent fields; a fabricated name would look like one
    // the user chose and would never get corrected.
    expect(resolveIdpDisplayName(saml({}))).toBe('')
    expect(resolveIdpDisplayName({})).toBe('')
    expect(resolveIdpDisplayName(null)).toBe('')
    expect(resolveIdpDisplayName(undefined)).toBe('')
  })

  it('ignores whitespace-only and non-string values', () => {
    expect(resolveIdpDisplayName({ name: '   ' })).toBe('')
    expect(resolveIdpDisplayName(saml({ firstName: '  ', lastName: 'Lovelace' }))).toBe(
      'Lovelace',
    )
    expect(resolveIdpDisplayName(saml({ firstName: 42, lastName: null }))).toBe('')
  })

  it('trims, so a padded attribute does not become a double space', () => {
    expect(
      resolveIdpDisplayName(saml({ firstName: ' Ada ', lastName: ' Lovelace ' })),
    ).toBe('Ada Lovelace')
  })

  it('survives a token with no firebase claim at all', () => {
    // Email/password accounts have no `firebase.sign_in_attributes`, and this
    // runs on every interactive sign-in — throwing here would break them all.
    expect(resolveIdpDisplayName({ firebase: undefined })).toBe('')
    expect(resolveIdpDisplayName({ firebase: 'not-an-object' })).toBe('')
    expect(resolveIdpDisplayName({ firebase: { sign_in_attributes: 'nope' } })).toBe('')
  })
})

describe('resolveIdpPhotoUrl', () => {
  it('prefers the standard picture claim', () => {
    expect(
      resolveIdpPhotoUrl({ picture: 'https://lh3.googleusercontent.com/a/x' }),
    ).toBe('https://lh3.googleusercontent.com/a/x')
  })

  it('falls back to a mapped SAML attribute', () => {
    expect(
      resolveIdpPhotoUrl(saml({ thumbnailPhotoUrl: 'https://cdn.example/z.png' })),
    ).toBe('https://cdn.example/z.png')
  })

  it('refuses a non-https URL', () => {
    // This value is rendered as an <img src> for every member of the org, so
    // a mapped attribute is an injection point, not just a broken avatar.
    expect(resolveIdpPhotoUrl({ picture: 'javascript:alert(1)' })).toBe('')
    expect(resolveIdpPhotoUrl({ picture: 'data:image/svg+xml,<svg/>' })).toBe('')
    expect(resolveIdpPhotoUrl({ picture: 'http://cdn.example/z.png' })).toBe('')
    expect(resolveIdpPhotoUrl(saml({ picture: 'not a url' }))).toBe('')
  })

  it('returns empty when the IdP releases no photo', () => {
    expect(resolveIdpPhotoUrl(saml({}))).toBe('')
    expect(resolveIdpPhotoUrl(null)).toBe('')
  })
})

describe('resolveIdpPhone', () => {
  it('reads the standard claim and the mapped attribute', () => {
    expect(resolveIdpPhone({ phone_number: '+15125550142' })).toBe('+15125550142')
    expect(resolveIdpPhone(saml({ phoneNumber: '+15125550142' }))).toBe(
      '+15125550142',
    )
    expect(resolveIdpPhone(saml({ telephoneNumber: '512-555-0142' }))).toBe(
      '512-555-0142',
    )
  })

  it('returns a national-format number verbatim', () => {
    // Normalising here would have to guess a country code, which invents
    // digits. The number is left as the directory holds it.
    expect(resolveIdpPhone(saml({ phone: '(512) 555-0142' }))).toBe(
      '(512) 555-0142',
    )
  })

  it('returns empty when the IdP releases no phone', () => {
    expect(resolveIdpPhone(saml({}))).toBe('')
    expect(resolveIdpPhone(undefined)).toBe('')
  })
})

/**
 * AGL-1963. The address was item 6 of AGL-1133 and the only one of the six
 * that never shipped — written as blocked on AGL-1131 mapping attributes,
 * which completed on 2026-08-01.
 *
 * These pin WHERE each part is read from, never what it is worth: deciding
 * whether the parts amount to a storable address is `normalizeAddress`'s job,
 * and this function deliberately returns loose strings so it cannot pre-empt
 * that call.
 */
describe('resolveIdpAddress', () => {
  const EMPTY = {
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }

  it('reads a Google Workspace directory mapping', () => {
    // The names Workspace's SAML attribute mapping offers for the Directory
    // fields AGL-1133 anticipated.
    expect(
      resolveIdpAddress(
        saml({
          streetAddress: '100 Congress Ave',
          locality: 'Austin',
          region: 'TX',
          postalCode: '78701',
          country: 'US',
        }),
      ),
    ).toEqual({
      line1: '100 Congress Ave',
      line2: '',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
  })

  it('reads the ADFS claim URIs and the LDAP short forms', () => {
    // The customer's IdP admin picks these names, not us. Guessing one house
    // style costs a blank address and a support ticket.
    expect(
      resolveIdpAddress(
        saml({
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/streetaddress':
            '1 Microsoft Way',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/stateorprovince':
            'WA',
        }),
      ),
    ).toMatchObject({ line1: '1 Microsoft Way', state: 'WA' })
    expect(resolveIdpAddress(saml({ l: 'Austin', st: 'TX', c: 'US' }))).toMatchObject(
      { city: 'Austin', state: 'TX', country: 'US' },
    )
  })

  it('reads the OIDC address claim, which is an OBJECT not a string', () => {
    // OpenID Connect Core 5.1.1. SAML has no equivalent — its attributes are
    // flat — so this arm exists only for OIDC providers.
    expect(
      resolveIdpAddress({
        address: {
          street_address: '100 Congress Ave',
          locality: 'Austin',
          region: 'TX',
          postal_code: '78701',
          country: 'US',
        },
      }),
    ).toMatchObject({
      line1: '100 Congress Ave',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
  })

  it('prefers a mapped SAML attribute over the OIDC claim', () => {
    // An org that mapped its directory into the assertion has said what it
    // wants used.
    const both = {
      ...saml({ locality: 'Austin' }),
      address: { locality: 'Seattle' },
    }
    expect(resolveIdpAddress(both).city).toBe('Austin')
  })

  it('takes the first element of a repeated SAML attribute', () => {
    // The assertion permits repeats and GCIP passes the array through.
    expect(resolveIdpAddress(saml({ locality: ['Austin'] })).city).toBe('Austin')
  })

  it('returns loose parts, never a half-built address object', () => {
    // A city and nothing else is a normal directory. Returning it as parts
    // lets `normalizeAddress` refuse it; returning it as an object would hand
    // every `if (address)` something truthy holding no street.
    expect(resolveIdpAddress(saml({ locality: 'Austin' }))).toEqual({
      ...EMPTY,
      city: 'Austin',
    })
  })

  it('returns empty parts when the IdP releases no address', () => {
    // Including for an account with no `firebase` claim at all — every
    // email/password sign-in runs through this.
    expect(resolveIdpAddress(saml({}))).toEqual(EMPTY)
    expect(resolveIdpAddress({ name: 'Zach Gover' })).toEqual(EMPTY)
    expect(resolveIdpAddress(undefined)).toEqual(EMPTY)
    expect(resolveIdpAddress(null)).toEqual(EMPTY)
  })

  it('is not confused by an address claim that is a STRING', () => {
    // Some providers send a single formatted line. It is not the OIDC object
    // shape, and reading `.locality` off a string yields undefined rather
    // than throwing — assert it stays empty rather than half-read.
    expect(resolveIdpAddress({ address: '100 Congress Ave, Austin TX' })).toEqual(
      EMPTY,
    )
  })
})
