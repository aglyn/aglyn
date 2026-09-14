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
 * Your sending addresses (AGL-2975): the member's own list, read from the
 * core route once the scope is known; an address added shows "Verification
 * email sent" until the member opens the link, which this card redeems and
 * then shows as verified; a verified address is removed only after a
 * confirmation. The hook is REAL — the route is the fake.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  SENDING_ADDRESSES_EXPLANATION,
  SendingAddressesCard,
  VERIFICATION_SENT_LABEL,
  VERIFIED_LABEL,
} from './sending-addresses-card'

interface Row {
  address: string
  addedAtMs: number
  verified: boolean
  verifiedAtMs: number | null
}

let rows: Row[] = []
const requests: Array<{ method: string; url: string; body: Record<string, any> | null }> = []
let refuseAdd: string | null = null

const json = (status: number, payload: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as unknown as Response

const mockAuthorizedFetch = jest.fn(async (_user: unknown, url: string, init: RequestInit = {}) => {
  const method = String(init.method ?? 'GET')
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, any>) : null
  requests.push({ method, url, body })
  if (method === 'GET') return json(200, { aliases: rows, signInEmail: 'zach@aglyn.com' })
  if (method === 'DELETE') {
    rows = rows.filter((row) => row.address !== body?.['address'])
    return json(200, { ok: true })
  }
  switch (body?.['action']) {
    case 'add': {
      if (refuseAdd) return json(400, { error: refuseAdd, reason: 'sign-in-address' })
      const row = { address: String(body['address']).trim().toLowerCase(), addedAtMs: rows.length + 1, verified: false, verifiedAtMs: null }
      rows = [...rows, row]
      return json(200, { ok: true, alias: row, sent: true })
    }
    case 'resend':
      return json(200, { ok: true, sent: true })
    case 'confirm':
      rows = rows.map((row) =>
        row.address === 'zach@aglyn.io' ? { ...row, verified: true, verifiedAtMs: 99 } : row,
      )
      return json(200, { ok: true, orgId: 'org-1', address: 'zach@aglyn.io', alreadyConfirmed: false })
    default:
      return json(400, { error: 'Unknown action' })
  }
})

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: [unknown, string, RequestInit]) => mockAuthorizedFetch(...args),
}))
// One user object for every render: a fresh object per render would re-run
// every effect that depends on it.
const mockUser = { uid: 'u-zach', getIdToken: async () => 'token' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
const confirm = jest.fn()
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
  useConfirmationContext: () => ({ confirm }),
}))
jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => undefined,
}))

const list = () => screen.getByRole('list', { name: 'Your sending addresses' })
const rowOf = (address: string) =>
  within(list())
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(address)) as HTMLElement

beforeEach(() => {
  jest.clearAllMocks()
  rows = []
  requests.length = 0
  refuseAdd = null
  confirm.mockResolvedValue(undefined)
  window.history.replaceState({}, '', '/acme/crm/settings')
})

describe('SendingAddressesCard (AGL-2975)', () => {
  it('asks for the list only once the scope is ready, and says what the list is for', async () => {
    const { rerender } = render(<SendingAddressesCard orgId={null} ready={false} />)
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    rerender(<SendingAddressesCard orgId="org-1" ready />)
    await waitFor(() => expect(requests[0]).toMatchObject({ method: 'GET' }))
    expect(requests[0].url).toBe('/api/orgs/members/email-aliases?orgId=org-1')
    expect(screen.getByText(SENDING_ADDRESSES_EXPLANATION)).toBeTruthy()
    expect(
      await screen.findByText('You sign in as zach@aglyn.com, which already counts as yours.'),
    ).toBeTruthy()
  })

  it('prints each address with its state: verification sent, or verified', async () => {
    rows = [
      { address: 'zach@aglyn.io', addedAtMs: 1, verified: false, verifiedAtMs: null },
      { address: 'outreach@aglyn.io', addedAtMs: 2, verified: true, verifiedAtMs: 3 },
    ]
    render(<SendingAddressesCard orgId="org-1" ready />)
    await screen.findByText('zach@aglyn.io')
    expect(within(rowOf('zach@aglyn.io')).getByText(VERIFICATION_SENT_LABEL)).toBeTruthy()
    expect(
      within(rowOf('zach@aglyn.io')).getByRole('button', {
        name: 'Resend the verification email to zach@aglyn.io',
      }),
    ).toBeTruthy()
    expect(within(rowOf('outreach@aglyn.io')).getByText(VERIFIED_LABEL)).toBeTruthy()
    expect(within(rowOf('outreach@aglyn.io')).queryByRole('button', { name: /Resend/ })).toBeNull()
  })

  it('adds an address with the page it was added on, then shows it waiting for verification', async () => {
    render(<SendingAddressesCard orgId="org-1" ready />)
    const field = await screen.findByLabelText('Add an address you send from')
    await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false))
    fireEvent.change(field, { target: { value: 'Zach@Aglyn.io' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith(VERIFICATION_SENT_LABEL, expect.anything()))
    expect(requests.find((entry) => entry.body?.['action'] === 'add')?.body).toEqual({
      orgId: 'org-1',
      action: 'add',
      address: 'Zach@Aglyn.io',
      returnPath: '/acme/crm/settings',
    })
    expect(within(await waitFor(() => rowOf('zach@aglyn.io'))).getByText(VERIFICATION_SENT_LABEL)).toBeTruthy()
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('prints the route’s refusal and keeps what was typed', async () => {
    refuseAdd = 'That is the address you sign in with, which already counts as yours.'
    render(<SendingAddressesCard orgId="org-1" ready />)
    const field = await screen.findByLabelText('Add an address you send from')
    await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false))
    fireEvent.change(field, { target: { value: 'zach@aglyn.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(refuseAdd, expect.objectContaining({ variant: 'error' })),
    )
    expect((field as HTMLInputElement).value).toBe('zach@aglyn.com')
  })

  it('redeems a verification link once, takes the token out of the address bar, and shows the address verified', async () => {
    rows = [{ address: 'zach@aglyn.io', addedAtMs: 1, verified: false, verifiedAtMs: null }]
    window.history.replaceState({}, '', '/acme/crm/settings?confirmEmailAlias=mea1.abc.def&tab=capture')
    render(<SendingAddressesCard orgId="org-1" ready />)
    await waitFor(() =>
      expect(requests.find((entry) => entry.body?.['action'] === 'confirm')?.body).toEqual({
        action: 'confirm',
        token: 'mea1.abc.def',
      }),
    )
    expect(window.location.search).toBe('?tab=capture')
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith('zach@aglyn.io verified', expect.anything()),
    )
    await waitFor(() => expect(within(rowOf('zach@aglyn.io')).getByText(VERIFIED_LABEL)).toBeTruthy())
    expect(requests.filter((entry) => entry.body?.['action'] === 'confirm')).toHaveLength(1)
  })

  it('re-sends a verification email for an address waiting on one', async () => {
    rows = [{ address: 'zach@aglyn.io', addedAtMs: 1, verified: false, verifiedAtMs: null }]
    render(<SendingAddressesCard orgId="org-1" ready />)
    const resend = await screen.findByRole('button', {
      name: 'Resend the verification email to zach@aglyn.io',
    })
    await waitFor(() => expect((resend as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(resend)
    await waitFor(() =>
      expect(requests.find((entry) => entry.body?.['action'] === 'resend')?.body).toMatchObject({
        action: 'resend',
        address: 'zach@aglyn.io',
      }),
    )
  })

  it('removes a waiting address at once, and a verified one only after the confirmation', async () => {
    rows = [
      { address: 'zach@aglyn.io', addedAtMs: 1, verified: false, verifiedAtMs: null },
      { address: 'outreach@aglyn.io', addedAtMs: 2, verified: true, verifiedAtMs: 3 },
    ]
    render(<SendingAddressesCard orgId="org-1" ready />)
    const removeWaiting = await screen.findByRole('button', { name: 'Remove zach@aglyn.io' })
    await waitFor(() => expect((removeWaiting as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(removeWaiting)
    await waitFor(() => expect(screen.queryByText('zach@aglyn.io')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()

    confirm.mockRejectedValueOnce(new Error('declined'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove outreach@aglyn.io' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(requests.filter((entry) => entry.method === 'DELETE')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Remove outreach@aglyn.io' }))
    await waitFor(() => expect(screen.queryByText('outreach@aglyn.io')).toBeNull())
    expect(requests.filter((entry) => entry.method === 'DELETE').map((entry) => entry.body)).toEqual([
      { orgId: 'org-1', address: 'zach@aglyn.io' },
      { orgId: 'org-1', address: 'outreach@aglyn.io' },
    ])
  })
})
