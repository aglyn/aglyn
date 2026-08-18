/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (AGL-1440 lore).
 *
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
 * AGL-1961: the app bar must show the avatar the user actually has.
 *
 * `useUserPhoto` resolved the Firebase Auth record's `photoURL` alone. Nothing
 * writes that field except an interactive save on Manage Account — while
 * `seedUserProfile` writes the identity provider's picture to
 * `users/{uid}.photoUrl` on EVERY sign-in, and `user-profiles.ts` calls that
 * document "the avatar the console shows for you". So an SSO account whose
 * IdP maps a picture attribute had one stored on every sign-in and still drew
 * a grey initial in the header, while Manage Account's own card — which
 * already resolved `photoUrl ?? photoURL` — showed the photo. One user, two
 * answers.
 *
 * Note the casing: `photoUrl` on the profile document, `photoURL` on the auth
 * record and the roster. A read against the wrong one yields nothing forever
 * and looks exactly like "this user has no photo", which is why each case
 * below names the store it is asserting about.
 */

import { render } from '@testing-library/react'

let mockUser: { uid?: string; photoURL?: string | null } | null | undefined
let mockDoc: { photoUrl?: unknown } | undefined
/** The ref the hook asked for, so "opens no listen" is observable. */
let builtRef: unknown

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
}))

jest.mock('./firebase/firebase-services', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
}))

jest.mock('./use-firestore-doc', () => ({
  __esModule: true,
  useFirestoreDoc: (buildRef: () => unknown) => {
    builtRef = buildRef()
    return { data: builtRef ? mockDoc : undefined }
  },
}))

import { useUserPhoto } from './use-user-photo'

/** Renders the hook and hands back exactly what it returned. */
function resolve(): string | undefined {
  let seen: string | undefined
  function Probe() {
    seen = useUserPhoto()
    return null
  }
  render(<Probe />)
  return seen
}

describe('useUserPhoto (AGL-1961)', () => {
  beforeEach(() => {
    mockUser = { uid: 'QQ7fixtureUid0000000000000001', photoURL: null }
    mockDoc = undefined
    builtRef = undefined
  })

  it('renders the photo the IdP seeded onto the profile document', () => {
    // The defect, exactly: stored by `seedUserProfile` on every sign-in,
    // never mirrored onto the auth record, so the header showed nothing.
    mockDoc = { photoUrl: 'https://cdn.example/from-idp.png' }
    expect(resolve()).toBe('https://cdn.example/from-idp.png')
  })

  it('reads the profile document at users/{uid}', () => {
    // Guards the casing and the path together. A read of `users/{uid}` with
    // the roster's `photoURL` spelling would satisfy every other case here
    // by returning undefined and falling through to the auth record.
    resolve()
    expect(builtRef).toEqual({ path: 'users/QQ7fixtureUid0000000000000001' })
  })

  it('prefers the profile document over a stale auth photoURL', () => {
    // Manage Account writes the document and THEN calls `updateProfile`; a
    // failure between the two used to leave every surface on the old value.
    mockUser = { uid: 'u1', photoURL: 'https://cdn.example/stale.png' }
    mockDoc = { photoUrl: 'https://cdn.example/current.png' }
    expect(resolve()).toBe('https://cdn.example/current.png')
  })

  it('CONTROL — the auth photoURL still answers when the document has none', () => {
    // Without this, "always read the document" would also pass, and every
    // social-sign-in account would lose the avatar it has today.
    mockUser = { uid: 'u1', photoURL: 'https://cdn.example/google.png' }
    mockDoc = {}
    expect(resolve()).toBe('https://cdn.example/google.png')
  })

  it('CONTROL — a blank document value falls through rather than winning', () => {
    // `??` would let `''` beat a real auth photo. Blank-not-null is the join.
    mockUser = { uid: 'u1', photoURL: 'https://cdn.example/google.png' }
    mockDoc = { photoUrl: '   ' }
    expect(resolve()).toBe('https://cdn.example/google.png')
  })

  it('CONTROL — nothing anywhere is undefined, so callers draw initials', () => {
    // The measured state of `zach@aglyn.com` on 2026-08-18. This is the case
    // that must keep returning falsy: `MemberAvatar` and the account chip
    // treat any truthy value as an `<img src>`, and AGL-1683 removed the
    // vendor that used to make this branch unreachable.
    mockUser = { uid: 'u1', photoURL: null }
    mockDoc = {}
    expect(resolve()).toBeUndefined()
  })

  it('opens no listen at all before a uid resolves', () => {
    // A signed-out mount must not subscribe to `users/undefined` — that is a
    // refused read per mount, and a denial streak is what trips the session
    // re-auth reporting (AGL-1066).
    mockUser = null
    expect(resolve()).toBeUndefined()
    expect(builtRef).toBeNull()
  })
})
