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
 * THE ARITHMETIC OF A CAMPAIGN THAT HOLDS MANY SENDS.
 *
 * Two properties carry the whole design:
 *
 *  1. **A send with no container is still a campaign.** It is adopted as a
 *     campaign of one AT READ TIME, so nothing is rewritten — which is what
 *     keeps every delivered unsubscribe link (`cid={sendId}`, signed) and
 *     every pasted `/emails/campaigns/{sendId}` URL resolving.
 *  2. **A partial total says so.** Summing across sends where some recorded a
 *     field and others never did is the one way this aggregation can lie, and
 *     `?? 0` is how it would.
 */

import {
  campaignListRows,
  campaignRollup,
  campaignSendDisplay,
  campaignSendIsMidFlight,
  campaignSendListIds,
  campaignWindowState,
  type CampaignSend,
  type EmailCampaign,
} from './campaign-container'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 30)

const send = (over: Partial<CampaignSend> & { $id: string }): CampaignSend => ({
  subject: 'A send',
  status: 'sent',
  ...over,
})

describe('rolling a campaign’s sends into one set of figures', () => {
  it('sums what every send recorded', () => {
    const rollup = campaignRollup([
      send({ $id: 'a', stats: { sent: 100, delivered: 98, uniqueOpens: 40 } }),
      send({ $id: 'b', stats: { sent: 50, delivered: 49, uniqueOpens: 10 } }),
    ])

    expect(rollup.sent.value).toBe(150)
    expect(rollup.delivered.value).toBe(147)
    expect(rollup.sent.recorded).toBe(2)
  })

  it('reports a total measured over fewer sends than the campaign holds', () => {
    // The send that predates the delivery webhook. Its absence is what makes
    // `recorded` worth carrying: 98 is a real number about part of this
    // campaign, and presenting it as the whole campaign's deliveries is the
    // lie `?? 0` would tell in the other direction.
    const rollup = campaignRollup([
      send({ $id: 'a', stats: { sent: 100, delivered: 98 } }),
      send({ $id: 'b', stats: { sent: 50 } }),
    ])

    expect(rollup.delivered.value).toBe(98)
    expect(rollup.delivered.recorded).toBe(1)
    expect(rollup.delivered.sends).toBe(2)
  })

  it('answers null, not zero, when nothing recorded the field', () => {
    const rollup = campaignRollup([send({ $id: 'a', stats: { sent: 100 } })])

    expect(rollup.delivered.value).toBeNull()
    expect(rollup.opens.value).toBeNull()
  })

  it('counts a recorded zero as measured', () => {
    const rollup = campaignRollup([send({ $id: 'a', stats: { opens: 0 } })])

    expect(rollup.opens.value).toBe(0)
    expect(rollup.opens.recorded).toBe(1)
  })

  it('takes rates over the sends that recorded both sides', () => {
    const rollup = campaignRollup([
      send({ $id: 'a', stats: { sent: 100, delivered: 100, uniqueOpens: 25 } }),
      // No delivery events: including it would divide 25 by 100 and call the
      // result the campaign's open rate over 150 sends.
      send({ $id: 'b', stats: { sent: 50, uniqueOpens: 9 } }),
    ])

    expect(rollup.openRate).toEqual({
      value: 0.25,
      numerator: 25,
      denominator: 100,
      denominatorLabel: 'delivered',
    })
  })

  it('withholds a rate it cannot take', () => {
    expect(campaignRollup([send({ $id: 'a', stats: { sent: 10 } })]).openRate)
      .toBeNull()
  })

  it('counts scheduled sends apart from sent ones', () => {
    const rollup = campaignRollup([
      send({ $id: 'a', stats: { sent: 10 } }),
      send({ $id: 'b', status: 'scheduled', sendAtMs: NOW + DAY }),
      send({ $id: 'c', status: 'canceled' }),
    ])

    expect(rollup.sends).toBe(1)
    expect(rollup.scheduled).toBe(1)
  })
})

/*==========================================
 * A SEND THAT IS STILL GOING HAS STILL GONE.
 *
 * An audience larger than one batch is delivered over several runs, and
 * between them the email is stored as `scheduled` — the state the processor
 * claims to resume it. Read literally that is a campaign row reporting
 * "nothing sent yet" about an email that has put five hundred messages in
 * five hundred inboxes, and a rollup that drops its figures entirely.
 *=========================================*/
describe('a campaign holding a send that is still going out', () => {
  const midFlight = {
    status: 'scheduled',
    sendAtMs: NOW + 60_000,
    stats: { recipients: 500, sent: 500, delivered: 480, audienceSize: 3000 },
    resume: { remaining: 2500, batch: 1, nextAtMs: NOW + 60_000 },
  } as never as CampaignSend

  it('counts it among the sends, not among the scheduled', () => {
    const rollup = campaignRollup([midFlight])
    expect(rollup.sends).toBe(1)
    expect(rollup.scheduled).toBe(0)
    expect(rollup.sending).toBe(1)
  })

  it('keeps an email that has delivered nothing yet as scheduled', () => {
    // THE CONTROL. The narrower `scheduled` must still hold the case it has
    // always held — a campaign waiting for its time — or the fix has simply
    // moved the lie.
    const rollup = campaignRollup([
      { status: 'scheduled', sendAtMs: NOW + DAY } as never as CampaignSend,
    ])
    expect(rollup.scheduled).toBe(1)
    expect(rollup.sending).toBe(0)
    expect(rollup.sends).toBe(0)
  })

  it('includes its figures in the campaign totals', () => {
    /*
     * The other half of the same fault. Excluded from `gone`, the five
     * hundred messages this email has actually delivered were missing from
     * every aggregate on the campaign — a merchant reading the row would see
     * a campaign that had sent nothing while their audience was receiving it.
     */
    const rollup = campaignRollup([midFlight])
    expect(rollup.sent.value).toBe(500)
    expect(rollup.delivered.value).toBe(480)
  })

  it('is not counted twice when the campaign also holds a finished send', () => {
    const rollup = campaignRollup([
      midFlight,
      send({ $id: 'done', stats: { sent: 10, delivered: 10 } }),
    ])
    expect(rollup.sends).toBe(2)
    expect(rollup.sent.value).toBe(510)
  })
})

describe('what a row says about one email', () => {
  it('says a draft is a draft', () => {
    /*
     * The progress derivation cannot: an absent status reads as `sent` and a
     * draft has no counters, so asking it answers "Sent to 0" — the worst
     * available sentence about an email nobody has written yet.
     */
    const display = campaignSendDisplay({ status: 'draft' } as never)
    expect(display.state).toBe('draft')
    expect(display.label).toBe('Draft')
  })

  it('says a mid-flight campaign is SENDING, with the count', () => {
    const display = campaignSendDisplay({
      status: 'scheduled',
      stats: { sent: 500, audienceSize: 3000 },
      resume: { remaining: 2500, batch: 1, nextAtMs: NOW + 1 },
    } as never)
    expect(display.state).toBe('sending')
    expect(display.label).toBe('Sending — reached 500 of 3,000')
    // Never the stored word, which is what a status-driven chip showed.
    expect(display.label).not.toMatch(/scheduled/i)
  })

  it('still says Scheduled for one that has delivered nothing', () => {
    const display = campaignSendDisplay({
      status: 'scheduled',
      sendAtMs: NOW + DAY,
    } as never)
    expect(display.state).toBe('pending')
    expect(display.label).toBe('Scheduled')
  })

  it('names the shortfall on a send that stopped part way', () => {
    const display = campaignSendDisplay({
      status: 'canceled',
      stats: { sent: 1500, audienceSize: 3000 },
      resume: { remaining: 1500, batch: 3 },
    } as never)
    expect(display.state).toBe('stopped')
    expect(display.label).toMatch(/1,500 not addressed/)
  })

  it('reads only a send with more to come as mid-flight', () => {
    expect(
      campaignSendIsMidFlight({
        status: 'scheduled',
        stats: { sent: 500 },
        resume: { remaining: 2500, batch: 1, nextAtMs: NOW + 1 },
      } as never),
    ).toBe(true)
    // A campaign waiting for its time is not in flight, and neither is one a
    // merchant stopped however much of its audience is left.
    expect(
      campaignSendIsMidFlight({ status: 'scheduled', sendAtMs: NOW } as never),
    ).toBe(false)
    expect(
      campaignSendIsMidFlight({
        status: 'canceled',
        stats: { sent: 1500 },
        resume: { remaining: 1500, batch: 3 },
      } as never),
    ).toBe(false)
    expect(campaignSendIsMidFlight({ status: 'draft' } as never)).toBe(false)
  })
})

describe('a campaign’s window', () => {
  it.each([
    ['undated', {}],
    ['upcoming', { startAtMs: NOW + DAY }],
    ['running', { startAtMs: NOW - DAY, endAtMs: NOW + DAY }],
    ['ended', { startAtMs: NOW - 2 * DAY, endAtMs: NOW - DAY }],
    ['running', { startAtMs: NOW - DAY }],
  ])('reads as %s', (expected, campaign) => {
    expect(campaignWindowState(campaign as EmailCampaign, NOW)).toBe(expected)
  })
})

describe('the campaigns list', () => {
  const campaign: EmailCampaign = {
    $id: 'camp-1',
    name: 'Spring sale',
    startAtMs: NOW - DAY,
    listIds: ['list-1'],
  }

  it('groups a campaign’s own sends under it', () => {
    const rows = campaignListRows(
      [campaign],
      [
        send({ $id: 's1', emailCampaignId: 'camp-1', stats: { sent: 10 } }),
        send({ $id: 's2', emailCampaignId: 'camp-1', stats: { sent: 5 } }),
      ],
      NOW,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].sends).toHaveLength(2)
    expect(rows[0].rollup.sent.value).toBe(15)
  })

  it('ADOPTS a send with no container as a campaign of one', () => {
    /*
     * The migration, such as it is. A send written before containers existed
     * has to keep appearing in the list — a merchant's history is what they
     * already sent — and it does so without its document being touched.
     */
    const rows = campaignListRows(
      [],
      [
        send({
          $id: 'legacy-send',
          subject: 'Last week’s news',
          sentAt: { seconds: (NOW - DAY) / 1000 },
          stats: { sent: 42 },
        }),
      ],
      NOW,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].legacy).toBe(true)
    expect(rows[0].name).toBe('Last week’s news')
    // THE URL PROPERTY: the row's id is the SEND's id, so the link this row
    // renders is the same `/emails/campaigns/{id}` that has always worked.
    expect(rows[0].id).toBe('legacy-send')
    expect(rows[0].rollup.sent.value).toBe(42)
  })

  it('does not adopt a send that already has a container', () => {
    const rows = campaignListRows(
      [campaign],
      [send({ $id: 's1', emailCampaignId: 'camp-1' })],
      NOW,
    )

    expect(rows.map((row) => row.id)).toEqual(['camp-1'])
  })

  it('keeps a container whose sends are not in the window read', () => {
    // The sends list is ceilinged, so a campaign's own sends may not be in it.
    // The campaign is still a campaign.
    const rows = campaignListRows([campaign], [], NOW)

    expect(rows).toHaveLength(1)
    expect(rows[0].rollup.sends).toBe(0)
  })

  it('orders newest first and puts undated campaigns last', () => {
    const rows = campaignListRows(
      [
        { $id: 'old', name: 'Old', startAtMs: NOW - 10 * DAY },
        { $id: 'new', name: 'New', startAtMs: NOW - DAY },
        { $id: 'none', name: 'No dates' },
      ],
      [],
      NOW,
    )

    expect(rows.map((row) => row.id)).toEqual(['new', 'old', 'none'])
  })
})

describe('which lists ONE send addressed', () => {
  it('answers the list it was sent to', () => {
    expect(
      campaignSendListIds(
        send({ $id: 's1', audience: 'list', listId: 'list-7' }),
      ),
    ).toEqual(['list-7'])
  })

  it('answers nothing for a stray list id on another audience', () => {
    // The audience KIND decides. A request may carry a `listId` alongside
    // `audience: 'leads'`, and the send resolves the leads — reading the id
    // regardless would report a list nobody was mailed from.
    expect(
      campaignSendListIds(
        send({ $id: 's1', audience: 'leads', listId: 'list-7' }),
      ),
    ).toEqual([])
  })

  it('answers nothing for an audience that is not a list', () => {
    // A campaign may be AIMED at lists while one of its emails goes to the
    // site's leads. The send's own answer is the narrower, truer one.
    expect(
      campaignSendListIds(send({ $id: 's1', audience: 'leads' })),
    ).toEqual([])
    expect(
      campaignSendListIds(
        send({ $id: 's1', audience: 'segment', segmentId: 'seg-1' }),
      ),
    ).toEqual([])
  })
})

describe('an unsent email is not rolled up as a send', () => {
  /*==========================================
   * THE COLLECTION NOW HOLDS EMAILS THAT HAVE MAILED NOBODY.
   *
   * An email exists from the moment it is created, so `draft`, `scheduled`
   * and the `sending` claim all sit in the same collection as delivered mail.
   * Every figure here is about mail that went out, and counting an unsent
   * record in any of them is the "reached nobody" reading of "not sent yet".
   *=========================================*/
  const sentSend = {
    status: 'sent',
    stats: { recipients: 100, sent: 100, delivered: 90, uniqueOpens: 45 },
  }

  it('does not count a draft among the sends', () => {
    const rollup = campaignRollup([sentSend, { status: 'draft' }] as never)
    expect(rollup.sends).toBe(1)
    expect(rollup.drafts).toBe(1)
  })

  it('does not count a draft as scheduled either', () => {
    // A draft is not on the clock. Folding it into `scheduled` would promise
    // a send time nothing is going to act on.
    const rollup = campaignRollup([{ status: 'draft' }] as never)
    expect(rollup.scheduled).toBe(0)
    expect(rollup.drafts).toBe(1)
  })

  it('does not count the mid-send claim among the sends', () => {
    const rollup = campaignRollup([sentSend, { status: 'sending' }] as never)
    expect(rollup.sends).toBe(1)
  })

  it('keeps an unsent email OUT of every aggregate denominator', () => {
    /*
     * Each aggregate carries `sends` as the M in its own "recorded by N of M"
     * label. An unsent record in there enlarges the M and publishes a
     * coverage figure claiming the campaign is missing data it was never
     * going to have.
     */
    const rollup = campaignRollup([
      sentSend,
      { status: 'draft' },
      { status: 'scheduled', sendAtMs: 1 },
    ] as never)

    expect(rollup.delivered.sends).toBe(1)
    expect(rollup.delivered.recorded).toBe(1)
    expect(rollup.delivered.value).toBe(90)
  })

  it('still rolls up a campaign made only of sent emails', () => {
    // The control. A filter that excluded everything would pass every
    // assertion above having deleted the rollup.
    const rollup = campaignRollup([sentSend, sentSend] as never)
    expect(rollup.sends).toBe(2)
    expect(rollup.drafts).toBe(0)
    expect(rollup.delivered.value).toBe(180)
    expect(rollup.delivered.sends).toBe(2)
  })
})
