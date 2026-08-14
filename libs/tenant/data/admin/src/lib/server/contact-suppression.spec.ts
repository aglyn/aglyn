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
  contactSuppressionKey,
  getContactSuppression,
  isPhoneContactSuppressed,
  releasePhoneContact,
  suppressPhoneContact,
} from './contact-suppression'
import { fakeFirestore } from './test-firestore'

/**
 * AGL-1592. The do-not-contact list behind Privacy Policy v4 §11.
 *
 * The properties worth pinning are the ones whose failure is invisible: a
 * record filed under a key nothing will look up, a second opt-out that
 * narrows the first, and a lookup outage that answers "go ahead and dial".
 */
describe('contactSuppressionKey', () => {
  it('keys on E.164 digits so the same number in any format is one record', () => {
    expect(contactSuppressionKey('+1 (512) 555-0123')).toBe('15125550123')
    expect(contactSuppressionKey('5125550123')).toBe('15125550123')
    expect(contactSuppressionKey('512.555.0123')).toBe('15125550123')
  })

  it('drops the +, so a number carried through a query string cannot mutate', () => {
    // '+' is a space in form encoding. A key that contained one would become a
    // different key the first time it crossed a URL.
    expect(contactSuppressionKey('+15125550123')).not.toContain('+')
  })

  it('refuses a number it cannot be sure of rather than guessing one', () => {
    expect(contactSuppressionKey('555-0123')).toBeNull()
    expect(contactSuppressionKey('')).toBeNull()
    expect(contactSuppressionKey(null)).toBeNull()
  })
})

describe('suppressPhoneContact', () => {
  it('records the number in E.164 and retains it — the list cannot work otherwise', async () => {
    const firestore = fakeFirestore()
    const result = await suppressPhoneContact({
      phoneNumber: '(512) 555-0123',
      source: 'email',
      firestore,
    })
    expect(result).toMatchObject({ phoneNumber: '+15125550123', created: true })
    const stored = firestore.docs('contactSuppressions')['15125550123']
    expect(stored.phoneNumber).toBe('+15125550123')
  })

  it('defaults to both channels — the conservative reading of an ambiguous ask', async () => {
    const firestore = fakeFirestore()
    const result = await suppressPhoneContact({
      phoneNumber: '+15125550123',
      source: 'verbal',
      firestore,
    })
    expect(result.channels).toEqual(['calls', 'texts'])
  })

  it('UNIONS channels, so a later request can never narrow an earlier one', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({
      phoneNumber: '+15125550123',
      channels: ['texts'],
      source: 'sms-keyword',
      firestore,
    })
    const second = await suppressPhoneContact({
      phoneNumber: '+15125550123',
      channels: ['calls'],
      source: 'verbal',
      firestore,
    })
    expect(second.channels).toEqual(['calls', 'texts'])
    expect(second.created).toBe(false)
  })

  it('keeps erasePhoneOnFile sticky across a later plain opt-out', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({
      phoneNumber: '+15125550123',
      source: 'erasure-request',
      erasePhoneOnFile: true,
      firestore,
    })
    await suppressPhoneContact({
      phoneNumber: '+15125550123',
      channels: ['texts'],
      source: 'sms-keyword',
      firestore,
    })
    expect(
      firestore.docs('contactSuppressions')['15125550123'].erasePhoneOnFile,
    ).toBe(true)
  })

  it('throws rather than silently dropping an opt-out it cannot key', async () => {
    const firestore = fakeFirestore()
    await expect(
      suppressPhoneContact({ phoneNumber: 'call me', source: 'email', firestore }),
    ).rejects.toThrow()
  })

  it('is idempotent by number, so a retry cannot file a second record', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({ phoneNumber: '+15125550123', source: 'email', firestore })
    await suppressPhoneContact({ phoneNumber: '5125550123', source: 'email', firestore })
    expect(Object.keys(firestore.docs('contactSuppressions'))).toEqual(['15125550123'])
  })
})

describe('isPhoneContactSuppressed', () => {
  it('answers from the number alone, with no query and no index', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({ phoneNumber: '+15125550123', source: 'email', firestore })
    expect(await isPhoneContactSuppressed('512 555 0123', undefined, firestore)).toBe(true)
    expect(await isPhoneContactSuppressed('+15125559999', undefined, firestore)).toBe(false)
  })

  it('is per channel: a texting opt-out does not silence calls we may still place', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({
      phoneNumber: '+15125550123',
      channels: ['texts'],
      source: 'sms-keyword',
      firestore,
    })
    expect(await isPhoneContactSuppressed('+15125550123', 'texts', firestore)).toBe(true)
    expect(await isPhoneContactSuppressed('+15125550123', 'calls', firestore)).toBe(false)
  })

  it('FAILS CLOSED when the list cannot be read', async () => {
    // A list outage that answered "not suppressed" would turn into a round of
    // calls to people who asked us never to call again. Delay is recoverable;
    // that is not.
    const exploding = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('unavailable')
          },
        }),
      }),
    }
    expect(await isPhoneContactSuppressed('+15125550123', undefined, exploding)).toBe(true)
  })

  it('fails closed on a number it cannot normalize', async () => {
    const firestore = fakeFirestore()
    expect(await isPhoneContactSuppressed('555-0123', undefined, firestore)).toBe(true)
  })
})

describe('releasePhoneContact', () => {
  it('revokes rather than deletes, so the honoured period stays provable', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({ phoneNumber: '+15125550123', source: 'email', firestore })
    expect(await releasePhoneContact({ phoneNumber: '+15125550123', firestore })).toBe(true)

    const stored = firestore.docs('contactSuppressions')['15125550123']
    expect(stored).toBeDefined()
    expect(stored.revokedAt).toBeTruthy()
    expect(await isPhoneContactSuppressed('+15125550123', undefined, firestore)).toBe(false)
  })

  it('un-revokes on a fresh opt-out, because a fresh request is a fresh request', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({ phoneNumber: '+15125550123', source: 'email', firestore })
    await releasePhoneContact({ phoneNumber: '+15125550123', firestore })
    await suppressPhoneContact({ phoneNumber: '+15125550123', source: 'verbal', firestore })
    expect(await isPhoneContactSuppressed('+15125550123', undefined, firestore)).toBe(true)
  })

  it('reports false when there was nothing to revoke', async () => {
    const firestore = fakeFirestore()
    expect(await releasePhoneContact({ phoneNumber: '+15125550123', firestore })).toBe(false)
  })
})

describe('getContactSuppression', () => {
  it('reads back the record the seed guard consults', async () => {
    const firestore = fakeFirestore()
    await suppressPhoneContact({
      phoneNumber: '+15125550123',
      source: 'erasure-request',
      erasePhoneOnFile: true,
      firestore,
    })
    const record = await getContactSuppression('512 555 0123', firestore)
    expect(record).toMatchObject({ $id: '15125550123', erasePhoneOnFile: true })
  })
})
