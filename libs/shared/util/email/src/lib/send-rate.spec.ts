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
 * The send-rate policy (AGL-2409).
 *
 * The load-bearing assertion in this file is the one about what a rate control
 * may NOT do: refuse a transactional message. Every other test here protects a
 * number; that one protects somebody's ability to get back into their account.
 */

import {
  EMAIL_BATCH_MIN_REQUEST_INTERVAL_MS,
  EMAIL_BATCH_REQUESTS_PER_SECOND,
  EMAIL_PROVIDER_REQUESTS_PER_SECOND,
  EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
  EMAIL_SEND_RATE_MAX_PER_HOUR,
  EMAIL_SEND_RATE_MIN_PER_HOUR,
  EMAIL_SEND_RATE_NOTE_MAX,
  EMAIL_SEND_RATE_WINDOW_MS,
  batchRequestIntervalMs,
  createProviderRequestPacer,
  emailSendRateVerdict,
  emailSendRateWindowStartMs,
  isRefusablePriority,
  normalizeEmailSendRateConfig,
  resolveSendPriority,
  type EmailSendPriority,
} from './send-rate'

const WINDOW_START = 1_755_100_800_000

function verdict(
  priority: EmailSendPriority,
  used: number,
  count: number,
  ceiling = 100,
  enabled = true,
) {
  return emailSendRateVerdict({
    priority,
    used,
    count,
    ceiling,
    enabled,
    windowStartMs: WINDOW_START,
  })
}

describe('emailSendRateVerdict — the boundary', () => {
  /**
   * THE RULE. A quota may only ever refuse a campaign; a rate control may
   * only ever defer a campaign or a bulk sweep. Neither may touch a
   * transactional message, at any ceiling, at any usage, ever.
   */
  it('never refuses a transactional send, however far over the ceiling', () => {
    expect(verdict('transactional', 0, 1).allowed).toBe(true)
    expect(verdict('transactional', 100, 1).allowed).toBe(true)
    expect(verdict('transactional', 1_000_000, 500).allowed).toBe(true)
    // Even with the smallest ceiling the console can set.
    expect(
      verdict('transactional', 9_999, 1, EMAIL_SEND_RATE_MIN_PER_HOUR).allowed,
    ).toBe(true)
  })

  it('reports a transactional send over the ceiling as overCeiling, not refused', () => {
    const result = verdict('transactional', 100, 5)
    expect(result.allowed).toBe(true)
    expect(result.overCeiling).toBe(true)
    // Headroom is gone, and says so, without refusing anything.
    expect(result.remaining).toBe(0)
  })

  it('refuses a campaign that would cross the ceiling', () => {
    expect(verdict('campaign', 99, 1).allowed).toBe(true)
    expect(verdict('campaign', 99, 2).allowed).toBe(false)
    expect(verdict('campaign', 100, 1).allowed).toBe(false)
  })

  it('refuses a bulk sweep that would cross the ceiling', () => {
    expect(verdict('bulk', 50, 50).allowed).toBe(true)
    expect(verdict('bulk', 50, 51).allowed).toBe(false)
  })

  it('grants everything, still counted, while the governor is parked', () => {
    const result = verdict('campaign', 500, 500, 100, false)
    expect(result.allowed).toBe(true)
    expect(result.overCeiling).toBe(true)
  })

  it('answers retryAtMs at the end of the window', () => {
    expect(verdict('campaign', 100, 1).retryAtMs).toBe(
      WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS,
    )
  })

  it('does not consume headroom for a send it refused', () => {
    // `remaining` reflects what is left for the NEXT caller. A refused send
    // took nothing, so the headroom it did not fit into is still there.
    const refused = verdict('campaign', 90, 20)
    expect(refused.allowed).toBe(false)
    expect(refused.remaining).toBe(10)
  })

  it('treats a corrupt or negative counter as zero, not as headroom', () => {
    expect(verdict('campaign', -5_000, 100).allowed).toBe(true)
    expect(verdict('campaign', Number.NaN as any, 101).allowed).toBe(false)
    expect(verdict('campaign', Number.NaN as any, 100).used).toBe(0)
  })

  it('falls back to the default ceiling rather than to zero on a bad ceiling', () => {
    // A ceiling that read as 0 would refuse every campaign on the platform.
    const result = verdict('campaign', 0, 1, Number.NaN as any)
    expect(result.ceiling).toBe(EMAIL_SEND_RATE_DEFAULT_PER_HOUR)
    expect(result.allowed).toBe(true)
  })
})

describe('resolveSendPriority', () => {
  it('derives campaign from the context the sender already passes', () => {
    expect(resolveSendPriority('campaign')).toBe('campaign')
  })

  it('defaults everything else to transactional', () => {
    for (const context of [
      undefined,
      '',
      'invite',
      'password-reset',
      'order-confirmation',
      'usage summary (org-1)',
      'campaigns',
      'Campaign',
    ]) {
      expect(resolveSendPriority(context)).toBe('transactional')
    }
  })

  it('lets an explicit priority win', () => {
    expect(resolveSendPriority('campaign', 'transactional')).toBe('transactional')
    expect(resolveSendPriority('usage summary (org-1)', 'bulk')).toBe('bulk')
    expect(resolveSendPriority(undefined, 'campaign')).toBe('campaign')
  })

  it('ignores an unrecognised explicit priority rather than trusting it', () => {
    expect(resolveSendPriority('invite', 'nonsense' as any)).toBe('transactional')
  })
})

describe('isRefusablePriority', () => {
  it('is exactly campaign and bulk', () => {
    expect(isRefusablePriority('campaign')).toBe(true)
    expect(isRefusablePriority('bulk')).toBe(true)
    expect(isRefusablePriority('transactional')).toBe(false)
  })
})

describe('normalizeEmailSendRateConfig', () => {
  it('uses the built-in default when nothing is stored', () => {
    const config = normalizeEmailSendRateConfig(null)
    expect(config.perHour).toBe(EMAIL_SEND_RATE_DEFAULT_PER_HOUR)
    expect(config.enabled).toBe(true)
  })

  it('treats an absent `enabled` as ON', () => {
    // A governor a missing field turns off is not a governor.
    expect(normalizeEmailSendRateConfig({ perHour: 10 }).enabled).toBe(true)
    expect(
      normalizeEmailSendRateConfig({ perHour: 10, enabled: false }).enabled,
    ).toBe(false)
  })

  it('clamps a stored ceiling into bounds rather than honouring it', () => {
    expect(normalizeEmailSendRateConfig({ perHour: 0 }).perHour).toBe(
      EMAIL_SEND_RATE_MIN_PER_HOUR,
    )
    expect(normalizeEmailSendRateConfig({ perHour: -50 }).perHour).toBe(
      EMAIL_SEND_RATE_MIN_PER_HOUR,
    )
    expect(normalizeEmailSendRateConfig({ perHour: 1e12 }).perHour).toBe(
      EMAIL_SEND_RATE_MAX_PER_HOUR,
    )
  })

  it('falls back to the default — never to zero — on an unreadable ceiling', () => {
    expect(
      normalizeEmailSendRateConfig({ perHour: 'lots' as any }).perHour,
    ).toBe(EMAIL_SEND_RATE_DEFAULT_PER_HOUR)
  })

  it('bounds the note', () => {
    const config = normalizeEmailSendRateConfig({ note: 'x'.repeat(5_000) })
    expect(config.note).toHaveLength(EMAIL_SEND_RATE_NOTE_MAX)
  })

  it('drops a non-positive updatedAtMs to null', () => {
    expect(normalizeEmailSendRateConfig({ updatedAtMs: 0 }).updatedAtMs).toBeNull()
    expect(
      normalizeEmailSendRateConfig({ updatedAtMs: 1_755_100_800_000 }).updatedAtMs,
    ).toBe(1_755_100_800_000)
  })
})

describe('emailSendRateWindowStartMs', () => {
  it('floors to the hour', () => {
    expect(emailSendRateWindowStartMs(WINDOW_START + 1)).toBe(WINDOW_START)
    expect(
      emailSendRateWindowStartMs(WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS - 1),
    ).toBe(WINDOW_START)
    expect(
      emailSendRateWindowStartMs(WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS),
    ).toBe(WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS)
  })
})

describe('the provider request rate', () => {
  it('leaves the published rate a request per second of headroom', () => {
    // The reserved request is the transactional mail sharing the key, not a
    // rounding allowance — see the constant.
    expect(EMAIL_BATCH_REQUESTS_PER_SECOND).toBe(
      EMAIL_PROVIDER_REQUESTS_PER_SECOND - 1,
    )
    expect(
      EMAIL_BATCH_REQUESTS_PER_SECOND * EMAIL_BATCH_MIN_REQUEST_INTERVAL_MS,
    ).toBeGreaterThanOrEqual(1_000)
  })

  it('takes a configured rate for an account whose limit was raised', () => {
    expect(batchRequestIntervalMs('20')).toBe(Math.ceil(1_000 / 19))
    expect(batchRequestIntervalMs(20)).toBe(Math.ceil(1_000 / 19))
  })

  it('paces at a second for a rate of one, rather than dividing by zero', () => {
    expect(batchRequestIntervalMs('1')).toBe(1_000)
  })

  it('turns pacing off only for an explicit zero', () => {
    expect(batchRequestIntervalMs('0')).toBe(0)
    // Every other unreadable value falls back to the shipped interval. A typo
    // in an env var must not silently remove a rate control.
    for (const raw of [undefined, null, '', '  ', 'ten', '-4', NaN]) {
      expect(batchRequestIntervalMs(raw)).toBe(EMAIL_BATCH_MIN_REQUEST_INTERVAL_MS)
    }
  })

  it('lets the first request through and spaces the ones behind it', async () => {
    const pace = createProviderRequestPacer(30)
    const startedAt = Date.now()
    await pace()
    const firstAt = Date.now()
    await pace()
    await pace()

    // One tick of slack: `setTimeout` may fire a millisecond early.
    expect(firstAt - startedAt).toBeLessThan(30)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(59)
  })

  it('costs a caller that is already slower than the interval nothing', async () => {
    const pace = createProviderRequestPacer(20)
    await pace()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const before = Date.now()
    await pace()
    expect(Date.now() - before).toBeLessThan(20)
  })

  it('does not bank the slots a stalled caller did not use', async () => {
    // The burst this exists to remove: a loop that paused must not be able to
    // spend the interval it skipped on a run of requests with no gap at all.
    const pace = createProviderRequestPacer(25)
    await pace()
    await new Promise((resolve) => setTimeout(resolve, 200))
    const before = Date.now()
    await pace()
    await pace()
    expect(Date.now() - before).toBeGreaterThanOrEqual(24)
  })

  it('waits for nothing at all when pacing is off', async () => {
    const pace = createProviderRequestPacer(0)
    const before = Date.now()
    await pace()
    await pace()
    await pace()
    expect(Date.now() - before).toBeLessThan(20)
  })
})
