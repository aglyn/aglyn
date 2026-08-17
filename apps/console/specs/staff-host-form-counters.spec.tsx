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

import { render } from '@testing-library/react'
import StaffHostFormCountersChips from '../components/staff-host-form-counters.component'

/**
 * AGL-1681: the per-host form-counter chips on the staff org detail page's
 * Sites card.
 *
 * The discipline under test is the same one `formSubmissionsPausedNotice`
 * enforces for the owner: below one refusal, render NOTHING — the counter
 * document exists from the first trip and never goes away, and a "0 refused"
 * chip on every healthy site is noise that trains staff to ignore the chip
 * that will one day be real. Above zero, the chip must carry the count, so a
 * support conversation starts with the number instead of a Firestore query.
 */
describe('StaffHostFormCountersChips (AGL-1681)', () => {
  it('renders nothing for a host with no refusals this month', () => {
    const { container } = render(
      <StaffHostFormCountersChips
        forms={{ month: '2026-08', refused: 0, ceiling: 500 }}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the join is absent (picker rows, failed read)', () => {
    const { container } = render(<StaffHostFormCountersChips forms={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('flags a refusing host with the count', () => {
    const { getByText } = render(
      <StaffHostFormCountersChips
        forms={{ month: '2026-08', refused: 12, ceiling: 500 }}
      />,
    )
    expect(getByText('forms paused · 12 refused')).toBeTruthy()
  })

  it('carries the resolved ceiling in the accessible tooltip', () => {
    // The chip is terse; the ceiling and the reset date are the tooltip's
    // job, and `aria-label` is how MUI's Tooltip title reaches the DOM
    // without a hover simulation.
    const { getByLabelText } = render(
      <StaffHostFormCountersChips
        forms={{ month: '2026-08', refused: 12, ceiling: 500 }}
      />,
    )
    expect(
      getByLabelText(/passed its 500-submission ceiling/),
    ).toBeTruthy()
  })

  it('omits the ceiling clause when the counter never recorded one', () => {
    const { getByText, queryByLabelText } = render(
      <StaffHostFormCountersChips
        forms={{ month: '2026-08', refused: 1, ceiling: null }}
      />,
    )
    expect(getByText('forms paused · 1 refused')).toBeTruthy()
    expect(queryByLabelText(/ceiling/)).toBeNull()
  })
})
