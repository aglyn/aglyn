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
  filterSendableForHost,
  filterSuppressedEmails,
  filterTopicSendable,
  isEmailSuppressed,
  listEmailSuppressions,
  releaseEmail,
  suppressEmail,
  suppressionCursorFrom,
  suppressionCursorTimestamp,
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
    // honored while it stood.
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

/**
 * D6 of `docs/specs/email-overhaul.md` — a campaign consulted the site's own
 * list and nothing else.
 *
 * The address that matters is the one suppressed PLATFORM-wide and not on this
 * site's list at all: a hard bounce learned on another site in the org, or on
 * transactional mail carrying no site tag, which is where most of the platform
 * list comes from. Mailing that person is not one merchant's deliverability
 * problem — every tenant's campaigns leave by one sending domain under
 * `p=reject`.
 */
describe('listEmailSuppressions', () => {
  /**
   * A query double that RECORDS what it was built with.
   *
   * `fakeFirestore` answers `orderBy`/`limit` by returning itself and knows
   * nothing about `startAfter`, so a walk that dropped its cursor would read
   * page one forever and every assertion over the returned rows would still
   * pass. What has to be observed is the QUERY, not the answer.
   */
  const recordingFirestore = () => {
    const built: Record<string, unknown> = {}
    const query: any = {
      orderBy: (field: string, direction: string) => {
        built.orderBy = `${field} ${direction}`
        return query
      },
      startAfter: (value: unknown) => {
        built.startAfter = value
        return query
      },
      limit: (value: number) => {
        built.limit = value
        return query
      },
      get: async () => ({ docs: [] }),
    }
    return { built, firestore: { collection: () => query } as any }
  }

  it('starts the page AFTER the cursor it was given', async () => {
    const { built, firestore } = recordingFirestore()
    await listEmailSuppressions({
      limit: 10,
      startAfter: '1700000000.123456789',
      firestore,
    })

    expect(built.orderBy).toBe('suppressedAt desc')
    expect(built.limit).toBe(10)
    const cursor = built.startAfter as { seconds: number; nanoseconds: number }
    expect(cursor?.seconds).toBe(1_700_000_000)
    expect(cursor?.nanoseconds).toBe(123_456_789)
  })

  it('reads from the top when there is no cursor', async () => {
    // The other direction: a walk that always started after something would
    // hide the newest entries, which is the half of the list this screen
    // exists for.
    const { built, firestore } = recordingFirestore()
    await listEmailSuppressions({ limit: 10, firestore })
    expect(built.startAfter).toBeUndefined()
  })

  it('does not start after a cursor it cannot parse', async () => {
    const { built, firestore } = recordingFirestore()
    await listEmailSuppressions({ startAfter: 'nonsense', firestore })
    expect(built.startAfter).toBeUndefined()
  })
})

describe('the suppression cursor', () => {
  it('round-trips a timestamp exactly, nanoseconds included', () => {
    // MILLISECONDS WOULD NOT. `startAfter` skips exactly the value it is
    // given, so a truncated cursor sits BEFORE the record it names and that
    // record arrives again at the top of the following page.
    const cursor = suppressionCursorFrom({
      suppressedAt: { seconds: 1_700_000_000, nanoseconds: 123_456_789 },
    })
    expect(cursor).toBe('1700000000.123456789')
    const restored = suppressionCursorTimestamp(cursor)
    expect(restored?.seconds).toBe(1_700_000_000)
    expect(restored?.nanoseconds).toBe(123_456_789)
  })

  it('reads the Admin SDK’s underscored shape too', () => {
    // A `Timestamp` off the wire exposes `_seconds`/`_nanoseconds`; a plain
    // object seeded in a test exposes the bare names. A cursor that only knew
    // one of them would answer null in production and pass here.
    expect(
      suppressionCursorFrom({
        suppressedAt: { _seconds: 42, _nanoseconds: 7 },
      }),
    ).toBe('42.7')
  })

  it('answers null rather than guessing a position', () => {
    // A cursor invented from nothing would silently start the next page in
    // the wrong place, which on this list drops entries nobody can find.
    expect(suppressionCursorFrom({})).toBeNull()
    expect(suppressionCursorFrom(null)).toBeNull()
    expect(suppressionCursorFrom({ suppressedAt: 'yesterday' })).toBeNull()
    expect(suppressionCursorTimestamp('')).toBeNull()
    expect(suppressionCursorTimestamp('nonsense')).toBeNull()
    expect(suppressionCursorTimestamp(null)).toBeNull()
  })
})

describe('filterSendableForHost', () => {
  const HOST = 'host-1'
  const hostList = `hosts/${HOST}/suppressions`

  it('drops an address the PLATFORM suppressed but this site never did', async () => {
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    // Nothing under this site — the whole point of the case.
    expect(firestore.docs(hostList)[KEY]).toBeUndefined()

    await expect(
      filterSendableForHost(HOST, [ADDRESS, 'ok@example.com'], firestore),
    ).resolves.toEqual(['ok@example.com'])
  })

  it('drops an address that unsubscribed from THIS site', async () => {
    const firestore = fakeFirestore({
      [hostList]: { [KEY]: { email: ADDRESS, reason: 'unsubscribe' } },
    })
    await expect(
      filterSendableForHost(HOST, [ADDRESS, 'ok@example.com'], firestore),
    ).resolves.toEqual(['ok@example.com'])
  })

  it('does not apply another site’s unsubscribes to this one', async () => {
    // An unsubscribe is from ONE site's campaigns. Reading it as platform-wide
    // would silently shrink every other site in the org.
    const firestore = fakeFirestore({
      'hosts/host-2/suppressions': {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    })
    await expect(
      filterSendableForHost(HOST, [ADDRESS], firestore),
    ).resolves.toEqual([ADDRESS])
  })

  it('mails a RELEASED platform record — a release is a real release', async () => {
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'bounce', firestore })
    await releaseEmail({ email: ADDRESS, firestore })
    await expect(
      filterSendableForHost(HOST, [ADDRESS], firestore),
    ).resolves.toEqual([ADDRESS])
  })

  it('normalizes and deduplicates, so casing cannot walk past either list', async () => {
    const firestore = fakeFirestore({
      [hostList]: { [KEY]: { email: ADDRESS, reason: 'unsubscribe' } },
    })
    await expect(
      filterSendableForHost(
        HOST,
        ['  DANA@Example.com ', ADDRESS, ' OK@example.com ', 'ok@example.com'],
        firestore,
      ),
    ).resolves.toEqual(['ok@example.com'])
  })

  it('FAILS CLOSED when the per-site lookup throws', async () => {
    // Matching the platform half. A list we could not read is not a list that
    // said this address is safe to mail.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const exploding: any = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false }),
          collection: () => ({ doc: (id: string) => ({ id }) }),
        }),
      }),
      getAll: async () => {
        throw new Error('firestore down')
      },
    }
    await expect(
      filterSendableForHost(HOST, [ADDRESS], exploding),
    ).resolves.toEqual([])
    consoleError.mockRestore()
  })

  it('asks the per-site list for nobody when the platform list took everyone', async () => {
    // `getAll` rejects an empty reference list, so the early return is load
    // bearing rather than an optimisation.
    const firestore = fakeFirestore()
    await suppressEmail({ email: ADDRESS, reason: 'complaint', firestore })
    await expect(
      filterSendableForHost(HOST, [ADDRESS], firestore),
    ).resolves.toEqual([])
  })
})

/**
 * The THIRD filter a campaign passes, and the narrowest.
 *
 * The two suppression lists answer "may we mail this person at all"; this one
 * answers "may we mail them about THIS". Somebody who unticked one stream on
 * the preference page is not suppressed — they still get the others — so the
 * fact cannot live on either list without meaning something it does not mean.
 */
describe('filterTopicSendable', () => {
  const HOST = 'host-1'
  const optOuts = `hosts/${HOST}/topicOptOuts`
  const OTHER = 'ok@example.com'

  it('drops an address that left this stream', async () => {
    const firestore = fakeFirestore({
      [optOuts]: {
        [KEY]: {
          email: ADDRESS,
          topics: { newsletter: { optedOutAt: 1, resubscribedAt: null } },
        },
      },
    })
    await expect(
      filterTopicSendable(HOST, 'newsletter', [ADDRESS, OTHER], firestore),
    ).resolves.toEqual([OTHER])
  })

  it('keeps them for a stream they did NOT leave', async () => {
    // The whole point of topics. Leaving one is not leaving all of them.
    const firestore = fakeFirestore({
      [optOuts]: {
        [KEY]: {
          email: ADDRESS,
          topics: { newsletter: { optedOutAt: 1, resubscribedAt: null } },
        },
      },
    })
    await expect(
      filterTopicSendable(HOST, 'marketing', [ADDRESS, OTHER], firestore),
    ).resolves.toEqual([ADDRESS, OTHER])
  })

  it('mails an opt-out that was later lifted, and keeps the evidence', async () => {
    // A `resubscribedAt` marks a lifted opt-out. The entry stays as the proof
    // the request was honored while it stood, so PRESENCE alone is not the
    // test — reading it that way would leave a rejoined recipient unmailable
    // forever with no record on screen explaining why.
    const firestore = fakeFirestore({
      [optOuts]: {
        [KEY]: {
          email: ADDRESS,
          topics: { newsletter: { optedOutAt: 1, resubscribedAt: 2 } },
        },
      },
    })
    await expect(
      filterTopicSendable(HOST, 'newsletter', [ADDRESS], firestore),
    ).resolves.toEqual([ADDRESS])
  })

  it('does not apply another site’s opt-outs to this one', async () => {
    const firestore = fakeFirestore({
      'hosts/host-2/topicOptOuts': {
        [KEY]: {
          email: ADDRESS,
          topics: { newsletter: { optedOutAt: 1, resubscribedAt: null } },
        },
      },
    })
    await expect(
      filterTopicSendable(HOST, 'newsletter', [ADDRESS], firestore),
    ).resolves.toEqual([ADDRESS])
  })

  it('filters nobody, and READS nothing, for a campaign with no topic', async () => {
    // Every campaign sent before topics existed. There is no stream to have
    // left, so there is nothing to drop — and nothing to ask Firestore, which
    // is the half worth asserting: a lookup keyed on an absent topic costs one
    // `getAll` per send to answer a question with no question in it.
    const firestore = fakeFirestore({
      [optOuts]: {
        [KEY]: {
          email: ADDRESS,
          topics: { newsletter: { optedOutAt: 1, resubscribedAt: null } },
        },
      },
    })
    const getAll = jest.spyOn(firestore, 'getAll')
    await expect(
      filterTopicSendable(HOST, '', [ADDRESS], firestore),
    ).resolves.toEqual([ADDRESS])
    expect(getAll).not.toHaveBeenCalled()
  })

  it('fails OPEN, unlike every other filter in this module', async () => {
    /*
     * The opposite posture from its neighbours, on purpose. They answer
     * "suppressed" on a read that throws, because the cost of guessing wrong
     * is mailing somebody who told us to stop. Here the campaign has ALREADY
     * passed both suppression lists, so nobody who asked us to stop entirely
     * can reach this line — and the cost of failing closed would be refusing
     * a newsletter somebody asked for, over a read that failed for an
     * unrelated reason.
     */
    const firestore = fakeFirestore()
    firestore.getAll = async () => {
      throw new Error('firestore down')
    }
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    await expect(
      filterTopicSendable(HOST, 'newsletter', [ADDRESS, OTHER], firestore),
    ).resolves.toEqual([ADDRESS, OTHER])
    consoleError.mockRestore()
  })

  it('keeps an address it cannot key rather than refusing it twice', async () => {
    // An unkeyable value cannot carry an opt-out record. The suppression
    // filters above have already refused it on their own stricter rule, so
    // this one has no business refusing it a second time.
    const firestore = fakeFirestore()
    await expect(
      filterTopicSendable(HOST, 'newsletter', ['not-an-address'], firestore),
    ).resolves.toEqual(['not-an-address'])
  })
})
