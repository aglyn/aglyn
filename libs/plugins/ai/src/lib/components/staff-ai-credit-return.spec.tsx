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
 * The give-back dialog (AGL-3595). The route holds every rule; the dialog
 * says them first — a reason is required, the amount is a whole number no
 * larger than the month used, the default puts the meter back to zero — and
 * sends one key per opening, so a double-click returns once.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockStaffUser = {
  uid: 'staff-1',
  getIdToken: async () => 'tok',
  getIdTokenResult: async () => ({ claims: { staff: true, staffRole: 'super' } }),
}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockStaffUser }),
}))

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import {
  StaffCreditReturnDialog,
  staffCreditReturnable,
  staffCreditReturnProblem,
} from './staff-ai-credit-return.component'

const WORKSPACE = { used: 227, limit: 300 }
const ACCOUNT = { used: 240, limit: 300 }

const sentBody = (call = 0) =>
  JSON.parse(String((mockFetch.mock.calls[call]?.[2] as RequestInit).body))

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ duplicate: false, lines: [{ meter: 'workspace', credits: 227 }] }),
  })
})

describe('the rules the dialog states before the request', () => {
  it('returns at most the LOWER meter when both are chosen', () => {
    expect(staffCreditReturnable('both', WORKSPACE, ACCOUNT)).toBe(227)
    expect(staffCreditReturnable('account', WORKSPACE, ACCOUNT)).toBe(240)
    expect(staffCreditReturnable('both', WORKSPACE, null)).toBe(0)
  })

  it('requires a reason, a whole positive amount, and no more than was used', () => {
    const ok = { mode: 'give' as const, credits: '100', reason: 'Our bug', returnable: 227 }
    expect(staffCreditReturnProblem(ok)).toBeNull()
    expect(staffCreditReturnProblem({ ...ok, reason: '  ' })).toMatch(/reason/)
    expect(staffCreditReturnProblem({ ...ok, credits: '1.5' })).toMatch(/whole number/)
    expect(staffCreditReturnProblem({ ...ok, credits: '0' })).toMatch(/whole number/)
    expect(staffCreditReturnProblem({ ...ok, credits: '228' })).toMatch(/At most 227/)
    expect(staffCreditReturnProblem({ ...ok, returnable: 0 })).toMatch(/Nothing used/)
    // A reset names no amount; it still needs its reason.
    expect(staffCreditReturnProblem({ ...ok, mode: 'reset', credits: '' })).toBeNull()
    expect(staffCreditReturnProblem({ ...ok, mode: 'reset', reason: '' })).toMatch(/reason/)
  })
})

describe('StaffCreditReturnDialog', () => {
  const open = (props: Partial<Parameters<typeof StaffCreditReturnDialog>[0]> = {}) =>
    render(
      <StaffCreditReturnDialog
        open
        mode="give"
        target={{ orgId: 'org-1' }}
        workspace={WORKSPACE}
        account={ACCOUNT}
        onClose={jest.fn()}
        onReturned={jest.fn()}
        {...props}
      />,
    )

  it('shows both meters’ figures and defaults to both, at the amount that zeroes them', () => {
    open()
    expect(screen.getByText('Workspace band: 227 used of 300')).toBeTruthy()
    expect(screen.getByText('Owner’s Free allowance: 240 used of 300')).toBeTruthy()
    expect((screen.getByLabelText('Both') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Credits') as HTMLInputElement).value).toBe('227')
  })

  it('REFUSES to send without a reason', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Give back' }))
    expect(await screen.findByText('Say why — the reason is the audit row.')).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends the act with its reason and one key, and the same key again on a retry', async () => {
    const onReturned = jest.fn()
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Giving credits back failed' }),
    })
    open({ onReturned, jobId: 'job-9', jobCredits: 120 })
    expect((screen.getByLabelText('Credits') as HTMLInputElement).value).toBe('120')
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Planner bug' } })
    fireEvent.click(screen.getByRole('button', { name: 'Give back' }))
    expect(await screen.findByText('Giving credits back failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Give back' }))
    await waitFor(() => expect(onReturned).toHaveBeenCalled())

    expect(mockFetch.mock.calls[0]?.[1]).toBe('/api/ai/admin/credits')
    expect(sentBody(0)).toMatchObject({
      orgId: 'org-1',
      action: 'give',
      meter: 'both',
      credits: 120,
      reason: 'Planner bug',
      jobId: 'job-9',
    })
    // The retry is the same act: the server returns it once.
    expect(sentBody(1).idempotencyKey).toBe(sentBody(0).idempotencyKey)
  })

  it('refuses an amount past what the month used, before the request', async () => {
    open()
    fireEvent.change(screen.getByLabelText('Credits'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Planner bug' } })
    fireEvent.click(screen.getByRole('button', { name: 'Give back' }))
    expect(await screen.findByText('At most 227 — what this month used.')).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('from the staff user page offers the account alone and sends its uid', async () => {
    open({ target: { uid: 'owner-1' }, workspace: null, mode: 'reset' })
    expect(screen.queryByLabelText('Both')).toBeNull()
    expect(screen.getByText('Returns 240 credits.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Compensation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(sentBody()).toMatchObject({ uid: 'owner-1', action: 'reset', meter: 'account' })
    expect(sentBody()).not.toHaveProperty('credits')
  })
})
