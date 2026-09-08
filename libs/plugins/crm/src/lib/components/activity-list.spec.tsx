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
 * A captured email on the timeline (AGL-2657): a message that came through
 * the capture address is drawn apart from what a member logged and from
 * what the console sent. A correspondent's message reads "Received" with
 * its sender and no author; a member's copied send reads "Sent" with no
 * delivery chip; and neither offers an edit, since neither is a note.
 */

import { render, screen } from '@testing-library/react'
import { ActivityRow } from './activity-list'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
  useUserName: () => 'Ada Admin',
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

const scope = { firestore: {}, dataScope: ['orgs', 'org-1'] as [string, string] }

const base = {
  kind: 'email',
  atMs: 1_000,
  byUid: 'u-1',
  byName: 'Ada Admin',
  hostId: 'host-1',
  visibleTo: ['host:host-1'],
  contactId: 'con-1',
  subject: 'Re: the renewal',
  body: 'Yes, let us talk Tuesday.',
}

const renderRow = (activity: Record<string, unknown>) =>
  render(
    <ActivityRow
      activity={activity as never}
      scope={scope as never}
      subject={<span>Logged</span>}
      onEdit={jest.fn()}
      editable
      nowMs={2_000}
    />,
  )

describe('ActivityRow with a captured email (AGL-2657)', () => {
  it('draws a correspondent’s message as Received, from its sender, with no author', () => {
    renderRow({
      ...base,
      $id: 'act-in',
      direction: 'inbound',
      messageId: '<m1@example.test>',
      from: 'grace@example.test',
      byUid: '',
      byName: '',
    })
    expect(screen.getByTestId('activity-direction').textContent).toBe('Received')
    expect(screen.queryByText('Logged')).toBeNull()
    expect(screen.getByText(/from grace@example\.test/)).toBeTruthy()
    expect(screen.queryByText(/Ada Admin/)).toBeNull()
    expect(screen.getByText('Re: the renewal')).toBeTruthy()
    expect(screen.queryByLabelText('Edit activity')).toBeNull()
    expect(screen.getByLabelText('Delete activity')).toBeTruthy()
  })

  it('draws a member’s copied send as Sent, to its recipient, without a delivery chip', () => {
    renderRow({
      ...base,
      $id: 'act-out',
      direction: 'outbound',
      messageId: '<m2@example.test>',
      to: 'grace@example.test',
    })
    expect(screen.getByTestId('activity-direction').textContent).toBe('Sent')
    expect(screen.queryByText('Logged')).toBeNull()
    expect(screen.getByText(/to grace@example\.test/)).toBeTruthy()
    expect(screen.queryByLabelText('Edit activity')).toBeNull()
  })

  it('leaves a logged email as it was: the caller’s chip, the author, an edit', () => {
    renderRow({ ...base, $id: 'act-note' })
    expect(screen.queryByTestId('activity-direction')).toBeNull()
    expect(screen.getByText('Logged')).toBeTruthy()
    expect(screen.getByText(/Ada Admin/)).toBeTruthy()
    expect(screen.getByLabelText('Edit activity')).toBeTruthy()
  })
})
