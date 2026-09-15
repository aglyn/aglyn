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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OutreachMailbox } from '../model/outreach.types'
import { CONNECT_WITH_GOOGLE_LABEL, OutreachMailboxesSection } from './mailboxes-section'

/**
 * The Mailboxes section (AGL-2978), in every state it can be in: loading,
 * not configured, refused, empty, listing the viewer's and a teammate's
 * mailboxes, starting a connect, and coming back from Google — finished,
 * failed, or refused on the consent screen. The routes and the mailbox list
 * are stubbed at the section's two hooks; each card is stubbed to the props
 * it was handed, and the card's own states are `mailbox-card.spec.tsx`.
 */

const mockApi = {
  availability: jest.fn(),
  connect: jest.fn(),
  complete: jest.fn(),
  saveSettings: jest.fn(),
  setPaused: jest.fn(),
  sendTest: jest.fn(),
  disconnect: jest.fn(),
}
let mockListed: { status: 'loading' | 'ready' | 'error'; mailboxes: OutreachMailbox[] }
const mockEnqueueSnackbar = jest.fn()

jest.mock('./use-outreach-mailbox-api', () => ({
  useOutreachMailboxApi: () => mockApi,
}))
jest.mock('./use-outreach-mailboxes', () => ({
  useOutreachMailboxes: () => mockListed,
}))
jest.mock('./mailbox-card', () => ({
  MailboxCard: (props: { mailbox: OutreachMailbox; isMine: boolean; canManage: boolean }) => (
    <article aria-label={`Mailbox ${props.mailbox.email}`}>
      {`mine:${props.isMine} manage:${props.canManage}`}
    </article>
  ),
}))
// ONE account object for every render, as the real hook holds the signed-in
// user in state. A fresh object per call would re-run every effect keyed on
// the account and hang the suite rather than fail it.
const mockUser = { data: { uid: 'uid-rep' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: { children: ReactNode; header: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: ({ label, description, action }: { label: ReactNode; description?: ReactNode; action?: ReactNode }) => (
    <div role="note">
      <p>{label}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  ),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const mailbox = (id: string, email: string, connectedByUid: string): OutreachMailbox =>
  ({ id, email, connectedByUid, status: 'connected' }) as OutreachMailbox

const setHash = (hash: string) => window.history.replaceState(null, '', `/acme/outreach/mailboxes${hash}`)

beforeEach(() => {
  jest.clearAllMocks()
  setHash('')
  mockListed = { status: 'ready', mailboxes: [] }
  mockApi.availability.mockResolvedValue({ configured: true, canManageAll: false })
})

describe('OutreachMailboxesSection — what it shows (AGL-2978)', () => {
  it('shows progress while the mailboxes load', async () => {
    mockListed = { status: 'loading', mailboxes: [] }
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(screen.getByRole('status').textContent).toContain('Loading mailboxes…')
    await waitFor(() => expect(mockApi.availability).toHaveBeenCalled())
  })

  it('offers Connect with Google on an empty organization', async () => {
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(screen.getByText('No mailboxes connected')).toBeTruthy()
    const button = await screen.findByRole('button', { name: CONNECT_WITH_GOOGLE_LABEL })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByText('Connect your Google mailbox to send sequences from your own address.')).toBeTruthy()
  })

  it('says the deployment is not configured, and offers no connect', async () => {
    mockApi.availability.mockResolvedValue({ configured: false, canManageAll: false })
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(await screen.findByText('Connecting a Google mailbox is not configured on this deployment.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: CONNECT_WITH_GOOGLE_LABEL })).toBeNull()
  })

  it('prints the route’s refusal when availability is refused', async () => {
    mockApi.availability.mockRejectedValue(new Error('Your role does not include Use Outreach.'))
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(await screen.findByText('Your role does not include Use Outreach.')).toBeTruthy()
  })

  it('says so when the mailboxes cannot be read', async () => {
    mockListed = { status: 'error', mailboxes: [] }
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(await screen.findByText('The mailboxes could not be loaded. Reload the page to try again.')).toBeTruthy()
  })

  it('lists the viewer’s mailboxes first, and lets only an admin manage a teammate’s', async () => {
    mockListed = {
      status: 'ready',
      mailboxes: [mailbox('gm_2', 'kim@rep.example.com', 'uid-teammate'), mailbox('gm_1', 'avery@rep.example.com', 'uid-rep')],
    }
    const { unmount } = render(<OutreachMailboxesSection orgId="org-1" />)
    await waitFor(() => expect(mockApi.availability).toHaveBeenCalled())
    const cards = screen.getAllByRole('article')
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Mailbox avery@rep.example.com',
      'Mailbox kim@rep.example.com',
    ])
    expect(cards.map((card) => card.textContent)).toEqual(['mine:true manage:true', 'mine:false manage:false'])
    unmount()

    mockApi.availability.mockResolvedValue({ configured: true, canManageAll: true })
    render(<OutreachMailboxesSection orgId="org-1" />)
    await waitFor(() =>
      expect(screen.getByLabelText('Mailbox kim@rep.example.com').textContent).toBe('mine:false manage:true'),
    )
  })
})

describe('OutreachMailboxesSection — connecting (AGL-2978)', () => {
  it('sends the browser to Google’s consent address', async () => {
    const navigate = jest.fn()
    mockApi.connect.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?state=s')
    render(<OutreachMailboxesSection orgId="org-1" navigate={navigate} />)
    const button = await screen.findByRole('button', { name: CONNECT_WITH_GOOGLE_LABEL })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=s'))
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays put and says why when the connect is refused', async () => {
    const navigate = jest.fn()
    mockApi.connect.mockRejectedValue(new Error('Connecting a Google mailbox is not configured on this deployment.'))
    render(<OutreachMailboxesSection orgId="org-1" navigate={navigate} />)
    const button = await screen.findByRole('button', { name: CONNECT_WITH_GOOGLE_LABEL })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Connecting a Google mailbox is not configured on this deployment.',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    expect(navigate).not.toHaveBeenCalled()
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('OutreachMailboxesSection — coming back from Google (AGL-2978)', () => {
  it('takes the code out of the address bar, finishes the connect and says what connected', async () => {
    let finish: (value: unknown) => void = () => undefined
    mockApi.complete.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    setHash('#outreachConnect=code&code=4%2F0Ab-c&state=os1.p.s')
    render(<OutreachMailboxesSection orgId="org-1" />)

    expect(await screen.findByText('Finishing the connection…')).toBeTruthy()
    expect(window.location.hash).toBe('')
    expect(mockApi.complete).toHaveBeenCalledWith(expect.objectContaining({ code: '4/0Ab-c', state: 'os1.p.s' }))
    expect(typeof mockApi.complete.mock.calls[0][0].timezone).toBe('string')

    await act(async () =>
      finish({ ok: true, created: true, confirmedAliases: ['sales@rep.example.com'], mailbox: { email: 'avery@rep.example.com' } }),
    )
    expect(await screen.findByText('Connected avery@rep.example.com. Verified sales@rep.example.com as your own.')).toBeTruthy()
    expect(mockApi.complete).toHaveBeenCalledTimes(1)
  })

  it('says a reconnect reconnected', async () => {
    mockApi.complete.mockResolvedValue({ ok: true, created: false, confirmedAliases: [], mailbox: { email: 'avery@rep.example.com' } })
    setHash('#outreachConnect=code&code=c&state=s')
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(await screen.findByText('Reconnected avery@rep.example.com.')).toBeTruthy()
  })

  it('prints the route’s refusal when the connect cannot be finished', async () => {
    mockApi.complete.mockRejectedValue(
      new Error('This connection was started by another member. Sign in as that member, or connect the mailbox again.'),
    )
    setHash('#outreachConnect=code&code=c&state=s')
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(
      await screen.findByText('This connection was started by another member. Sign in as that member, or connect the mailbox again.'),
    ).toBeTruthy()
  })

  it('explains a consent Google did not grant, and one that took too long, without calling the route', async () => {
    setHash('#outreachConnect=error&reason=access_denied')
    const { unmount } = render(<OutreachMailboxesSection orgId="org-1" />)
    expect(await screen.findByText('Google access was not granted, so no mailbox was connected.')).toBeTruthy()
    expect(window.location.hash).toBe('')
    unmount()

    setHash('#outreachConnect=error&reason=expired')
    render(<OutreachMailboxesSection orgId="org-1" />)
    expect(await screen.findByText('The connection took too long. Connect the mailbox again.')).toBeTruthy()
    expect(mockApi.complete).not.toHaveBeenCalled()
  })

  it('leaves an unrelated fragment alone', async () => {
    setHash('#section-2')
    render(<OutreachMailboxesSection orgId="org-1" />)
    await waitFor(() => expect(mockApi.availability).toHaveBeenCalled())
    expect(window.location.hash).toBe('#section-2')
    expect(mockApi.complete).not.toHaveBeenCalled()
  })
})
