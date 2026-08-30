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

import {
  CAMPAIGN_LINK_ROLLUP_MAX,
  campaignLinkKey,
  campaignLinkReport,
  campaignRate,
  campaignReport,
  type CampaignStats,
} from './campaign-report'

/** A campaign that sent to 1,000, delivered 900, with real engagement. */
const SENT: CampaignStats = {
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

describe('campaignRate', () => {
  it('divides and names the population it divided by', () => {
    const rate = campaignRate(300, 900, 'delivered')
    expect(rate).toEqual({
      value: 1 / 3,
      numerator: 300,
      denominator: 900,
      denominatorLabel: 'delivered',
    })
  })

  /*
   * The refusal that the whole module rests on. 0 out of 0 is not 0% — a
   * campaign whose delivery events have not arrived yet and a campaign that
   * genuinely reached nobody are different situations, and a rendered `0.0%`
   * makes them identical on screen.
   */
  it('refuses a zero denominator rather than reporting 0%', () => {
    expect(campaignRate(0, 0, 'delivered')).toBeNull()
    expect(campaignRate(5, 0, 'delivered')).toBeNull()
  })

  it('refuses a negative or non-finite denominator', () => {
    expect(campaignRate(5, -1, 'delivered')).toBeNull()
    expect(campaignRate(5, Number.NaN, 'delivered')).toBeNull()
    expect(campaignRate(Number.POSITIVE_INFINITY, 10, 'delivered')).toBeNull()
  })

  it('treats an absent numerator as zero, not as absent', () => {
    // A campaign with delivery events and no opens really does have a 0%
    // open rate, and that is a fact worth showing. Only the DENOMINATOR
    // being missing makes a rate unreportable.
    expect(campaignRate(undefined, 900, 'delivered')).toEqual({
      value: 0,
      numerator: 0,
      denominator: 900,
      denominatorLabel: 'delivered',
    })
  })
})

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
  const legacy: CampaignStats = { ...SENT }
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
  const untracked: CampaignStats = { ...SENT }
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
  const withPopulations: CampaignStats = {
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

    const legacy: CampaignStats = { ...withPopulations }
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

describe('campaignLinkKey', () => {
  /*
   * The normalisation that makes an aggregate possible at all. A campaign
   * body goes through `resolveMergeTags` per recipient, so a link carrying a
   * personalised query would mint one rollup row per RECIPIENT — the
   * aggregate degenerates into the per-recipient log, and it blows the cap on
   * the first campaign that does it.
   */
  it('folds a per-recipient query string onto one key', () => {
    expect(campaignLinkKey('https://shop.example/sale?u=alice@example.com')).toBe(
      campaignLinkKey('https://shop.example/sale?u=bob@example.com'),
    )
  })

  it('does not put a recipient address in the key it stores', () => {
    expect(campaignLinkKey('https://shop.example/sale?u=alice@example.com')).toBe(
      'https://shop.example/sale',
    )
  })

  it('keeps different paths apart', () => {
    expect(campaignLinkKey('https://shop.example/a')).not.toBe(
      campaignLinkKey('https://shop.example/b'),
    )
  })

  it('keeps different hosts apart', () => {
    expect(campaignLinkKey('https://a.example/x')).not.toBe(
      campaignLinkKey('https://b.example/x'),
    )
  })

  it('folds a trailing slash but keeps a bare origin valid', () => {
    expect(campaignLinkKey('https://shop.example/sale/')).toBe(
      'https://shop.example/sale',
    )
    expect(campaignLinkKey('https://shop.example/')).toBe('https://shop.example/')
  })

  it('refuses anything that is not an http(s) URL', () => {
    expect(campaignLinkKey('mailto:someone@example.com')).toBeNull()
    expect(campaignLinkKey('javascript:alert(1)')).toBeNull()
    expect(campaignLinkKey('not a url')).toBeNull()
    expect(campaignLinkKey('')).toBeNull()
    expect(campaignLinkKey(null)).toBeNull()
  })
})

describe('campaignLinkReport', () => {
  const rollup = {
    links: {
      a: { url: 'https://shop.example/sale', clicks: 60 },
      b: { url: 'https://shop.example/new', clicks: 30 },
      c: { url: 'https://shop.example/help', clicks: 10 },
    },
  }

  it('sorts by clicks, busiest first', () => {
    expect(campaignLinkReport(rollup).rows.map((row) => row.clicks)).toEqual([
      60, 30, 10,
    ])
  })

  /*
   * The share is over the clicks THIS TABLE accounts for, not over
   * `stats.clicks`. A share column that failed to reach 100% because of rows
   * that are not on screen is arithmetic a reader cannot check — and the
   * excluded figures are returned separately so the screen can state them.
   */
  it('takes each share over the clicks the table counted', () => {
    const report = campaignLinkReport(rollup)
    expect(report.attributedClicks).toBe(100)
    expect(report.rows[0].share).toMatchObject({
      denominator: 100,
      denominatorLabel: 'link clicks counted',
    })
    expect(
      report.rows.reduce((total, row) => total + (row.share?.value ?? 0), 0),
    ).toBeCloseTo(1, 10)
  })

  it('reports overflow and unattributed clicks rather than folding them in', () => {
    const report = campaignLinkReport({
      ...rollup,
      overflowClicks: 7,
      unattributedClicks: 3,
    })
    expect(report.attributedClicks).toBe(100)
    expect(report.overflowClicks).toBe(7)
    expect(report.unattributedClicks).toBe(3)
    expect(report.truncated).toBe(true)
  })

  it('is not truncated when the cap has not bitten', () => {
    expect(campaignLinkReport(rollup).truncated).toBe(false)
  })

  it('is truncated once the map is full, even with no overflow yet', () => {
    const full = {
      links: Object.fromEntries(
        Array.from({ length: CAMPAIGN_LINK_ROLLUP_MAX }, (_, index) => [
          `k${index}`,
          { url: `https://shop.example/${index}`, clicks: 1 },
        ]),
      ),
    }
    expect(campaignLinkReport(full).truncated).toBe(true)
  })

  it('drops a row with no URL rather than rendering a blank destination', () => {
    const report = campaignLinkReport({
      links: { a: { clicks: 5 }, b: { url: 'https://x.example/y', clicks: 2 } },
    })
    expect(report.rows).toHaveLength(1)
    expect(report.attributedClicks).toBe(2)
  })

  it('answers an empty table for a campaign with no rollup', () => {
    const report = campaignLinkReport(undefined)
    expect(report.rows).toEqual([])
    expect(report.attributedClicks).toBe(0)
    expect(report.truncated).toBe(false)
  })
})
