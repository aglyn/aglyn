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
 * THE KIND A NEW ACTIVITY OPENS ON (AGL-2661).
 *
 * Click-to-call's "Log a call" is only one tap if the dialog it opens is
 * already a call. The preset is a prop rather than the default it happens
 * to share, so a surface that wants a different kind gets one and neither
 * reading depends on the other; and a reader who opens as a call and means
 * a note can still say so. An EDIT ignores the preset — the kind of an
 * activity already logged is the activity's own.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LogActivityDialog } from './log-activity-dialog'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
  useUserName: () => 'Ada Admin',
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (name: string) => name,
  where: () => undefined,
  deleteField: () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  addDoc: jest.fn().mockResolvedValue({ id: 'act-1' }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('./crm-site-picker', () => ({ CrmSitePicker: () => null }))

const scope = {
  firestore: {},
  dataScope: ['orgs', 'org-1'] as const,
  orgId: 'org-1',
  hostId: 'host-1',
  mountedHostId: 'host-1',
  consentGroup: null,
  readTokens: ['host:host-1'],
  writeTokens: ['host:host-1'],
} as unknown as Parameters<typeof LogActivityDialog>[0]['scope']

const kind = () => screen.getByRole('combobox', { name: 'Kind' }).textContent

describe('the kind a new activity opens on (AGL-2661)', () => {
  it('opens on the kind the caller preset, and on a call when none is named', () => {
    const { unmount } = render(
      <LogActivityDialog
        open
        onClose={() => undefined}
        scope={scope}
        link={{ contactId: 'c-1' }}
        kind="note"
      />,
    )
    expect(kind()).toBe('Note')
    unmount()

    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    expect(kind()).toBe('Call')
  })

  it('lets the reader change it — the preset is a start, not a lock', () => {
    render(
      <LogActivityDialog
        open
        onClose={() => undefined}
        scope={scope}
        link={{ contactId: 'c-1' }}
        kind="call"
      />,
    )
    expect(kind()).toBe('Call')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kind' }))
    fireEvent.click(screen.getByRole('option', { name: 'Meeting' }))
    expect(kind()).toBe('Meeting')
  })
})

/**
 * WHICH WAY A CALL WENT (AGL-3517) — Salesforce's Call Type. A call takes
 * inbound, outbound or internal and an email inbound or outbound, outbound
 * to start; no other kind shows the field, and none writes one.
 */
describe('a call’s and an email’s direction (AGL-3517)', () => {
  const { addDoc } = jest.requireMock('firebase/firestore') as { addDoc: jest.Mock }
  const direction = () => screen.queryByRole('combobox', { name: 'Direction' })
  const options = () => {
    fireEvent.mouseDown(direction() as HTMLElement)
    return screen.getAllByRole('option').map((option) => option.textContent)
  }
  beforeEach(() => addDoc.mockClear())

  it('offers a call three directions and an email two, outbound to start, and a note none', () => {
    const { unmount } = render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    expect(direction()?.textContent).toBe('Outbound')
    expect(options()).toEqual(['Not said', 'Outbound', 'Inbound', 'Internal'])
    unmount()
    const email = render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} kind="email" />,
    )
    expect(options()).toEqual(['Not said', 'Outbound', 'Inbound'])
    email.unmount()
    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} kind="note" />,
    )
    expect(direction()).toBeNull()
  })

  it('writes the direction picked on a call, and none on a note', async () => {
    const { unmount } = render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    fireEvent.mouseDown(direction() as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: 'Inbound' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: 'They called about the quote' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    expect(addDoc.mock.calls[0][1]).toMatchObject({ kind: 'call', direction: 'inbound' })
    unmount()

    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} kind="note" />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: 'Prefers mornings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(2))
    expect('direction' in addDoc.mock.calls[1][1]).toBe(false)
  })
})
