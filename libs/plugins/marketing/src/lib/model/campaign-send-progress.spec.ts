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
 * THE ROW THAT WOULD OTHERWISE LIE.
 *
 * An email larger than one send may carry is stored as `scheduled` between
 * its batches — the state the processor claims, and the only one that resumes
 * it without a second index. Read literally that is a row saying "not sent
 * yet" about an email that has already delivered five hundred messages.
 *
 * These are the cases a merchant has to be able to tell apart on one screen:
 * a campaign waiting for its time, one that is halfway through, one that
 * finished, and one that stopped short. Getting the middle two confused is
 * the whole reason this function exists, so both are asserted against the
 * stored shape that produces them rather than against a flag.
 */

import {
  campaignSendProgress,
  type CampaignSend,
} from './campaign-container'

const send = (patch: Partial<CampaignSend>): CampaignSend =>
  ({ $id: 'send-1', ...patch }) as CampaignSend

describe('campaignSendProgress', () => {
  it('reads a scheduled campaign that has delivered nothing as pending', () => {
    expect(
      campaignSendProgress(
        send({ status: 'scheduled', sendAtMs: 1, stats: { sent: 0 } as never }),
      ),
    ).toMatchObject({ state: 'pending', reached: 0, label: 'Scheduled' })
  })

  it('reads a scheduled campaign that HAS delivered as still sending', () => {
    const progress = campaignSendProgress(
      send({
        status: 'scheduled',
        stats: { sent: 500, audienceSize: 3000 } as never,
        resume: { remaining: 2500, batch: 1, nextAtMs: 1 },
      }),
    )
    expect(progress.state).toBe('sending')
    expect(progress.label).toBe('Sending — reached 500 of 3,000')
    expect(progress.remaining).toBe(2500)
  })

  it('reads a finished multi-batch send as sent, and says how many runs', () => {
    expect(
      campaignSendProgress(
        send({
          status: 'sent',
          stats: { sent: 3000, audienceSize: 3000 } as never,
          resume: { remaining: 0, batch: 6, nextAtMs: 0 },
        }),
      ),
    ).toMatchObject({
      state: 'sent',
      label: 'Sent to 3,000 of 3,000 over 6 runs',
    })
  })

  it('reads an ordinary one-batch send exactly as before', () => {
    // Every send that predates batching carries no `resume` at all, and must
    // not start reading as stopped or as pending because a field is missing.
    expect(
      campaignSendProgress(
        send({ status: 'sent', stats: { sent: 42, audienceSize: 42 } as never }),
      ),
    ).toMatchObject({ state: 'sent', label: 'Sent to 42 of 42' })
  })

  it('withholds the audience rather than presenting a floor as a total', () => {
    // A send from before `audienceSize` was recorded. Reporting `reached` as
    // the audience would invent a campaign that reached everybody.
    const progress = campaignSendProgress(
      send({ status: 'sent', stats: { sent: 42 } as never }),
    )
    expect(progress.audience).toBeNull()
    expect(progress.label).toBe('Sent to 42')
  })

  it('reads a campaign canceled mid-flight as stopped, with the count', () => {
    expect(
      campaignSendProgress(
        send({
          status: 'canceled',
          stats: { sent: 1500, audienceSize: 3000 } as never,
          resume: { remaining: 1500, batch: 3, nextAtMs: 0 },
        }),
      ),
    ).toMatchObject({
      state: 'stopped',
      label: 'Reached 1,500 of 3,000 — canceled with 1,500 not addressed',
    })
  })

  it('reads a campaign that failed mid-flight as stopped, not as nothing', () => {
    const progress = campaignSendProgress(
      send({
        status: 'failed',
        stats: { sent: 2400, audienceSize: 3000 } as never,
        resume: { remaining: 600, batch: 5, nextAtMs: 0 },
      }),
    )
    expect(progress.state).toBe('stopped')
    expect(progress.reached).toBe(2400)
    expect(progress.label).toMatch(/stopped by an error/)
  })

  it('does not read a canceled campaign as still sending', () => {
    // A remainder alone is not "still going" — the status decides, which is
    // why it is read first. Otherwise Cancel would appear to do nothing.
    expect(
      campaignSendProgress(
        send({
          status: 'canceled',
          stats: { sent: 500 } as never,
          resume: { remaining: 2500, batch: 1, nextAtMs: 123 },
        }),
      ).state,
    ).toBe('stopped')
  })

  it('is total — a missing or corrupt record does not throw', () => {
    expect(() => campaignSendProgress(undefined)).not.toThrow()
    expect(campaignSendProgress(undefined).state).toBe('sent')
    expect(
      campaignSendProgress(
        send({
          status: 'scheduled',
          stats: { sent: -5, audienceSize: NaN } as never,
          resume: { remaining: -1, batch: 'x' as never, nextAtMs: null as never },
        }),
      ),
    ).toMatchObject({ state: 'pending', reached: 0 })
  })
})
