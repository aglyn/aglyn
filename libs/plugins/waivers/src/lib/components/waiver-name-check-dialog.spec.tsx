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

import { act, fireEvent, render, screen } from '@testing-library/react'
import { WaiverNameCheckDialog } from './waiver-name-check-dialog.component'

const request = jest.fn()

jest.mock('./waivers-api', () => {
  const actual = jest.requireActual('./waivers-api')
  return { ...actual, useWaiversFetch: () => ({ ready: true, request, download: jest.fn() }) }
})
jest.mock('./use-site-waivers', () => ({ useSiteWaivers: () => ({ waivers: [] }) }))
// The signatures search has its own spec; here it shows what it was opened on.
jest.mock('./signatures-card.component', () => ({
  SignaturesCard: (props: { initialQuery?: string; canManage: boolean }) => (
    <div>{`Signatures search: ${props.initialQuery} (void ${props.canManage ? 'on' : 'off'})`}</div>
  ),
}))
// A plain date field in place of the picker's sections, which jsdom cannot type into.
jest.mock('@mui/x-date-pickers/DatePicker', () => {
  const day = jest.requireActual('dayjs')
  return {
    DatePicker: (props: { label: string; onChange: (value: unknown) => void }) => (
      <input aria-label={props.label} onChange={(event) => props.onChange(event.target.value ? day(event.target.value) : null)} />
    ),
  }
})

/**
 * Finding a rider's waiver by name at check-in (AGL-4042): the signatures
 * search opens on the name, and a date of birth matches name and birth
 * date together. A name alone is never a match.
 */

function open() {
  render(<WaiverNameCheckDialog open hostId="host-1" dayKey="2026-10-24" name="Pat Lee" onClose={jest.fn()} />)
}

beforeEach(() => request.mockReset())

describe('finding a waiver by name', () => {
  it('opens the signatures search on the name, without voiding', () => {
    open()
    expect(screen.getByText('Signatures search: Pat Lee (void off)')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Full name' }) as HTMLInputElement).value).toBe('Pat Lee')
  })

  it('checks nothing until there is a date of birth', () => {
    open()
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('matches the name and date of birth together', async () => {
    request.mockResolvedValue({ signed: true, matched: true, label: 'Waiver signed' })
    open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Date of birth' }), { target: { value: '2014-09-30' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    })
    expect(request).toHaveBeenCalledWith('waivers/status', {
      query: { hostId: 'host-1', dayKey: '2026-10-24', name: 'Pat Lee', dateOfBirth: '2014-09-30' },
    })
    expect(screen.getByText('Waiver signed')).toBeTruthy()
  })

  it('says so when no signed waiver has that name and date of birth', async () => {
    request.mockResolvedValue({ signed: false, matched: false, label: 'Waiver needed' })
    open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Date of birth' }), { target: { value: '2014-09-29' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    })
    expect(screen.getByText('No signed waiver for that name and date of birth')).toBeTruthy()
  })
})
