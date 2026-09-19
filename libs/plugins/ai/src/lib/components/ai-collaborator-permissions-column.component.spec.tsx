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

const mockFetch = jest.fn()
const mockEnqueue = jest.fn()
/** ONE held user and ONE held snackbar, as the providers hand them. */
const mockUser = { uid: 'u-1' }
const mockSnackbar = { enqueueSnackbar: (...args: unknown[]) => mockEnqueue(...args) }

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => mockSnackbar,
}))

import {
  AiCollaboratorPermissionsCell,
  collaboratorAiPermissions,
} from './ai-collaborator-permissions-column.component'

beforeEach(() => {
  mockFetch.mockReset()
  mockEnqueue.mockReset()
})

/**
 * The collaborators table's AI column (AGL-2927, AGL-2984): the two boxes the
 * core card drew, drawn by the plugin through the `hostMembers` zone, with
 * the same defaults, the same holds and the same request.
 */
describe('the collaborators table’s AI column', () => {
  it('shows the roster copy, else the host role’s default', () => {
    expect(collaboratorAiPermissions({ role: 'author' })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(collaboratorAiPermissions({ role: 'viewer' })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(
      collaboratorAiPermissions({ role: 'editor', aiPermissions: { 'ai.generate': false } }),
    ).toEqual({ 'ai.use': true, 'ai.generate': false })
    // A row with no role reads as the card's own default role.
    expect(collaboratorAiPermissions({})).toEqual({ 'ai.use': true, 'ai.generate': true })
  })

  it('names the owner’s standing instead of drawing boxes', () => {
    render(
      <AiCollaboratorPermissionsCell
        hostId="host-1"
        canManage
        member={{ $id: 'owner-1', uid: 'owner-1', role: 'owner' }}
      />,
    )
    expect(screen.getByText('By org role')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('holds the boxes for a reader who cannot manage, and for an invite', () => {
    const { rerender } = render(
      <AiCollaboratorPermissionsCell
        hostId="host-1"
        canManage={false}
        member={{ $id: 'uid-9', uid: 'uid-9', role: 'editor' }}
      />,
    )
    expect((screen.getByRole('checkbox', { name: 'Assist with AI' }) as HTMLInputElement).disabled).toBe(true)
    rerender(
      <AiCollaboratorPermissionsCell
        hostId="host-1"
        canManage
        member={{ $id: 'pending', role: 'editor', status: 'invited' }}
      />,
    )
    expect(
      (screen.getByRole('checkbox', { name: 'Generate with AI' }) as HTMLInputElement).disabled,
    ).toBe(true)
  })

  it('sends one toggle to the plugin’s door and says it saved', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    render(
      <AiCollaboratorPermissionsCell
        hostId="host-1"
        canManage
        member={{ $id: 'uid-9', uid: 'uid-9', role: 'author' }}
      />,
    )
    const generate = screen.getByRole('checkbox', { name: 'Generate with AI' }) as HTMLInputElement
    expect(generate.checked).toBe(true)
    fireEvent.click(generate)
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledWith('AI access updated', expect.anything()))
    const [user, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(user).toBe(mockUser)
    expect(url).toBe('/api/ai/host-permissions')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      hostId: 'host-1',
      memberId: 'uid-9',
      aiPermissions: { 'ai.generate': false },
    })
  })

  it('relays the door’s refusal in its own words', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'AI access is set once the invite is accepted' }),
    })
    render(
      <AiCollaboratorPermissionsCell
        hostId="host-1"
        canManage
        member={{ $id: 'uid-9', uid: 'uid-9', role: 'author' }}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Assist with AI' }))
    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(
        'AI access is set once the invite is accepted',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })
})
