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
  memberSessionCookieName,
  signedInHintCookieName,
  signedInHintCorrections,
} from './sign-in-hint-cookie'

const jar = (cookies: Record<string, string>) =>
  Object.entries(cookies).map(([name, value]) => ({ name, value }))

/**
 * The middleware keeps each site's sign-in hint in step with its member
 * session (AGL-4231), so a member who signed in before the hint existed sees
 * "Account", and a hint that outlived its session stops saying so.
 */
describe('signedInHintCorrections (AGL-4231)', () => {
  it('names both cookies for a site the same way', () => {
    expect(memberSessionCookieName('RhISPcOcQd')).toBe('aglyn_member_RhISPcOcQd')
    expect(signedInHintCookieName('RhISPcOcQd')).toBe('aglyn_signed_in_RhISPcOcQd')
  })

  it('does nothing for a visitor with neither cookie, or with both in step', () => {
    expect(signedInHintCorrections(jar({ other: 'x' }))).toEqual({ set: [], clear: [] })
    expect(
      signedInHintCorrections(jar({ aglyn_member_h1: 'h1.m.1.sig', aglyn_signed_in_h1: '1' })),
    ).toEqual({ set: [], clear: [] })
  })

  it('adds the hint for a session signed in before it existed', () => {
    expect(signedInHintCorrections(jar({ aglyn_member_h1: 'h1.m.1.sig' }))).toEqual({
      set: ['aglyn_signed_in_h1'],
      clear: [],
    })
  })

  it('clears a hint whose session is gone, and ignores an empty one', () => {
    expect(signedInHintCorrections(jar({ aglyn_signed_in_h1: '1' }))).toEqual({
      set: [],
      clear: ['aglyn_signed_in_h1'],
    })
    expect(signedInHintCorrections(jar({ aglyn_signed_in_h1: '' }))).toEqual({ set: [], clear: [] })
    // An emptied session cookie is no session.
    expect(
      signedInHintCorrections(jar({ aglyn_member_h1: '', aglyn_signed_in_h1: '1' })),
    ).toEqual({ set: [], clear: ['aglyn_signed_in_h1'] })
  })

  it('keeps sites apart', () => {
    expect(
      signedInHintCorrections(jar({ aglyn_member_a: 'a.m.1.s', aglyn_signed_in_b: '1' })),
    ).toEqual({ set: ['aglyn_signed_in_a'], clear: ['aglyn_signed_in_b'] })
  })
})
