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

import { resolveUserName } from './use-user-name'

/**
 * What the signed-in user is CALLED (AGL-2486).
 *
 * A surface that resolves `user.displayName || user.email` prints an address
 * as the person's name, and draws one initial from it where the presence
 * stack beside it draws two.
 *
 * The name is not missing; that surface is reading the one source that is
 * blank for the enterprise tier. An SSO account's auth record carries
 * `displayName: undefined`, while its `users/{uid}` document holds a first and
 * last name — and presence reads the ID token's IdP claims, which is a third
 * answer again.
 *
 * The first case below fails against that `displayName || email` resolution.
 */
describe('the SSO account, whose auth record carries no name', () => {
  it('is named from its profile document, not its email address', () => {
    expect(
      resolveUserName({
        profileFirstName: 'Zach',
        profileLastName: 'Gover',
        authDisplayName: undefined,
        email: 'zach@aglyn.com',
      }),
    ).toBe('Zach Gover')
  })
})

describe('the order the sources are trusted in', () => {
  it('prefers the profile the user edits over the provider copy', () => {
    // Same precedence `useUserProfilePhotoUrl` already sets for the picture,
    // on the same document. Two hooks answering "who is signed in" must not
    // disagree about where to look.
    expect(
      resolveUserName({
        profileFirstName: 'Ada',
        profileLastName: 'Lovelace',
        authDisplayName: 'Stale Provider Name',
        email: 'ada@example.com',
      }),
    ).toBe('Ada Lovelace')
  })

  it('falls back to the auth record when the profile is empty', () => {
    expect(
      resolveUserName({ authDisplayName: 'Ada Lovelace', email: 'a@b.com' }),
    ).toBe('Ada Lovelace')
  })

  it('falls back to the address only when there is no name anywhere', () => {
    expect(resolveUserName({ email: 'ada@example.com' })).toBe(
      'ada@example.com',
    )
  })

  it('returns empty rather than inventing something when nothing is known', () => {
    expect(resolveUserName({})).toBe('')
  })
})

describe('half a name is still a name', () => {
  it('uses a first name alone', () => {
    expect(resolveUserName({ profileFirstName: 'Zach', email: 'z@a.com' })).toBe(
      'Zach',
    )
  })

  it('uses a last name alone', () => {
    expect(resolveUserName({ profileLastName: 'Gover', email: 'z@a.com' })).toBe(
      'Gover',
    )
  })

  it('ignores whitespace-only fields rather than joining them into a space', () => {
    // `'  ' + ' '` would otherwise pass a truthy string down to the avatar and
    // render as blank initials.
    expect(
      resolveUserName({
        profileFirstName: '  ',
        profileLastName: ' ',
        authDisplayName: 'Ada Lovelace',
      }),
    ).toBe('Ada Lovelace')
  })
})
