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

import { seedUserProfile } from './user-profiles'

/**
 * AGL-1127. The seed runs on EVERY sign-in — the session-cookie mint calls
 * it, and the SSO route calls it again — so the property that matters is not
 * "does it write the name" but "can running it a hundred times ever undo an
 * edit". These pin both directions.
 */
function fakeFirestore(seed?: Record<string, unknown>) {
  const state: { data: Record<string, unknown> | undefined } = { data: seed }
  const writes: Array<Record<string, unknown>> = []
  return {
    writes,
    state,
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: state.data !== undefined,
          get: (field: string) => state.data?.[field],
        }),
        set: async (data: Record<string, unknown>) => {
          writes.push(data)
          state.data = { ...(state.data ?? {}), ...data }
        },
      }),
    }),
  }
}

describe('seedUserProfile', () => {
  it('creates the doc and splits the provider name into it', async () => {
    const firestore = fakeFirestore()
    const result = await seedUserProfile('uid-1', {
      displayName: 'Zach Gover',
      firestore,
    })
    expect(result).toEqual({ created: true, fields: ['firstName', 'lastName'] })
    expect(firestore.state.data).toMatchObject({
      firstName: 'Zach',
      lastName: 'Gover',
    })
  })

  it('seeds the avatar and phone the assertion carried (AGL-1131)', async () => {
    const firestore = fakeFirestore()
    const result = await seedUserProfile('uid-1', {
      displayName: 'Zach Gover',
      photoUrl: 'https://cdn.example/z.png',
      phoneNumber: '+15125550142',
      firestore,
    })
    expect(result.fields.sort()).toEqual([
      'firstName',
      'lastName',
      'phoneNumber',
      'photoUrl',
    ])
    expect(firestore.state.data).toMatchObject({
      photoUrl: 'https://cdn.example/z.png',
      phoneNumber: '+15125550142',
    })
  })

  it('never replaces an avatar or phone the user set', async () => {
    // Same absent-only rule as the name. An uploaded avatar losing to the
    // directory thumbnail on the next sign-in is the failure to avoid.
    const firestore = fakeFirestore({
      photoUrl: 'https://cdn.example/uploaded.png',
      phoneNumber: '+15125550001',
    })
    const result = await seedUserProfile('uid-1', {
      photoUrl: 'https://directory.example/thumb.png',
      phoneNumber: '+15125559999',
      firestore,
    })
    expect(result).toEqual({ created: false, fields: [] })
    expect(firestore.writes).toEqual([])
  })

  it('writes photoUrl, not the roster spelling photoURL', async () => {
    // Manage Account reads `photoUrl`; writing `photoURL` would add a field
    // nothing renders and leave the avatar looking unseeded.
    const firestore = fakeFirestore()
    await seedUserProfile('uid-1', {
      photoUrl: 'https://cdn.example/z.png',
      firestore,
    })
    expect(Object.keys(firestore.writes[0])).toContain('photoUrl')
    expect(Object.keys(firestore.writes[0])).not.toContain('photoURL')
  })

  it('ignores blank photo and phone rather than writing empty strings', async () => {
    // The callers pass `resolveIdp*(...) || null`, and a written '' would
    // make the field look set and block a later real one.
    const firestore = fakeFirestore()
    const result = await seedUserProfile('uid-1', {
      photoUrl: '   ',
      phoneNumber: null,
      firestore,
    })
    expect(result).toEqual({ created: true, fields: [] })
  })

  it('never overwrites a name the user has edited', async () => {
    // The regression this guards: an IdP whose assertion still says "Zachary
    // Gover" re-asserting it over the "Zach" typed in Basic info, on every
    // single sign-in.
    const firestore = fakeFirestore({ firstName: 'Zach', lastName: 'Gover' })
    const result = await seedUserProfile('uid-1', {
      displayName: 'Zachary Gover-Smith',
      firestore,
    })
    expect(result).toEqual({ created: false, fields: [] })
    expect(firestore.writes).toEqual([])
    expect(firestore.state.data).toEqual({
      firstName: 'Zach',
      lastName: 'Gover',
    })
  })

  it('fills only the half that is missing', async () => {
    const firestore = fakeFirestore({ firstName: 'Zach' })
    const result = await seedUserProfile('uid-1', {
      displayName: 'Zachary Gover',
      firestore,
    })
    expect(result.fields).toEqual(['lastName'])
    expect(firestore.state.data).toMatchObject({
      firstName: 'Zach',
      lastName: 'Gover',
    })
  })

  it('treats a blank stored value as missing, not as an edit', async () => {
    const firestore = fakeFirestore({ firstName: '   ', lastName: '' })
    const result = await seedUserProfile('uid-1', {
      displayName: 'Zach Gover',
      firestore,
    })
    expect(result.fields).toEqual(['firstName', 'lastName'])
  })

  it('still creates the doc when the provider sent no name', async () => {
    // The doc's existence is the point as much as the name is: it is where
    // the avatar and the notification mutes land.
    const firestore = fakeFirestore()
    const result = await seedUserProfile('uid-1', { displayName: null, firestore })
    expect(result).toEqual({ created: true, fields: [] })
    expect(firestore.state.data).toHaveProperty('createdAt')
    expect(firestore.state.data).not.toHaveProperty('firstName')
  })

  it('writes nothing at all for an existing doc with no name to add', async () => {
    const firestore = fakeFirestore({ firstName: 'Zach' })
    await seedUserProfile('uid-1', { displayName: undefined, firestore })
    expect(firestore.writes).toEqual([])
  })

  /**
   * AGL-2486 item 38 — REMOVING YOUR AVATAR HAS TO STICK.
   *
   * Absent-only protects an avatar somebody SET. It does nothing for one they
   * REMOVED, because removing it is what makes the field absent again, and
   * absent is the condition that makes this seed write. So the next sign-in
   * put the directory thumbnail back — from the customer's own IdP, silently,
   * every time, forever. `propagateMemberPhoto` already refuses this on the
   * roster row and says why; this document had no equivalent.
   *
   * The account that PROMPTED the item is the one whose IdP asserts nothing
   * at all, so these deliberately run both assertions: one carrying a picture
   * and one carrying none. A double that always supplies a picture would
   * prove nothing about the real `aglyn-org-y5v14` account, whose auth
   * record, SAML provider entry and profile row are all photo-less.
   */
  describe('the photoUrlErasedAt marker', () => {
    it('does not re-seed an avatar the user removed', async () => {
      const firestore = fakeFirestore({
        firstName: 'Zach',
        lastName: 'Gover',
        // What Manage Account leaves behind on a clear: the field DELETED
        // (so it is absent here, not '') plus the marker.
        photoUrlErasedAt: '2026-08-23T00:00:00.000Z',
      })
      const result = await seedUserProfile('uid-1', {
        photoUrl: 'https://directory.example/thumb.png',
        firestore,
      })
      expect(result).toEqual({ created: false, fields: [] })
      expect(firestore.writes).toEqual([])
      expect(firestore.state.data).not.toHaveProperty('photoUrl')
    })

    it('still seeds the avatar when there is no marker', async () => {
      // The baseline the guard is measured against. Without this, deleting
      // the whole photo branch would leave the test above green.
      const firestore = fakeFirestore({ firstName: 'Zach', lastName: 'Gover' })
      const result = await seedUserProfile('uid-1', {
        photoUrl: 'https://directory.example/thumb.png',
        firestore,
      })
      expect(result.fields).toEqual(['photoUrl'])
      expect(firestore.state.data).toMatchObject({
        photoUrl: 'https://directory.example/thumb.png',
      })
    })

    it('seeds again once the marker is dropped, which is what saving a photo does', async () => {
      // Reversible BY THE PERSON IT PROTECTS and only by them: Manage Account
      // clears the marker on any save that stores a photo, so opting back
      // into IdP prefill is just setting an avatar.
      const firestore = fakeFirestore({ firstName: 'Zach' })
      const result = await seedUserProfile('uid-1', {
        photoUrl: 'https://directory.example/thumb.png',
        firestore,
      })
      expect(result.fields).toEqual(['photoUrl'])
    })

    it('leaves an uploaded avatar alone whether or not a marker is present', async () => {
      // The ORIGINAL invariant, which the marker must not weaken: a photo the
      // user chose is never replaced by the directory's.
      for (const extra of [{}, { photoUrlErasedAt: '2026-08-23T00:00:00.000Z' }]) {
        const firestore = fakeFirestore({
          photoUrl: 'https://cdn.example/uploaded.png',
          ...extra,
        })
        await seedUserProfile('uid-1', {
          photoUrl: 'https://directory.example/thumb.png',
          firestore,
        })
        expect(firestore.state.data).toMatchObject({
          photoUrl: 'https://cdn.example/uploaded.png',
        })
        expect(firestore.writes).toEqual([])
      }
    })

    it('writes no photo for the assertion that carries none, marker or not', async () => {
      // THE MEASURED ACCOUNT. `resolveIdpPhotoUrl` returns '' for the live
      // SAML assertion and both callers pass `|| null`, so this is the input
      // the real SSO account produces on every sign-in. The marker must not
      // turn that into a write, and its absence must not either.
      for (const extra of [{}, { photoUrlErasedAt: '2026-08-23T00:00:00.000Z' }]) {
        const firestore = fakeFirestore({ firstName: 'Zach', ...extra })
        const result = await seedUserProfile('uid-1', {
          photoUrl: null,
          firestore,
        })
        expect(result.fields).not.toContain('photoUrl')
        expect(firestore.state.data).not.toHaveProperty('photoUrl')
      }
    })

    it('does not let the marker block the other seeded fields', async () => {
      // Scoped to the photo. A guard that short-circuited the whole seed
      // would silently stop prefilling names and addresses too.
      const firestore = fakeFirestore({
        photoUrlErasedAt: '2026-08-23T00:00:00.000Z',
      })
      const result = await seedUserProfile('uid-1', {
        displayName: 'Zach Gover',
        photoUrl: 'https://directory.example/thumb.png',
        firestore,
      })
      expect(result.fields.sort()).toEqual(['firstName', 'lastName'])
    })
  })
})
