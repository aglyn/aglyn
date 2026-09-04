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
 * THE TWO DECISIONS THE REACH RECORD MAKES ON ITS OWN.
 *
 * `campaign-follow-up.spec.ts` drives the whole send and proves that a second
 * send reaches nobody the first did. What is here is the pair of judgements
 * that decide the ANSWER at the edges, where a send-level test cannot easily
 * put an input: an address that cannot be keyed, and a record that does not
 * account for everything the email has sent.
 *
 * Both fail toward NOT MAILING. That direction is the whole design: a
 * follow-up is discretionary and a merchant can repeat it in a minute, where
 * a second copy in a stranger's inbox is not retractable.
 */

const store = new Map<string, Record<string, any>>()

/**
 * The reach document's read can be made to THROW, which is the case the
 * fail-closed posture exists for. Thrown from the LEAF get rather than from a
 * whole collection, so every other path in the double keeps working and the
 * test is about the one read.
 */
let readThrows = false

function docRef(path: string): any {
  return {
    get: async () => {
      if (readThrows && path.endsWith('/reports/reached')) {
        throw new Error('firestore unavailable')
      }
      const data = store.get(path)
      return {
        exists: data !== undefined,
        get: (field: string) => data?.[field],
      }
    },
    set: async (value: Record<string, any>) => {
      store.set(path, { ...(store.get(path) ?? {}), ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return { doc: (id: string) => docRef(`${path}/${id}`) }
}

const mockFirestore = () => ({
  collection: (name: string) => collectionRef(name),
})

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ __increment: value }),
        arrayUnion: (...values: string[]) => ({ __arrayUnion: values }),
      },
    },
  },
}))

import {
  campaignReachCovers,
  partitionByCampaignReach,
  readCampaignReach,
} from './email-campaign-reach'
import { emailSuppressionKey } from './email-suppression'

const key = (email: string) => emailSuppressionKey(email) as string

beforeEach(() => {
  store.clear()
  readThrows = false
})

describe('splitting an audience against who has already had the email', () => {
  it('keeps the people the record does not name', () => {
    const reached = new Set([key('ada@example.com')])

    const result = partitionByCampaignReach(
      ['ada@example.com', 'bo@example.com'],
      reached,
    )

    expect(result.unreached).toEqual(['bo@example.com'])
    expect(result.alreadyReached).toBe(1)
  })

  it('matches on the normalized address, not the typed one', () => {
    // The key is `sha256` of the NORMALIZED address, which is what both
    // suppression lists and the frequency window already derive. An audience
    // that spells the same person differently must still be one person.
    const reached = new Set([key('ada@example.com')])

    const result = partitionByCampaignReach(['  Ada@Example.com '], reached)

    expect(result.unreached).toEqual([])
    expect(result.alreadyReached).toBe(1)
  })

  it('DROPS an address it cannot key, rather than mailing it', () => {
    /*
     * An address whose identity cannot be established is one we cannot prove
     * we have not already mailed. Both suppression lists refuse such an
     * address for the same reason, and the cost of the two mistakes is not
     * symmetric: dropping it withholds a message nobody was promised, and
     * keeping it risks a second copy of one somebody already has.
     */
    const result = partitionByCampaignReach(
      ['', '   ', 'not-an-address', 'bo@example.com'],
      new Set<string>(),
    )

    expect(result.unreached).toEqual(['bo@example.com'])
    expect(result.alreadyReached).toBe(3)
  })

  it('keeps everybody when nothing has been reached yet', () => {
    // Anti-vacuity for the drop above: an empty record must not read as
    // "everyone has had it".
    const result = partitionByCampaignReach(
      ['ada@example.com', 'bo@example.com'],
      new Set<string>(),
    )

    expect(result.unreached).toHaveLength(2)
    expect(result.alreadyReached).toBe(0)
  })
})

describe('whether the record accounts for everything the email has sent', () => {
  it('accepts a record that names as many people as the email has sent', () => {
    expect(campaignReachCovers(new Set(['a', 'b']), 2)).toBe(true)
  })

  it('REFUSES a record that is short', () => {
    // One key per delivered message — a recipient cannot be addressed twice
    // by one send, nor across sends — so a record that is short is a record
    // missing somebody, and that somebody would be mailed again.
    expect(campaignReachCovers(new Set(['a']), 2)).toBe(false)
  })

  it('refuses an email that has no record at all', () => {
    // Every email sent before the record existed is in this state, and it is
    // the case that must refuse: nobody can say who those sends reached.
    expect(campaignReachCovers(new Set<string>(), 500)).toBe(false)
  })

  it('accepts an email that has sent nothing', () => {
    // A send that delivered nothing has nobody to double-mail.
    expect(campaignReachCovers(new Set<string>(), 0)).toBe(true)
  })

  it('accepts a record that is AHEAD of the sent count', () => {
    /*
     * The order the sender writes in makes this reachable: the reach record
     * goes down before the campaign document, so a failure between them
     * leaves the record ahead. That is the safe direction — a follow-up
     * subtracts more people than it strictly has to.
     */
    expect(campaignReachCovers(new Set(['a', 'b', 'c']), 2)).toBe(true)
  })

  it('treats an unreadable sent count as nothing to cover', () => {
    expect(campaignReachCovers(new Set<string>(), Number.NaN)).toBe(true)
  })
})

describe('reading the record', () => {
  it('answers the stored keys', async () => {
    store.set('hosts/site1/campaigns/send1/reports/reached', {
      keys: ['k1', 'k2'],
      count: 2,
    })

    const reached = await readCampaignReach('site1', 'send1')

    expect([...reached].sort()).toEqual(['k1', 'k2'])
  })

  it('answers an empty set for an email with no record', async () => {
    const reached = await readCampaignReach('site1', 'send1')

    expect(reached.size).toBe(0)
  })

  it('THROWS when it cannot read, rather than answering "nobody"', async () => {
    /*
     * Fails CLOSED, which is the opposite of the frequency window beside it
     * and deliberately so. A frequency read that fails closed refuses a
     * message nobody objected to; a reach read that failed open would mail
     * somebody a second copy of a message they already have.
     */
    readThrows = true

    await expect(readCampaignReach('site1', 'send1')).rejects.toThrow(
      /firestore unavailable/,
    )
  })
})
