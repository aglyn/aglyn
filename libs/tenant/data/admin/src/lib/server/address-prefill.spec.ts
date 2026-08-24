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
 * AGL-1963 — the address half of the IdP prefill, and the erasure guard that
 * has to come with it. AGL-1566 added the completeness gate: the prefill
 * stores an asserted address only when it carries a street line, because the
 * Workspace SAML app maps a HOME city, region and postcode and no street, and
 * a fragment of somebody's home address is personal data with no use rather
 * than an address.
 *
 * Modelled on `phone-opt-out.spec.ts` deliberately, because the defect has the
 * same shape: `/api/auth/sso-jit` and `/api/auth/session` both call
 * `seedUserProfile` on EVERY sign-in with whatever the customer's directory
 * asserts, and the seed writes whenever the stored field is blank. So deleting
 * an address undoes itself at the next sign-in unless something marks the
 * deletion — and the honoured request and the resurrected address are the same
 * data afterwards.
 *
 * A test that asserted "a flag was written" would prove nothing about that.
 * These drive the real seeding function with the real payload shape the SSO
 * route passes it, repeatedly, the way someone signing in every morning does.
 *
 * `IDP_ASSERTION` is the shape sso-jit builds — `resolveIdpAddress` returns
 * loose parts with every key present, blank when the IdP sent nothing, which
 * is exactly what the seed has to cope with.
 */

import { resolveIdpAddress } from '@aglyn/aglyn/server'
import { fakeFirestore } from './test-firestore'
import { forgetUserAddress, seedUserProfile } from './user-profiles'

const UID = 'sso-uid-address'

const parts = (over: Record<string, string> = {}) => ({
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  ...over,
})

const ADDRESS = {
  line1: '100 Congress Ave',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
}

const IDP_ASSERTION = {
  displayName: 'Zach Gover',
  photoUrl: 'https://directory.example/z.png',
  address: parts(ADDRESS),
}

describe('the IdP address prefill', () => {
  it('seeds a normalized address on the first sign-in', async () => {
    const firestore = fakeFirestore()
    const result = await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(result.fields).toContain('address')
    // `state`, not `region` — the canonical spelling in `AglynPostalAddress`,
    // matching Stripe's customer address, even though Google Workspace calls
    // the source attribute `Region`.
    expect(firestore.docs('users')[UID].address).toEqual(ADDRESS)
  })

  it('never overwrites an address the person typed', async () => {
    const typed = { line1: '1 Private Rd', city: 'Marfa', country: 'US' }
    const firestore = fakeFirestore({ users: { [UID]: { address: typed } } })
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID].address).toEqual(typed)
  })

  it('stores NOTHING when the assertion normalizes to no address at all', async () => {
    // The concrete sparse case AGL-1963 names. A directory that releases only
    // a country, spelled the way humans spell it, has told us nothing usable:
    // `normalizeAddress` drops a country that is not ISO-3166 alpha-2, which
    // leaves the address entirely blank and therefore null. Storing the object
    // would put `{}`-shaped truthiness on the profile that every
    // `if (address)` reads as "has an address".
    const firestore = fakeFirestore()
    const result = await seedUserProfile(UID, {
      address: parts({ country: 'United States' }),
      firestore,
    })
    expect(result.fields).not.toContain('address')
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })

  it('stores nothing for an assertion with no address parts at all', async () => {
    const firestore = fakeFirestore()
    const result = await seedUserProfile(UID, { address: parts(), firestore })
    expect(result.fields).not.toContain('address')
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })

  it('stores NOTHING for a street-less assertion, however many parts it has', async () => {
    // THE AGL-1566 CASE, and the reversal of a judgement this spec previously
    // pinned the other way. AGL-1963 asked that a partial assertion "not
    // produce a half-address that looks populated" and named `normalizeAddress`
    // as the mechanism; that only fires when NOTHING survives, so a locality on
    // its own survived and was stored. It was left that way on the reasoning
    // that Manage Account stores a typed city-only address happily, so a
    // stricter rule here would give an SSO user and a typing user different
    // profiles from the same input.
    //
    // What that reasoning did not have: the `Aglyn Console SSO` app maps
    // `city`, `region` and `postalCode` out of the Directory's HOME address and
    // maps no street row at all. So this is not a rare partial — it is the only
    // address that IdP can assert, it is residential, and the typing user chose
    // to enter a city while the SSO user chose nothing.
    //
    // EXACTLY THE THREE ATTRIBUTES THE WORKSPACE APP MAPS, spelled the way
    // Workspace spells them, so this fails if the gate is removed.
    const firestore = fakeFirestore()
    const result = await seedUserProfile(UID, {
      address: parts({ city: 'Testville', state: 'TX', postalCode: '00000' }),
      firestore,
    })
    expect(result.fields).not.toContain('address')
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })

  it('stores nothing for a city-only assertion either', async () => {
    const firestore = fakeFirestore()
    await seedUserProfile(UID, { address: parts({ city: 'Austin' }), firestore })
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })

  it('still seeds an address that has a street line', async () => {
    // The gate is about completeness, not about refusing the IdP. A directory
    // that releases a real posting address still prefills the form, which is
    // the whole of what AGL-1963 set out to do.
    const firestore = fakeFirestore()
    await seedUserProfile(UID, {
      address: parts({ line1: '100 Congress Ave', city: 'Austin' }),
      firestore,
    })
    expect(firestore.docs('users')[UID].address).toEqual({
      line1: '100 Congress Ave',
      city: 'Austin',
    })
  })

  it('does not treat a blank street line as a street line', async () => {
    // `strictNullChecks` is off repo-wide and a SAML attribute may be mapped
    // and EMPTY — a directory row nobody filled in. `normalizeAddress` drops
    // it, so `line1` is absent rather than `''`, and the gate must read that
    // as no street rather than as a key that is present.
    const firestore = fakeFirestore()
    await seedUserProfile(UID, {
      address: parts({ line1: '   ', city: 'Testville', postalCode: '00000' }),
      firestore,
    })
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })
})

describe('an erased address survives an SSO re-assertion', () => {
  it('does not come back on the next sign-in, or the one after that', async () => {
    const firestore = fakeFirestore()

    // First sign-in: the directory's address lands on the profile, as designed.
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID].address).toEqual(ADDRESS)

    // The person asks us to delete it.
    expect(await forgetUserAddress({ uid: UID, firestore })).toEqual({
      cleared: true,
    })
    // GONE, not nulled: a nulled field still reads as "we hold an address slot
    // for this person", and `FieldValue.delete()` is honoured for real by this
    // fake precisely so the distinction is testable.
    expect(firestore.docs('users')[UID].address).toBeUndefined()

    // THE DEFECT. Two more sign-ins, exactly as the SSO route performs them.
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })

  it('marks the account even when there was no address on file', async () => {
    // Someone who asks us to stop holding their address has asked about the
    // account, not only about the value we happened to have at the time — so a
    // later assertion for this account is refused too.
    const firestore = fakeFirestore()
    expect(await forgetUserAddress({ uid: UID, firestore })).toEqual({
      cleared: false,
    })
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID].address).toBeUndefined()
  })

  it('still seeds the other fields for an address-erased account', async () => {
    // The marker suppresses ONE field. An erasure that quietly stopped the
    // avatar and the name seeding too would be a different request than the
    // one the person made.
    const firestore = fakeFirestore()
    await forgetUserAddress({ uid: UID, firestore })
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID]).toMatchObject({
      firstName: 'Zach',
      lastName: 'Gover',
      photoUrl: 'https://directory.example/z.png',
    })
  })

  it('resumes prefill once the marker is dropped', async () => {
    // Manage Account clears `addressErasedAt` on any save that stores an
    // address, so changing your mind is just filling the field in again. The
    // only party who can undo this is the person it protects.
    const firestore = fakeFirestore()
    await forgetUserAddress({ uid: UID, firestore })
    await firestore
      .collection('users')
      .doc(UID)
      .set({ addressErasedAt: undefined }, { merge: true })
    delete firestore.docs('users')[UID].addressErasedAt

    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID].address).toEqual(ADDRESS)
  })
})

/**
 * The composition, not the halves (AGL-1566).
 *
 * Every console-side spec that touches the SSO routes mocks `resolveIdpAddress`
 * to return all-blank parts, so none of them can tell whether an assertion
 * carrying an address is dropped or merely never arrived. These drive the REAL
 * resolver with the REAL claim shape — attributes under
 * `firebase.sign_in_attributes`, never as top-level claims (AGL-1131) — spelled
 * the way the `Aglyn Console SSO` app spells them, and then the real seed.
 */
describe('a real Workspace assertion, resolver and seed together', () => {
  // The three rows the SAML app maps, sourced from Directory → Contact
  // information → Address (Home). No street row is mapped, which is the whole
  // of why this must not be stored.
  //
  // THE VALUES ARE FICTIONAL ON PURPOSE, and must stay that way (AGL-1491).
  // What these specs prove is the SHAPE of the assertion — a city, a region and
  // a postcode with no street line — and the shape is what the gate reads. The
  // literal values are load-bearing for nothing here: every expectation below
  // compares against these same constants, so they hold identically whatever
  // the strings say.
  //
  // This repo is PUBLIC, and the real rows resolve to a residential address
  // that AGL-1491 exists to get off public surfaces. Pasting it back in the
  // name of fidelity would publish the exact value the gate above was built to
  // stop us STORING — a worse leak than the one it fixes, and permanent,
  // because git history does not forget.
  const workspaceAssertion = {
    firebase: {
      sign_in_attributes: {
        firstName: 'Zach',
        lastName: 'Gover',
        city: 'Testville',
        region: 'TX',
        postalCode: '00000',
      },
    },
  }

  it('resolves the home address components, so the drop is a real drop', () => {
    // Fails on purpose if the resolver stopped reading them: then the seed
    // assertions below would pass for the wrong reason.
    expect(resolveIdpAddress(workspaceAssertion)).toMatchObject({
      city: 'Testville',
      state: 'TX',
      postalCode: '00000',
      line1: '',
    })
  })

  it('stores no address for it', async () => {
    const firestore = fakeFirestore()
    const result = await seedUserProfile('sso-uid-workspace', {
      displayName: 'Zach Gover',
      address: resolveIdpAddress(workspaceAssertion),
      firestore,
    })
    expect(result.fields).not.toContain('address')
    const doc = firestore.docs('users')['sso-uid-workspace']
    expect(doc.address).toBeUndefined()
    // The rest of the prefill is untouched — this gate is about one field.
    expect(doc).toMatchObject({ firstName: 'Zach', lastName: 'Gover' })
  })

  it('stores no address on a second and third sign-in either', async () => {
    // The seed runs on EVERY sign-in. A gate that only held the first time
    // would leak the address to anyone who came back tomorrow.
    const firestore = fakeFirestore()
    const address = resolveIdpAddress(workspaceAssertion)
    for (let i = 0; i < 3; i++) {
      await seedUserProfile('sso-uid-workspace', { address, firestore })
    }
    expect(firestore.docs('users')['sso-uid-workspace'].address).toBeUndefined()
  })

  it('does store one once the directory releases a street row too', async () => {
    // Not a refusal of the IdP: add the street attribute in Workspace and the
    // prefill AGL-1963 built works exactly as designed.
    const firestore = fakeFirestore()
    await seedUserProfile('sso-uid-workspace-full', {
      address: resolveIdpAddress({
        firebase: {
          sign_in_attributes: {
            ...workspaceAssertion.firebase.sign_in_attributes,
            streetAddress: '1 Directory Row',
          },
        },
      }),
      firestore,
    })
    expect(firestore.docs('users')['sso-uid-workspace-full'].address).toEqual({
      line1: '1 Directory Row',
      city: 'Testville',
      state: 'TX',
      postalCode: '00000',
    })
  })
})
