/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * The Current plan card must state ONE thing about the billing period.
 *
 * Observed live before this: plan **Free**, a **canceled** chip, a **cancels
 * at period end** badge, and **Renews 8/18/2026** — all at once. The date was
 * the same field in every state and the label was hardcoded to "Renews", so
 * the word carrying the meaning was the one that never changed.
 *
 * These cases are the truth table. The assertions are on `kind` and on the
 * presence or absence of specific WORDS, not on whole sentences: prose should
 * be editable without reddening a suite, but "renews" appearing on a
 * cancelling subscription must never be.
 */

export {}

import { subscriptionPeriodNotice } from './subscription-period-notice'

/** Fixed formatter, so nothing here depends on the runner's locale. */
const fmt = (date: Date) => date.toISOString().slice(0, 10)
const END = '2026-08-18T00:00:00.000Z'

describe('the four states the card has to tell apart', () => {
  it('renewing — says renews, and names the date', () => {
    const notice = subscriptionPeriodNotice(
      { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: END },
      fmt,
    )
    expect(notice.kind).toBe('renewing')
    expect(notice.sentence).toContain('2026-08-18')
    expect(notice.sentence?.toLowerCase()).toContain('renews')
  })

  it('cancelling at period end — says cancels, and NEVER renews', () => {
    // The contradiction, pinned. This is the case that rendered both.
    const notice = subscriptionPeriodNotice(
      { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: END },
      fmt,
    )
    expect(notice.kind).toBe('ending')
    expect(notice.sentence?.toLowerCase()).toContain('cancels')
    expect(notice.sentence?.toLowerCase()).not.toContain('renews')
    // And it still reassures: the customer keeps what they paid for.
    expect(notice.sentence).toContain('2026-08-18')
  })

  it('already cancelled — past tense, and NEVER renews', () => {
    // The `Free` + `canceled` pairing observed live. The plan names what is in
    // effect now; this names what happened. Neither may claim a renewal.
    const notice = subscriptionPeriodNotice(
      { status: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: END },
      fmt,
    )
    expect(notice.kind).toBe('ended')
    expect(notice.sentence?.toLowerCase()).toContain('ended')
    expect(notice.sentence?.toLowerCase()).not.toContain('renews')
  })

  it('never subscribed — says nothing at all', () => {
    // An org on a staff-granted plan has no subscription and is not a mistake,
    // so the card must not print "no subscription" under its plan name.
    expect(subscriptionPeriodNotice({}, fmt)).toEqual({
      sentence: null,
      kind: 'never',
    })
    expect(subscriptionPeriodNotice(null, fmt).sentence).toBeNull()
  })
})

describe('the states that are not one of the four', () => {
  it('overdue — says so, and does not promise a renewal', () => {
    for (const status of ['past_due', 'unpaid']) {
      const notice = subscriptionPeriodNotice(
        { status, currentPeriodEnd: END },
        fmt,
      )
      expect(`${status}: ${notice.kind}`).toBe(`${status}: overdue`)
      expect(notice.sentence?.toLowerCase()).not.toContain('renews')
    }
  })

  it('cancelling wins over overdue', () => {
    // A past-due subscription that is also set to cancel is ending, not
    // retrying forever. The order of the branches is the claim.
    const notice = subscriptionPeriodNotice(
      { status: 'past_due', cancelAtPeriodEnd: true, currentPeriodEnd: END },
      fmt,
    )
    expect(notice.kind).toBe('ending')
  })

  it('a live status with no date says nothing rather than guessing', () => {
    // An incomplete subscription mid-authentication, or a mirror that has not
    // caught up. A wrong date is the bug this function exists to remove.
    expect(
      subscriptionPeriodNotice({ status: 'active' }, fmt).sentence,
    ).toBeNull()
  })
})

describe('the shapes currentPeriodEnd actually arrives in', () => {
  it('reads a Firestore Timestamp, an ISO string and epoch ms alike', () => {
    // The org doc comes from a live listener (Timestamp) and the billing doc
    // from a one-shot read (string); this page merges both.
    const iso = subscriptionPeriodNotice(
      { status: 'active', currentPeriodEnd: END },
      fmt,
    ).sentence
    const millis = subscriptionPeriodNotice(
      { status: 'active', currentPeriodEnd: Date.parse(END) },
      fmt,
    ).sentence
    const stamp = subscriptionPeriodNotice(
      { status: 'active', currentPeriodEnd: { toDate: () => new Date(END) } },
      fmt,
    ).sentence
    expect(millis).toBe(iso)
    expect(stamp).toBe(iso)
  })

  it('CONTROL — an unparseable date does not render "Invalid Date"', () => {
    // What a bare `new Date(x)` would have put on the card.
    const notice = subscriptionPeriodNotice(
      { status: 'active', currentPeriodEnd: 'not a date' },
      fmt,
    )
    expect(notice.sentence).toBeNull()
    const cancelling = subscriptionPeriodNotice(
      { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: 'nope' },
      fmt,
    )
    expect(cancelling.sentence).not.toContain('Invalid')
    // Still says the true thing, just without a date it does not have.
    expect(cancelling.sentence?.toLowerCase()).toContain('cancels')
  })
})
