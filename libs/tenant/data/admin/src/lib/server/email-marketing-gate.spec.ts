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
 * The marketing gate: both suppression lists, the frequency ceiling, and the
 * unsubscribe URL.
 *
 * Every assertion here is written so that it can fail in BOTH directions. A
 * ceiling test that only proves a refusal would pass over a gate that refuses
 * everybody — the shape where mocking the policy makes every limit read zero
 * and a clamp goes green having delivered nothing. So each ceiling is checked
 * one below the line as well as at it, and each suppression is checked
 * against a clean address in the same store.
 */

import {
  MARKETING_FREQUENCY_DEFAULT_PER_WINDOW,
  MARKETING_FREQUENCY_WINDOW_MS,
} from '@aglyn/shared-util-email'
import { emailSuppressionKey } from './email-suppression'
import {
  EMAIL_FREQUENCY_SUBCOLLECTION,
  filterCadenceSendable,
  marketingSendVerdict,
  readMarketingFrequency,
  recordMarketingSends,
  setMarketingCadence,
} from './email-marketing-gate'
import { fakeFirestore } from './test-firestore'

const HOST = 'host-1'
const SITE_BASE = 'https://shop.example.com'
const ADDRESS = 'dana@example.com'
const OTHER = 'sam@example.com'
const KEY = emailSuppressionKey(ADDRESS) as string
const NOW = 1_800_000_000_000

const FREQUENCY_PATH = `hosts/${HOST}/${EMAIL_FREQUENCY_SUBCOLLECTION}`

const ask = (
  firestore: ReturnType<typeof fakeFirestore>,
  overrides: Partial<Parameters<typeof marketingSendVerdict>[0]> = {},
  nowMs = NOW,
) =>
  marketingSendVerdict(
    {
      hostId: HOST,
      siteBase: SITE_BASE,
      email: ADDRESS,
      capped: true,
      ...overrides,
    },
    { nowMs, firestore },
  )

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

describe('the gate consults BOTH suppression lists', () => {
  it('lets a clean address through, and says where it may unsubscribe', async () => {
    const firestore = fakeFirestore()
    const verdict = await ask(firestore)

    expect(verdict.allowed).toBe(true)
    expect(verdict.refusal).toBeUndefined()
    expect(verdict.unsubscribeUrl).toContain(
      `${SITE_BASE}/api/email/unsubscribe`,
    )
    expect(verdict.unsubscribeUrl).toContain(`hostId=${HOST}`)
    expect(verdict.unsubscribeUrl).toContain('sig=')
  })

  it('refuses an address on the PLATFORM list', async () => {
    const firestore = fakeFirestore({
      emailSuppressions: {
        [KEY]: { email: ADDRESS, reason: 'bounce', releasedAt: null },
      },
    })
    const refused = await ask(firestore)
    expect(refused).toMatchObject({ allowed: false, refusal: 'suppressed' })

    // The other direction, in the SAME store: a clean address is not caught
    // by a gate that has learned to refuse everybody.
    const allowed = await ask(firestore, { email: OTHER })
    expect(allowed.allowed).toBe(true)
  })

  it('refuses an address on this SITE’s own list', async () => {
    const firestore = fakeFirestore({
      [`hosts/${HOST}/suppressions`]: {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({
      allowed: false,
      refusal: 'suppressed',
    })
    await expect(ask(firestore, { email: OTHER })).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('does not let one site’s unsubscribe silence another site', async () => {
    const firestore = fakeFirestore({
      'hosts/other-site/suppressions': {
        [KEY]: { email: ADDRESS, reason: 'unsubscribe' },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
    await expect(
      ask(firestore, { hostId: 'other-site' }),
    ).resolves.toMatchObject({ allowed: false, refusal: 'suppressed' })
  })

  it('does NOT count a message it refused against the ceiling', async () => {
    // A suppressed address whose window kept growing would stay capped for a
    // day after somebody released it.
    const firestore = fakeFirestore({
      emailSuppressions: {
        [KEY]: { email: ADDRESS, reason: 'complaint', releasedAt: null },
      },
    })
    await ask(firestore)
    expect(firestore.docs(FREQUENCY_PATH)[KEY]).toBeUndefined()
  })
})

describe('the frequency ceiling', () => {
  const cap = MARKETING_FREQUENCY_DEFAULT_PER_WINDOW
  const windowOf = (count: number) =>
    Array.from({ length: count }, (_unused, index) => NOW - 1_000 * (index + 1))

  it('allows the message that fills the last slot', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: { email: ADDRESS, sentAtMs: windowOf(cap - 1) },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
  })

  it('refuses the one after it', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: { [KEY]: { email: ADDRESS, sentAtMs: windowOf(cap) } },
    })
    const verdict = await ask(firestore)
    expect(verdict).toMatchObject({
      allowed: false,
      refusal: 'frequency-capped',
    })
    // A refusal still names the way out, so the message a caller logs can say
    // something a person could act on.
    expect(verdict.detail).toContain(String(cap))
  })

  it('forgets sends that have left the window', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: {
          email: ADDRESS,
          sentAtMs: Array.from(
            { length: cap },
            () => NOW - MARKETING_FREQUENCY_WINDOW_MS - 1,
          ),
        },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
    // …and the stale instants are not carried forward, so the record cannot
    // grow without bound.
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([NOW])
  })

  it('counts a granted send, so the next one sees it', async () => {
    const firestore = fakeFirestore()
    for (let index = 0; index < cap; index += 1) {
      await ask(firestore, {}, NOW + index)
    }
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toHaveLength(cap)
    await expect(ask(firestore, {}, NOW + cap)).resolves.toMatchObject({
      allowed: false,
      refusal: 'frequency-capped',
    })
  })

  it('counts each recipient separately', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: { [KEY]: { email: ADDRESS, sentAtMs: windowOf(cap) } },
    })
    await expect(ask(firestore, { email: OTHER })).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('lets an UNCAPPED send through a full window, and still counts it', async () => {
    // What a campaign gets: it is a merchant's reviewed, one-shot act with a
    // recipient count on screen, so the ceiling does not remove people from
    // it — but it is most of the mail a person receives, so it is counted.
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: { [KEY]: { email: ADDRESS, sentAtMs: windowOf(cap) } },
    })
    await expect(ask(firestore, { capped: false })).resolves.toMatchObject({
      allowed: true,
    })
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toContain(NOW)
  })

  it('fails OPEN when the window cannot be read', async () => {
    // A counter outage must not become a mail outage. The suppression half
    // above fails the other way, and the next case proves the two postures
    // are independent rather than one setting.
    const exploding = fakeFirestore()
    const realCollection = exploding.collection.bind(exploding)
    exploding.collection = (name: string) => {
      const api = realCollection(name)
      const realDoc = api.doc.bind(api)
      api.doc = (id: string) => {
        const ref = realDoc(id)
        if (name === FREQUENCY_PATH) {
          ref.get = async () => {
            throw new Error('frequency read is down')
          }
        }
        return ref
      }
      return api
    }
    await expect(ask(exploding as never)).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('fails CLOSED when a suppression list cannot be read', async () => {
    const exploding = fakeFirestore()
    exploding.getAll = async () => {
      throw new Error('suppression read is down')
    }
    await expect(ask(exploding as never)).resolves.toMatchObject({
      allowed: false,
      refusal: 'suppressed',
    })
  })
})

describe('recordMarketingSends', () => {
  it('records a batch, one window per recipient', async () => {
    const firestore = fakeFirestore()
    const recorded = await recordMarketingSends(HOST, [ADDRESS, OTHER], {
      nowMs: NOW,
      firestore,
    })

    expect(recorded).toBe(2)
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([NOW])
    expect(
      firestore.docs(FREQUENCY_PATH)[emailSuppressionKey(OTHER) as string]
        .sentAtMs,
    ).toEqual([NOW])
  })

  it('appends to a window that already exists', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: { [KEY]: { email: ADDRESS, sentAtMs: [NOW - 5_000] } },
    })
    await recordMarketingSends(HOST, [ADDRESS], { nowMs: NOW, firestore })
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([
      NOW - 5_000,
      NOW,
    ])
  })

  it('names the same person once, however the caller spelled it', async () => {
    const firestore = fakeFirestore()
    await recordMarketingSends(HOST, ['  DANA@Example.com ', ADDRESS], {
      nowMs: NOW,
      firestore,
    })
    expect(Object.keys(firestore.docs(FREQUENCY_PATH))).toEqual([KEY])
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([NOW])
  })

  it('ignores a value that is not an address rather than keying a guess', async () => {
    const firestore = fakeFirestore()
    await expect(
      recordMarketingSends(HOST, ['not-an-address'], { nowMs: NOW, firestore }),
    ).resolves.toBe(0)
    expect(Object.keys(firestore.docs(FREQUENCY_PATH))).toHaveLength(0)
  })
})

describe('readMarketingFrequency', () => {
  it('reads the stored window', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: { [KEY]: { email: ADDRESS, sentAtMs: [1, 2, 3] } },
    })
    await expect(
      readMarketingFrequency(HOST, ADDRESS, firestore),
    ).resolves.toEqual([1, 2, 3])
  })

  it('answers an empty window for an address nobody has been mailed at', async () => {
    await expect(
      readMarketingFrequency(HOST, ADDRESS, fakeFirestore()),
    ).resolves.toEqual([])
  })
})

/**
 * THE RECIPIENT'S OWN REQUEST — `docs/specs/email-competitive-gaps.md` G10's
 * preference-center half.
 *
 * Every assertion here is written to fail in both directions: a cadence that
 * refuses is checked against the same store one interval later, and against a
 * recipient in the same store who asked for nothing.
 */
describe('the pace the recipient asked for', () => {
  const DAY = 86_400_000
  const withCadence = (cadence: string, lastSentAtMs: number | null) =>
    fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: {
          email: ADDRESS,
          cadence,
          ...(lastSentAtMs === null ? {} : { lastSentAtMs }),
          sentAtMs: [],
        },
      },
    })

  it('refuses a second message inside a weekly recipient’s week', async () => {
    const firestore = withCadence('weekly', NOW - 3 * DAY)
    await expect(ask(firestore)).resolves.toMatchObject({
      allowed: false,
      refusal: 'cadence-limited',
    })
    // The other direction, same store: somebody who asked for nothing goes.
    await expect(ask(firestore, { email: OTHER })).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('allows it once the week has passed', async () => {
    const firestore = withCadence('weekly', NOW - 8 * DAY)
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
  })

  it('holds a daily recipient for a day and a monthly one for a month', async () => {
    await expect(
      ask(withCadence('daily', NOW - 2 * 3_600_000)),
    ).resolves.toMatchObject({ allowed: false, refusal: 'cadence-limited' })
    await expect(
      ask(withCadence('daily', NOW - 25 * 3_600_000)),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      ask(withCadence('monthly', NOW - 10 * DAY)),
    ).resolves.toMatchObject({ allowed: false, refusal: 'cadence-limited' })
    await expect(
      ask(withCadence('monthly', NOW - 31 * DAY)),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('mails somebody it has never mailed, whatever pace they chose', async () => {
    await expect(
      ask(withCadence('monthly', null)),
    ).resolves.toMatchObject({ allowed: true })
  })

  /**
   * `capped: false` exempts a campaign from the platform CEILING, on the
   * argument that a control the merchant cannot see must not silently shrink
   * a reviewed send. That argument does not reach a request the recipient
   * made: a campaign that overrode it would make the preference page a form
   * recording a choice nothing honors.
   */
  it('binds a campaign, which the platform ceiling does not', async () => {
    const firestore = withCadence('weekly', NOW - 3 * DAY)
    await expect(
      ask(firestore, { capped: false }),
    ).resolves.toMatchObject({ allowed: false, refusal: 'cadence-limited' })
  })

  it('does not count a message the pace refused', async () => {
    const firestore = withCadence('weekly', NOW - 3 * DAY)
    await ask(firestore)
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([])
  })

  it('still offers the unsubscribe URL on a refusal', async () => {
    const refused = await ask(withCadence('weekly', NOW - 3 * DAY))
    expect(refused.unsubscribeUrl).toContain('/api/email/unsubscribe')
  })

  it('treats an unreadable or absent choice as no choice', async () => {
    await expect(ask(withCadence('fortnightly', NOW - 1))).resolves.toMatchObject(
      { allowed: true },
    )
    await expect(
      ask(
        fakeFirestore({
          [FREQUENCY_PATH]: {
            [KEY]: { email: ADDRESS, lastSentAtMs: NOW - 1, sentAtMs: [] },
          },
        }),
      ),
    ).resolves.toMatchObject({ allowed: true })
  })

  /**
   * Every record written before `lastSentAtMs` existed carries a window and
   * nothing else. Reading `null` for those would let one message through at
   * any pace on the first send after this ships.
   */
  it('falls back to the newest instant in the window', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: {
          email: ADDRESS,
          cadence: 'weekly',
          sentAtMs: [NOW - 5 * 3_600_000, NOW - 9 * 3_600_000],
        },
      },
    })
    await expect(ask(firestore)).resolves.toMatchObject({
      allowed: false,
      refusal: 'cadence-limited',
    })
  })

  it('records the last send so the next interval can be measured', async () => {
    const firestore = fakeFirestore()
    await ask(firestore)
    expect(firestore.docs(FREQUENCY_PATH)[KEY].lastSentAtMs).toBe(NOW)
  })

  it('records the last send from a batch too', async () => {
    const firestore = fakeFirestore()
    await recordMarketingSends(HOST, [ADDRESS], { nowMs: NOW, firestore })
    expect(firestore.docs(FREQUENCY_PATH)[KEY].lastSentAtMs).toBe(NOW)
  })

  it('does not disturb the window when the choice is stored', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: { [KEY]: { email: ADDRESS, sentAtMs: [NOW - 10] } },
    })
    await expect(
      setMarketingCadence(HOST, ADDRESS, 'weekly', { nowMs: NOW, firestore }),
    ).resolves.toBe(true)
    expect(firestore.docs(FREQUENCY_PATH)[KEY]).toMatchObject({
      cadence: 'weekly',
      cadenceSetAtMs: NOW,
      sentAtMs: [NOW - 10],
    })
  })

  it('refuses to key a choice for a value that is not an address', async () => {
    const firestore = fakeFirestore()
    await expect(
      setMarketingCadence(HOST, 'not-an-address', 'weekly', {
        nowMs: NOW,
        firestore,
      }),
    ).resolves.toBe(false)
    expect(Object.keys(firestore.docs(FREQUENCY_PATH))).toHaveLength(0)
  })
})

/**
 * The campaign's pre-send subtraction, so the recipient count on the
 * composer is true before anybody presses Send.
 */
describe('filterCadenceSendable', () => {
  const DAY = 86_400_000
  const OTHER_KEY = emailSuppressionKey(OTHER) as string

  it('holds back the person who asked for less and keeps everybody else', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: { email: ADDRESS, cadence: 'weekly', lastSentAtMs: NOW - DAY },
        [OTHER_KEY]: { email: OTHER, cadence: 'weekly', lastSentAtMs: NOW - 8 * DAY },
      },
    })
    await expect(
      filterCadenceSendable(HOST, [ADDRESS, OTHER], { nowMs: NOW, firestore }),
    ).resolves.toEqual([OTHER])
  })

  it('keeps an address with no counter at all', async () => {
    await expect(
      filterCadenceSendable(HOST, [ADDRESS], {
        nowMs: NOW,
        firestore: fakeFirestore(),
      }),
    ).resolves.toEqual([ADDRESS])
  })

  it('keeps a value it cannot key rather than refusing it a second time', async () => {
    await expect(
      filterCadenceSendable(HOST, ['not-an-address'], {
        nowMs: NOW,
        firestore: fakeFirestore(),
      }),
    ).resolves.toEqual(['not-an-address'])
  })

  /**
   * Fails OPEN, unlike the two suppression lists. A pace is not a stop, and
   * withholding a whole campaign on a transient read failure is the larger
   * error — everybody who asked us to stop entirely has already been refused
   * one layer up.
   */
  it('sends the whole audience when the counter cannot be read', async () => {
    const broken = fakeFirestore()
    broken.getAll = async () => {
      throw new Error('unavailable')
    }
    await expect(
      filterCadenceSendable(HOST, [ADDRESS, OTHER], {
        nowMs: NOW,
        firestore: broken,
      }),
    ).resolves.toEqual([ADDRESS, OTHER])
  })
})
