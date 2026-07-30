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

import { splitDisplayName } from './split-display-name'

/**
 * AGL-1127: this is what turns a provider's single `name` claim into the
 * first/last pair `users/{uid}` stores, so a Google or SAML account arrives
 * with Basic info prefilled instead of blank.
 */
describe('splitDisplayName', () => {
  it('splits on the FIRST space, keeping multi-word family names whole', () => {
    expect(splitDisplayName('Ada Lovelace King')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace King',
    })
  })

  it('treats a single word as a first name, not a guess at both', () => {
    expect(splitDisplayName('Prince')).toEqual({
      firstName: 'Prince',
      lastName: '',
    })
  })

  it('collapses stray whitespace rather than emitting empty parts', () => {
    expect(splitDisplayName('  Zach   Gover  ')).toEqual({
      firstName: 'Zach',
      lastName: 'Gover',
    })
  })

  it.each([undefined, null, '', '   '])(
    'yields two empty strings for %p',
    (value) => {
      // The caller's cue that there is nothing to seed — an empty string
      // written into `firstName` would look like a name the user cleared.
      expect(splitDisplayName(value)).toEqual({ firstName: '', lastName: '' })
    },
  )
})
