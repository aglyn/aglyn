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
 * AGL-3952 — the create-workspace dialog's "Build for a client" switch.
 *
 * Staff see a switch below the two fields; on, it reveals the comp plan,
 * the reason and a required note, and the create posts `clientComp`. A
 * non-staff member sees the dialog exactly as before and the post carries
 * no such field — the server refuses it from them anyway, but the dialog
 * never offers what it cannot send.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockFetch = jest.fn()
let mockIsStaff: boolean | null = false

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => mockIsStaff,
  useStaffRole: () => (mockIsStaff ? 'staff' : null),
}))

import CreateOrgDialog from '../components/create-org-dialog.component'

/** The body the dialog posted, parsed. */
const postedBody = (): Record<string, unknown> =>
  JSON.parse(String((mockFetch.mock.calls[0][2] as { body: string }).body))

const typeName = (name: string) =>
  fireEvent.change(screen.getByLabelText('Organization name'), {
    target: { value: name },
  })

const create = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(label))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ orgId: 'org-new', slug: 'pecos-valley' }),
  })
})

describe('the create-workspace dialog for a customer', () => {
  beforeEach(() => {
    mockIsStaff = false
  })

  it('shows no switch and posts no comp', async () => {
    render(<CreateOrgDialog open onClose={() => undefined} />)
    expect(screen.queryByText('Build for a client')).toBeNull()
    typeName('Pecos Valley')
    await create('Create')
    expect(postedBody()).not.toHaveProperty('clientComp')
  })

  it('shows no switch while the claim is still resolving', () => {
    mockIsStaff = null
    render(<CreateOrgDialog open onClose={() => undefined} />)
    expect(screen.queryByText('Build for a client')).toBeNull()
  })
})

describe('the create-workspace dialog for staff (AGL-3952)', () => {
  beforeEach(() => {
    mockIsStaff = true
  })

  it('offers the switch, and with it off posts exactly what a customer posts', async () => {
    render(<CreateOrgDialog open onClose={() => undefined} />)
    expect(screen.getByText('Build for a client')).toBeTruthy()
    expect(screen.queryByLabelText(/Comp plan/)).toBeNull()
    typeName('Pecos Valley')
    await create('Create')
    expect(postedBody()).not.toHaveProperty('clientComp')
  })

  it('with the switch on, holds Create until the note is written, then posts the comp', async () => {
    render(<CreateOrgDialog open onClose={() => undefined} />)
    typeName('Pecos Valley')
    fireEvent.click(screen.getByRole('switch'))
    // The fields appear, defaulted to Starter and the sales-trial reason.
    expect(screen.getByLabelText(/Comp plan/)).toBeTruthy()
    expect(screen.getByText('Starter')).toBeTruthy()
    expect(screen.getByText('Sales trial or proof of concept')).toBeTruthy()
    // No note yet: the button names the client build and stays disabled.
    const button = screen.getByText('Create for the client').closest('button')
    expect(button?.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Note \(staff only\)/), {
      target: { value: 'Booth build, Three Palms MX round 4' },
    })
    expect(button?.disabled).toBe(false)
    await create('Create for the client')
    expect(postedBody()).toMatchObject({
      name: 'Pecos Valley',
      clientComp: {
        plan: 'starter',
        reason: 'trial',
        note: 'Booth build, Three Palms MX round 4',
      },
    })
    // On to the one-screen build for the client (AGL-3958).
    expect(mockPush).toHaveBeenCalledWith('/pecos-valley/client-build')
  })

  it('with the switch off, lands on the new workspace as before', async () => {
    render(<CreateOrgDialog open onClose={() => undefined} />)
    typeName('Pecos Valley')
    await create('Create')
    expect(mockPush).toHaveBeenCalledWith('/pecos-valley/hosts')
  })
})
