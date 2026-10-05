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
 * THE RATE ARITHMETIC AND THE LINK ROLLUP EVERY BULK SENDER DIVIDES BY.
 *
 * Every assertion here is about a DENOMINATOR, because that is the only part
 * of send reporting that is hard to get right and impossible to notice when
 * it is wrong: the tests assert the denominator explicitly rather than only
 * the value.
 */

import {
  SEND_LINK_ROLLUP_MAX,
  sendLinkKey,
  sendLinkReport,
  sendRate,
} from './send-report'

describe('sendRate', () => {
  it('divides and names the population it divided by', () => {
    const rate = sendRate(300, 900, 'delivered')
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
    expect(sendRate(0, 0, 'delivered')).toBeNull()
    expect(sendRate(5, 0, 'delivered')).toBeNull()
  })

  it('refuses a negative or non-finite denominator', () => {
    expect(sendRate(5, -1, 'delivered')).toBeNull()
    expect(sendRate(5, Number.NaN, 'delivered')).toBeNull()
    expect(sendRate(Number.POSITIVE_INFINITY, 10, 'delivered')).toBeNull()
  })

  it('treats an absent numerator as zero, not as absent', () => {
    // A campaign with delivery events and no opens really does have a 0%
    // open rate, and that is a fact worth showing. Only the DENOMINATOR
    // being missing makes a rate unreportable.
    expect(sendRate(undefined, 900, 'delivered')).toEqual({
      value: 0,
      numerator: 0,
      denominator: 900,
      denominatorLabel: 'delivered',
    })
  })
})

describe('sendLinkKey', () => {
  /*
   * The normalisation that makes an aggregate possible at all. A campaign
   * body goes through `resolveMergeTags` per recipient, so a link carrying a
   * personalised query would mint one rollup row per RECIPIENT — the
   * aggregate degenerates into the per-recipient log, and it blows the cap on
   * the first campaign that does it.
   */
  it('folds a per-recipient query string onto one key', () => {
    expect(sendLinkKey('https://shop.example/sale?u=alice@example.com')).toBe(
      sendLinkKey('https://shop.example/sale?u=bob@example.com'),
    )
  })

  it('does not put a recipient address in the key it stores', () => {
    expect(sendLinkKey('https://shop.example/sale?u=alice@example.com')).toBe(
      'https://shop.example/sale',
    )
  })

  it('keeps different paths apart', () => {
    expect(sendLinkKey('https://shop.example/a')).not.toBe(
      sendLinkKey('https://shop.example/b'),
    )
  })

  it('keeps different hosts apart', () => {
    expect(sendLinkKey('https://a.example/x')).not.toBe(
      sendLinkKey('https://b.example/x'),
    )
  })

  it('folds a trailing slash but keeps a bare origin valid', () => {
    expect(sendLinkKey('https://shop.example/sale/')).toBe(
      'https://shop.example/sale',
    )
    expect(sendLinkKey('https://shop.example/')).toBe('https://shop.example/')
  })

  it('refuses anything that is not an http(s) URL', () => {
    expect(sendLinkKey('mailto:someone@example.com')).toBeNull()
    expect(sendLinkKey('javascript:alert(1)')).toBeNull()
    expect(sendLinkKey('not a url')).toBeNull()
    expect(sendLinkKey('')).toBeNull()
    expect(sendLinkKey(null)).toBeNull()
  })
})

describe('sendLinkReport', () => {
  const rollup = {
    links: {
      a: { url: 'https://shop.example/sale', clicks: 60 },
      b: { url: 'https://shop.example/new', clicks: 30 },
      c: { url: 'https://shop.example/help', clicks: 10 },
    },
  }

  it('sorts by clicks, busiest first', () => {
    expect(sendLinkReport(rollup).rows.map((row) => row.clicks)).toEqual([
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
    const report = sendLinkReport(rollup)
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
    const report = sendLinkReport({
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
    expect(sendLinkReport(rollup).truncated).toBe(false)
  })

  it('is truncated once the map is full, even with no overflow yet', () => {
    const full = {
      links: Object.fromEntries(
        Array.from({ length: SEND_LINK_ROLLUP_MAX }, (_, index) => [
          `k${index}`,
          { url: `https://shop.example/${index}`, clicks: 1 },
        ]),
      ),
    }
    expect(sendLinkReport(full).truncated).toBe(true)
  })

  it('drops a row with no URL rather than rendering a blank destination', () => {
    const report = sendLinkReport({
      links: { a: { clicks: 5 }, b: { url: 'https://x.example/y', clicks: 2 } },
    })
    expect(report.rows).toHaveLength(1)
    expect(report.attributedClicks).toBe(2)
  })

  it('answers an empty table for a campaign with no rollup', () => {
    const report = sendLinkReport(undefined)
    expect(report.rows).toEqual([])
    expect(report.attributedClicks).toBe(0)
    expect(report.truncated).toBe(false)
  })
})

/*
 * The Sequences block (AGL-3254): five figures in funnel order, absent
 * distinguished from zero, and no total anywhere.
 */
