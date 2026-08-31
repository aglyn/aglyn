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

import { accountPhotoProfilePatch } from './account-photo-payload'

/**
 * AGL-2486 item 38. The SSO account `staff@aglyn.com` renders an initial
 * because its IdP asserts no `picture` attribute — measured, not assumed:
 * the tenant auth record, its `saml.aglyn-workspace` provider entry and
 * `users/{uid}` are all photo-less after a sign-in three weeks after the
 * mapping shipped. So the avatar is the user's to set, and the property that
 * has to hold is that SETTING AND CHANGING it survives the next sign-in.
 *
 * The half that did not hold was the clear. These pin the two sentinels
 * literally, because "which sentinel" IS the behaviour — an assertion on
 * `photoUrl` alone passes with the field blanked to `''`, which is the bug.
 */
const DELETE = Symbol('deleteField')
const STAMP = Symbol('serverTimestamp')
const sentinels = {
  deleteField: () => DELETE,
  serverTimestamp: () => STAMP,
}

describe('accountPhotoProfilePatch', () => {
  it('stores the chosen avatar and drops any removal marker', () => {
    expect(
      accountPhotoProfilePatch('https://cdn.example/z.png', sentinels),
    ).toEqual({
      photoUrl: 'https://cdn.example/z.png',
      // Symmetric: choosing a picture is how you opt back into IdP prefill,
      // so the marker must come OFF here, not merely be left alone.
      photoUrlErasedAt: DELETE,
    })
  })

  it('accepts a media-library CDN path, which is not absolute', () => {
    // What the card's own Browse button produces (AGL-2286). The https check
    // lives in `normalizeMemberPhotoUrl`; this function must not second-guess
    // it, or every avatar picked from the library would be treated as a clear.
    expect(
      accountPhotoProfilePatch('/api/media/cdn/org:o1/m1', sentinels),
    ).toEqual({
      photoUrl: '/api/media/cdn/org:o1/m1',
      photoUrlErasedAt: DELETE,
    })
  })

  it('DELETES the field on a clear rather than storing an empty string', () => {
    // `seedUserProfile`'s `blank()` reads `''` as absent, so storing the blank
    // is what let the IdP write the avatar back on the next sign-in.
    // `strictNullChecks` is off repo-wide, so `''` is a value this codebase
    // really does produce and really does have to distinguish.
    expect(accountPhotoProfilePatch('', sentinels)).toEqual({
      photoUrl: DELETE,
      photoUrlErasedAt: STAMP,
    })
  })

  it('treats whitespace as a clear, not as an avatar made of spaces', () => {
    expect(accountPhotoProfilePatch('   ', sentinels)).toEqual({
      photoUrl: DELETE,
      photoUrlErasedAt: STAMP,
    })
  })

  it('MARKS the removal, because deletion alone cannot say a removal happened', () => {
    // The whole point, stated on its own so it cannot be lost in a refactor
    // that keeps the delete and drops the marker: an absent field is exactly
    // what an account that never had an avatar looks like, and that is the
    // state that makes the seed write.
    const patch = accountPhotoProfilePatch('', sentinels)
    expect(patch.photoUrlErasedAt).toBe(STAMP)
    expect(patch.photoUrlErasedAt).not.toBe(DELETE)
  })
})
