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
import DocumentPresenceChips from '../components/document-presence-chips.component'
import type { PresentPerson } from '../hooks/use-presence-summary'

const person = (over: Partial<PresentPerson> = {}): PresentPerson => ({
  uid: 'u1',
  displayName: 'Zach Gover',
  ...over,
})

/**
 * A list row says who is already in a document (AGL-2486).
 *
 * The row is read at a glance and believed, so what it must never do is take
 * up space, or claim anything, when nobody is there — which on a real list is
 * the common case. Measured on production: 2 occupied presence rooms against a
 * largest host of 69 documents.
 */
describe('a row with nobody in it', () => {
  it('renders nothing at all', () => {
    const { container } = render(<DocumentPresenceChips people={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('a row with people in it', () => {
  it('draws one chip per person', () => {
    const { container } = render(
      <DocumentPresenceChips
        people={[person(), person({ uid: 'u2', displayName: 'Ada Lovelace' })]}
      />,
    )
    expect(container.querySelectorAll('.MuiAvatar-root')).toHaveLength(2)
    expect(
      container
        .querySelector('[data-aglyn-document-presence]')
        ?.getAttribute('data-aglyn-document-presence'),
    ).toBe('2')
  })

  it('reuses the shared avatar, so initials and photos behave as everywhere else', () => {
    // Two letters, not one — the same `memberInitials` the app bar uses. A
    // second implementation here is exactly what would drift.
    const { container } = render(<DocumentPresenceChips people={[person()]} />)
    expect(container.querySelector('.MuiAvatar-root')?.textContent).toBe('ZG')
  })

  it('shows a photo when the person has one', () => {
    const { container } = render(
      <DocumentPresenceChips
        people={[person({ photoURL: 'https://lh3.googleusercontent.com/a/x' })]}
      />,
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('googleusercontent')
    // The same leak-avoidance the member avatar applies everywhere.
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('caps the row and counts the rest', () => {
    const many = Array.from({ length: 6 }, (unused, index) =>
      person({ uid: `u${index}`, displayName: `Person ${index}` }),
    )
    const { container } = render(<DocumentPresenceChips people={many} />)
    expect(container.querySelectorAll('.MuiAvatar-root').length).toBeLessThan(6)
    expect(
      container
        .querySelector('[data-aglyn-document-presence-overflow]')
        ?.textContent,
    ).toBe('+3')
  })
})
