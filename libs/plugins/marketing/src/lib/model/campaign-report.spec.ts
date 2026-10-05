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
 * THE ARITHMETIC, AND WHICH POPULATION EACH NUMBER IS OVER.
 *
 * Every assertion here is about a DENOMINATOR, because that is the only part
 * of campaign reporting that is hard to get right and impossible to notice
 * when it is wrong: an open rate over `sent` and an open rate over
 * `delivered` are both plausible-looking percentages, and nothing on a screen
 * distinguishes them.
 *
 * So the tests assert the denominator explicitly rather than only the value —
 * `expect(rate.denominatorLabel).toBe('delivered')` beside
 * `expect(rate.value)`. A test that checked the number alone would go green
 * against a rate divided by the wrong population whenever the two happened to
 * be equal, which for a campaign with no bounces is always.
 */

import type { SendStats } from '@aglyn/shared-ui-email-campaigns/model/send-report'
import {
  CAMPAIGN_SEQUENCE_OUTCOMES,
  campaignReport,
  campaignSequencesReport,
} from './campaign-report'


/** A campaign that sent to 1,000, delivered 900, with real engagement. */
const SENT: SendStats = {
  audienceSize: 1200,
  recipients: 1000,
  sent: 1000,
  delivered: 900,
  opens: 500,
  uniqueOpens: 300,
  clicks: 120,
  uniqueClicks: 90,
  bounced: 100,
  complained: 9,
  unsubscribes: 18,
  clickTracked: true,
}

describe('campaignReport — which population each rate is over', () => {
  /*
   * THE HEADLINE ASSERTION.
   *
   * `delivered` (900) and `sent` (1000) are deliberately different in the
   * fixture, and by exactly the bounce count, so the two candidate open rates
   * are 33.3% and 30.0%. A test built on a campaign with no bounces would
   * pass against either denominator.
   */
  it('takes the open rate over DELIVERED, not sent', () => {
    const open = campaignReport(SENT).rates.open
    expect(open?.denominatorLabel).toBe('delivered')
    expect(open?.denominator).toBe(900)
    expect(open?.value).toBeCloseTo(300 / 900, 10)
    // The number the wrong denominator would have produced, named so a
    // reader of this file can see the two are distinguishable at all.
    expect(open?.value).not.toBeCloseTo(300 / 1000, 10)
  })

  /*
   * The numerator half of the same trap. `opens` (500) counts events and
   * `uniqueOpens` (300) counts people; over 900 delivered they are 55.6% and
   * 33.3%, and only one of them is an open rate.
   */
  it('takes the open rate over DISTINCT readers, not open events', () => {
    const open = campaignReport(SENT).rates.open
    expect(open?.numerator).toBe(300)
    expect(open?.numerator).not.toBe(500)
  })

  it('reports the event counts too, so activity is not hidden', () => {
    const report = campaignReport(SENT)
    expect(report.opens).toBe(500)
    expect(report.clicks).toBe(120)
  })

  it('takes the delivery and bounce rates over SENT', () => {
    const { rates } = campaignReport(SENT)
    expect(rates.delivery).toMatchObject({
      numerator: 900,
      denominator: 1000,
      denominatorLabel: 'sent',
    })
    expect(rates.bounce).toMatchObject({
      numerator: 100,
      denominator: 1000,
      denominatorLabel: 'sent',
    })
  })

  it('takes the complaint and unsubscribe rates over DELIVERED', () => {
    const { rates } = campaignReport(SENT)
    expect(rates.complaint).toMatchObject({
      denominator: 900,
      denominatorLabel: 'delivered',
    })
    expect(rates.unsubscribe).toMatchObject({
      denominator: 900,
      denominatorLabel: 'delivered',
    })
  })

  /*
   * The two numbers the industry calls "click rate", side by side.
   *
   * Over delivered: 90/900 = 10%. Over openers: 90/300 = 30%. They are the
   * same numerator and differ by a factor of three, which is why they are
   * separate fields with separate labels rather than one figure whose
   * meaning depends on who is reading it.
   */
  it('keeps click-over-delivered and click-to-open apart', () => {
    const { rates } = campaignReport(SENT)
    expect(rates.click).toMatchObject({
      denominator: 900,
      denominatorLabel: 'delivered',
    })
    expect(rates.click?.value).toBeCloseTo(0.1, 10)
    expect(rates.clickToOpen).toMatchObject({
      denominator: 300,
      denominatorLabel: 'unique openers',
    })
    expect(rates.clickToOpen?.value).toBeCloseTo(0.3, 10)
  })
})

describe('campaignReport — a denominator that was never recorded', () => {
  /** The fixture with delivery events removed, as an old campaign reads. */
  const legacy: SendStats = { ...SENT }
  delete legacy.delivered
  delete legacy.uniqueOpens
  delete legacy.uniqueClicks

  it('reports delivered as unknown rather than as zero', () => {
    expect(campaignReport(legacy).delivered).toBeNull()
  })

  /*
   * The substitution this module exists to refuse. `sent` is present and
   * dividing by it would produce a printable, plausible, and wrong number —
   * and it would be the FLATTERING wrong number on any campaign whose
   * delivery events are merely late.
   */
  /*
   * The delivery rate is the one whose NUMERATOR is the unrecorded quantity,
   * so it is the one place an absent numerator must not read as a nought. A
   * `0.0% delivery rate — 0 of 1,000 sent` says the campaign reached nobody,
   * which is a far more alarming claim than the one the data supports.
   */
  it('withholds the delivery rate rather than reporting 0%', () => {
    expect(campaignReport(legacy).rates.delivery).toBeNull()
  })

  it('withholds every rate over delivered rather than falling back to sent', () => {
    const { rates } = campaignReport(legacy)
    expect(rates.open).toBeNull()
    expect(rates.click).toBeNull()
    expect(rates.complaint).toBeNull()
    expect(rates.unsubscribe).toBeNull()
    // The rates that are over `sent` are unaffected — this is a missing
    // denominator, not a broken report.
    expect(rates.bounce).toMatchObject({ denominatorLabel: 'sent' })
  })

  it('says why, with a caveat naming the reason', () => {
    expect(campaignReport(legacy).caveats.map((one) => one.id)).toContain(
      'delivery-unrecorded',
    )
  })

  it('still reports the counts, which are real', () => {
    const report = campaignReport(legacy)
    expect(report.sent).toBe(1000)
    expect(report.opens).toBe(500)
    expect(report.bounced).toBe(100)
  })

  /*
   * The CONTROL for the three assertions above: with `delivered` present the
   * same fixture produces every one of those rates. Without this, a
   * `campaignReport` that returned `null` for everything would satisfy them.
   */
  it('CONTROL: the same fixture WITH delivered produces all of them', () => {
    const { rates } = campaignReport(SENT)
    expect(rates.open).not.toBeNull()
    expect(rates.click).not.toBeNull()
    expect(rates.complaint).not.toBeNull()
    expect(rates.unsubscribe).not.toBeNull()
  })
})

describe('campaignReport — the window where clicks were structurally zero', () => {
  /** A send that never recorded carrying an HTML part. */
  const untracked: SendStats = { ...SENT }
  delete untracked.clickTracked

  it('computes no click rate for a send whose links were not trackable', () => {
    const { rates } = campaignReport(untracked)
    expect(rates.click).toBeNull()
    expect(rates.clickToOpen).toBeNull()
  })

  it('still shows the click COUNT, which is a real count of real events', () => {
    expect(campaignReport(untracked).clicks).toBe(120)
  })

  it('leaves the open rate alone — opens are tracked by a pixel, not a link', () => {
    expect(campaignReport(untracked).rates.open).not.toBeNull()
  })

  it('says why', () => {
    expect(campaignReport(untracked).caveats.map((one) => one.id)).toContain(
      'click-tracking-unrecorded',
    )
  })

  it('treats an explicit false the same as an absent marker', () => {
    expect(
      campaignReport({ ...SENT, clickTracked: false }).rates.click,
    ).toBeNull()
  })

  it('CONTROL: the recorded marker produces the rate', () => {
    expect(campaignReport(SENT).rates.click).not.toBeNull()
    expect(
      campaignReport(SENT).caveats.map((one) => one.id),
    ).not.toContain('click-tracking-unrecorded')
  })
})

describe('campaignReport — the populations the send measured', () => {
  const withPopulations: SendStats = {
    ...SENT,
    consented: 700,
    consentedByOperator: 120,
    grandfathered: 400,
    consentWithheld: 100,
    suppressed: 40,
  }

  /*
   * Two different wholes, which is the entire reason these are stored as
   * counts with a named `of` rather than as percentages. The consent split
   * runs over the resolved audience (1,200) and suppression over the capped
   * recipient list (1,000), because that is where each check runs — netting
   * them would present two denominators as one.
   */
  it('measures the consent split over the audience', () => {
    const populations = campaignReport(withPopulations).populations
    const consent = populations.find((one) => one.id === 'consentWithheld')
    expect(consent).toMatchObject({ count: 100, of: 1200, ofLabel: 'audience' })
  })

  it('measures suppression over the ADDRESSED list, not the audience', () => {
    const suppressed = campaignReport(withPopulations).populations.find(
      (one) => one.id === 'suppressed',
    )
    expect(suppressed).toMatchObject({
      count: 40,
      of: 1000,
      ofLabel: 'addressed',
    })
    expect(suppressed?.of).not.toBe(1200)
  })

  /*
   * Zero is a RESULT and absent is not. "No one was withheld by the consent
   * rule" is worth saying; a campaign sent before the field existed has
   * nothing to say, and rendering it as 0 would tell a merchant their old
   * campaigns had perfect consent coverage.
   */
  it('keeps a recorded zero and drops an unrecorded population', () => {
    const zeroed = campaignReport({ ...withPopulations, consentWithheld: 0 })
    expect(
      zeroed.populations.find((one) => one.id === 'consentWithheld'),
    ).toMatchObject({ count: 0 })

    const legacy: SendStats = { ...withPopulations }
    delete legacy.consentWithheld
    expect(
      campaignReport(legacy).populations.find(
        (one) => one.id === 'consentWithheld',
      ),
    ).toBeUndefined()
  })

  it('reports nothing at all for a campaign that recorded no populations', () => {
    expect(campaignReport(SENT).populations).toEqual([])
  })
})

describe('campaignReport — the caveats that qualify a figure', () => {
  it('marks a truncated audience as a floor', () => {
    expect(
      campaignReport({ ...SENT, audienceSizeTruncated: true }).caveats.map(
        (one) => one.id,
      ),
    ).toContain('audience-truncated')
  })

  it('names the recipients the hourly governor held back', () => {
    const caveat = campaignReport({ ...SENT, deferred: 250 }).caveats.find(
      (one) => one.id === 'send-deferred',
    )
    expect(caveat?.message).toContain('250')
  })

  it('does not raise the deferred caveat for a send that deferred nothing', () => {
    expect(
      campaignReport({ ...SENT, deferred: 0 }).caveats.map((one) => one.id),
    ).not.toContain('send-deferred')
  })

  it('survives a campaign with no stats map at all', () => {
    const report = campaignReport(undefined)
    expect(report.sent).toBe(0)
    expect(report.delivered).toBeNull()
    expect(report.rates.open).toBeNull()
  })
})

describe('campaignSequencesReport', () => {
  it('reports every outcome in funnel order and never a total', () => {
    const report = campaignSequencesReport({
      byOutcome: { enrolled: 40, sent: 38, replied: 6, meetings: 2, converted: 1 },
    })
    expect(report.figures.map((figure) => figure.outcome)).toEqual([...CAMPAIGN_SEQUENCE_OUTCOMES])
    expect(report.figures.map((figure) => figure.value)).toEqual([40, 38, 6, 2, 1])
    expect(report.recorded).toBe(true)
    expect(report.any).toBe(true)
    expect(Object.keys(report)).not.toContain('total')
    expect(report.caveats.map((caveat) => caveat.id)).toEqual(['sequences-funnel-not-summed'])
  })

  it('reads a stage nobody reached as unrecorded, not as zero', () => {
    const report = campaignSequencesReport({ byOutcome: { enrolled: 3, sent: 3 } })
    const replied = report.figures.find((figure) => figure.outcome === 'replied')
    expect(replied?.value).toBeNull()
  })

  it('distinguishes an absent rollup from one that recorded nothing yet', () => {
    expect(campaignSequencesReport(undefined).recorded).toBe(false)
    const empty = campaignSequencesReport({})
    expect(empty.recorded).toBe(true)
    expect(empty.any).toBe(false)
    expect(empty.caveats).toEqual([])
  })

  it('reads a negative or non-numeric stored count as unrecorded', () => {
    const report = campaignSequencesReport({
      byOutcome: { enrolled: -2, sent: Number.NaN as never, replied: 'six' as never },
    })
    expect(report.figures.map((figure) => figure.value)).toEqual([null, null, null, null, null])
    expect(report.any).toBe(false)
  })
})
