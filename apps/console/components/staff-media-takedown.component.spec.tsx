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
import { StaffMediaTakedown, takedownScopeOf } from './staff-media-takedown.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'staff-1' } }),
}))

const mockState: { quarantined: boolean; posts: Array<Record<string, unknown>>; refuse: string | null } = {
  quarantined: false,
  posts: [],
  refuse: null,
}

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      mockState.posts.push(body)
      if (mockState.refuse) return reply(403, { error: mockState.refuse })
      mockState.quarantined = body.action === 'quarantine'
      return reply(200, { ok: true })
    }
    expect(url).toBe('/api/admin/media-quarantine?orgId=acme&mediaId=track1')
    return reply(200, { quarantined: mockState.quarantined })
  },
}))

beforeEach(() => {
  mockState.quarantined = false
  mockState.posts = []
  mockState.refuse = null
})

describe('the copyright takedown in the staff media dialog (AGL-3716)', () => {
  it('reads the scope off the card query', () => {
    expect(takedownScopeOf('orgId=acme')).toEqual({ orgId: 'acme' })
    expect(takedownScopeOf('hostId=h1')).toEqual({ hostId: 'h1' })
  })

  it('quarantines the file with the dmca reason, and shows the state read back', async () => {
    render(<StaffMediaTakedown scopeQuery="orgId=acme" mediaId="track1" />)
    fireEvent.change(await screen.findByLabelText(/Staff note/), {
      target: { value: 'Notice 42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Take down for copyright' }))
    await screen.findByRole('button', { name: 'Restore' })
    expect(mockState.posts).toEqual([
      { action: 'quarantine', by: 'media', orgId: 'acme', mediaId: 'track1', reason: 'dmca', note: 'Notice 42' },
    ])
    expect(screen.getByText(/Taken down/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await screen.findByRole('button', { name: 'Take down for copyright' })
    expect(mockState.posts[1]).toEqual({ action: 'release', by: 'media', orgId: 'acme', mediaId: 'track1' })
  })

  it("shows the route's refusal and claims nothing", async () => {
    mockState.refuse = 'Requires the super staff role'
    render(<StaffMediaTakedown scopeQuery="orgId=acme" mediaId="track1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Take down for copyright' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('super staff role'))
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })
})
