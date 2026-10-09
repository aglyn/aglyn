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
import { fireEvent, render, screen } from '@testing-library/react'
import AccountAvatar, { accountInitials } from './account-avatar.component'

describe('AccountAvatar (AGL-3660)', () => {
  it('draws initials from the name, else the address', () => {
    expect(accountInitials('Ada Lovelace')).toBe('AL')
    expect(accountInitials('grace')).toBe('G')
    expect(accountInitials('Mary Ann Evans')).toBe('ME')
    expect(accountInitials(null, 'pat@example.com')).toBe('P')
    expect(accountInitials('  ', null)).toBe('?')
  })

  it('shows the photo without a referrer, and the initials when it fails', () => {
    render(
      <AccountAvatar
        photoUrl="https://lh3.googleusercontent.com/a/photo"
        name="Ada Lovelace"
        email="ada@example.com"
      />,
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://lh3.googleusercontent.com/a/photo')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.error(img)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('AL')).toBeTruthy()
  })

  it('shows initials when there is no photo', () => {
    render(<AccountAvatar name={null} email="pat@example.com" />)
    expect(screen.getByText('P')).toBeTruthy()
  })
})
