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
  readMarketingFrequencyState,
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

/*==========================================
 * ENGAGEMENT-BASED SUNSETTING.
 *
 * Three properties, and every one of them is asserted in BOTH directions,
 * because a sunset is a refusal and the failure that would go unnoticed is
 * the one where it refuses everybody:
 *
 *  1. It refuses a person who has gone quiet for longer than the window.
 *  2. It refuses NOBODY else — not a new subscriber, not somebody we have no
 *     record of, not somebody who engaged inside the window, and not a
 *     campaign.
 *  3. It removes nothing. No suppression, no membership change, and not even
 *     a mark on the frequency window, because a message that never left must
 *     not count against what this person has received.
 *=========================================*/

const DAY = 86_400_000
const SUNSET_DAYS = 180

/** Turns the sunset on for one test body, and off again afterwards. */
async function withSunset(days: number | string, body: () => Promise<void>) {
  const previous = process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS']
  process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS'] = String(days)
  try {
    await body()
  } finally {
    if (previous === undefined) {
      delete process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS']
    } else {
      process.env['AGLYN_EMAIL_SUNSET_AFTER_DAYS'] = previous
    }
  }
}

/**
 * A store where this site has mailed the address for two years.
 *
 * `engagedAtMs` null is "never opened anything", which is the population the
 * sunset is aimed at.
 */
const agedStore = (engagedAtMs: number | null, firstSentAtMs = NOW - 720 * DAY) =>
  fakeFirestore({
    [FREQUENCY_PATH]: {
      [KEY]: { email: ADDRESS, sentAtMs: [], firstSentAtMs },
    },
    emailDeliveries: engagedAtMs
      ? { [KEY]: { lastEngagedAtMs: engagedAtMs, lastOpenedAtMs: engagedAtMs } }
      : {},
  })

describe('the sunset refuses a send and reduces nobody', () => {
  it('is OFF unless an operator configures a window', async () => {
    const firestore = agedStore(null)

    // The same address, the same silence, and no refusal — because no vendor
    // researched automates this, and a platform that silently stopped mailing
    // a merchant's quiet subscribers would be doing something none of their
    // previous tools did.
    await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
  })

  it('refuses somebody quiet for longer than the window', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = agedStore(null)
      const verdict = await ask(firestore)

      expect(verdict).toMatchObject({ allowed: false, refusal: 'unengaged' })
      // It still hands back a way out. A refusal is not a reason to withhold
      // the unsubscribe link from the log line that reports it.
      expect(verdict.unsubscribeUrl).toContain('/api/email/unsubscribe')
    })
  })

  it('allows somebody who engaged inside the window, in the same store', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      await expect(ask(agedStore(NOW - 10 * DAY))).resolves.toMatchObject({
        allowed: true,
      })
    })
  })

  it('holds at the boundary in both directions', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      await expect(
        ask(agedStore(NOW - SUNSET_DAYS * DAY)),
      ).resolves.toMatchObject({ allowed: true })
      await expect(
        ask(agedStore(NOW - SUNSET_DAYS * DAY - 1)),
      ).resolves.toMatchObject({ allowed: false, refusal: 'unengaged' })
    })
  })

  /**
   * ⚠️ A NEW SUBSCRIBER HAS NO ENGAGEMENT YET.
   *
   * The window is measured from when this site STARTED mailing them, so
   * somebody it has not been mailing for longer than the window is never
   * refused however little they have engaged. Without this the sunset would
   * refuse everybody the day it was switched on.
   */
  it('never refuses somebody this site has not been mailing that long', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      await expect(
        ask(agedStore(null, NOW - 10 * DAY)),
      ).resolves.toMatchObject({ allowed: true })
    })
  })

  it('never refuses somebody it holds no mailing record for', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      // Missing evidence is not evidence of absence, and the reading that
      // mails somebody once more is the recoverable one.
      await expect(ask(fakeFirestore())).resolves.toMatchObject({
        allowed: true,
      })
    })
  })

  /*
   * A campaign is a reviewed act with its recipient count on screen before
   * anybody presses Send. It yields to the sunset exactly as it yields to the
   * frequency ceiling — through the same flag — so that number stays true.
   */
  it('does not refuse a campaign', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      await expect(
        ask(agedStore(null), { capped: false }),
      ).resolves.toMatchObject({ allowed: true })
    })
  })

  it('reads an out-of-range window as OFF rather than as a default', async () => {
    // The opposite handling from the frequency cap, and deliberately: a typo
    // there weakens a guard that is already on, and a typo here would switch
    // on a refusal nobody asked for.
    await withSunset(2, async () => {
      await expect(ask(agedStore(null))).resolves.toMatchObject({
        allowed: true,
      })
    })
    await withSunset('not-a-number', async () => {
      await expect(ask(agedStore(null))).resolves.toMatchObject({
        allowed: true,
      })
    })
  })

  /**
   * ⛔ THE RULE THE WHOLE FEATURE SITS UNDER.
   *
   * A ceiling never removes a person or their data. A sunset refuses the
   * SEND: nothing is suppressed, nothing is unsubscribed, no membership
   * changes, and the frequency window is not even appended to — a message
   * that never left must not count against what this person has received.
   */
  it('writes no suppression and does not count the message it refused', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = agedStore(null)
      await ask(firestore)

      expect(Object.keys(firestore.docs('emailSuppressions'))).toHaveLength(0)
      expect(
        Object.keys(firestore.docs(`hosts/${HOST}/suppressions`)),
      ).toHaveLength(0)
      expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([])
      // The address is exactly where it was, first-send stamp included.
      expect(firestore.docs(FREQUENCY_PATH)[KEY].firstSentAtMs).toBe(
        NOW - 720 * DAY,
      )
    })
  })

  /**
   * REVERSIBLE WITH NOBODY DOING ANYTHING.
   *
   * The only state is two timestamps. A person who opens anything moves the
   * second one, and the very next send finds them inside the window. Nothing
   * has to be undone, because nothing was done.
   */
  it('becomes mailable again the moment the person engages', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = agedStore(null)
      await expect(ask(firestore)).resolves.toMatchObject({
        allowed: false,
        refusal: 'unengaged',
      })

      // The delivery webhook's rollup, doing exactly what it does on an open.
      await firestore
        .collection('emailDeliveries')
        .doc(KEY)
        .set({ lastEngagedAtMs: NOW - DAY, lastOpenedAtMs: NOW - DAY }, { merge: true })

      await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })
    })
  })
})

describe('the first-send stamp the sunset measures from', () => {
  it('is written by the gate on a send it allows', async () => {
    const firestore = fakeFirestore()
    await ask(firestore)

    expect(firestore.docs(FREQUENCY_PATH)[KEY].firstSentAtMs).toBe(NOW)
  })

  /**
   * ⚠️ WRITE-ONCE, and the sunset is unreachable without it. Re-stamping on
   * every send would keep the relationship permanently younger than any
   * window, so nobody would ever be old enough to be quiet.
   */
  it('is never re-stamped by a later send', async () => {
    const firestore = fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: { email: ADDRESS, sentAtMs: [], firstSentAtMs: NOW - 500 * DAY },
      },
    })
    await ask(firestore)

    expect(firestore.docs(FREQUENCY_PATH)[KEY].firstSentAtMs).toBe(
      NOW - 500 * DAY,
    )
  })

  it('is written by the campaign path’s batch recorder too', async () => {
    const firestore = fakeFirestore()
    await recordMarketingSends(HOST, [ADDRESS], { nowMs: NOW, firestore })

    expect(firestore.docs(FREQUENCY_PATH)[KEY].firstSentAtMs).toBe(NOW)

    await recordMarketingSends(HOST, [ADDRESS], {
      nowMs: NOW + DAY,
      firestore,
    })
    expect(firestore.docs(FREQUENCY_PATH)[KEY].firstSentAtMs).toBe(NOW)
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

/*==========================================
 * THE COMBINATION.
 *
 * The recipient's cadence and the engagement sunset read the same counter
 * document, and neither could be written against the other. What holds only
 * when the two are asked together is asserted here, each of it in both
 * directions:
 *
 *  1. The ORDER. Suppression, then the recipient's own request, then the
 *     sunset, then the platform ceiling.
 *  2. The CAMPAIGN SPLIT. Bound by suppression and by the cadence; exempt
 *     from the sunset and from the ceiling.
 *  3. ONE ROUND TRIP. The four facts the gate needs come from a single read
 *     of a single document, and the sunset's second read is spent only when
 *     it can still change the answer.
 *  4. NOBODY IS REDUCED, whichever refusal fires.
 *=========================================*/

/**
 * The fake, with every keyed document read recorded by collection path.
 *
 * The per-recipient READ COST is a property no verdict exposes: a second
 * round trip here would satisfy every assertion above while doubling the
 * latency of a path that is already one awaited HTTP POST per person.
 * Counting is the only way to assert it.
 */
function countingFirestore(seed: Record<string, Record<string, any>> = {}) {
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
          reads.push(path)
          return ref.get()
        },
      }
    },
  })
  return {
    ...inner,
    reads,
    collection: (name: string) => wrapCollection(name, inner.collection(name)),
  }
}

/** The fake, with the per-recipient counter document unreadable. */
function brokenCounterFirestore() {
  const inner = fakeFirestore()
  return {
    ...inner,
    collection: (name: string) => {
      const api = inner.collection(name)
      if (name !== 'hosts') return api
      return {
        ...api,
        doc: (id: string) => {
          const host = api.doc(id)
          return {
            ...host,
            collection: (sub: string) => {
              const counters = host.collection(sub)
              if (sub !== EMAIL_FREQUENCY_SUBCOLLECTION) return counters
              return {
                ...counters,
                doc: (key: string) => ({
                  ...counters.doc(key),
                  get: async () => {
                    throw new Error('counter unavailable')
                  },
                }),
              }
            },
          }
        },
      }
    },
  }
}

/**
 * Somebody this site has mailed for two years, who has never engaged, who
 * asked for monthly mail, and who was mailed three days ago.
 *
 * All three pace refusals have something to say about them: the cadence
 * because three days is not a month, the sunset because two years of silence
 * is longer than the window, and the ceiling when the window is full.
 */
const coldAndAskedForLess = (options?: {
  cadence?: string
  sentAtMs?: number[]
}) =>
  countingFirestore({
    [FREQUENCY_PATH]: {
      [KEY]: {
        email: ADDRESS,
        sentAtMs: options?.sentAtMs ?? [],
        firstSentAtMs: NOW - 720 * DAY,
        lastSentAtMs: NOW - 3 * DAY,
        cadence: options?.cadence ?? 'monthly',
      },
    },
    emailDeliveries: {},
  })

/** A window with no room left in it. */
const fullWindow = () =>
  Array.from(
    { length: MARKETING_FREQUENCY_DEFAULT_PER_WINDOW },
    (_at, index) => NOW - index * 1_000,
  )

describe('a recipient who is BOTH cold and has asked for a slower pace', () => {
  it('is refused on the request they made, not on the inference we drew', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = coldAndAskedForLess()
      await expect(ask(firestore)).resolves.toMatchObject({
        allowed: false,
        refusal: 'cadence-limited',
      })

      /*
       * The other direction, same store, same person: once the month they
       * asked for has passed, the sunset is what answers. Without this the
       * assertion above would also pass over a gate that had lost the sunset.
       */
      await expect(ask(firestore, {}, NOW + 30 * DAY)).resolves.toMatchObject({
        allowed: false,
        refusal: 'unengaged',
      })
    })
  })

  it('does not pay for the sunset’s read when the cadence already refused', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = coldAndAskedForLess()
      await ask(firestore)

      // The engagement rollup is a second document in a second collection,
      // and asking it cannot change an answer already given.
      expect(firestore.reads).not.toContain('emailDeliveries')

      /*
       * The other direction: it IS spent once the cadence allows, or this
       * would pass over a gate that had stopped reading engagement at all —
       * the mutation that makes a sunset refuse nobody.
       */
      firestore.reads.length = 0
      await ask(firestore, {}, NOW + 30 * DAY)
      expect(firestore.reads).toContain('emailDeliveries')
    })
  })

  it('reads the counter document exactly once per verdict', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = coldAndAskedForLess({ cadence: 'all' })
      await ask(firestore)

      // Four facts — the window, the first send, the last send and the
      // cadence — out of one read. Two would be a regression no verdict shows.
      expect(
        firestore.reads.filter((path) => path === FREQUENCY_PATH),
      ).toHaveLength(1)
      // And the sunset's is the only other one this path spends.
      expect(
        firestore.reads.filter((path) => path === 'emailDeliveries'),
      ).toHaveLength(1)
    })
  })

  it('refuses a SEND and removes nobody, on either refusal', async () => {
    const firestore = coldAndAskedForLess()
    const before = JSON.stringify(firestore.docs(FREQUENCY_PATH)[KEY])

    await withSunset(SUNSET_DAYS, async () => {
      await ask(firestore) // cadence-limited
      await ask(firestore, {}, NOW + 30 * DAY) // unengaged
    })

    // Not a suppression, not a membership change, and not even a mark on the
    // window: a message that never left must not count against what this
    // person has received.
    expect(JSON.stringify(firestore.docs(FREQUENCY_PATH)[KEY])).toBe(before)
    expect(Object.keys(firestore.docs('emailSuppressions'))).toHaveLength(0)
    expect(
      Object.keys(firestore.docs(`hosts/${HOST}/suppressions`)),
    ).toHaveLength(0)

    // The other direction, with the month elapsed and the sunset off: the
    // send goes and DOES touch the window, or the comparison above would pass
    // over a gate that had stopped writing anything at all.
    await ask(firestore, {}, NOW + 30 * DAY)
    expect(firestore.docs(FREQUENCY_PATH)[KEY].sentAtMs).toEqual([
      NOW + 30 * DAY,
    ])
  })
})

describe('which refusals a CAMPAIGN is bound by', () => {
  const campaign = { capped: false }

  it('is bound by the recipient’s own request', async () => {
    const firestore = coldAndAskedForLess({ cadence: 'weekly' })
    await expect(ask(firestore, campaign)).resolves.toMatchObject({
      allowed: false,
      refusal: 'cadence-limited',
    })
    // The other direction, same store: somebody who asked for nothing goes.
    await expect(
      ask(firestore, { ...campaign, email: OTHER }),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('is EXEMPT from the sunset', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = coldAndAskedForLess({ cadence: 'all' })
      await expect(ask(firestore, campaign)).resolves.toMatchObject({
        allowed: true,
      })
      // The other direction, same store: an automated path IS refused, or
      // this would pass over a sunset that had stopped firing for anybody.
      await expect(ask(firestore, { capped: true })).resolves.toMatchObject({
        allowed: false,
        refusal: 'unengaged',
      })
    })
  })

  it('is EXEMPT from the platform ceiling', async () => {
    const firestore = coldAndAskedForLess({
      cadence: 'all',
      sentAtMs: fullWindow(),
    })
    await expect(ask(firestore, campaign)).resolves.toMatchObject({
      allowed: true,
    })
    // The other direction, same store.
    await expect(ask(firestore, { capped: true })).resolves.toMatchObject({
      allowed: false,
      refusal: 'frequency-capped',
    })
  })

  it('is bound by suppression', async () => {
    const firestore = fakeFirestore({
      emailSuppressions: {
        [KEY]: { email: ADDRESS, reason: 'complaint', releasedAt: null },
      },
    })
    await expect(ask(firestore, campaign)).resolves.toMatchObject({
      allowed: false,
      refusal: 'suppressed',
    })
    // The other direction, same store.
    await expect(
      ask(firestore, { ...campaign, email: OTHER }),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('counts against the ceiling it is exempt from', async () => {
    const firestore = coldAndAskedForLess({ cadence: 'all' })
    await ask(firestore, campaign)

    // Exempt from the REFUSAL, never from the counting: a ceiling measured
    // only over the mail a cap may stop describes nothing.
    expect(firestore.docs(FREQUENCY_PATH)[KEY]).toMatchObject({
      sentAtMs: [NOW],
      lastSentAtMs: NOW,
    })
  })
})

describe('a NEW subscriber, with nothing on record, against both refusals', () => {
  it('is refused by neither, even having asked for monthly mail', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = fakeFirestore()
      // The preference page's own write, on a person nobody has mailed yet.
      await setMarketingCadence(HOST, ADDRESS, 'monthly', {
        nowMs: NOW - DAY,
        firestore,
      })

      // A cadence is a gap between messages and there is no first gap; the
      // sunset measures from a first send that has not happened.
      await expect(ask(firestore)).resolves.toMatchObject({ allowed: true })

      // The other direction: the same person a day later, now that we HAVE
      // mailed them, is held to the month they asked for.
      await expect(ask(firestore, {}, NOW + DAY)).resolves.toMatchObject({
        allowed: false,
        refusal: 'cadence-limited',
      })
    })
  })

  it('gains both stamps on the send that goes, and keeps the first one', async () => {
    const firestore = fakeFirestore()
    await ask(firestore)
    expect(firestore.docs(FREQUENCY_PATH)[KEY]).toMatchObject({
      firstSentAtMs: NOW,
      lastSentAtMs: NOW,
    })

    await ask(firestore, {}, NOW + 400 * DAY)
    // `firstSentAtMs` is write-once and `lastSentAtMs` moves. A record that
    // re-stamped the first would be permanently younger than any sunset
    // window; one that never moved the last would hold a monthly recipient's
    // mail forever.
    expect(firestore.docs(FREQUENCY_PATH)[KEY]).toMatchObject({
      firstSentAtMs: NOW,
      lastSentAtMs: NOW + 400 * DAY,
    })
  })
})

describe('a row written before either field existed', () => {
  /** Only what the gate wrote before `firstSentAtMs` and `lastSentAtMs`. */
  const legacyRow = (extra: Record<string, unknown> = {}) =>
    fakeFirestore({
      [FREQUENCY_PATH]: {
        [KEY]: { email: ADDRESS, sentAtMs: [NOW - 3_600_000], ...extra },
      },
      emailDeliveries: {},
    })

  it('refuses nobody on a sunset it holds no first send for', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      // Missing evidence is not evidence of absence, and the reading that
      // mails somebody once more is the recoverable one.
      await expect(ask(legacyRow())).resolves.toMatchObject({ allowed: true })

      // The other direction: the same row WITH a first send old enough is
      // refused, or the assertion above would pass over a dead sunset.
      await expect(
        ask(legacyRow({ firstSentAtMs: NOW - 720 * DAY })),
      ).resolves.toMatchObject({ allowed: false, refusal: 'unengaged' })
    })
  })

  /**
   * ⚠️ The two stamps take OPPOSITE readings of the same window, and only one
   * of them is visible in a verdict.
   *
   * `sentAtMs` is a rolling day, so the oldest entry in it is always less than
   * a day old. A `firstSentAtMs` that fell back to it would read every row as
   * a relationship younger than any sunset window — the sunset could never
   * fire — and no refusal would change, because that reading only ever
   * ALLOWS. The decoded state is therefore asserted directly: nothing about
   * the mailed outcome can tell "no record" from "started an hour ago".
   */
  it('decodes the two stamps in opposite directions', async () => {
    await expect(
      readMarketingFrequencyState(HOST, ADDRESS, legacyRow()),
    ).resolves.toEqual({
      window: [NOW - 3_600_000],
      // No record, from a row that never carried one.
      firstSentAtMs: null,
      // The newest entry still inside the window, because a rolling day does
      // know when this site last mailed the person.
      lastSentAtMs: NOW - 3_600_000,
      cadence: 'all',
    })

    // The other direction: a row that DOES carry both reads them verbatim,
    // or the nulls above would pass over a decoder that read nothing at all.
    await expect(
      readMarketingFrequencyState(
        HOST,
        ADDRESS,
        legacyRow({
          firstSentAtMs: NOW - 720 * DAY,
          lastSentAtMs: NOW - 2 * DAY,
          cadence: 'weekly',
        }),
      ),
    ).resolves.toEqual({
      window: [NOW - 3_600_000],
      firstSentAtMs: NOW - 720 * DAY,
      lastSentAtMs: NOW - 2 * DAY,
      cadence: 'weekly',
    })
  })

  it('answers the cadence from the window when it holds no last send', async () => {
    // A row carrying a window and nothing else still knows when this site
    // last mailed the person, so a weekly recipient is not mailed again an
    // hour after the previous message just because the field is new.
    await expect(ask(legacyRow({ cadence: 'weekly' }))).resolves.toMatchObject({
      allowed: false,
      refusal: 'cadence-limited',
    })

    // The other direction: an empty window with no stored instant is somebody
    // never mailed, and there is no first gap.
    await expect(
      ask(
        fakeFirestore({
          [FREQUENCY_PATH]: {
            [KEY]: { email: ADDRESS, sentAtMs: [], cadence: 'weekly' },
          },
        }),
      ),
    ).resolves.toMatchObject({ allowed: true })
  })
})

describe('an unreadable counter is evidence of NEITHER', () => {
  it('does not read as a request for less mail, nor as a cold address', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const verdict = await marketingSendVerdict(
        { hostId: HOST, siteBase: SITE_BASE, email: ADDRESS, capped: true },
        { nowMs: NOW, firestore: brokenCounterFirestore() },
      )

      // Fails OPEN in both directions at once: not `cadence-limited`, because
      // an unreadable document is not somebody asking for less, and not
      // `unengaged`, because it is not evidence they have gone quiet either.
      expect(verdict.allowed).toBe(true)
      expect(verdict.refusal).toBeUndefined()
    })
  })
})

describe('the order the four refusals are asked in', () => {
  it('reports the recipient’s request over the sunset AND the ceiling', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      // Every pace refusal applies to this person at once.
      const firestore = coldAndAskedForLess({ sentAtMs: fullWindow() })
      await expect(ask(firestore)).resolves.toMatchObject({
        allowed: false,
        refusal: 'cadence-limited',
      })
    })
  })

  it('reports the sunset over the ceiling, because only one clears by waiting', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = coldAndAskedForLess({
        cadence: 'all',
        sentAtMs: fullWindow(),
      })
      await expect(ask(firestore)).resolves.toMatchObject({
        allowed: false,
        refusal: 'unengaged',
      })
    })
  })

  it('reports suppression over everything, and counts nothing for it', async () => {
    await withSunset(SUNSET_DAYS, async () => {
      const firestore = coldAndAskedForLess()
      await firestore
        .collection('emailSuppressions')
        .doc(KEY)
        .set({ email: ADDRESS, reason: 'bounce', releasedAt: null })
      const before = JSON.stringify(firestore.docs(FREQUENCY_PATH)[KEY])

      await expect(ask(firestore)).resolves.toMatchObject({
        allowed: false,
        refusal: 'suppressed',
      })
      // A suppressed address whose window kept growing would stay capped for
      // a day after being released.
      expect(JSON.stringify(firestore.docs(FREQUENCY_PATH)[KEY])).toBe(before)
    })
  })
})
