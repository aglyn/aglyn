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
 * The Quotes card (AGL-4093, AGL-4206): the two new-quote switches and the
 * statements a customer ticks before approving, and what Save writes.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QUOTE_DEFAULT_APPROVAL_STATEMENTS } from '../../model'

const mockSetDoc = jest.fn(async (..._args: unknown[]) => undefined)
let mockStore: any = {}
let mockFromCache = false

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: mockStore, status: 'success', fromCache: mockFromCache }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
}))

import QuoteSettingsCard from './quote-settings-card.component'

const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const statementFields = () => screen.getAllByLabelText(/^Statement \d$/) as HTMLTextAreaElement[]

beforeEach(() => {
  mockSetDoc.mockClear()
  mockStore = {}
  mockFromCache = false
})

/**
 * The first press is never refused for a late server (AGL-4047): Save is held
 * while the settings read is the cache's, with the reason beside it, and the
 * edit is saved onto what the server confirms.
 */
describe('the Quotes card while the server has not answered', () => {
  it('holds Save with the reason, then saves the edit onto the server’s settings', async () => {
    mockFromCache = true
    const { rerender } = render(<QuoteSettingsCard hostId="site1" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Customers sign in to see and approve proofs' }))
    expect(save().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Checking your quote settings with the server…')

    // Proof approval was switched on elsewhere since the cached snapshot.
    mockStore = { quotes: { requireProofApproval: true } }
    mockFromCache = false
    rerender(<QuoteSettingsCard hostId="site1" />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(save())

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    expect(mockSetDoc.mock.calls[0][1]).toMatchObject({
      quotes: { requireProofApproval: true, requireProofSignIn: true },
    })
  })
})

describe('the Quotes card', () => {
  it('shows both switches off and the suggested statements when nothing is saved', () => {
    render(<QuoteSettingsCard hostId="site1" />)
    expect((screen.getByRole('switch', { name: 'Customers approve the proof before they can pay' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('switch', { name: 'Customers sign in to see and approve proofs' }) as HTMLInputElement).checked).toBe(false)
    expect(statementFields().map((field) => field.value)).toEqual([...QUOTE_DEFAULT_APPROVAL_STATEMENTS])
    expect(save().disabled).toBe(true)
  })

  it('saves the switches and the statements as typed, cleaned, under quotes', async () => {
    render(<QuoteSettingsCard hostId="site1" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Customers sign in to see and approve proofs' }))
    fireEvent.change(statementFields()[0], { target: { value: '  The names are  spelled right. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove statement 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a statement' }))
    expect(statementFields()).toHaveLength(3)
    fireEvent.click(save())
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    expect(mockSetDoc.mock.calls[0]).toEqual([
      'hosts/site1/settings/store',
      {
        quotes: {
          requireProofApproval: false,
          requireProofSignIn: true,
          // The blank one just added is dropped.
          approvalStatements: ['The names are spelled right.', QUOTE_DEFAULT_APPROVAL_STATEMENTS[1]],
        },
      },
      { merge: true },
    ])
  })

  it('reads what was saved, and puts the suggestions back on request', () => {
    mockStore = { quotes: { requireProofSignIn: true, approvalStatements: ['Sizes are right.'] } }
    render(<QuoteSettingsCard hostId="site1" />)
    expect((screen.getByRole('switch', { name: 'Customers sign in to see and approve proofs' }) as HTMLInputElement).checked).toBe(true)
    expect(statementFields().map((field) => field.value)).toEqual(['Sizes are right.'])
    // One statement always stays.
    expect((screen.getByRole('button', { name: 'Remove statement 1' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use the suggested statements' }))
    expect(statementFields().map((field) => field.value)).toEqual([...QUOTE_DEFAULT_APPROVAL_STATEMENTS])
  })

  it('will not save with every statement blank', () => {
    mockStore = { quotes: { approvalStatements: ['Only one.'] } }
    render(<QuoteSettingsCard hostId="site1" />)
    fireEvent.change(statementFields()[0], { target: { value: '   ' } })
    expect(screen.getByText('Write at least one statement for customers to confirm.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('stops at five statements', () => {
    mockStore = { quotes: { approvalStatements: ['a', 'b', 'c', 'd', 'e'] } }
    render(<QuoteSettingsCard hostId="site1" />)
    expect((screen.getByRole('button', { name: 'Add a statement' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
