/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 *
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
 * The staff console's spinner has to end (AGL-3242).
 *
 * `useIsStaff` reports `null` both while a claim read is in flight and when
 * it cannot be made at all — there is no signed-in user to ask, or the forced
 * refresh will not land. `StaffGuard` answered both with the same spinner, so
 * the second case turned forever. Observed on production: the staff tab strip,
 * which mounts above this route boundary, drawn over a spinner that never
 * resolved while the re-auth dialog re-opened behind it.
 *
 * ## What must NOT change
 *
 * The enumeration guard. A reader whose claim is readable and false still
 * gets the ordinary 404, and the notice this adds names no staff surface —
 * the last two cases hold both halves, because a gate that explains itself to
 * a stranger is a worse bug than the spinner.
 */

import { render, screen } from '@testing-library/react'

let mockIsStaff: boolean | null = null
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => mockIsStaff,
}))

const mockNotFound = jest.fn(() => {
  // Next's real `notFound()` throws to unwind the render; model that, or a
  // guard that returned nothing would read as a working 404.
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({
  __esModule: true,
  notFound: () => mockNotFound(),
}))

import {
  __resetSessionReauth,
  dismissSessionReauth,
  requestSessionReauth,
} from '../utils/session-reauth'
import { StaffGuard } from '../components/staff-guard.component'

const INSIDE = 'staff-console-body'
const guard = () =>
  render(
    <StaffGuard>
      <div data-testid={INSIDE}>{'Platform Overview'}</div>
    </StaffGuard>,
  )

beforeEach(() => {
  mockIsStaff = null
  mockNotFound.mockClear()
  __resetSessionReauth()
})

describe('while the claim is genuinely still resolving', () => {
  it('CONTROL: shows the spinner and says nothing else', () => {
    // The case the spinner is FOR — a staff member on the way in must not
    // flash a 404, and must not be told a session is broken when it is not.
    const { container } = guard()
    expect(container.querySelector('.MuiCircularProgress-root')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('once the console has diagnosed a session fault', () => {
  it('replaces the spinner with something that ends', () => {
    requestSessionReauth('stale')
    const { container } = guard()
    // The assertion that fails on the old guard: it kept spinning.
    expect(container.querySelector('.MuiCircularProgress-root')).toBeNull()
    expect(screen.getByRole('alert')).not.toBeNull()
  })

  it('offers the way back in once the prompt has been dismissed', () => {
    requestSessionReauth('stale')
    dismissSessionReauth()
    guard()
    expect(screen.getByRole('button', { name: 'Sign in again' })).not.toBeNull()
  })

  it('offers no button while the prompt is still on screen', () => {
    // A second way to open a dialog that is already covering this notice.
    requestSessionReauth('stale')
    guard()
    expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull()
  })

  it('says nothing a stranger could learn the staff area from', () => {
    requestSessionReauth('revoked')
    guard()
    const notice = screen.getByRole('alert').textContent ?? ''
    for (const word of ['staff', 'admin', 'Staff', 'Admin']) {
      expect(notice).not.toContain(word)
    }
  })
})

describe('the enumeration guard is untouched', () => {
  it('still 404s a reader whose claim is readable and false', () => {
    mockIsStaff = false
    requestSessionReauth('stale')
    // Even with a fault pending: a resolved `false` is a verdict, and it wins.
    expect(() => guard()).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('still renders the area for a staff reader', () => {
    mockIsStaff = true
    guard()
    expect(screen.getByTestId(INSIDE).textContent).toBe('Platform Overview')
  })
})
