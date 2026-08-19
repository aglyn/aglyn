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

import { createHash } from 'crypto'
import {
  emailSuppressionKey,
  filterSuppressedEmails,
  isEmailSuppressed,
  releaseEmail,
  suppressEmail,
} from './email-suppression'
import { fakeFirestore } from './test-firestore'

/**
 * AGL-2407. The platform-wide email suppression list.
 *
 * The properties worth pinning are the ones whose failure is invisible: a
 * record filed under a key nothing will look up, a second bounce that
 * overwrites the date the address first died, and a lookup outage that
 * answers "go ahead and send".
 */

const ADDRESS = 'dana@example.com'
const KEY = createHash('sha256').update(ADDRESS).digest('hex')

describe('emailSuppressionKey', () => {
  it('keys on sha256 of the normalized address, as the per-host list does', () => {
    // The SAME derivation `campaign-send.ts`'s `suppressionId` uses. If these
    // two ever diverge the lists silently describe different people, and
    // nothing anywhere would say so.
    expect(emailSuppressionKey(ADDRESS)).toBe(KEY)
    expect(emailSuppressionKey('  DANA@Example.com ')).toBe(KEY)
  })

  it('refuses a value it cannot be sure of rather than guessing one', () => {
    expect(emailSuppressionKey('not-an-address')).toBeNull()
    expect(emailSuppressionKey('two addresses@x.com')).toBeNull()
    expect(emailSuppressionKey('')).toBeNull()
    expect(emailSuppressionKey(null)).toBeNull()
  })
})

describe('suppressEmail', () => {
  it('records the address in the clear under its hash', async () => {
    const firestore = fakeFirestore()
    const result = await suppressEmail({
      email: 'DANA@Example.com',
      reason: 'bounce',
      context: 'invite',
      firestore,
    })

    expect(result).toMatchObject({ key: KEY, created: true })
    const record = firestore.docs('emailSuppressions')[KEY]
    // The address is stored, because a staff reader has to show a human
    // something they can act on; the hash is only the id.
    expect(record.email).toBe(ADDRESS)
    expect(record.reason).toBe('bounce')
    // Which sender produced the address that died.
    expect(record.context).toBe('invite')
    expect(record.releasedAt).toBeNull()
  })

  it('does not restamp createdAt on a second failure', async () => {
    // The date a human is told when they ask when this address went bad. A
    // seeded sentinel, so a restamp is VISIBLE — the fake freezes server
    // timestamps to the current second, and two writes in one second would
    // otherwise be indistinguishable.
    const firestore = fakeFirestore({
      emailSuppressions: {
        [KEY]: { email: ADDRESS, reason: 'bounce', createdAt: { seconds: 1 } },
      },
    })
    const result = await suppressEmail({
      email: ADDRESS,
      reason: 'complaint',
      firestore,
    })

    expect(result.created).toBe(false)
    expect(firestore.docs('emailSuppressions')[KEY].createdAt).toEqual({
      seconds: 1,
    })
    // …but the newer reason lands, so "why is this address off" stays current.
    expect(firestore.docs('emailSuppressions')[KEY].reason).toBe('complaint')
  })

  it('un-releases a released record — a fresh failure is a fresh failure', async () => {
    const firestore = fakeFirestore({
      emailSuppressions: {
        [KEY]: { email: ADDRESS, reason: 'bounce', releasedAt: { seconds: 1 } },
      },
    })
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    expect(firestore.docs('emailSuppressions')[KEY].releasedAt).toBeNull()
  })

  it('throws rather than filing under a key nothing will look up', async () => {
    const firestore = fakeFirestore()
    await expect(
      suppressEmail({ email: 'nonsense', reason: 'bounce', firestore }),
    ).rejects.toThrow(/cannot key/i)
    expect(Object.keys(firestore.docs('emailSuppressions'))).toHaveLength(0)
  })
})

describe('isEmailSuppressed', () => {
  it('answers false for an address nothing was ever recorded for', async () => {
    const firestore = fakeFirestore()
    await expect(isEmailSuppressed(ADDRESS, firestore)).resolves.toBe(false)
  })

  it('answers true for a recorded address', async () => {
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    await expect(isEmailSuppressed(ADDRESS, firestore)).resolves.toBe(true)
  })

  it('treats a RELEASED record as not suppressed', async () => {
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    await expect(releaseEmail({ email: ADDRESS, firestore })).resolves.toBe(true)
    await expect(isEmailSuppressed(ADDRESS, firestore)).resolves.toBe(false)
    // The record is KEPT, not deleted: it is the evidence the suppression was
    // honoured while it stood.
    expect(firestore.docs('emailSuppressions')[KEY]).toBeDefined()
  })

  it('will not release the same record twice', async () => {
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    await releaseEmail({ email: ADDRESS, firestore })
    await expect(releaseEmail({ email: ADDRESS, firestore })).resolves.toBe(
      false,
    )
  })

  it('FAILS CLOSED when the lookup throws', async () => {
    // A list outage must not turn into another delivery attempt at a mailbox
    // that permanently said it does not exist. Same rule as
    // `isPhoneContactSuppressed`; never "fix" this by returning false.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const exploding: any = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('firestore down')
          },
        }),
      }),
    }
    await expect(isEmailSuppressed(ADDRESS, exploding)).resolves.toBe(true)
    consoleError.mockRestore()
  })

  it('FAILS CLOSED on a value it cannot key', async () => {
    const firestore = fakeFirestore()
    await expect(isEmailSuppressed('nonsense', firestore)).resolves.toBe(true)
  })
})

describe('filterSuppressedEmails', () => {
  it('drops the suppressed and keeps the rest', async () => {
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    await expect(
      filterSuppressedEmails([ADDRESS, 'ok@example.com'], firestore),
    ).resolves.toEqual(['ok@example.com'])
  })

  it('deduplicates and normalizes before checking', async () => {
    // The callers fan out over an org's owners AND admins, which routinely
    // names the same person twice — and the check is one read per address.
    const firestore = fakeFirestore()
    await expect(
      filterSuppressedEmails(
        [' OK@Example.com ', 'ok@example.com', ''],
        firestore,
      ),
    ).resolves.toEqual(['ok@example.com'])
  })
})
