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
 * AGL-3270 — presence announces the avatar THE CONSOLE SHOWS, not the one the
 * auth record happens to hold.
 *
 * THE MEASUREMENT, on a staff account governed by SSO — the property that
 * matters is that its uid is NOT in the project pool: `getUser(uid)` there
 * answers `auth/user-not-found`. Read on 2026-09-22: `users/{uid}.photoUrl`
 * held a photo, every `orgs/{orgId}/members/{uid}.photoURL` held the same one,
 * and the live RTDB presence row held `colour`, `displayName`, `lastSeenAt`,
 * `selectedNodeId` and NO `photoURL` key at all. So the room, the summary
 * endpoint and the list-row chips each had nothing to give `MemberAvatar` and
 * all three drew initials, under a header showing the picture.
 *
 * The writer resolved `user.photoURL || idp.photoURL`, and for an SSO identity
 * both are empty — `sso-avatar-is-the-users-to-set.spec.ts` measured that from
 * the other end: a Google Workspace SAML app maps no picture attribute, so the
 * assertion carries none and the auth record is never filled. The photo such a
 * person has is the one they SET, on `users/{uid}.photoUrl`, and `useUserPhoto`
 * is already the join that reads it (AGL-1961).
 *
 * Asserted over stripped source: the fix's own comment names `user.photoURL`
 * and `idp.photoURL` while explaining what it replaced, so a raw-text negative
 * would be satisfied by the prose describing the bug. The hook mounts a
 * Firebase app, a second auth instance and an RTDB subscription, so rendering
 * it would be a test of the mocks.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from './source-text'

const HOOK = code(
  readFileSync(join(__dirname, '..', 'hooks', 'use-presence.ts'), 'utf8'),
  'hooks/use-presence.ts',
)

/** The identity block, up to the ref that follows it. */
function photoChain(): string {
  const start = HOOK.indexOf('const photoURL =')
  expect(start).toBeGreaterThan(-1)
  const end = HOOK.indexOf('const userRef = useRef', start)
  expect(end).toBeGreaterThan(start)
  return HOOK.slice(start, end)
}

describe('the photo presence announces (AGL-3270)', () => {
  it('is the console-wide join, not a second opinion about where a photo lives', () => {
    // `useUserPhoto` = profile document, then the auth record, blank-not-null.
    // Reading the document here directly would be a THIRD answer to a question
    // that already has one, and the header and the room would drift apart the
    // next time either changed.
    expect(HOOK).toContain('const consolePhotoURL = useUserPhoto()')
    expect(HOOK).toContain('const photoURL = consolePhotoURL || idp.photoURL')
  })

  it('comes from the shared hook, not a local re-read of users/{uid}', () => {
    expect(HOOK).toContain(
      "import { useUser, useUserPhoto } from '@aglyn/tenant-feature-instance'",
    )
    // The profile document is that hook's business. A `doc(firestore, 'users',`
    // in here is the re-implementation this case exists to refuse — and it
    // would also get the field's casing wrong sooner or later, since the
    // profile document spells it `photoUrl` and the roster spells it
    // `photoURL`.
    expect(HOOK).not.toContain("'users'")
  })

  it('no longer resolves the auth record as the FIRST source', () => {
    // The defect exactly: `user.photoURL || idp.photoURL`, which is empty
    // twice over for a tenanted account. The auth record is still reached —
    // inside `useUserPhoto`, as the fallback — but never ahead of the document
    // the person actually writes to.
    expect(photoChain()).not.toMatch(/user as \{ photoURL\?: string \}/)
  })

  it('keeps the IdP claim as the last resort, so a mapping IdP still works', () => {
    // An IdP that DOES map a picture is the one case the profile document may
    // not have caught up with yet — `seedUserProfile` writes it on sign-in,
    // and this tab may be announcing before that write is visible here.
    expect(photoChain()).toContain('|| idp.photoURL')
  })

  it('re-announces when the photo resolves, because it arrives asynchronously', () => {
    // The profile document is a Firestore listen: the first render has no
    // photo and a later one does. If `photoURL` left the announce effect's
    // dependencies, the row written at mount — the one without a picture —
    // would be the row everyone else reads for the life of the session.
    const start = HOOK.lastIndexOf('}, [\n    session,')
    expect(start).toBeGreaterThan(-1)
    const deps = HOOK.slice(start, HOOK.indexOf('])', start))
    expect(deps).toContain('photoURL')
    expect(deps).toContain('displayName')
  })
})
