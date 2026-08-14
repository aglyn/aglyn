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
  isPhoneContactSuppressed,
  suppressPhoneContact,
} from './contact-suppression'
import { fakeFirestore } from './test-firestore'
import { forgetUserPhoneNumber, seedUserProfile } from './user-profiles'

/**
 * AGL-1592 — THE DEFECT THIS ISSUE IS ABOUT.
 *
 * `/api/auth/sso-jit` and `/api/auth/session` both call `seedUserProfile` on
 * EVERY sign-in, with the phone number the customer's IdP asserts, and the
 * seed writes whenever the stored field is blank. Clearing
 * `users/{uid}.phoneNumber` therefore undoes itself at the next sign-in, with
 * no trace: the honoured request and the resurrected number are the same data.
 *
 * A test that only asserts "a flag was written" proves nothing about that. So
 * these drive the real seeding function with the real IdP payload the SSO
 * route passes it, repeatedly, the way a person signing in every morning
 * would.
 *
 * `IDP_ASSERTION` is exactly the shape sso-jit builds at route.ts:153-157.
 */
const UID = 'sso-uid-1'
const PHONE = '+15125550123'
const IDP_ASSERTION = {
  displayName: 'Zach Gover',
  photoUrl: 'https://directory.example/z.png',
  phoneNumber: PHONE,
}

describe('an erased phone number survives an SSO re-assertion', () => {
  it('does not come back on the next sign-in, or the one after that', async () => {
    const firestore = fakeFirestore()

    // First sign-in: the IdP's number lands on the profile, as designed.
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(firestore.docs('users')[UID].phoneNumber).toBe(PHONE)

    // The user emails privacy@aglyn.com and asks us to delete it.
    const result = await forgetUserPhoneNumber({ uid: UID, firestore })
    expect(result).toEqual({ cleared: true, suppressed: PHONE })
    expect(firestore.docs('users')[UID].phoneNumber).toBeUndefined()

    // Every subsequent sign-in re-asserts the same number from the IdP.
    for (let signIn = 0; signIn < 5; signIn += 1) {
      const seeded = await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
      expect(seeded.fields).not.toContain('phoneNumber')
    }
    expect(firestore.docs('users')[UID].phoneNumber).toBeUndefined()
  })

  it('still re-asserts the OTHER profile fields, so the fix is narrow', async () => {
    // The guard must not turn into "SSO stops prefilling profiles". Only the
    // phone was asked about.
    const firestore = fakeFirestore()
    await forgetUserPhoneNumber({ uid: UID, phoneNumber: PHONE, firestore })
    const seeded = await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(seeded.fields.sort()).toEqual(['firstName', 'lastName', 'photoUrl'])
    expect(firestore.docs('users')[UID]).toMatchObject({
      firstName: 'Zach',
      photoUrl: 'https://directory.example/z.png',
    })
  })

  it('blocks re-assertion for a DIFFERENT uid on the same number', async () => {
    // The per-account marker cannot see this case: a reprovisioned SSO
    // account, or the same human signing up self-serve beside their SSO seat,
    // arrives with a brand-new `users/{uid}` and no marker on it. The
    // number-keyed record is what catches it.
    const firestore = fakeFirestore()
    await forgetUserPhoneNumber({ uid: UID, phoneNumber: PHONE, firestore })

    const seeded = await seedUserProfile('a-brand-new-uid', {
      ...IDP_ASSERTION,
      firestore,
    })
    expect(seeded.fields).not.toContain('phoneNumber')
    expect(firestore.docs('users')['a-brand-new-uid'].phoneNumber).toBeUndefined()
  })

  it('recognizes the number however the IdP happens to format it', async () => {
    // A guard keyed on the literal string would be defeated by an IdP that
    // asserts `(512) 555-0123` where the erasure recorded `+15125550123`.
    const firestore = fakeFirestore()
    await forgetUserPhoneNumber({ uid: UID, phoneNumber: PHONE, firestore })
    const seeded = await seedUserProfile('another-uid', {
      phoneNumber: '(512) 555-0123',
      firestore,
    })
    expect(seeded.fields).not.toContain('phoneNumber')
  })

  it('leaves the number ON the suppression list — that is what makes it enforceable', async () => {
    const firestore = fakeFirestore()
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    await forgetUserPhoneNumber({ uid: UID, firestore })

    // Deleted from the profile...
    expect(firestore.docs('users')[UID].phoneNumber).toBeUndefined()
    // ...and still recognizable, which is the only way a later outbound
    // programme can know not to dial it.
    expect(await isPhoneContactSuppressed(PHONE, 'calls', firestore)).toBe(true)
  })

  it('records the erasure even when we hold no number to erase', async () => {
    // Someone can ask us to stop holding a number we never stored. The
    // account-level marker still has to be set, or their next sign-in stores
    // one for the first time.
    const firestore = fakeFirestore()
    const result = await forgetUserPhoneNumber({ uid: UID, firestore })
    expect(result).toEqual({ cleared: false, suppressed: null })

    const seeded = await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(seeded.fields).not.toContain('phoneNumber')
  })
})

describe('"stop contacting me" and "delete my number" stay distinct', () => {
  it('a plain do-not-call does NOT delete the number from the profile', async () => {
    const firestore = fakeFirestore()
    await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    await suppressPhoneContact({
      phoneNumber: PHONE,
      source: 'verbal',
      firestore,
    })
    // They asked us not to call. They did not ask us to drop the number, and
    // answering a question nobody asked is its own defect.
    expect(firestore.docs('users')[UID].phoneNumber).toBe(PHONE)
  })

  it('a plain do-not-call does NOT block the IdP prefill either', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({
      phoneNumber: PHONE,
      source: 'sms-keyword',
      channels: ['texts'],
      firestore,
    })
    const seeded = await seedUserProfile('fresh-uid', {
      ...IDP_ASSERTION,
      firestore,
    })
    expect(seeded.fields).toContain('phoneNumber')
    // Storing it and being allowed to text it are different questions.
    expect(await isPhoneContactSuppressed(PHONE, 'texts', firestore)).toBe(true)
  })

  it('the seed fails CLOSED when the suppression list cannot be read', async () => {
    // Unable to say whether this number was erased on request → do not
    // re-store it. A cosmetic prefill is worth nothing against that.
    const users: Record<string, any> = {}
    const halfBroken: any = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            if (name === 'contactSuppressions') throw new Error('unavailable')
            return { exists: users[id] !== undefined, get: (f: string) => users[id]?.[f] }
          },
          set: async (data: Record<string, any>) => {
            users[id] = { ...(users[id] ?? {}), ...data }
          },
        }),
      }),
    }
    const seeded = await seedUserProfile(UID, {
      ...IDP_ASSERTION,
      firestore: halfBroken,
    })
    expect(seeded.fields).not.toContain('phoneNumber')
    expect(seeded.fields).toContain('firstName')
  })
})

describe('opting back in', () => {
  it('a revoked erasure lets the IdP prefill again', async () => {
    const firestore = fakeFirestore()
    await forgetUserPhoneNumber({ uid: UID, phoneNumber: PHONE, firestore })
    const { releasePhoneContact } = await import('./contact-suppression')
    await releasePhoneContact({ phoneNumber: PHONE, firestore })

    // A different account, so the per-account marker is not in the way — this
    // is asserting that the number-keyed guard respects the revocation.
    const seeded = await seedUserProfile('post-revoke-uid', {
      ...IDP_ASSERTION,
      firestore,
    })
    expect(seeded.fields).toContain('phoneNumber')
  })

  it('but the account marker still holds for the account that asked', async () => {
    // Revoking the do-not-contact record is not the same statement as "please
    // start holding my number again", and the conservative reading is the one
    // that does not re-store data somebody asked us to drop. They can type it
    // back in themselves.
    const firestore = fakeFirestore()
    await forgetUserPhoneNumber({ uid: UID, phoneNumber: PHONE, firestore })
    const { releasePhoneContact } = await import('./contact-suppression')
    await releasePhoneContact({ phoneNumber: PHONE, firestore })

    const seeded = await seedUserProfile(UID, { ...IDP_ASSERTION, firestore })
    expect(seeded.fields).not.toContain('phoneNumber')
  })
})
