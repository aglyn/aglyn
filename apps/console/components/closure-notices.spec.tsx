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
 * The delete-workspace and close-account screens say what the closure will
 * change before the confirm (AGL-4038): every notice a plugin answered, with
 * what it applies to, a note when one could not be read, and nothing at all
 * when there is nothing to say — and the confirm is never held back.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'owner-1', getIdToken: async () => 'tok' } }),
  useFirestore: () => ({}),
}))

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', orgName: 'Acme Builders', slug: 'acme' } }),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { name: 'Acme Builders' }, ready: true }),
}))

jest.mock('./data-export-card.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./billing/retention-funnel.dialog', () => ({ RetentionFunnelDialog: () => null }))

import { ClosureNotices, CLOSURE_NOTICES_UNAVAILABLE } from './closure-notices.component'
import { CloseAccountCard } from './close-account-card.component'
import { OrgDeleteCard } from './settings/org-delete-card.component'

const ORDERS_NOTICE = {
  pluginId: 'commerce',
  id: 'hardware-orders',
  severity: 'warning',
  title: '2 card reader orders will be canceled and refunded',
  body: 'They have not shipped. Each is refunded in full to the card it was paid with.',
  items: [
    { id: 'o1', primary: 'Order HW-3F9A21', secondary: 'Stripe Reader S710 × 1', amount: '$324.75' },
    { id: 'o2', primary: 'Order HW-77B0C2', secondary: 'Stripe Reader M2 × 2', amount: '$135.30' },
  ],
}

const answer = (body: unknown, ok = true) => ({ ok, json: async () => body })

const user = { uid: 'owner-1' } as never

describe('ClosureNotices', () => {
  beforeEach(() => mockFetch.mockReset())

  it('asks about the workspace and draws each notice with what it applies to', async () => {
    mockFetch.mockResolvedValue(answer({ notices: [ORDERS_NOTICE], unavailable: [] }))
    render(<ClosureNotices user={user} subject="workspace" orgId="org-1" />)
    expect(await screen.findByText(ORDERS_NOTICE.title)).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledWith(user, '/api/closure-notices?subject=workspace&orgId=org-1')
    expect(screen.getByText('Order HW-3F9A21')).toBeTruthy()
    expect(screen.getByText('Stripe Reader M2 × 2')).toBeTruthy()
    expect(screen.getByText('$324.75')).toBeTruthy()
    expect(screen.queryByText(CLOSURE_NOTICES_UNAVAILABLE)).toBeNull()
  })

  it('says so when a notice could not be read, or the question failed', async () => {
    mockFetch.mockResolvedValueOnce(answer({ notices: [], unavailable: ['commerce'] }))
    const { unmount } = render(<ClosureNotices user={user} subject="account" />)
    expect(await screen.findByText(CLOSURE_NOTICES_UNAVAILABLE)).toBeTruthy()
    unmount()
    mockFetch.mockResolvedValueOnce(answer({ error: 'down' }, false))
    render(<ClosureNotices user={user} subject="account" />)
    expect(await screen.findByText(CLOSURE_NOTICES_UNAVAILABLE)).toBeTruthy()
  })

  it('draws nothing when nothing changes', async () => {
    mockFetch.mockResolvedValue(answer({ notices: [], unavailable: [] }))
    const { container } = render(<ClosureNotices user={user} subject="account" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.querySelector('[data-closure-notices]')).toBeNull()
  })
})

describe('the delete-workspace screen', () => {
  beforeEach(() => mockFetch.mockReset())

  it('warns about what deleting it will cancel and refund, above a confirm it does not hold back', async () => {
    mockFetch.mockResolvedValue(answer({ notices: [ORDERS_NOTICE], unavailable: [] }))
    render(<OrgDeleteCard />)
    expect(await screen.findByText(ORDERS_NOTICE.title)).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledWith(expect.anything(), '/api/closure-notices?subject=workspace&orgId=org-1')
    const button = screen.getByRole('button', { name: 'Delete organization' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Type "Acme Builders" to confirm'), { target: { value: 'Acme Builders' } })
    expect(button.disabled).toBe(false)
  })
})

describe('the close-account screen', () => {
  beforeEach(() => mockFetch.mockReset())

  it('warns about what closing it will cancel and refund once the dialog opens, and still lets it close', async () => {
    mockFetch.mockResolvedValue(answer({ notices: [ORDERS_NOTICE], unavailable: [] }))
    render(<CloseAccountCard user={{ uid: 'person-1', providerData: [] } as never} hasPassword />)
    expect(mockFetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close account' }))
    expect(await screen.findByText(ORDERS_NOTICE.title)).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ uid: 'person-1' }), '/api/closure-notices?subject=account')
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } })
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    const confirm = screen.getByRole('button', { name: 'Close account permanently' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
  })
})
