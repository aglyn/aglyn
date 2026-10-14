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
 * The ad audience opt-out on the staff user page (AGL-3780): it reads the
 * account's own document, records the choice through the manage route, and
 * shows a refusal rather than pretending the switch moved.
 */
import StaffUserAdAudience from '../components/staff-user-ad-audience.component'
import { fireEvent, render, screen } from '@testing-library/react'

describe('StaffUserAdAudience', () => {
  it('shows an account with no opt-out as included, and opts it out', async () => {
    const onChange = jest.fn().mockResolvedValue({ atMs: Date.UTC(2026, 9, 13), by: 'staff-1' })
    render(<StaffUserAdAudience profile={{}} onChange={onChange} />)
    expect(screen.getByText('Included when eligible')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Opt out' }))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(await screen.findByText(/^Opted out/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Include again' })).toBeTruthy()
  })

  it('lets an opted-out account back in', async () => {
    const onChange = jest.fn().mockResolvedValue(null)
    render(
      <StaffUserAdAudience
        profile={{ adAudienceOptOut: { atMs: Date.UTC(2026, 9, 1), by: 'staff-1' } }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Include again' }))
    expect(onChange).toHaveBeenCalledWith(false)
    expect(await screen.findByText('Included when eligible')).toBeTruthy()
  })

  it('keeps the old state and says why when the save is refused', async () => {
    const onChange = jest.fn().mockRejectedValue(new Error('Requires the super staff role'))
    render(<StaffUserAdAudience profile={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Opt out' }))
    expect(await screen.findByText('Requires the super staff role')).toBeTruthy()
    expect(screen.getByText('Included when eligible')).toBeTruthy()
  })
})
