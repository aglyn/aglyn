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
  CONTACT_ERASURE_REQUESTED_FIELD,
  PERSON_ERASURE_NOT_REACHED,
  PERSON_ERASURE_REMOVES,
  PERSON_ERASURE_RETAINS,
  personErasureConfirmationMatches,
  personErasureId,
  readErasureRequestedAtMs,
} from './person-erasure'

describe('personErasureId', () => {
  it('keys a request by workspace and person, in that order', () => {
    expect(personErasureId('org1', 'abc123')).toBe('org1__abc123')
  })

  it('refuses a request that names no workspace or no person', () => {
    // A request with either half missing would file under a key some other
    // workspace's request could also produce.
    expect(() => personErasureId('', 'abc')).toThrow()
    expect(() => personErasureId('org1', '')).toThrow()
  })
})

describe('readErasureRequestedAtMs', () => {
  it('reads the marker off a record that carries one', () => {
    expect(
      readErasureRequestedAtMs({ [CONTACT_ERASURE_REQUESTED_FIELD]: 1_700_000_000_000 }),
    ).toBe(1_700_000_000_000)
  })

  it('answers null for a record with no marker, or a marker that is not a time', () => {
    expect(readErasureRequestedAtMs({})).toBeNull()
    expect(readErasureRequestedAtMs(null)).toBeNull()
    expect(readErasureRequestedAtMs({ [CONTACT_ERASURE_REQUESTED_FIELD]: 0 })).toBeNull()
    expect(readErasureRequestedAtMs({ [CONTACT_ERASURE_REQUESTED_FIELD]: 'soon' })).toBeNull()
    expect(readErasureRequestedAtMs({ [CONTACT_ERASURE_REQUESTED_FIELD]: NaN })).toBeNull()
  })
})

describe('personErasureConfirmationMatches', () => {
  it('accepts the address typed with different case and surrounding space', () => {
    // The confirmation makes the admin read the address; it is not a test
    // of their capitalization.
    expect(
      personErasureConfirmationMatches('  Jane@Example.com ', 'jane@example.com'),
    ).toBe(true)
  })

  it('refuses a different address, an empty one, and a record with no address', () => {
    expect(personErasureConfirmationMatches('jane@example.org', 'jane@example.com')).toBe(false)
    expect(personErasureConfirmationMatches('', 'jane@example.com')).toBe(false)
    expect(personErasureConfirmationMatches('jane@example.com', '')).toBe(false)
    expect(personErasureConfirmationMatches(undefined, undefined)).toBe(false)
  })
})

describe('the dialog lists', () => {
  it('name what is removed, what is retained and what is not reached, each non-empty', () => {
    // The dialog and the docs read these; an empty list would render a
    // heading over nothing and promise less than the sweep does.
    expect(PERSON_ERASURE_REMOVES.length).toBeGreaterThan(0)
    expect(PERSON_ERASURE_RETAINS.length).toBeGreaterThan(0)
    expect(PERSON_ERASURE_NOT_REACHED.length).toBeGreaterThan(0)
  })

  it('say that orders survive as financial records rather than being deleted', () => {
    expect(PERSON_ERASURE_RETAINS.join(' ')).toMatch(/orders/i)
    expect(PERSON_ERASURE_REMOVES.join(' ')).not.toMatch(/orders/i)
  })
})
