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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OutreachMailbox } from '../model/outreach.types'
import {
  OutreachSequenceMailboxPicker,
  outreachMailboxOptionLabel,
  outreachOfferedMailboxes,
  type OutreachSequenceMailboxPickerProps,
} from './sequence-mailbox-picker'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'

/**
 * The mailbox a sequence sends from (AGL-2980): each state the Mailboxes
 * listener can be in, the mailboxes a member is offered — their own, or
 * every one for an owner or admin, never a disconnected one — and what the
 * field says about a chosen mailbox that cannot send.
 */

const mockPush = jest.fn()
const mockAvailability = jest.fn()

jest.mock('./use-outreach-mailbox-api', () => {
  const api = { availability: () => mockAvailability() }
  return { useOutreachMailboxApi: () => api }
})
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

const MAILBOXES = '/acme/outreach/mailboxes'

const mailbox = (overrides: Partial<OutreachMailbox>): OutreachMailbox =>
  ({
    id: 'mbx-mine',
    email: 'avery@example.com',
    sendAs: 'avery@example.com',
    displayName: 'Avery Quinn',
    status: 'connected',
    connectedByUid: 'uid-rep',
    ...overrides,
  }) as OutreachMailbox

const MINE = mailbox({})
const MINE_PAUSED = mailbox({
  id: 'mbx-mine-paused',
  email: 'avery.quinn@example.org',
  sendAs: 'avery.quinn@example.org',
  status: 'paused',
})
const MINE_GONE = mailbox({
  id: 'mbx-mine-gone',
  email: 'avery.q@example.net',
  sendAs: 'avery.q@example.net',
  status: 'disconnected',
})
const COLLEAGUE = mailbox({
  id: 'mbx-colleague',
  email: 'jordan@example.com',
  sendAs: 'jordan@example.com',
  displayName: 'Jordan Lee',
  connectedByUid: 'uid-colleague',
})

const ready = (list: OutreachMailbox[]): OutreachMailboxesResult => ({ status: 'ready', mailboxes: list })

const renderPicker = (props: Partial<OutreachSequenceMailboxPickerProps> = {}) => {
  const onChange = jest.fn()
  const view = render(
    <OutreachSequenceMailboxPicker
      orgId="org-1"
      uid="uid-rep"
      mailboxes={ready([MINE, MINE_PAUSED, MINE_GONE, COLLEAGUE])}
      mailboxesPath={MAILBOXES}
      value=""
      onChange={onChange}
      {...props}
    />,
  )
  return { onChange, ...view }
}

const optionNames = () => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mailbox' }))
  return screen.getAllByRole('option').map((option) => option.textContent)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAvailability.mockResolvedValue({ configured: true, canManageAll: false })
})

describe('the mailbox picker: what it shows (AGL-2980)', () => {
  it('shows progress, and a failure to read the mailboxes', () => {
    const loading = renderPicker({ mailboxes: { status: 'loading', mailboxes: [] } })
    expect(screen.getByText('Loading mailboxes…')).toBeTruthy()
    loading.unmount()
    renderPicker({ mailboxes: { status: 'error', mailboxes: [] } })
    expect(screen.getByText('The mailboxes could not be loaded. Reload the page to try again.')).toBeTruthy()
  })

  it('sends a member with no mailbox of their own to Mailboxes to connect one', async () => {
    renderPicker({ mailboxes: ready([COLLEAGUE, MINE_GONE]) })
    await waitFor(() => expect(mockAvailability).toHaveBeenCalled())
    expect(screen.getByText(/you haven’t connected one yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Connect a mailbox in Mailboxes' }))
    expect(mockPush).toHaveBeenCalledWith(MAILBOXES)
  })

  it('reads a mailbox as who mail is from, and any status that stops it sending', () => {
    expect(outreachMailboxOptionLabel(MINE)).toBe('Avery Quinn <avery@example.com>')
    expect(outreachMailboxOptionLabel(MINE_PAUSED)).toBe('Avery Quinn <avery.quinn@example.org> — Paused')
    expect(outreachMailboxOptionLabel(mailbox({ displayName: '', status: 'reconnect_required' }))).toBe(
      'avery@example.com — Reconnect required',
    )
  })
})

describe('the mailbox picker: what a member is offered (AGL-2980)', () => {
  it('offers a member their own mailboxes, never a colleague’s or a disconnected one', async () => {
    renderPicker()
    await waitFor(() => expect(mockAvailability).toHaveBeenCalled())
    expect(optionNames()).toEqual([
      'Avery Quinn <avery@example.com>',
      'Avery Quinn <avery.quinn@example.org> — Paused',
    ])
  })

  it('offers an owner or admin every connected mailbox, as the mailbox routes answer', async () => {
    mockAvailability.mockResolvedValue({ configured: true, canManageAll: true })
    renderPicker()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mailbox' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Jordan Lee <jordan@example.com>' })).toBeTruthy())
    expect(screen.queryByRole('option', { name: /avery\.q@example\.net/ })).toBeNull()
  })

  it('offers a member their own when the routes cannot say whether they may choose more', async () => {
    mockAvailability.mockRejectedValue(new Error('Sequences could not be reached. Try again.'))
    renderPicker()
    await waitFor(() => expect(mockAvailability).toHaveBeenCalled())
    expect(optionNames()).toHaveLength(2)
  })

  it('keeps the mailbox a sequence already names, whoever connected it', () => {
    expect(
      outreachOfferedMailboxes([MINE, COLLEAGUE, MINE_GONE], {
        uid: 'uid-rep',
        canManageAll: false,
        value: 'mbx-colleague',
      }).map((entry) => entry.id),
    ).toEqual(['mbx-mine', 'mbx-colleague'])
  })

  it('hands back the chosen mailbox', async () => {
    const { onChange } = renderPicker()
    await waitFor(() => expect(mockAvailability).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mailbox' }))
    fireEvent.click(screen.getByRole('option', { name: 'Avery Quinn <avery@example.com>' }))
    expect(onChange).toHaveBeenCalledWith('mbx-mine')
  })
})

describe('the mailbox picker: a chosen mailbox that cannot send (AGL-2980)', () => {
  it('says what activating needs, in the words activation refuses with', async () => {
    const paused = renderPicker({ value: 'mbx-mine-paused' })
    await waitFor(() => expect(mockAvailability).toHaveBeenCalled())
    expect(
      screen.getByText("This sequence's mailbox is paused. Resume it in Mailboxes, then activate the sequence."),
    ).toBeTruthy()
    paused.unmount()
    renderPicker({ value: 'mbx-deleted' })
    await waitFor(() => expect(mockAvailability).toHaveBeenCalledTimes(2))
    expect(
      screen.getByText("This sequence's mailbox is no longer connected. Choose another before activating it."),
    ).toBeTruthy()
  })

  it('shows the route’s issue over its own note', async () => {
    renderPicker({ value: 'mbx-mine', error: 'Only the member who connected this mailbox can send from it.' })
    await waitFor(() => expect(mockAvailability).toHaveBeenCalled())
    expect(screen.getByText('Only the member who connected this mailbox can send from it.')).toBeTruthy()
    expect(screen.queryByText(/sending hours and timezone/)).toBeNull()
  })
})
