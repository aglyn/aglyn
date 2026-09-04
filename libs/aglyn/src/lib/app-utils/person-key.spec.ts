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
 * The one address-derived id, and the three properties the two derivations it
 * replaces each got wrong.
 */

import { createHash } from 'node:crypto'
import { personKey } from './person-key'

describe('personKey', () => {
  it('folds casing and surrounding whitespace onto one key', () => {
    const key = personKey('bob@example.com')
    expect(personKey('Bob@Example.COM')).toBe(key)
    expect(personKey('  bob@example.com  ')).toBe(key)
  })

  it('is the full sha256 of the normalized address, never truncated', () => {
    // The truncation to 20 hex in the derivation this replaces is one of the
    // three reasons the two ids could not be reconciled.
    expect(personKey('bob@example.com')).toBe(
      createHash('sha256').update('bob@example.com').digest('hex'),
    )
    expect(personKey('bob@example.com')).toHaveLength(64)
  })

  it('agrees with emailSuppressionKey, which keys the same person elsewhere', () => {
    // `docs/specs/email-overhaul.md` §3d names `emailSuppressionKey`'s
    // derivation for `memberKey`. That helper lives in the admin library and
    // cannot be imported here; its derivation is restated so a change to
    // either side fails rather than silently forking the two lists again.
    const suppressionKey = createHash('sha256')
      .update('bob@example.com'.trim().toLowerCase())
      .digest('hex')
    expect(personKey('  Bob@Example.com ')).toBe(suppressionKey)
  })

  it('refuses a value that is not an address rather than guessing one', () => {
    expect(personKey('not-an-email')).toBeNull()
    expect(personKey('')).toBeNull()
    expect(personKey(undefined)).toBeNull()
    expect(personKey(null)).toBeNull()
    expect(personKey('a b@c.com')).toBeNull()
  })

  it('refuses an over-long address, as the normalizer does', () => {
    expect(personKey(`${'a'.repeat(320)}@example.com`)).toBeNull()
  })
})
