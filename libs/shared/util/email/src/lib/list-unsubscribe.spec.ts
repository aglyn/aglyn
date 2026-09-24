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

import {
  decideListUnsubscribe,
  LIST_UNSUBSCRIBE_BULK_THRESHOLD_DEFAULT,
  LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV,
  LIST_UNSUBSCRIBE_ONE_CLICK,
  listUnsubscribeBulkThreshold,
  listUnsubscribeForcedDetail,
  listUnsubscribeHeaders,
  readListUnsubscribeSetting,
  resolveListUnsubscribe,
} from './list-unsubscribe'
import { unsubscribeHeaders } from './marketing-send'

describe('the setting, read with each sender’s default (AGL-3307)', () => {
  it('takes a stored boolean as the choice', () => {
    expect(readListUnsubscribeSetting(true, false)).toBe(true)
    expect(readListUnsubscribeSetting(false, true)).toBe(false)
  })

  it('reads anything else as the default: off for a sequence, on for a campaign', () => {
    for (const raw of [undefined, null, 'true', 'false', 1, 0, {}]) {
      expect(readListUnsubscribeSetting(raw, false)).toBe(false)
      expect(readListUnsubscribeSetting(raw, true)).toBe(true)
    }
  })
})

describe('the header pair', () => {
  it('writes the RFC 8058 pair for a URL', () => {
    expect(listUnsubscribeHeaders({ url: 'https://x.test/u?t=1' })).toEqual({
      'List-Unsubscribe': '<https://x.test/u?t=1>',
      'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_ONE_CLICK,
    })
  })

  it('puts a mailto beside the URL in one header, as a sequence sends it', () => {
    expect(
      listUnsubscribeHeaders({
        url: 'https://x.test/u',
        mailto: 'mailto:a+unsubscribe@x.test?subject=unsubscribe',
      }),
    ).toEqual({
      'List-Unsubscribe':
        '<https://x.test/u>, <mailto:a+unsubscribe@x.test?subject=unsubscribe>',
      'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_ONE_CLICK,
    })
  })

  it('never advertises one-click without a URL to post to', () => {
    expect(listUnsubscribeHeaders({ mailto: 'mailto:a@x.test' })).toEqual({
      'List-Unsubscribe': '<mailto:a@x.test>',
    })
  })

  it('writes nothing when there is nothing to name', () => {
    expect(listUnsubscribeHeaders({})).toEqual({})
    expect(listUnsubscribeHeaders({ url: '', mailto: null })).toEqual({})
  })

  it('is the builder the marketing seam writes with too — no second copy', () => {
    expect(unsubscribeHeaders('https://x.test/u')).toEqual(
      listUnsubscribeHeaders({ url: 'https://x.test/u' }),
    )
    expect(unsubscribeHeaders('')).toEqual({})
  })
})

describe('one send’s pair', () => {
  const url = () => 'https://x.test/u'
  const mailto = () => 'mailto:a@x.test'

  it('is off unless enabled is exactly true, and mints nothing', () => {
    const mint = jest.fn(url)
    for (const enabled of [false, null, undefined]) {
      expect(resolveListUnsubscribe({ enabled, mintUrl: mint })).toEqual({
        status: 'off',
      })
    }
    expect(mint).not.toHaveBeenCalled()
  })

  it('is ready with the URL alone when the sender has no mailto', () => {
    expect(resolveListUnsubscribe({ enabled: true, mintUrl: url })).toEqual({
      status: 'ready',
      url: 'https://x.test/u',
      mailto: null,
    })
  })

  it('needs both halves when the sender has a mailto', () => {
    expect(
      resolveListUnsubscribe({ enabled: true, mintUrl: url, mintMailto: mailto }),
    ).toEqual({ status: 'ready', url: 'https://x.test/u', mailto: 'mailto:a@x.test' })
    expect(
      resolveListUnsubscribe({ enabled: true, mintUrl: url, mintMailto: () => null }),
    ).toEqual({ status: 'unavailable' })
    expect(
      resolveListUnsubscribe({ enabled: true, mintUrl: () => null, mintMailto: mailto }),
    ).toEqual({ status: 'unavailable' })
  })
})

describe('the bulk threshold', () => {
  const previous = process.env[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV]
  afterEach(() => {
    if (previous === undefined) delete process.env[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV]
    else process.env[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV] = previous
  })

  it('defaults to the 5,000 Gmail and Yahoo publish', () => {
    delete process.env[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV]
    expect(LIST_UNSUBSCRIBE_BULK_THRESHOLD_DEFAULT).toBe(5_000)
    expect(listUnsubscribeBulkThreshold()).toBe(5_000)
  })

  it('reads a deployment’s override from the environment, per call', () => {
    process.env[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV] = '1200'
    expect(listUnsubscribeBulkThreshold()).toBe(1_200)
    process.env[LIST_UNSUBSCRIBE_BULK_THRESHOLD_ENV] = '20000.9'
    expect(listUnsubscribeBulkThreshold()).toBe(20_000)
  })

  it('never lets a typo remove or zero the guard', () => {
    for (const raw of ['', '  ', 'abc', '0', '-5', 'NaN', 'Infinity']) {
      expect(listUnsubscribeBulkThreshold(raw)).toBe(5_000)
    }
  })
})

describe('the bulk-sender guard', () => {
  it('honors ON whatever the volume', () => {
    expect(
      decideListUnsubscribe({ requested: true, recentVolume: 0, sendVolume: 1, threshold: 5_000 }),
    ).toMatchObject({ on: true, forced: false, reason: null })
  })

  it('honors OFF under the threshold', () => {
    expect(
      decideListUnsubscribe({
        requested: false,
        recentVolume: 3_000,
        sendVolume: 1_999,
        threshold: 5_000,
      }),
    ).toEqual({
      requested: false,
      on: false,
      forced: false,
      reason: null,
      volume: 4_999,
      threshold: 5_000,
    })
  })

  it('forces it on for a send that takes the organization to the threshold', () => {
    expect(
      decideListUnsubscribe({
        requested: false,
        recentVolume: 3_000,
        sendVolume: 2_000,
        threshold: 5_000,
      }),
    ).toMatchObject({ on: true, forced: true, reason: 'bulk-volume', volume: 5_000 })
  })

  it('counts the whole send, not the batch that happens to cross', () => {
    // 500 recent and a 4,600-person email: the first batch of 500 is under,
    // the email is over, and the email is what is judged.
    expect(
      decideListUnsubscribe({
        requested: false,
        recentVolume: 500,
        sendVolume: 4_600,
        threshold: 5_000,
      }).forced,
    ).toBe(true)
  })

  it('forces it on for the pooled identity whatever the volume', () => {
    expect(
      decideListUnsubscribe({
        requested: false,
        recentVolume: 0,
        sendVolume: 1,
        threshold: 5_000,
        pooled: true,
      }),
    ).toMatchObject({ on: true, forced: true, reason: 'pooled-identity' })
  })

  it('keeps an earlier batch’s forced header on for the rest of the email', () => {
    expect(
      decideListUnsubscribe({
        requested: false,
        recentVolume: 0,
        sendVolume: 10,
        threshold: 5_000,
        forcedBefore: 'bulk-volume',
      }),
    ).toMatchObject({ on: true, forced: true, reason: 'bulk-volume' })
  })

  it('reads a junk volume as none rather than as headroom or a crash', () => {
    expect(
      decideListUnsubscribe({
        requested: false,
        recentVolume: Number.NaN,
        sendVolume: -4,
        threshold: 5_000,
      }),
    ).toMatchObject({ on: false, volume: 0 })
  })

  it('says why, in a sentence the campaign page shows', () => {
    expect(
      listUnsubscribeForcedDetail({ reason: 'bulk-volume', volume: 6_200, threshold: 5_000 }),
    ).toContain('6,200 campaign emails in 24 hours')
    expect(
      listUnsubscribeForcedDetail({ reason: 'pooled-identity', volume: 1, threshold: 5_000 }),
    ).toContain('shared sending address')
    expect(
      listUnsubscribeForcedDetail({ reason: 'volume-unknown', volume: 1, threshold: 5_000 }),
    ).toContain('could not be read')
    expect(
      listUnsubscribeForcedDetail({ reason: null, volume: 1, threshold: 5_000 }),
    ).toBe('')
  })
})
