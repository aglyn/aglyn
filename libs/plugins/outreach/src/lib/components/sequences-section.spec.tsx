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
import type { OutreachMailbox, OutreachSequence } from '../model/outreach.types'
import { OutreachSequencesSection } from './sequences-section'
import type { OutreachLoad, OutreachSequenceCounts } from './use-outreach-data'

/**
 * The Sequences section (AGL-2980): the list in each state it can be in —
 * loading, failed, refused, empty, and listing sequences with their mailbox,
 * status and counts — and the pages below it the path selects. The reads are
 * stubbed at the section's hooks; the editor and the detail page are stubbed
 * to the props they were handed, and have specs of their own.
 */

let mockSequences: OutreachLoad<OutreachSequence[]>
let mockCounts: Record<string, OutreachSequenceCounts>
const mockPush = jest.fn()
const mockMailboxes: { status: 'ready'; mailboxes: OutreachMailbox[] } = {
  status: 'ready',
  mailboxes: [
    {
      id: 'mbx-1',
      email: 'rep@example.com',
      sendAs: 'avery@example.com',
    } as OutreachMailbox,
  ],
}

jest.mock('./use-outreach-data', () => ({
  useOutreachSequences: () => mockSequences,
  useOutreachSequenceCounts: () => mockCounts,
}))
jest.mock('./use-outreach-mailboxes', () => ({
  useOutreachMailboxes: () => mockMailboxes,
}))
jest.mock('./use-outreach-settings', () => ({
  useOutreachComplianceSettings: () => ({
    status: 'ready',
    settings: null,
    message: null,
    reload: jest.fn(),
  }),
}))
jest.mock('./use-outreach-api', () => ({ useOutreachApi: () => ({}) }))
jest.mock('./sequence-editor', () => ({
  OutreachSequenceEditor: (props: {
    sequence: unknown
    onSaved(sequence: { id: string }): void
  }) => (
    <div role="form" aria-label="Sequence editor">
      {props.sequence ? 'editing' : 'new'}
      <button onClick={() => props.onSaved({ id: 'seq-new' })}>Saved</button>
    </div>
  ),
}))
jest.mock('./sequence-detail', () => ({
  OutreachSequenceDetail: (props: { sequenceId: string; tab: string }) => (
    <div
      role="article"
      aria-label="Sequence detail"
    >{`${props.sequenceId}:${props.tab}`}</div>
  ),
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
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
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const sequence = (
  id: string,
  name: string,
  status: OutreachSequence['status'],
  mailboxId = 'mbx-1',
) =>
  ({
    id,
    name,
    status,
    mailboxId,
    hostId: 'host-1',
    steps: [],
    createdAtMs: 1,
    updatedAtMs: 1,
  }) as unknown as OutreachSequence

const SECTION = '/acme/outreach/sequences'
const renderSection = (subpath: string[] = []) =>
  render(
    <OutreachSequencesSection
      orgId="org-1"
      sectionPath={SECTION}
      subpath={subpath}
      mailboxesPath="/acme/outreach/mailboxes"
      compliancePath="/acme/outreach/compliance"
    />,
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockSequences = { status: 'ready', data: [] }
  mockCounts = {}
})

describe('the sequence list (AGL-2980)', () => {
  it('shows progress while the sequences load', () => {
    mockSequences = { status: 'loading', data: [] }
    renderSection()
    expect(screen.getByRole('status').textContent).toContain(
      'Loading sequences',
    )
  })

  it('says the sequences could not be loaded, and says a refusal as information', () => {
    mockSequences = { status: 'error', data: [] }
    const { unmount } = renderSection()
    expect(
      screen.getByText(
        'The sequences could not be loaded. Reload the page to try again.',
      ),
    ).toBeTruthy()
    unmount()
    mockSequences = { status: 'refused', data: [] }
    renderSection()
    expect(
      screen.getByText(
        /Ask an organization owner or admin for the Use Sequences permission/,
      ),
    ).toBeTruthy()
  })

  it('offers a new sequence from the empty state, and nowhere above an empty list', () => {
    renderSection()
    expect(screen.getByText('No sequences yet')).toBeTruthy()
    const buttons = screen.getAllByRole('link', { name: 'New sequence' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(mockPush).toHaveBeenCalledWith(`${SECTION}/new`)
  })

  it('lists each sequence with its mailbox, status and counts, and opens one on a click', () => {
    mockSequences = {
      status: 'ready',
      data: [
        sequence('seq-1', 'Second locations', 'active'),
        sequence('seq-2', 'Win-back', 'draft', 'mbx-gone'),
      ],
    }
    mockCounts = {
      'seq-1': { enrolled: 12, active: 7, replied: 3, bounced: 1, optedOut: 1 },
    }
    renderSection()
    const grid = screen.getByRole('grid', { name: 'Sequences' })
    const first = within(grid)
      .getByRole('gridcell', { name: 'Second locations' })
      .closest('[role="row"]') as HTMLElement
    expect(within(first).getByText('avery@example.com')).toBeTruthy()
    expect(within(first).getByText('Active')).toBeTruthy()
    expect(within(first).getByText('12')).toBeTruthy()
    expect(within(first).getByText('7')).toBeTruthy()
    const second = within(grid)
      .getByRole('gridcell', { name: 'Win-back' })
      .closest('[role="row"]') as HTMLElement
    expect(within(second).getByText('Mailbox removed')).toBeTruthy()
    expect(within(second).getByText('Draft')).toBeTruthy()
    fireEvent.click(
      within(grid).getByRole('gridcell', { name: 'Second locations' }),
    )
    expect(mockPush).toHaveBeenCalledWith(`${SECTION}/seq-1`)
    // With sequences listed, New sequence sits in the header.
    expect(screen.getByRole('link', { name: 'New sequence' })).toBeTruthy()
  })
})

describe('the sequence list filters through the grid (AGL-3317)', () => {
  it('searches every sequence it read, not only the page on screen', async () => {
    mockSequences = {
      status: 'ready',
      data: Array.from({ length: 12 }, (_unused, at) =>
        sequence(`seq-${at}`, at === 11 ? 'Renewal nudge' : `Outbound ${at}`, 'active'),
      ),
    }
    renderSection()
    const grid = screen.getByRole('grid', { name: 'Sequences' })
    // Page one holds ten; the twelfth is past it.
    expect(grid.textContent).not.toContain('Renewal nudge')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'renewal' } })
    await waitFor(() => {
      expect(screen.getByRole('grid', { name: 'Sequences' }).textContent).toContain('Renewal nudge')
      expect(screen.getByRole('grid', { name: 'Sequences' }).textContent).not.toContain('Outbound 1')
    })
  })
})

describe('the pages below the section (AGL-2980)', () => {
  it('opens the editor for a new sequence, and goes to it once saved', () => {
    renderSection(['new'])
    expect(
      screen.getByRole('form', { name: 'Sequence editor' }).textContent,
    ).toContain('new')
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }))
    expect(mockPush).toHaveBeenCalledWith(`${SECTION}/seq-new`)
  })

  it('opens a sequence on its steps, and on its enrollments', () => {
    const { unmount } = renderSection(['seq-1'])
    expect(
      screen.getByRole('article', { name: 'Sequence detail' }).textContent,
    ).toBe('seq-1:steps')
    unmount()
    renderSection(['seq-1', 'enrollments'])
    expect(
      screen.getByRole('article', { name: 'Sequence detail' }).textContent,
    ).toBe('seq-1:enrollments')
  })
})
