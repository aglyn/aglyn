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
 * A CONSENT GROUP IS ONE SENDER TO THE PERSON WHO LEAVES IT (AGL-3310).
 *
 * An org may declare several sites one sender (`consent-groups.ts`), and every
 * capture form in the group names it as one. So a person who unsubscribes from
 * one of its sites has left the sender, and every opt-out a send path consults
 * is read across the group: the site suppression list, the topic opt-outs and
 * the pace the person asked for. The consent refusal was already read that
 * way; these three were read for the sending site alone, so an unsubscribe
 * from site B left site A free to mail.
 *
 * Every block holds three facts apart, because each pair of them collapses
 * into a defect in one direction or the other:
 *
 *  - a SIBLING's refusal withholds the send;
 *  - a site OUTSIDE the group — the agency's other client, in the same org —
 *    changes nothing;
 *  - a site in NO group reads exactly the documents it always read, and no
 *    more of them.
 */

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  EMAIL_FREQUENCY_SUBCOLLECTION,
  filterCadenceSendable,
  marketingSendVerdict,
} from './email-marketing-gate'
import {
  emailSuppressionKey,
  filterSendableForHost,
  filterTopicSendable,
  optOutHostIds,
} from './email-suppression'
import { fakeFirestore } from './test-firestore'

/** The site sending. */
const SITE_A = 'site-a'
/** Declared one sender with site A. */
const SITE_B = 'site-b'
/** The same org, and in no group with either — a different brand. */
const SITE_C = 'site-c'

const ORG = {
  consentGroups: { acme: { name: 'Acme', hostIds: [SITE_A, SITE_B] } },
}
/** Resolved the only way any caller may resolve one. */
const GROUP = consentGroupForHost(ORG, SITE_A)
/** The same site in an org that declared nothing. */
const ALONE = consentGroupForHost({}, SITE_A)

const ADDRESS = 'dana@example.com'
const OTHER = 'sam@example.com'
const KEY = emailSuppressionKey(ADDRESS) as string
const OTHER_KEY = emailSuppressionKey(OTHER) as string
const NOW = 1_800_000_000_000
const DAY = 86_400_000
const SITE_BASE = 'https://shop.example.com'

const list = (hostId: string, name: string) => `hosts/${hostId}/${name}`

/**
 * The fake, with every document read recorded by its full path — through
 * `get` and through `getAll` alike.
 *
 * "A site in no group reads what it always read" is a property no verdict
 * shows: a filter that also read its siblings' lists would return the same
 * answer for an org that declared nothing, at a multiple of the cost, on the
 * one path whose cost scales with a customer's list. Recording is the only
 * way to assert it.
 */
function recordingFirestore(seed: Record<string, Record<string, any>> = {}) {
  const inner = fakeFirestore(seed)
  const reads: string[] = []
  const wrapCollection = (path: string, api: any): any => ({
    ...api,
    doc: (id: string) => {
      const ref = api.doc(id)
      return {
        ...ref,
        collection: (sub: string) =>
          wrapCollection(`${path}/${id}/${sub}`, ref.collection(sub)),
        get: async () => {
          reads.push(`${path}/${id}`)
          return ref.get()
        },
      }
    },
  })
  return {
    ...inner,
    reads,
    getAll: async (...refs: any[]) => {
      for (const ref of refs) reads.push(`${ref.collectionPath}/${ref.id}`)
      return inner.getAll(...refs)
    },
    collection: (name: string) => wrapCollection(name, inner.collection(name)),
  }
}

/** An entry that says the person left `topic`, and never came back. */
const leftTopic = (topic: string) => ({
  email: ADDRESS,
  topics: { [topic]: { optedOutAt: { seconds: 1 }, resubscribedAt: null } },
})

describe('the group is resolved from the declaration, and nothing else', () => {
  it('reads the sending site first, then its siblings', () => {
    expect(optOutHostIds(SITE_A, GROUP)).toEqual([SITE_A, SITE_B])
    // Reached from the sibling's side, the order flips and the set does not.
    expect(optOutHostIds(SITE_B, consentGroupForHost(ORG, SITE_B))).toEqual([
      SITE_B,
      SITE_A,
    ])
  })

  it('is the site alone for an org that declared nothing, and for no group at all', () => {
    expect(optOutHostIds(SITE_A, ALONE)).toEqual([SITE_A])
    expect(optOutHostIds(SITE_A)).toEqual([SITE_A])
    // Sharing an org is a billing fact, never a group.
    expect(optOutHostIds(SITE_C, consentGroupForHost(ORG, SITE_C))).toEqual([
      SITE_C,
    ])
  })

  it('refuses a group resolved for a different site', () => {
    // The wiring defect this guards is one site's send decided against
    // another site's lists — loud, not quietly narrower or wider.
    expect(() =>
      optOutHostIds(SITE_C, consentGroupForHost(ORG, SITE_B)),
    ).toThrow(/cannot decide a send from site-c/)
  })
})

describe('the site suppression list, across the group', () => {
  it('withholds site A’s send from somebody who unsubscribed from site B', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    })
    await expect(
      filterSendableForHost(SITE_A, [ADDRESS, OTHER], firestore, GROUP),
    ).resolves.toEqual([OTHER])
  })

  it('holds every entry a sibling’s list carries, whatever its reason', async () => {
    // A hand-added opt-out is the person leaving by phone; an erasure is
    // already on every site of the workspace. Neither is the sibling's alone.
    const firestore = recordingFirestore({
      [list(SITE_B, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'manual' },
        [OTHER_KEY]: { email: null, reason: 'erasure' },
      },
    })
    await expect(
      filterSendableForHost(SITE_A, [ADDRESS, OTHER], firestore, GROUP),
    ).resolves.toEqual([])
  })

  it('leaves the agency’s other client alone', async () => {
    const firestore = recordingFirestore({
      [list(SITE_C, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    })
    await expect(
      filterSendableForHost(SITE_A, [ADDRESS], firestore, GROUP),
    ).resolves.toEqual([ADDRESS])
  })

  it('reads a site in no group exactly as it always did', async () => {
    const seed = {
      [list(SITE_B, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    }
    const alone = recordingFirestore(seed)
    const unstated = recordingFirestore(seed)

    // B is not A's sibling here, so B's unsubscribe does not reach A.
    await expect(
      filterSendableForHost(SITE_A, [ADDRESS, OTHER], alone, ALONE),
    ).resolves.toEqual([ADDRESS, OTHER])
    await filterSendableForHost(SITE_A, [ADDRESS, OTHER], unstated)

    // The platform list per address, then this site's list per address —
    // and not one document under any other site.
    expect(alone.reads).toEqual([
      `emailSuppressions/${KEY}`,
      `emailSuppressions/${OTHER_KEY}`,
      `${list(SITE_A, 'suppressions')}/${KEY}`,
      `${list(SITE_A, 'suppressions')}/${OTHER_KEY}`,
    ])
    expect(unstated.reads).toEqual(alone.reads)
  })

  it('reads each sibling’s list once per address, in one round trip each', async () => {
    const firestore = recordingFirestore()
    await filterSendableForHost(SITE_A, [ADDRESS], firestore, GROUP)
    expect(
      firestore.reads.filter((path) => path.startsWith('hosts/')),
    ).toEqual([
      `${list(SITE_A, 'suppressions')}/${KEY}`,
      `${list(SITE_B, 'suppressions')}/${KEY}`,
    ])
  })

  it('fails CLOSED when a sibling’s list cannot be read', async () => {
    // Its own list was readable and clean. A list we could not read is still
    // not a list that said this address is safe to mail.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const inner = recordingFirestore()
    const firestore = {
      ...inner,
      getAll: async (...refs: any[]) => {
        if (refs.some((ref) => String(ref.collectionPath).includes(SITE_B))) {
          throw new Error('sibling list unavailable')
        }
        return inner.getAll(...refs)
      },
    }
    await expect(
      filterSendableForHost(SITE_A, [ADDRESS], firestore, GROUP),
    ).resolves.toEqual([])
    consoleError.mockRestore()
  })
})

describe('the topic opt-outs, across the group', () => {
  it('withholds site A’s newsletter from somebody who left it on site B', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, 'topicOptOuts')]: { [KEY]: leftTopic('newsletter') },
    })
    await expect(
      filterTopicSendable(SITE_A, 'newsletter', [ADDRESS, OTHER], firestore, GROUP),
    ).resolves.toEqual([OTHER])
    // They left ONE stream of the sender, and still get the others.
    await expect(
      filterTopicSendable(SITE_A, 'marketing', [ADDRESS], firestore, GROUP),
    ).resolves.toEqual([ADDRESS])
  })

  it('mails them again once the sibling’s opt-out is lifted', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, 'topicOptOuts')]: {
        [KEY]: {
          email: ADDRESS,
          topics: {
            newsletter: {
              optedOutAt: { seconds: 1 },
              resubscribedAt: { seconds: 2 },
            },
          },
        },
      },
    })
    await expect(
      filterTopicSendable(SITE_A, 'newsletter', [ADDRESS], firestore, GROUP),
    ).resolves.toEqual([ADDRESS])
  })

  it('carries a sibling’s REFUSAL and not its pending confirmation', async () => {
    // A confirmation site B asked for is a question B's form put; the sending
    // site's own pending entry still holds, as it always did.
    const pending = {
      email: ADDRESS,
      topics: { newsletter: { pendingAt: NOW, confirmedAt: null } },
    }
    const firestore = recordingFirestore({
      [list(SITE_B, 'topicOptOuts')]: { [KEY]: pending },
      [list(SITE_A, 'topicOptOuts')]: { [OTHER_KEY]: { ...pending, email: OTHER } },
    })
    await expect(
      filterTopicSendable(SITE_A, 'newsletter', [ADDRESS, OTHER], firestore, GROUP),
    ).resolves.toEqual([ADDRESS])
  })

  it('leaves the agency’s other client alone', async () => {
    const firestore = recordingFirestore({
      [list(SITE_C, 'topicOptOuts')]: { [KEY]: leftTopic('newsletter') },
    })
    await expect(
      filterTopicSendable(SITE_A, 'newsletter', [ADDRESS], firestore, GROUP),
    ).resolves.toEqual([ADDRESS])
  })

  it('reads a site in no group exactly as it always did', async () => {
    const alone = recordingFirestore({
      [list(SITE_B, 'topicOptOuts')]: { [KEY]: leftTopic('newsletter') },
    })
    await expect(
      filterTopicSendable(SITE_A, 'newsletter', [ADDRESS, OTHER], alone, ALONE),
    ).resolves.toEqual([ADDRESS, OTHER])
    expect(alone.reads).toEqual([
      `${list(SITE_A, 'topicOptOuts')}/${KEY}`,
      `${list(SITE_A, 'topicOptOuts')}/${OTHER_KEY}`,
    ])
  })
})

describe('the pace the person asked for, across the group', () => {
  const counter = (fields: Record<string, unknown>) => ({
    email: ADDRESS,
    sentAtMs: [],
    ...fields,
  })

  it('holds site A’s campaign for somebody who asked site B for a weekly pace', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: counter({
          cadence: 'weekly',
          cadenceSetAtMs: NOW - 10 * DAY,
          lastSentAtMs: NOW - 1 * DAY,
        }),
      },
    })
    await expect(
      filterCadenceSendable(SITE_A, [ADDRESS, OTHER], {
        nowMs: NOW,
        firestore,
        group: GROUP,
      }),
    ).resolves.toEqual([OTHER])
  })

  it('counts the group’s last send against a pace asked of the group', async () => {
    // Monthly, asked on site A's own page; site A last mailed them six weeks
    // ago, but site B mailed them yesterday — one a month from the sender.
    const firestore = recordingFirestore({
      [list(SITE_A, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: counter({
          cadence: 'monthly',
          cadenceSetAtMs: NOW - 90 * DAY,
          lastSentAtMs: NOW - 42 * DAY,
        }),
      },
      [list(SITE_B, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: counter({ lastSentAtMs: NOW - 1 * DAY }),
      },
    })
    await expect(
      filterCadenceSendable(SITE_A, [ADDRESS], { nowMs: NOW, firestore, group: GROUP }),
    ).resolves.toEqual([])
    // The same counters, read for the site alone, answer as they always did.
    await expect(
      filterCadenceSendable(SITE_A, [ADDRESS], { nowMs: NOW, firestore }),
    ).resolves.toEqual([ADDRESS])
  })

  it('lets the most RECENT choice stand, whichever site’s page it was made on', async () => {
    // Weekly on site B, then "as they come" on site A a week later: the later
    // answer undoes the earlier one, as it would on one site.
    const firestore = recordingFirestore({
      [list(SITE_B, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: counter({
          cadence: 'weekly',
          cadenceSetAtMs: NOW - 14 * DAY,
          lastSentAtMs: NOW - 1 * DAY,
        }),
      },
      [list(SITE_A, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: counter({ cadence: 'all', cadenceSetAtMs: NOW - 7 * DAY }),
      },
    })
    await expect(
      filterCadenceSendable(SITE_A, [ADDRESS], { nowMs: NOW, firestore, group: GROUP }),
    ).resolves.toEqual([ADDRESS])
  })

  it('leaves the agency’s other client alone', async () => {
    const firestore = recordingFirestore({
      [list(SITE_C, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: counter({
          cadence: 'monthly',
          cadenceSetAtMs: NOW - 10 * DAY,
          lastSentAtMs: NOW - 1 * DAY,
        }),
      },
    })
    await expect(
      filterCadenceSendable(SITE_A, [ADDRESS], { nowMs: NOW, firestore, group: GROUP }),
    ).resolves.toEqual([ADDRESS])
  })

  it('reads a site in no group exactly as it always did', async () => {
    const alone = recordingFirestore()
    await filterCadenceSendable(SITE_A, [ADDRESS, OTHER], {
      nowMs: NOW,
      firestore: alone,
      group: ALONE,
    })
    expect(alone.reads).toEqual([
      `${list(SITE_A, EMAIL_FREQUENCY_SUBCOLLECTION)}/${KEY}`,
      `${list(SITE_A, EMAIL_FREQUENCY_SUBCOLLECTION)}/${OTHER_KEY}`,
    ])
  })
})

/*==========================================
 * THE PER-MESSAGE GATE — the path an automation's `sendEmail` step, a cart
 * reminder, a restock alert and a member post all take.
 *
 * Every one of those senders resolves the group from the org it already holds
 * and hands it over as `consentHostIds`; the request below is the shape the
 * workflow step builds.
 *=========================================*/

describe('the marketing gate, across the group', () => {
  let previousSecret: string | undefined
  beforeAll(() => {
    previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
  })
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
    } else {
      process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
    }
  })

  const ask = (
    firestore: any,
    overrides: Partial<Parameters<typeof marketingSendVerdict>[0]> = {},
  ) =>
    marketingSendVerdict(
      {
        hostId: SITE_A,
        siteBase: SITE_BASE,
        email: ADDRESS,
        capped: true,
        topicId: 'newsletter',
        consentHostIds: GROUP.hostIds,
        ...overrides,
      },
      { nowMs: NOW, firestore },
    )

  it('refuses an automation email from site A to somebody who unsubscribed from site B', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({
      allowed: false,
      refusal: 'suppressed',
    })
    // The other direction in the same store: somebody who did not.
    await expect(ask(firestore, { email: OTHER })).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('refuses it to somebody who left the stream on site B', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, 'topicOptOuts')]: { [KEY]: leftTopic('newsletter') },
    })
    await expect(ask(firestore)).resolves.toMatchObject({
      allowed: false,
      refusal: 'topic-unsubscribed',
    })
    await expect(ask(firestore, { topicId: 'marketing' })).resolves.toMatchObject(
      { allowed: true },
    )
  })

  it('holds it for somebody who asked site B for a weekly pace, and says whose request it was', async () => {
    const firestore = recordingFirestore({
      [list(SITE_B, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: {
          email: ADDRESS,
          sentAtMs: [],
          cadence: 'weekly',
          cadenceSetAtMs: NOW - 10 * DAY,
          lastSentAtMs: NOW - 1 * DAY,
        },
      },
    })
    const verdict = await ask(firestore)
    expect(verdict).toMatchObject({ allowed: false, refusal: 'cadence-limited' })
    expect(verdict.detail).toMatch(/consent group/)
  })

  it('leaves the agency’s other client alone', async () => {
    const firestore = recordingFirestore({
      [list(SITE_C, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
      [list(SITE_C, 'topicOptOuts')]: { [KEY]: leftTopic('newsletter') },
    })
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
  })

  it('keeps the frequency ceiling the sending site’s own', async () => {
    // A platform guard on how much THIS site sends, not a request the person
    // made — so a sibling's full day does not cap site A.
    const firestore = recordingFirestore({
      [list(SITE_B, EMAIL_FREQUENCY_SUBCOLLECTION)]: {
        [KEY]: {
          email: ADDRESS,
          sentAtMs: [NOW - 1, NOW - 2, NOW - 3, NOW - 4, NOW - 5, NOW - 6],
          lastSentAtMs: NOW - 1,
        },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
  })

  it('reads a site in no group exactly as it always did', async () => {
    const seed = {
      [list(SITE_B, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    }
    const alone = recordingFirestore(seed)
    await expect(
      ask(alone, { consentHostIds: ALONE.hostIds }),
    ).resolves.toMatchObject({ allowed: true })

    // The platform list, this site's list, this site's stream record, and
    // this site's counter read once — nothing under site B.
    expect(alone.reads).toEqual([
      `emailSuppressions/${KEY}`,
      `${list(SITE_A, 'suppressions')}/${KEY}`,
      `${list(SITE_A, 'topicOptOuts')}/${KEY}`,
      `${list(SITE_A, EMAIL_FREQUENCY_SUBCOLLECTION)}/${KEY}`,
    ])
    // A request that names no group reads the same.
    const unstated = recordingFirestore(seed)
    await ask(unstated, { consentHostIds: undefined })
    expect(unstated.reads).toEqual(alone.reads)
  })

  it('reads a list that does not name the sending site as the site alone, and never throws', async () => {
    // `sendEmail` answers a gate that throws by sending UNGATED, so a
    // malformed group must narrow to the site, not fail.
    const firestore = recordingFirestore({
      [list(SITE_B, 'suppressions')]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
      [list(SITE_A, 'suppressions')]: {
        [OTHER_KEY]: { email: OTHER, reason: 'unsubscribe' },
      },
    })
    await expect(
      ask(firestore, { consentHostIds: [SITE_B, SITE_C] }),
    ).resolves.toMatchObject({ allowed: true })
    // …and its own list still holds.
    await expect(
      ask(firestore, { email: OTHER, consentHostIds: [SITE_B, SITE_C] }),
    ).resolves.toMatchObject({ allowed: false, refusal: 'suppressed' })
  })
})
