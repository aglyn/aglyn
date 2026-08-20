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
 * has to come with it.
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

  it('keeps a partial address that normalizeAddress keeps', async () => {
    // PINNED BECAUSE IT IS A JUDGEMENT CALL. AGL-1963 asks that a partial
    // assertion "not produce a half-address that looks populated", and the
    // mechanism it names — `normalizeAddress` returning null — only fires when
    // NOTHING survives. A city on its own does survive.
    //
    // Deliberately not tightened here. `normalizeAddress` is the canonical
    // rule and Manage Account stores a city-only address happily when someone
    // types one, so a second, stricter rule in the seed would mean an SSO user
    // and a typing user end up with different profiles from the same input.
    // Nothing on this document feeds tax or shipping; the field is editable and
    // visible. The case that actually bites — parts that amount to nothing — is
    // the test above.
    const firestore = fakeFirestore()
    await seedUserProfile(UID, { address: parts({ city: 'Austin' }), firestore })
    expect(firestore.docs('users')[UID].address).toEqual({ city: 'Austin' })
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
