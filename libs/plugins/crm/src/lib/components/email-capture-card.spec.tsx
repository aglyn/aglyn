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
 * The Email capture card (AGL-2657): the workspace's address, read from the
 * inbound-address route once the scope is known, copied to the clipboard,
 * and rotated only by an owner or admin who confirmed.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EmailCaptureCard } from './email-capture-card'

const crmApi = jest.fn()
let crmApiHost: string | null | undefined
jest.mock('./use-crm-api', () => ({
  useCrmApi: (hostId: string | null) => {
    crmApiHost = hostId
    return crmApi
  },
}))
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
const confirm = jest.fn()
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm }),
}))
jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => undefined,
}))

const ADDRESS = 'crm+abcdefghijklmnopqrstuvwxyz012345@in.aglyn.com'
const ROTATED = 'crm+zyxwvutsrqponmlkjihgfedcba543210@in.aglyn.com'

beforeEach(() => {
  jest.clearAllMocks()
  crmApiHost = undefined
  confirm.mockResolvedValue(undefined)
  crmApi.mockImplementation(async (_route: string, body: Record<string, unknown>) => ({
    response: { ok: true },
    payload: { address: body['rotate'] ? ROTATED : ADDRESS },
  }))
})

describe('EmailCaptureCard (AGL-2657)', () => {
  it('asks the route for the address once the scope is ready, and prints it', async () => {
    const { rerender } = render(<EmailCaptureCard hostId="site-1" canManage ready={false} />)
    expect(crmApi).not.toHaveBeenCalled()
    rerender(<EmailCaptureCard hostId="site-1" canManage ready />)
    expect(crmApi).toHaveBeenCalledWith('inbound-address', {})
    expect(crmApiHost).toBe('site-1')
    await waitFor(() =>
      expect(screen.getByLabelText('Capture address')).toHaveProperty('value', ADDRESS),
    )
  })

  it('reads the same address at the organization level, through the org variant', async () => {
    render(<EmailCaptureCard hostId={null} canManage ready />)
    expect(crmApiHost).toBeNull()
    await waitFor(() =>
      expect(screen.getByLabelText('Capture address')).toHaveProperty('value', ADDRESS),
    )
  })

  it('copies the address to the clipboard and says so', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<EmailCaptureCard hostId="site-1" canManage ready />)
    await screen.findByLabelText('Capture address')
    fireEvent.click(screen.getByRole('button', { name: 'Copy the capture address' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS))
    expect(enqueueSnackbar).toHaveBeenCalledWith('Address copied', expect.anything())
  })

  it('rotates only after the confirmation, and shows the new address', async () => {
    render(<EmailCaptureCard hostId="site-1" canManage ready />)
    await screen.findByLabelText('Capture address')
    fireEvent.click(screen.getByRole('button', { name: 'Rotate address' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    await waitFor(() => expect(crmApi).toHaveBeenCalledWith('inbound-address', { rotate: true }))
    await waitFor(() =>
      expect(screen.getByLabelText('Capture address')).toHaveProperty('value', ROTATED),
    )
    expect(enqueueSnackbar).toHaveBeenCalledWith('Capture address rotated', expect.anything())
  })

  it('keeps the address when the confirmation is declined', async () => {
    confirm.mockRejectedValue(new Error('declined'))
    render(<EmailCaptureCard hostId="site-1" canManage ready />)
    await screen.findByLabelText('Capture address')
    fireEvent.click(screen.getByRole('button', { name: 'Rotate address' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(crmApi).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Capture address')).toHaveProperty('value', ADDRESS)
  })

  it('shows the address to a member who may not rotate it, with Rotate disabled', async () => {
    render(<EmailCaptureCard hostId="site-1" canManage={false} ready />)
    await screen.findByLabelText('Capture address')
    expect((screen.getByRole('button', { name: 'Rotate address' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only a workspace owner or admin can rotate the address.')).toBeTruthy()
  })

  it('prints the route’s refusal rather than an empty field', async () => {
    crmApi.mockResolvedValue({ response: { ok: false }, payload: { error: 'Forbidden' } })
    render(<EmailCaptureCard hostId="site-1" canManage ready />)
    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect(screen.queryByLabelText('Capture address')).toBeNull()
  })
})
