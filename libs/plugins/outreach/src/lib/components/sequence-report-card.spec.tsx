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

import { render, screen } from '@testing-library/react'
import type { OutreachSequence } from '../model/outreach.types'
import { OutreachSequenceReportCard } from './sequence-report-card'
import type { OutreachSequenceLinksLoad } from './use-outreach-data'

/**
 * WHAT THE SEQUENCE'S CARD SAYS (AGL-3239).
 *
 * The arithmetic is `model/sequence-report.ts`'s and has its own spec. What
 * is asserted here is the thing a screen can get wrong on its own: printing
 * a number the model withheld, or leaving off the sentence that says why.
 */

const settings = (trackClicks: boolean): OutreachSequence['settings'] => ({
  window: null,
  allowedCountries: ['US'],
  allowCustomers: false,
  trackClicks,
  listUnsubscribe: false,
})

const noLinks: OutreachSequenceLinksLoad = { status: 'ready', data: null }

const card = (
  stats: OutreachSequence['stats'],
  trackClicks = true,
  links: OutreachSequenceLinksLoad = noLinks,
) =>
  render(
    <OutreachSequenceReportCard
      sequence={{ stats, settings: settings(trackClicks) }}
      links={links}
      timeZone="America/Chicago"
    />,
  )

describe('the sequence report card', () => {
  it('says opens are not measured, and offers no open figure to misread', () => {
    card({ sent: 40, people: 10, clicks: 4, uniqueClicks: 3, clickTracked: true })
    expect(screen.getByText(/Opens aren.t measured/i)).toBeTruthy()
    expect(screen.queryByText(/open rate/i)).toBeNull()
  })

  it('prints the rate with the denominator it was taken over', () => {
    // "12%" alone is not a claim anyone can check, and "of delivered" and "of
    // people emailed" are different quantities.
    card({ sent: 40, people: 10, clicks: 4, uniqueClicks: 3, clickTracked: true })
    expect(screen.getByText('30.0%')).toBeTruthy()
    expect(screen.getByText('3 of 10 people emailed')).toBeTruthy()
  })

  it('shows a dash, never a nought, where the model withheld the rate', () => {
    card({ sent: 40, people: 10 }, false)
    expect(screen.queryByText('0.0%')).toBeNull()
    expect(screen.getByText(/Turn on link tracking/i)).toBeTruthy()
  })

  it('shows an unrecorded denominator as unknown rather than as nobody', () => {
    card({ sent: 40, clickTracked: true, uniqueClicks: 2 })
    expect(screen.getByText('Not counted for this sequence')).toBeTruthy()
  })

  it('shows scanner clicks beside the rate they are left out of', () => {
    card({ sent: 20, people: 20, clicks: 2, uniqueClicks: 2, machineClicks: 14, clickTracked: true })
    expect(screen.getByText('Scanner clicks')).toBeTruthy()
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText(/security scanners/i)).toBeTruthy()
  })

  it('lists the destinations followed, most-clicked first', () => {
    card({ sent: 20, people: 20, clicks: 5, uniqueClicks: 4, clickTracked: true }, true, {
      status: 'ready',
      data: {
        links: {
          a: { url: 'https://aglyn.com/pricing', clicks: 4 },
          b: { url: 'https://aglyn.com/demo', clicks: 1 },
        },
      },
    })
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      'https://aglyn.com/pricing4',
      'https://aglyn.com/demo1',
    ])
  })

  it('says nothing is wrong with a sequence that has simply not run', () => {
    card(undefined, true)
    expect(screen.getByText(/Opens aren.t measured/i)).toBeTruthy()
    expect(screen.queryByText(/Turn on link tracking/i)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
