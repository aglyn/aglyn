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
 * Zach: the account menu showed a single `Z` where the presence stack two
 * inches away showed `ZG`, and its header printed `zach@aglyn.com` as both
 * the name and the address.
 *
 * The name was never missing — the menu was reading the one source that is
 * blank for the enterprise tier. Measured on production: the SSO account
 * `zach@aglyn.com` (tenant `aglyn-org-y5v14`) has `displayName: undefined` on
 * its auth record, while `users/IHumyGGhGxZKjVV26qCRx5Okf573` holds
 * `firstName: "Zach"`, `lastName: "Gover"`. Presence had already worked around
 * the same gap by reading the ID token's IdP claims, which is why the two
 * surfaces disagreed.
 *
 * The first case below fails against the pre-fix menu, which resolved
 * `user.displayName || user.email`.
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
