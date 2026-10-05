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
 * THE ARITHMETIC OF A SUM.
 *
 * `campaign-report.spec.ts` proves a rate over one campaign names its
 * denominator. This file proves the harder case: a rate over SEVERAL
 * campaigns divides sums taken over the same campaigns, and says which.
 *
 * The fixtures are built so a wrong subset is arithmetically visible. Every
 * campaign has a different `sent`, and the campaign missing a `delivered` has
 * the largest one — so summing `sent` over all campaigns instead of over the
 * ones that recorded a delivery produces a number no correct implementation
 * can reach by any other route.
 */

import { templateReport, type TemplateCampaign } from './template-report'

/** A sent campaign, with whatever stats the case is about. */
function campaign(
  id: string,
  stats: TemplateCampaign['stats'],
  extra: Partial<TemplateCampaign> = {},
): TemplateCampaign {
  return {
    campaignId: id,
    subject: `Subject ${id}`,
    sentAtMs: 1_700_000_000_000,
    status: 'sent',
    audience: 'leads',
    stats,
    ...extra,
  }
}

/**
 * Measured: 100 sent and 90 delivered, so `sent` and `delivered` are
 * different numbers and an assertion can tell which one was divided by.
 */
const MEASURED = campaign('measured', {
  recipients: 100,
  sent: 100,
  delivered: 90,
  opens: 60,
  uniqueOpens: 45,
  clicks: 12,
  uniqueClicks: 9,
  bounced: 10,
  complained: 3,
  unsubscribes: 6,
  clickTracked: true,
})

/**
 * Unmeasured: a campaign from before the delivery webhook. Its opens and
 * clicks are real and counted; it has no `delivered`, so it can be in no rate
 * taken over delivered. Deliberately the LARGEST `sent` in the file.
 */
const UNMEASURED = campaign('unmeasured', {
  recipients: 200,
  sent: 200,
  opens: 30,
  clicks: 5,
  bounced: 4,
})

describe('a design report divides sums over one set of campaigns', () => {
  it('takes the delivery rate over the sends that recorded a delivery', () => {
    const report = templateReport([MEASURED, UNMEASURED])
    const rate = report.rates.delivery
    // 90 of 100 — NOT 90 of 300, which is what summing `sent` over both
    // campaigns would give and would read as a catastrophic delivery failure.
    expect(rate?.numerator).toBe(90)
    expect(rate?.denominator).toBe(100)
    expect(rate?.denominatorLabel).toBe('sent across 1 of 2 campaigns')
  })

  it('names how many campaigns an open rate actually covers', () => {
    const report = templateReport([MEASURED, UNMEASURED])
    expect(report.rates.open?.numerator).toBe(45)
    expect(report.rates.open?.denominator).toBe(90)
    expect(report.rates.open?.denominatorLabel).toBe(
      'delivered across 1 of 2 campaigns',
    )
  })

  it('counts every sent campaign even when only some can be rated', () => {
    const report = templateReport([MEASURED, UNMEASURED])
    // The counts are over both; only the rates narrowed.
    expect(report.opens).toBe(90)
    expect(report.clicks).toBe(17)
    expect(report.sent).toBe(300)
    expect(report.sentCampaigns).toBe(2)
  })

  it('drops "of N" once a rate covers every campaign', () => {
    const report = templateReport([
      MEASURED,
      campaign('second', {
        sent: 50,
        delivered: 50,
        uniqueOpens: 25,
        clickTracked: true,
        uniqueClicks: 5,
      }),
    ])
    expect(report.rates.open?.denominatorLabel).toBe(
      'delivered across 2 campaigns',
    )
    expect(report.rates.open?.denominator).toBe(140)
  })

  it('takes the bounce rate over every sent campaign', () => {
    const report = templateReport([MEASURED, UNMEASURED])
    // Bounces need no delivery record: an absent bounce count is a genuine
    // zero, so this rate is the one that covers everything.
    expect(report.rates.bounce?.numerator).toBe(14)
    expect(report.rates.bounce?.denominator).toBe(300)
    expect(report.rates.bounce?.denominatorLabel).toBe(
      'sent across 2 campaigns',
    )
  })
})

describe('a design report withholds what it cannot honestly divide', () => {
  it('reports delivered as absent, not zero, when nothing recorded it', () => {
    const report = templateReport([UNMEASURED])
    expect(report.delivered).toBeNull()
    expect(report.rates.delivery).toBeNull()
    expect(report.rates.open).toBeNull()
    expect(report.rates.complaint).toBeNull()
    expect(report.rates.unsubscribe).toBeNull()
  })

  it('says which campaigns every rate over delivered leaves out', () => {
    const report = templateReport([MEASURED, UNMEASURED])
    const caveat = report.caveats.find((one) => one.id === 'delivery-partial')
    expect(caveat?.message).toContain('1 of 2 campaigns')
  })

  it('CONTROL: no such caveat when every campaign recorded a delivery', () => {
    const report = templateReport([MEASURED])
    expect(report.caveats.map((one) => one.id)).not.toContain(
      'delivery-partial',
    )
  })

  it('excludes an untrackable send from click rates but not from clicks', () => {
    const untrackable = campaign('untrackable', {
      sent: 80,
      delivered: 80,
      opens: 20,
      uniqueOpens: 15,
      /*
       * The webhook DID record click counts for this send — they are simply
       * both zero, because the mail carried no HTML part for the tracker to
       * rewrite. Without `clickTracked` there is no way to tell that
       * structural zero from a real one, so the send is excluded from the
       * click rate rather than dragging its denominator up by 80.
       */
      clicks: 0,
      uniqueClicks: 0,
    })
    const report = templateReport([MEASURED, untrackable])
    // Click rate over the trackable send alone.
    expect(report.rates.click?.denominator).toBe(90)
    expect(report.rates.click?.denominatorLabel).toBe(
      'delivered across 1 of 2 campaigns',
    )
    // Open rate still covers both — the two narrow independently.
    expect(report.rates.open?.denominator).toBe(170)
    expect(report.rates.open?.denominatorLabel).toBe(
      'delivered across 2 campaigns',
    )
    expect(
      report.caveats.map((one) => one.id),
    ).toContain('click-tracking-partial')
  })

  it('keeps click-to-open apart from click rate', () => {
    const report = templateReport([MEASURED])
    expect(report.rates.click?.denominatorLabel).toBe(
      'delivered across 1 campaign',
    )
    expect(report.rates.clickToOpen?.denominator).toBe(45)
    expect(report.rates.clickToOpen?.denominatorLabel).toBe(
      'unique openers across 1 campaign',
    )
  })

  it('marks every total a floor when the campaign read was truncated', () => {
    const report = templateReport([MEASURED], true)
    expect(report.caveats.map((one) => one.id)).toContain(
      'campaigns-truncated',
    )
  })

  it('measures nothing from a campaign that has not been sent', () => {
    const scheduled: TemplateCampaign = {
      campaignId: 'scheduled',
      subject: 'Later',
      sentAtMs: null,
      status: 'scheduled',
      audience: 'leads',
      stats: { recipients: 500, sent: 500 },
    }
    const report = templateReport([scheduled])
    expect(report.sentCampaigns).toBe(0)
    expect(report.totalCampaigns).toBe(1)
    expect(report.sent).toBe(0)
    expect(report.caveats.map((one) => one.id)).toContain('no-campaigns')
  })
})

describe('a design report says which audiences it went to', () => {
  const listSend = (id: string, listId: string, listName?: string) =>
    campaign(
      id,
      { recipients: 40, sent: 40 },
      { audience: 'list', listId, ...(listName ? { listName } : {}) },
    )

  it('merges repeat sends to one list into a single row', () => {
    const report = templateReport([
      listSend('a', 'list_1', 'Newsletter'),
      listSend('b', 'list_1', 'Newsletter'),
    ])
    expect(report.audiences).toHaveLength(1)
    expect(report.audiences[0].label).toBe('Newsletter')
    expect(report.audiences[0].campaigns).toBe(2)
    expect(report.audiences[0].addressed).toBe(80)
  })

  it('keeps two different lists apart', () => {
    const report = templateReport([
      listSend('a', 'list_1', 'Newsletter'),
      listSend('b', 'list_2', 'VIPs'),
    ])
    expect(report.audiences.map((one) => one.label).sort()).toEqual([
      'Newsletter',
      'VIPs',
    ])
  })

  it('never merges a list send with a built-in audience', () => {
    const report = templateReport([listSend('a', 'list_1', 'Newsletter'), MEASURED])
    expect(report.audiences.map((one) => one.id).sort()).toEqual([
      'leads',
      'list:list_1',
    ])
  })

  it('names the built-in audiences in words', () => {
    const report = templateReport([
      campaign('m', { recipients: 5, sent: 5 }, { audience: 'members' }),
    ])
    expect(report.audiences[0].label).toBe('All site members')
  })

  it('fills a list name from any send that recorded one', () => {
    const report = templateReport([
      // The older send predates the name being stored.
      listSend('old', 'list_1'),
      listSend('new', 'list_1', 'Newsletter'),
    ])
    expect(report.audiences[0].label).toBe('Newsletter')
    expect(report.audiences[0].unnamed).toBeUndefined()
  })

  it('says a list is unnamed rather than printing its document id', () => {
    const report = templateReport([listSend('old', 'list_1')])
    expect(report.audiences[0].unnamed).toBe(true)
    expect(report.audiences[0].label).not.toContain('list_1')
  })

  it('drops a list send that recorded no list at all', () => {
    const report = templateReport([
      campaign('nolist', { recipients: 9, sent: 9 }, { audience: 'list' }),
    ])
    expect(report.audiences).toHaveLength(0)
  })
})
