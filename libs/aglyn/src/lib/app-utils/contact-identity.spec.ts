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

import { contactIdentityForGroup } from './contacts'

describe('a contact’s identity to one holder (AGL-4042)', () => {
  const contact = {
    name: 'Jordan Lee',
    facets: {
      'group-a': { name: 'Jordan Q. Lee', birthdate: '1990-04-02', notes: 'private to group a', phone: '+15125550100' },
      'group-b': { birthdate: 'not a date' },
    },
  }

  it('is the holder’s name and birthdate, and nothing else of the person', () => {
    expect(contactIdentityForGroup(contact, 'group-a')).toEqual({ name: 'Jordan Q. Lee', birthdate: '1990-04-02' })
  })

  it('falls back to the shared name, never to another holder’s birthdate, and refuses a stored value that is not a date', () => {
    expect(contactIdentityForGroup(contact, 'group-b')).toEqual({ name: 'Jordan Lee', birthdate: null })
    expect(contactIdentityForGroup(contact, 'group-c')).toEqual({ name: 'Jordan Lee', birthdate: null })
    expect(contactIdentityForGroup(null, 'group-a')).toEqual({ name: null, birthdate: null })
  })
})
