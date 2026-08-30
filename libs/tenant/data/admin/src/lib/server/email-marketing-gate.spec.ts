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
  marketingSendVerdict,
  readMarketingFrequency,
  recordMarketingSends,
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
