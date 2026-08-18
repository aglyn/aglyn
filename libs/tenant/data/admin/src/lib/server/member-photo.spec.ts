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

import { backfillMemberIdentity } from './organizations'
import {
  normalizeMemberPhotoUrl,
  propagateMemberPhoto,
} from './member-photo'

/**
 * AGL-1976. Two writers touch `orgs/{orgId}/members/{uid}.photoURL` and they
 * have OPPOSITE rules, which is the whole point of testing them in one file:
 *
 *   - `backfillMemberIdentity` is absent-only — an IdP directory thumbnail
 *     must never replace a photo somebody uploaded, and it re-runs on every
 *     single SSO sign-in, so an overwriting version would undo the choice
 *     forever;
 *   - `propagateMemberPhoto` overwrites — a person who opened Manage Account
 *     and pressed Save stated a preference, and a write that declined to
 *     replace the IdP thumbnail already on the row would leave them unable to
 *     change their own picture.
 *
 * A future refactor that "unifies" them into one helper breaks one of these
 * two directions, and both are asserted below.
 */

/** Sentinel for the delete sentinel — `FieldValue.delete()` is opaque. */
const DELETED = 'FIELD-DELETED'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => DELETED },
}))

/**
 * A Firestore double that models the behaviours this code actually depends on
 * (a faithful double is the difference between a real green and a fabricated
 * one): `set(..., {merge:true})` merges rather than replaces, `exists`
 * distinguishes a missing roster row from an empty one, and the delete
 * sentinel REMOVES the key rather than storing an object.
 */
function fakeDb(seed: {
  /** orgIds listed under `users/{uid}/orgs`. */
  memberships: string[]
  /** roster rows that actually exist, by orgId. */
  rows: Record<string, Record<string, unknown>>
}) {
  const rows: Record<string, Record<string, unknown>> = { ...seed.rows }
  const writes: Array<{ orgId: string; data: Record<string, unknown> }> = []

  const memberDoc = (orgId: string) => ({
    get: async () => ({
      exists: rows[orgId] !== undefined,
      get: (field: string) => rows[orgId]?.[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ orgId, data })
      const next = options?.merge ? { ...(rows[orgId] ?? {}) } : {}
      for (const [key, value] of Object.entries(data)) {
        if (value === DELETED) delete next[key]
        else next[key] = value
      }
      rows[orgId] = next
    },
  })

  return {
    rows,
    writes,
    collection: (name: string) => ({
      doc: (id: string) => ({
        collection: (sub: string) => ({
          doc: () =>
            name === 'orgs' && sub === 'members'
              ? memberDoc(id)
              : (undefined as never),
          get: async () => ({
            docs: seed.memberships.map((orgId) => ({ id: orgId })),
          }),
        }),
      }),
    }),
  } as any
}

describe('normalizeMemberPhotoUrl', () => {
  it('refuses everything that is not https', () => {
    // The value becomes an <img src> in front of every colleague. These are
    // the schemes that turn an avatar into script execution.
    expect(normalizeMemberPhotoUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'not-https',
    })
    expect(normalizeMemberPhotoUrl('data:image/svg+xml,<svg/>')).toEqual({
      ok: false,
      reason: 'not-https',
    })
    expect(normalizeMemberPhotoUrl('http://cdn.example/z.png')).toEqual({
      ok: false,
      reason: 'not-https',
    })
  })

  it('accepts an https url and treats blank as a clear', () => {
    expect(normalizeMemberPhotoUrl('  https://cdn.example/z.png  ')).toEqual({
      ok: true,
      photoURL: 'https://cdn.example/z.png',
      clearing: false,
    })
    expect(normalizeMemberPhotoUrl('')).toEqual({
      ok: true,
      photoURL: '',
      clearing: true,
    })
    expect(normalizeMemberPhotoUrl(null)).toEqual({
      ok: true,
      photoURL: '',
      clearing: true,
    })
  })

  it('refuses an over-long url', () => {
    expect(
      normalizeMemberPhotoUrl(`https://cdn.example/${'z'.repeat(600)}.png`),
    ).toEqual({ ok: false, reason: 'too-long' })
  })
})

describe('propagateMemberPhoto', () => {
  it('reaches EVERY org the member belongs to', async () => {
    // The measured shape (AGL-1976): 1 of 10 member rows across 6 orgs carried
    // a photo, because nothing propagated a self-chosen one to any of them.
    const db = fakeDb({
      memberships: ['org-a', 'org-b'],
      rows: {
        'org-a': { role: 'owner', allHosts: true },
        'org-b': { role: 'viewer', hostAccess: { h1: 'editor' } },
      },
    })
    const result = await propagateMemberPhoto({
      uid: 'u1',
      photoURL: 'https://cdn.example/z.png',
      firestore: db,
    })
    expect(result.orgIds.sort()).toEqual(['org-a', 'org-b'])
    expect(db.rows['org-a']['photoURL']).toBe('https://cdn.example/z.png')
    expect(db.rows['org-b']['photoURL']).toBe('https://cdn.example/z.png')
  })

  it('writes photoURL and NOTHING else', async () => {
    // The roster row is a permissions document. Every write here carries
    // exactly one key, so role/allHosts/hostAccess/roleId are untouched by
    // construction rather than by remembering.
    const db = fakeDb({
      memberships: ['org-a'],
      rows: {
        'org-a': {
          role: 'admin',
          allHosts: true,
          hostAccess: { h1: 'editor' },
          roleId: 'custom-1',
        },
      },
    })
    await propagateMemberPhoto({
      uid: 'u1',
      photoURL: 'https://cdn.example/z.png',
      firestore: db,
    })
    expect(Object.keys(db.writes[0].data)).toEqual(['photoURL'])
    expect(db.rows['org-a']).toMatchObject({
      role: 'admin',
      allHosts: true,
      hostAccess: { h1: 'editor' },
      roleId: 'custom-1',
    })
  })

  it('clears by REMOVING the key, not by storing a blank', async () => {
    // A blank string reads as absent to `backfillMemberIdentity`'s blank()
    // check either way, but storing '' leaves a field on a permissions
    // document that means nothing. Removal is the honest state.
    const db = fakeDb({
      memberships: ['org-a'],
      rows: { 'org-a': { role: 'owner', photoURL: 'https://cdn.example/old.png' } },
    })
    const result = await propagateMemberPhoto({
      uid: 'u1',
      photoURL: '',
      firestore: db,
    })
    expect(result.cleared).toBe(true)
    expect('photoURL' in db.rows['org-a']).toBe(false)
    expect(db.rows['org-a']['role']).toBe('owner')
  })

  it('never creates a roster row that does not exist', async () => {
    // A row minted here would have no `role`, which every permission check
    // that asks only whether the doc exists reads as a member (AGL-1122).
    const db = fakeDb({ memberships: ['org-a', 'ghost'], rows: { 'org-a': { role: 'owner' } } })
    const result = await propagateMemberPhoto({
      uid: 'u1',
      photoURL: 'https://cdn.example/z.png',
      firestore: db,
    })
    expect(result.orgIds).toEqual(['org-a'])
    expect(result.missingRows).toEqual(['ghost'])
    expect(db.rows['ghost']).toBeUndefined()
  })

  it('throws rather than storing a non-https value', async () => {
    const db = fakeDb({ memberships: ['org-a'], rows: { 'org-a': { role: 'owner' } } })
    await expect(
      propagateMemberPhoto({
        uid: 'u1',
        photoURL: 'javascript:alert(1)',
        firestore: db,
      }),
    ).rejects.toThrow(/not-https/)
    expect(db.writes).toEqual([])
  })
})

describe('the two writers of members.photoURL disagree on purpose', () => {
  it('an EXPLICIT save wins over a photo already on the row', async () => {
    const db = fakeDb({
      memberships: ['org-a'],
      rows: { 'org-a': { role: 'owner', photoURL: 'https://idp.example/thumb.png' } },
    })
    await propagateMemberPhoto({
      uid: 'u1',
      photoURL: 'https://cdn.example/mine.png',
      firestore: db,
    })
    expect(db.rows['org-a']['photoURL']).toBe('https://cdn.example/mine.png')
  })

  it('an IdP SEED does not clobber what the person chose', async () => {
    // Same starting row, opposite writer. `backfillMemberIdentity` runs on
    // every SSO sign-in; if this ever went green the other way, a person's
    // uploaded avatar would be replaced by their directory thumbnail on their
    // next sign-in, permanently and silently.
    const db = fakeDb({
      memberships: ['org-a'],
      rows: { 'org-a': { role: 'owner', photoURL: 'https://cdn.example/mine.png' } },
    })
    const written = await backfillMemberIdentity(
      'org-a',
      'u1',
      { photoURL: 'https://idp.example/thumb.png' },
      db,
    )
    expect(written).toEqual([])
    expect(db.rows['org-a']['photoURL']).toBe('https://cdn.example/mine.png')
  })

  it('an IdP seed still fills a row the person has left blank', async () => {
    // The absent-only rule is a floor, not a refusal to ever write — this is
    // the case AGL-1131 exists for and it must keep working.
    const db = fakeDb({ memberships: ['org-a'], rows: { 'org-a': { role: 'owner' } } })
    const written = await backfillMemberIdentity(
      'org-a',
      'u1',
      { photoURL: 'https://idp.example/thumb.png' },
      db,
    )
    expect(written).toEqual(['photoURL'])
    expect(db.rows['org-a']['photoURL']).toBe('https://idp.example/thumb.png')
  })
})
