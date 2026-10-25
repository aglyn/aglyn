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
 * The staff Site Care card on a support thread (AGL-4031): an emailed request
 * from a sender in several Site Care workspaces names the others ("Also a
 * member of"), and offers "Move to workspace" while the request may move.
 * When it may not, the action stays on the card, disabled, with the reason.
 * A request with no other workspace shows neither.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockCall = jest.fn()
jest.mock('./site-care-api', () => ({
  __esModule: true,
  useSiteCareCall: () => mockCall,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: (props: { header: string; HeaderProps?: { action?: ReactNode }; children: ReactNode }) => (
    <section aria-label={props.header}>
      <div data-testid="card-actions">{props.HeaderProps?.action}</div>
      {props.children}
    </section>
  ),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('../../constants/docs-links', () => ({ __esModule: true, docsHelp: () => null }))

jest.mock('./site-care-history-list.component', () => ({
  __esModule: true,
  default: () => null,
}))

import SiteCareRequestPanel from './site-care-request-panel.component'

const REQUEST = {
  source: 'email',
  hostId: null,
  requesterEmail: 'owner@example.com',
  state: 'open',
  month: '2026-10',
  timerStartedAtMs: null,
  timerStartedByUid: null,
  closedAtMs: null,
  minutesLogged: null,
  timerMinutes: null,
  countedMinutes: 0,
  includedMinutesUsed: 0,
  overMinutes: 0,
  billedHours: 0,
  absorbed: false,
  approval: null,
  charge: null,
  chargeSeq: 0,
  publish: null,
}

const RENTALS = { orgId: 'org-2', name: 'Acme Rentals', uid: 'owner-1' }

function panel(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: 't1',
    orgId: 'org-1',
    subject: 'Swap the photo',
    request: REQUEST,
    history: [],
    suggestedMinutes: 5,
    monthMinutesLeft: 60,
    otherWorkspaces: [RENTALS],
    moveBlockedReason: null,
    ...overrides,
  }
}

function answerWith(body: Record<string, unknown>) {
  mockCall.mockImplementation(async (_path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    if (init?.method === 'POST') return { ok: true, status: 200, body: {} }
    return { ok: true, status: 200, body }
  })
}

beforeEach(() => {
  mockCall.mockReset()
})

describe('SiteCareRequestPanel: a sender in several workspaces', () => {
  it('names the other workspaces and moves the request to the one staff choose', async () => {
    answerWith(panel())
    render(<SiteCareRequestPanel ticketId="t1" />)
    expect(await screen.findByText('Also a member of: Acme Rentals')).toBeTruthy()
    const move = within(screen.getByTestId('card-actions')).getByRole('button', { name: 'Move to workspace' })
    expect((move as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(move)
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
    await waitFor(() =>
      expect(mockCall).toHaveBeenCalledWith('/api/admin/site-care', {
        method: 'POST',
        body: { ticketId: 't1', action: 'move', orgId: 'org-2' },
      }),
    )
  })

  it('keeps the action on the card, disabled with the reason, when the request may not move', async () => {
    const reason = 'This request is finished, so it stays on the workspace its time counted against.'
    answerWith(panel({ request: { ...REQUEST, state: 'closed', closedAtMs: 1 }, moveBlockedReason: reason }))
    render(<SiteCareRequestPanel ticketId="t1" />)
    const move = await screen.findByRole('button', { name: 'Move to workspace' })
    expect((move as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText(reason)).toBeTruthy()
    expect(screen.getByText('Also a member of: Acme Rentals')).toBeTruthy()
  })

  it('shows neither for a request whose sender is in one workspace', async () => {
    answerWith(panel({ otherWorkspaces: [], moveBlockedReason: null }))
    render(<SiteCareRequestPanel ticketId="t1" />)
    expect(await screen.findByRole('button', { name: 'Close with minutes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Move to workspace' })).toBeNull()
    expect(screen.queryByText(/Also a member of/)).toBeNull()
  })
})
