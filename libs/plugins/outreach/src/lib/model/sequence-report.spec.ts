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

import { readOutreachEngagement } from './enrollment-engagement'
import { outreachSequenceReport } from './sequence-report'

const ids = (stats: Parameters<typeof outreachSequenceReport>[0], trackClicks = true) =>
  outreachSequenceReport(stats, trackClicks).caveats.map((entry) => entry.id)

describe('outreachSequenceReport', () => {
  it('always says opens are not measured, whatever else it has', () => {
    // The one thing a reader coming from the campaign report needs told. A
    // blank where an open rate would be says the opposite of what is true.
    expect(ids(undefined, false)).toContain('opens-not-measured')
    expect(ids({ sent: 40, people: 10, clickTracked: true, uniqueClicks: 3 })).toContain(
      'opens-not-measured',
    )
  })

  it('never reports an open figure of any kind', () => {
    const report = outreachSequenceReport({ sent: 40, people: 10 }, true)
    expect(Object.keys(report)).not.toContain('opens')
    expect(Object.keys(report.rates)).toEqual(['click'])
  })

  it('takes the click rate over PEOPLE emailed, not over emails sent', () => {
    // One person takes four steps. A rate over `sent` would read a quarter of
    // the truth, and would not be the quantity a campaign's report calls a
    // click rate either.
    const report = outreachSequenceReport(
      { sent: 40, people: 10, clicks: 7, uniqueClicks: 3, clickTracked: true },
      true,
    )
    expect(report.rates.click).toEqual({
      value: 0.3,
      numerator: 3,
      denominator: 10,
      denominatorLabel: 'people emailed',
    })
  })

  it('divides the DISTINCT clickers, never the click events', () => {
    // Events over people can exceed 100% the moment one person clicks twice.
    const report = outreachSequenceReport(
      { sent: 5, people: 2, clicks: 9, uniqueClicks: 1, clickTracked: true },
      true,
    )
    expect(report.rates.click?.numerator).toBe(1)
    expect(report.clicks).toBe(9)
  })

  it('withholds the rate for a sequence that never sent a tracked link', () => {
    // A structural zero: 0 is the only value it could ever have taken, so a
    // rate computed from it measures our sending code, not the recipients.
    const report = outreachSequenceReport({ sent: 40, people: 10 }, false)
    expect(report.rates.click).toBeNull()
    expect(ids({ sent: 40, people: 10 }, false)).toContain('clicks-not-tracked')
  })

  it('separates "nobody turned it on" from "nothing has been counted yet"', () => {
    expect(ids({ sent: 40, people: 10 }, true)).toContain('clicks-unrecorded')
    expect(ids({ sent: 40, people: 10 }, false)).toContain('clicks-not-tracked')
  })

  it('reports an unrecorded denominator as unknown, not as nobody', () => {
    // `people` absent means "never counted", which for a sequence that ran
    // before the counters existed is not "nobody was emailed" — and rendering
    // that beside a non-zero send count is the flattering-substitution
    // failure in reverse.
    const report = outreachSequenceReport({ sent: 40, clickTracked: true, uniqueClicks: 2 }, true)
    expect(report.people).toBeNull()
    expect(report.rates.click).toBeNull()
  })

  it('says nothing is missing about a sequence that has not run', () => {
    const report = outreachSequenceReport(undefined, true)
    expect(report.caveats.map((entry) => entry.id)).toEqual(['opens-not-measured'])
    expect(report.sent).toBe(0)
  })

  it('keeps scanner clicks out of the rate and still shows them', () => {
    const report = outreachSequenceReport(
      { sent: 20, people: 20, clicks: 2, uniqueClicks: 2, machineClicks: 14, clickTracked: true },
      true,
    )
    expect(report.rates.click?.numerator).toBe(2)
    expect(report.machineClicks).toBe(14)
    expect(report.caveats.map((entry) => entry.id)).toContain('machine-clicks-excluded')
  })

  it('reads a nonsense counter as nothing rather than propagating it', () => {
    const report = outreachSequenceReport(
      { sent: Number.NaN, people: -3, clicks: Number.POSITIVE_INFINITY } as never,
      true,
    )
    expect(report.sent).toBe(0)
    expect(report.people).toBe(0)
    expect(report.clicks).toBe(0)
  })
})

describe('readOutreachEngagement', () => {
  it('reads an enrollment that was never clicked as no clicks', () => {
    expect(readOutreachEngagement(undefined)).toEqual({
      clicks: 0,
      firstClickAtMs: null,
      lastClickAtMs: null,
      lastClickUrl: null,
      machineClicks: 0,
    })
  })

  it('keeps what is readable and drops what is not', () => {
    expect(
      readOutreachEngagement({
        clicks: 3.7,
        firstClickAtMs: 1_000,
        lastClickAtMs: 'soon',
        lastClickUrl: 'https://aglyn.com/pricing',
        machineClicks: -2,
      }),
    ).toEqual({
      clicks: 3,
      firstClickAtMs: 1_000,
      lastClickAtMs: null,
      lastClickUrl: 'https://aglyn.com/pricing',
      machineClicks: 0,
    })
  })
})
