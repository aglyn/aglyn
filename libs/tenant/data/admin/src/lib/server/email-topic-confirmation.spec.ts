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
 * THE DOUBLE OPT-IN QUARANTINE — what is written, and what refuses to be.
 *
 * `email-suppression.spec.ts` proves the send path refuses a pending address;
 * `email-topics.spec.ts` proves what an entry means. This proves the writes
 * that produce those entries, and in particular the three things that make
 * the quarantine a gate rather than a delay: re-asking does not refresh the
 * window, an expired link admits nobody, and a confirmation cannot reverse an
 * unsubscribe.
 *
 * Nothing is doubled but Firestore. The state reader and the expiry rule are
 * the real functions — they ARE the rules under test.
 */

import {
  readTopicSubscriptionState,
  DOUBLE_OPT_IN_EXPIRY_MS,
} from '@aglyn/aglyn/app-utils/email-topics'
import { emailSuppressionKey } from './email-suppression'
import {
  confirmTopicSubscription,
  recordPendingTopicConfirmation,
  siteRequiresDoubleOptIn,
} from './email-topic-confirmation'
import { fakeFirestore } from './test-firestore'

const HOST = 'host-1'
const ADDRESS = 'dana@example.com'
const TOPIC = 'newsletter'
const KEY = emailSuppressionKey(ADDRESS) as string
const OPT_OUTS = `hosts/${HOST}/topicOptOuts`
const NOW = 1_800_000_000_000

const entry = (firestore: ReturnType<typeof fakeFirestore>) =>
  firestore.docs(OPT_OUTS)[KEY]?.topics?.[TOPIC]

const seeded = (topics: Record<string, unknown>) =>
  fakeFirestore({ [OPT_OUTS]: { [KEY]: { email: ADDRESS, topics } } })

describe('asking for a confirmation', () => {
  it('puts a new address in the quarantine', async () => {
    const firestore = fakeFirestore()
    await expect(
      recordPendingTopicConfirmation(HOST, ADDRESS, TOPIC, {
        nowMs: NOW,
        firestore,
      }),
    ).resolves.toEqual({ result: 'pending', pendingAtMs: NOW })
    expect(readTopicSubscriptionState(entry(firestore))).toBe('pending')
  })

  /**
   * A second signup inside the window keeps the ORIGINAL moment, so the
   * expiry measures from when we first asked. Restamping would let anybody
   * resubmitting a form hold a confirmation link alive indefinitely.
   */
  it('does not restamp a request that is already pending', async () => {
    const firestore = seeded({
      [TOPIC]: { pendingAt: NOW - 1000, confirmedAt: null },
    })
    const again = await recordPendingTopicConfirmation(HOST, ADDRESS, TOPIC, {
      nowMs: NOW,
      firestore,
    })
    expect(again).toEqual({ result: 'pending', pendingAtMs: NOW - 1000 })
    expect(entry(firestore).pendingAt).toBe(NOW - 1000)
  })

  it('says nothing needs confirming for somebody already confirmed', async () => {
    const firestore = seeded({
      [TOPIC]: { pendingAt: NOW - 1000, confirmedAt: NOW - 500 },
    })
    const answer = await recordPendingTopicConfirmation(HOST, ADDRESS, TOPIC, {
      nowMs: NOW,
      firestore,
    })
    expect(answer.result).toBe('already-subscribed')
    expect(entry(firestore).confirmedAt).toBe(NOW - 500)
  })

  /**
   * A signup form must not become a way to mail somebody who unsubscribed by
   * asking them again — the confirmation request is itself a message.
   */
  it('refuses somebody who left this stream, and writes nothing', async () => {
    const firestore = seeded({
      [TOPIC]: { optedOutAt: NOW - 1000, resubscribedAt: null },
    })
    const answer = await recordPendingTopicConfirmation(HOST, ADDRESS, TOPIC, {
      nowMs: NOW,
      firestore,
    })
    expect(answer).toEqual({ result: 'opted-out', pendingAtMs: null })
    expect(entry(firestore).pendingAt).toBeUndefined()
  })

  it('refuses a value that is not an address, or not a topic id', async () => {
    const firestore = fakeFirestore()
    await expect(
      recordPendingTopicConfirmation(HOST, 'not-an-address', TOPIC, {
        nowMs: NOW,
        firestore,
      }),
    ).resolves.toMatchObject({ result: 'unusable' })
    await expect(
      recordPendingTopicConfirmation(HOST, ADDRESS, 'a:b', {
        nowMs: NOW,
        firestore,
      }),
    ).resolves.toMatchObject({ result: 'unusable' })
    expect(Object.keys(firestore.docs(OPT_OUTS))).toHaveLength(0)
  })

  it('leaves another topic on the same record alone', async () => {
    const firestore = seeded({
      marketing: { optedOutAt: NOW - 5, resubscribedAt: null },
    })
    await recordPendingTopicConfirmation(HOST, ADDRESS, TOPIC, {
      nowMs: NOW,
      firestore,
    })
    expect(
      firestore.docs(OPT_OUTS)[KEY].topics['marketing'].optedOutAt,
    ).toBe(NOW - 5)
    expect(readTopicSubscriptionState(entry(firestore))).toBe('pending')
  })
})

describe('confirming', () => {
  it('makes a pending address a subscriber', async () => {
    const firestore = seeded({
      [TOPIC]: { pendingAt: NOW - 1000, confirmedAt: null },
    })
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, TOPIC, { nowMs: NOW, firestore }),
    ).resolves.toBe('confirmed')
    expect(readTopicSubscriptionState(entry(firestore))).toBe('subscribed')
    expect(entry(firestore).confirmedAt).toBe(NOW)
  })

  /**
   * The pending mark stays beside the confirmation. The pair IS the evidence
   * — when we asked and when they answered — which is the same argument the
   * opt-out record makes for surviving a resubscribe.
   */
  it('keeps the request beside the answer', async () => {
    const firestore = seeded({
      [TOPIC]: { pendingAt: NOW - 1000, confirmedAt: null },
    })
    await confirmTopicSubscription(HOST, ADDRESS, TOPIC, {
      nowMs: NOW,
      firestore,
    })
    expect(entry(firestore).pendingAt).toBe(NOW - 1000)
  })

  it('is idempotent — a second click changes nothing', async () => {
    const firestore = seeded({
      [TOPIC]: { pendingAt: NOW - 1000, confirmedAt: NOW - 900 },
    })
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, TOPIC, { nowMs: NOW, firestore }),
    ).resolves.toBe('already-confirmed')
    expect(entry(firestore).confirmedAt).toBe(NOW - 900)
  })

  /**
   * Expiry stops the LINK working. Admitting the address after the window, or
   * clearing the request, would make the window a delay somebody could wait
   * out rather than a gate.
   */
  it('refuses an expired link and leaves the address unmailable', async () => {
    const firestore = seeded({
      [TOPIC]: {
        pendingAt: NOW - DOUBLE_OPT_IN_EXPIRY_MS - 1,
        confirmedAt: null,
      },
    })
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, TOPIC, { nowMs: NOW, firestore }),
    ).resolves.toBe('expired')
    expect(readTopicSubscriptionState(entry(firestore))).toBe('pending')
    expect(entry(firestore).confirmedAt).toBeNull()
  })

  it('honors a link on its last moment', async () => {
    const firestore = seeded({
      [TOPIC]: {
        pendingAt: NOW - DOUBLE_OPT_IN_EXPIRY_MS,
        confirmedAt: null,
      },
    })
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, TOPIC, { nowMs: NOW, firestore }),
    ).resolves.toBe('confirmed')
  })

  /**
   * Same rule as `releaseSiteSuppression`: the recipient's later, more
   * explicit act stands, and a link minted before it must not undo it.
   */
  it('cannot reverse an unsubscribe', async () => {
    const firestore = seeded({
      [TOPIC]: {
        pendingAt: NOW - 1000,
        confirmedAt: null,
        optedOutAt: NOW - 500,
        resubscribedAt: null,
      },
    })
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, TOPIC, { nowMs: NOW, firestore }),
    ).resolves.toBe('opted-out')
    expect(readTopicSubscriptionState(entry(firestore))).toBe('opted-out')
  })

  it('says there is nothing to confirm when nothing was asked', async () => {
    const firestore = fakeFirestore()
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, TOPIC, { nowMs: NOW, firestore }),
    ).resolves.toBe('not-pending')
    expect(Object.keys(firestore.docs(OPT_OUTS))).toHaveLength(0)
  })

  it('refuses a value that is not an address, or not a topic id', async () => {
    const firestore = fakeFirestore()
    await expect(
      confirmTopicSubscription(HOST, 'not-an-address', TOPIC, {
        nowMs: NOW,
        firestore,
      }),
    ).resolves.toBe('unusable')
    await expect(
      confirmTopicSubscription(HOST, ADDRESS, 'a/b', { nowMs: NOW, firestore }),
    ).resolves.toBe('unusable')
  })
})

describe('the site default', () => {
  it('is on only when the site says so', async () => {
    await expect(
      siteRequiresDoubleOptIn(
        HOST,
        fakeFirestore({ hosts: { [HOST]: { emailDoubleOptIn: true } } }),
      ),
    ).resolves.toBe(true)
    await expect(
      siteRequiresDoubleOptIn(
        HOST,
        fakeFirestore({ hosts: { [HOST]: { emailDoubleOptIn: false } } }),
      ),
    ).resolves.toBe(false)
  })

  /**
   * Off, not on. A default a failed read could switch ON would quarantine
   * every new signup on a site whose owner never asked for confirmations, and
   * they would have no way to tell why their list stopped growing.
   */
  it('is off for a site that never set it, and for a site that is not there', async () => {
    await expect(
      siteRequiresDoubleOptIn(HOST, fakeFirestore({ hosts: { [HOST]: {} } })),
    ).resolves.toBe(false)
    await expect(siteRequiresDoubleOptIn(HOST, fakeFirestore())).resolves.toBe(
      false,
    )
    await expect(siteRequiresDoubleOptIn('', fakeFirestore())).resolves.toBe(
      false,
    )
  })

  it('is off when the read throws', async () => {
    const broken = fakeFirestore()
    broken.collection = () => {
      throw new Error('unavailable')
    }
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    await expect(siteRequiresDoubleOptIn(HOST, broken)).resolves.toBe(false)
    consoleError.mockRestore()
  })
})
