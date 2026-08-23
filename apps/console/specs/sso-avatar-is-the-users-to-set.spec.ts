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
 * AGL-2486 item 38 — the SSO account renders an initial, and the answer is
 * the console, not a mapping.
 *
 * THE MEASUREMENT THAT DECIDED IT. `zach@aglyn.com` lives in GCIP tenant
 * `aglyn-org-y5v14` behind `saml.aglyn-workspace`. Read directly from the
 * tenant pool on 2026-08-23: the auth record carries no `photoURL` and no
 * `displayName`, its single provider entry (`saml.aglyn-workspace`) carries
 * neither either, and `users/{uid}` holds `createdAt`, `firstName`,
 * `lastName`, `phoneNumber` and NO `photoUrl` key at all. The photo mapping
 * shipped 2026-08-01 (62b5a0ed4); `seedUserProfile` runs on EVERY sign-in
 * from both `/api/auth/session` and `/api/auth/sso-jit`, before sso-jit's
 * already-a-member early return; the account signed in that same day. An
 * absent field is a blank field, so the seed was free to write and wrote
 * nothing — which is only possible if `resolveIdpPhotoUrl(decoded)` returned
 * `''`. The assertion carries no picture. There is nothing to back-fill.
 *
 * So the avatar is the user's to set, and this pins the two things that has
 * to mean on the page they set it from.
 *
 * Asserted over stripped source, like its siblings: both additions carry
 * comments that name the very identifiers being asserted, so a raw-text
 * check would be satisfied by the prose explaining the code.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from './source-text'

const PAGE = code(
  readFileSync(
    join(__dirname, '..', 'app', '(app)', 'manage', 'user', 'page.tsx'),
    'utf8',
  ),
  'manage/user/page.tsx',
)

function handlePhotoSaveBody(): string {
  const start = PAGE.indexOf('const handlePhotoSave = useCallback(')
  expect(start).toBeGreaterThan(-1)
  const end = PAGE.indexOf('const handleSecuritySave', start)
  expect(end).toBeGreaterThan(start)
  return PAGE.slice(start, end)
}

describe('an SSO user can set — and unset — their own avatar', () => {
  it('the save goes through accountPhotoProfilePatch, not a hand-built object', () => {
    // The rule and its mutation proofs live in that module's spec. Wiring it
    // is what makes them describe the real save: an identical object rebuilt
    // inline here would drift from them silently, which is how the roster
    // half ended up with `FieldValue.delete()` and this half with `''`.
    const body = handlePhotoSaveBody()
    expect(body).toContain(
      'accountPhotoProfilePatch(cleaned, { deleteField, serverTimestamp })',
    )
    expect(PAGE).toContain(
      "import { accountPhotoProfilePatch } from '../../../../components/account-photo-payload'",
    )
  })

  it('it no longer writes the raw value straight onto the profile document', () => {
    // The defect itself: `setDoc(userRef, { photoUrl: cleaned })` stores `''`
    // on a clear, and `seedUserProfile`'s `blank()` reads `''` as never-set,
    // so the IdP put the removed picture back on the next sign-in.
    //
    // Scoped to the `setDoc`, NOT to the whole handler. The roster fan-out
    // below it legitimately sends `JSON.stringify({ photoUrl: cleaned })` —
    // that is a route body, where `''` is the documented CLEAR that
    // `normalizeMemberPhotoUrl` turns into `FieldValue.delete()`. A blanket
    // search for the object literal fails on the correct code, which is a
    // test that would have to be deleted the first time it fired.
    const body = handlePhotoSaveBody()
    expect(body).not.toContain('setDoc(userRef, { photoUrl: cleaned }')
    expect(body).not.toMatch(/setDoc\(\s*userRef,\s*\{\s*photoUrl: cleaned\b/)
  })

  it('the auth record is still mirrored, so the app bar agrees with the card', () => {
    // Guards the refactor above from having dropped the second write:
    // `useUserPhoto` joins the profile doc and the auth record blank-not-null.
    expect(handlePhotoSaveBody()).toContain(
      'updateProfile(user, { photoURL: cleaned || null })',
    )
  })

  it('the roster fan-out still runs, because colleagues read neither of those', () => {
    expect(handlePhotoSaveBody()).toContain("'/api/account/photo'")
  })

  it('tells an SSO account with no picture that setting one is up to them', () => {
    // A self-serve account arrives through Google WITH a photo, so an empty
    // avatar there means "you have not set one". An SSO account's can only
    // come from a mapped `picture` attribute, and Google Workspace's SAML app
    // has none to map — so without this the page is silent about why, and an
    // empty field beside a grey initial reads as a broken import.
    const start = PAGE.indexOf('const profileCard')
    expect(start).toBeGreaterThan(-1)
    const card = PAGE.slice(start, PAGE.indexOf('const formPanel', start))
    expect(card).toContain('ssoGoverned')
    expect(card).toMatch(/identity provider/i)
  })

  it('and says it ONLY while there is no picture, from either source', () => {
    // Gated on both, because `useUserPhoto` joins them: the profile document
    // wins, the auth record is the fallback, and a notice that ignored either
    // would sit under an avatar the user can plainly see.
    const start = PAGE.indexOf('{ssoGoverned &&')
    expect(start).toBeGreaterThan(-1)
    const condition = PAGE.slice(start, PAGE.indexOf('? (', start))
    expect(condition).toContain('!photoUrl.trim()')
    expect(condition).toContain('!resolvedPhotoUrl')
  })

  it('never shows it to a project-pool account, which does get a photo', () => {
    // `ssoGoverned` is `!canLinkSocialProvider(user)` — tenanted accounts
    // only. Asserting the negation is present is what stops the notice being
    // "helpfully" widened to everyone, where it would be simply false.
    expect(PAGE).toContain('const ssoGoverned = !canLinkSocialProvider(')
  })
})
