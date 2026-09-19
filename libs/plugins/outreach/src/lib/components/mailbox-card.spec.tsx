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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OutreachMailbox } from '../model/outreach.types'
import { MAILBOX_ACTION_LABELS, MailboxCard, type MailboxCardProps } from './mailbox-card'
import type { OutreachMailboxApi } from './use-outreach-mailbox-api'

/**
 * One mailbox card (AGL-2978), in each status and for each viewer: its member,
 * an org admin looking at a teammate's, and a teammate looking at somebody
 * else's. Health reads the last seven local days; settings save only what
 * changed; pause, test and disconnect call their routes and say what
 * happened, and a refusal is shown in the route's own words.
 */

const mockEnqueueSnackbar = jest.fn()
const mockConfirm = jest.fn()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    subheader,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    subheader?: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      <p>{subheader}</p>
      <div data-testid="status">{HeaderProps?.action}</div>
      {children}
    </section>
  ),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const NOW = Date.UTC(2026, 8, 15, 15, 0)
const DAY = 24 * 60 * 60 * 1000

const base: OutreachMailbox = {
  id: 'gm_1',
  provider: 'google',
  email: 'avery@rep.example.com',
  sendAs: 'avery@rep.example.com',
  sendAsOptions: [
    { email: 'avery@rep.example.com', displayName: 'Avery Rep', isPrimary: true, isDefault: true },
    { email: 'sales@rep.example.com', displayName: 'Acme Sales', isPrimary: false, isDefault: false },
  ],
  displayName: 'Avery Rep',
  status: 'connected',
  dailyCap: 20,
  window: { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 },
  timezone: 'UTC',
  rampStartedAtMs: NOW - 3 * DAY,
  health: {
    sentToday: 0,
    sentOnDay: null,
    bounces: 0,
    replies: 0,
    lastSentAtMs: null,
    lastErrorAtMs: null,
    lastErrorCode: null,
    daily: {},
  },
  connectedByUid: 'uid-rep',
  connectedAtMs: NOW - 3 * DAY,
  createdAtMs: NOW - 3 * DAY,
  updatedAtMs: NOW - 3 * DAY,
}

function api(): jest.Mocked<OutreachMailboxApi> {
  return {
    availability: jest.fn(),
    connect: jest.fn(),
    complete: jest.fn(),
    saveSettings: jest.fn().mockResolvedValue({ ok: true, mailbox: base }),
    setPaused: jest.fn().mockResolvedValue({ ok: true, mailbox: base }),
    sendTest: jest.fn().mockResolvedValue({ ok: true, sentTo: 'avery@rep.example.com', gmailMessageId: 'm1', sentAtMs: NOW }),
    disconnect: jest.fn().mockResolvedValue({ ok: true, revocation: 'revoked' }),
  }
}

function renderCard(
  overrides: Omit<Partial<MailboxCardProps>, 'mailbox'> & { mailbox?: Partial<OutreachMailbox> } = {},
) {
  const props: MailboxCardProps = {
    isMine: true,
    canManage: true,
    api: api(),
    onReconnect: jest.fn(),
    nowMs: NOW,
    ...overrides,
    mailbox: { ...base, ...overrides.mailbox } as OutreachMailbox,
  }
  const view = render(<MailboxCard {...props} />)
  return { ...view, props }
}

const button = (name: string) => screen.queryByRole('button', { name })

beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(undefined)
})

describe('MailboxCard — status and health (AGL-2978)', () => {
  it('shows an active mailbox of the viewer’s own, with zeros and No sends yet before its first send', () => {
    renderCard()
    expect(within(screen.getByTestId('status')).getByText('Active')).toBeTruthy()
    expect(screen.getByText('Your mailbox')).toBeTruthy()
    expect(screen.getByText('No sends yet')).toBeTruthy()
    for (const label of ['Sent', 'Bounces', 'Replies']) {
      expect(screen.getByLabelText(`${label} in the last 7 days`).textContent).toBe(`0${label}`)
    }
    expect(button(MAILBOX_ACTION_LABELS.pause)).toBeTruthy()
    expect(button(MAILBOX_ACTION_LABELS.test)).toBeTruthy()
    expect(button(MAILBOX_ACTION_LABELS.disconnect)).toBeTruthy()
  })

  it('sums the last seven days of sending once there have been sends', () => {
    renderCard({
      mailbox: {
        health: {
          ...base.health,
          lastSentAtMs: NOW - DAY,
          daily: {
            '2026-09-15': { sent: 7, bounces: 1, replies: 2 },
            '2026-09-12': { sent: 5, bounces: 0, replies: 1 },
            '2026-08-01': { sent: 40, bounces: 4, replies: 4 },
          },
        },
      },
    })
    expect(screen.queryByText('No sends yet')).toBeNull()
    expect(screen.getByLabelText('Sent in the last 7 days').textContent).toBe('12Sent')
    expect(screen.getByLabelText('Bounces in the last 7 days').textContent).toBe('1Bounces')
    expect(screen.getByLabelText('Replies in the last 7 days').textContent).toBe('3Replies')
  })

  it('shows a paused mailbox with Resume, and resumes it', async () => {
    const { props } = renderCard({ mailbox: { status: 'paused' } })
    expect(within(screen.getByTestId('status')).getByText('Paused')).toBeTruthy()
    fireEvent.click(button(MAILBOX_ACTION_LABELS.resume) as HTMLElement)
    await waitFor(() => expect(props.api.setPaused).toHaveBeenCalledWith('gm_1', false))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Mailbox resumed', expect.objectContaining({ variant: 'success' }))
  })

  it('pauses an active mailbox', async () => {
    const { props } = renderCard()
    fireEvent.click(button(MAILBOX_ACTION_LABELS.pause) as HTMLElement)
    await waitFor(() => expect(props.api.setPaused).toHaveBeenCalledWith('gm_1', true))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Mailbox paused', expect.anything())
  })

  it('asks its member to reconnect a mailbox Google cut off, and offers no test or pause', () => {
    const onReconnect = jest.fn()
    renderCard({ mailbox: { status: 'reconnect_required' }, onReconnect })
    expect(within(screen.getByTestId('status')).getByText('Reconnect required')).toBeTruthy()
    expect(
      screen.getByText('Google stopped accepting this mailbox’s connection. Nothing sends from it until you connect it again.'),
    ).toBeTruthy()
    fireEvent.click(button(MAILBOX_ACTION_LABELS.reconnect) as HTMLElement)
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(button(MAILBOX_ACTION_LABELS.test)).toBeNull()
    expect(button(MAILBOX_ACTION_LABELS.pause)).toBeNull()
    expect(button(MAILBOX_ACTION_LABELS.disconnect)).toBeTruthy()
  })

  it('tells an admin looking at a teammate’s cut-off mailbox that only its member can reconnect', () => {
    renderCard({ mailbox: { status: 'reconnect_required' }, isMine: false, canManage: true })
    expect(
      screen.getByText('Google stopped accepting this mailbox’s connection. Only the member who connected it can reconnect it.'),
    ).toBeTruthy()
    expect(button(MAILBOX_ACTION_LABELS.reconnect)).toBeNull()
  })

  it('shows a disconnected mailbox as disconnected, offering its member a reconnect and nothing that sends', () => {
    const onReconnect = jest.fn()
    renderCard({ mailbox: { status: 'disconnected' }, onReconnect })
    expect(within(screen.getByTestId('status')).getByText('Disconnected')).toBeTruthy()
    expect(
      screen.getByText('This mailbox was disconnected. Nothing sends from it until you connect it again.'),
    ).toBeTruthy()
    fireEvent.click(button(MAILBOX_ACTION_LABELS.reconnect) as HTMLElement)
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(button(MAILBOX_ACTION_LABELS.test)).toBeNull()
    expect(button(MAILBOX_ACTION_LABELS.pause)).toBeNull()
    expect(button(MAILBOX_ACTION_LABELS.resume)).toBeNull()
  })
})

describe('MailboxCard — who sees what (AGL-2978)', () => {
  it('shows a teammate’s mailbox read-only to a member who cannot manage it', () => {
    renderCard({ isMine: false, canManage: false })
    expect(screen.getByText('A teammate’s mailbox')).toBeTruthy()
    expect(
      screen.getByText('Sends as Avery Rep <avery@rep.example.com>, at most 20 a day, Mon, Tue, Wed, Thu, Fri 9:00–17:00 (UTC).'),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Daily cap')).toBeNull()
    for (const name of Object.values(MAILBOX_ACTION_LABELS)) expect(button(name)).toBeNull()
  })

  it('lets an org admin change, pause and disconnect a teammate’s mailbox, but not send a test from it', () => {
    renderCard({ isMine: false, canManage: true })
    expect(screen.getByLabelText('Daily cap')).toBeTruthy()
    expect(button(MAILBOX_ACTION_LABELS.pause)).toBeTruthy()
    expect(button(MAILBOX_ACTION_LABELS.disconnect)).toBeTruthy()
    expect(button(MAILBOX_ACTION_LABELS.test)).toBeNull()
  })
})

describe('MailboxCard — settings (AGL-2978)', () => {
  it('shows the ramp and today’s limit under the cap', () => {
    renderCard()
    expect(
      screen.getByText('Warm-up: week 1: 10 · week 2: 20 · week 3+: 30 a day, never above the cap. Today’s limit: 10.'),
    ).toBeTruthy()
  })

  it('saves only the fields that changed', async () => {
    const { props } = renderCard()
    const save = button(MAILBOX_ACTION_LABELS.save) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '35' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Avery at Acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Saturday' }))
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() =>
      expect(props.api.saveSettings).toHaveBeenCalledWith({
        mailboxId: 'gm_1',
        displayName: 'Avery at Acme',
        dailyCap: 35,
        window: { days: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1020 },
      }),
    )
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Mailbox settings saved', expect.objectContaining({ variant: 'success' }))
  })

  it('refuses a cap over 50 and a window with no days before anything is sent', () => {
    renderCard()
    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '80' } })
    expect(screen.getByText('The daily cap must be a whole number from 1 to 50.')).toBeTruthy()
    expect((button(MAILBOX_ACTION_LABELS.save) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '20' } })
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      fireEvent.click(screen.getByRole('button', { name: day }))
    }
    expect(screen.getByText('Choose at least one day to send on.')).toBeTruthy()
    expect((button(MAILBOX_ACTION_LABELS.save) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the edit and prints the route’s refusal when a save is refused', async () => {
    const { props } = renderCard()
    ;(props.api.saveSettings as jest.Mock).mockRejectedValue(new Error('Choose a timezone from the list.'))
    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '30' } })
    fireEvent.click(button(MAILBOX_ACTION_LABELS.save) as HTMLElement)
    expect(await screen.findByText('Choose a timezone from the list.')).toBeTruthy()
    expect((screen.getByLabelText('Daily cap') as HTMLInputElement).value).toBe('30')
  })
})

describe('MailboxCard — test and disconnect (AGL-2978)', () => {
  it('sends a test and says where it went', async () => {
    const { props } = renderCard()
    fireEvent.click(button(MAILBOX_ACTION_LABELS.test) as HTMLElement)
    await waitFor(() => expect(props.api.sendTest).toHaveBeenCalledWith('gm_1'))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Test sent to avery@rep.example.com. Check your inbox.',
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('prints the route’s words when a test fails', async () => {
    const { props } = renderCard()
    ;(props.api.sendTest as jest.Mock).mockRejectedValue(new Error('Google refused this mailbox’s access. Connect it again.'))
    fireEvent.click(button(MAILBOX_ACTION_LABELS.test) as HTMLElement)
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Google refused this mailbox’s access. Connect it again.',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
  })

  it('disconnects only after the confirmation, and says when Google could not confirm the revocation', async () => {
    const { props } = renderCard()
    ;(props.api.disconnect as jest.Mock).mockResolvedValue({ ok: true, revocation: 'failed' })
    fireEvent.click(button(MAILBOX_ACTION_LABELS.disconnect) as HTMLElement)
    await waitFor(() => expect(props.api.disconnect).toHaveBeenCalledWith('gm_1'))
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnect this mailbox?' }))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('Google could not confirm the access was revoked'),
      expect.objectContaining({ variant: 'warning' }),
    )
  })

  it('says a disconnect left Google access in place for another mailbox on the account', async () => {
    const { props } = renderCard()
    ;(props.api.disconnect as jest.Mock).mockResolvedValue({ ok: true, revocation: 'kept-for-other-mailbox' })
    fireEvent.click(button(MAILBOX_ACTION_LABELS.disconnect) as HTMLElement)
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Mailbox disconnected. Google access stays in place for another connected mailbox on the same account.',
        expect.anything(),
      ),
    )
  })

  it('keeps the mailbox when the confirmation is declined', async () => {
    mockConfirm.mockRejectedValue(new Error('declined'))
    const { props } = renderCard()
    fireEvent.click(button(MAILBOX_ACTION_LABELS.disconnect) as HTMLElement)
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(props.api.disconnect).not.toHaveBeenCalled()
  })
})
