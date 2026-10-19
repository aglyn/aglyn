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
import { PhotoLinkDialog, type PhotoLinkRow } from './photo-link-dialog.component'

const URL_ONCE = 'https://console.example.test/p/aaaaaaaaaaaaaaaaaaaaaaaa#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const DAY = 24 * 60 * 60 * 1000

const mockSnackbar = jest.fn()
const mockState: {
  links: PhotoLinkRow[]
  posts: Array<Record<string, unknown>>
  listRefusal: { status: number; error: string } | null
} = { links: [], posts: [], listRefusal: null }

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'member-1' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  HelpTip: () => null,
  useConfirmationContext: () => ({ confirm: () => Promise.resolve() }),
}))

jest.mock('../../constants/docs-links', () => ({ docsHelp: () => ({}) }))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    expect(url).toBe('/api/media/photo-links')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    mockState.posts.push(body)
    if (body['action'] === 'list') {
      if (mockState.listRefusal) return reply(mockState.listRefusal.status, { error: mockState.listRefusal.error })
      return reply(200, { links: mockState.links })
    }
    if (body['action'] === 'create') {
      const now = Date.now()
      mockState.links = [
        { linkId: 'fresh', createdAt: now, expiresAt: now + 7 * DAY, uploads: 0, remainingUploads: 40 },
        ...mockState.links,
      ]
      return reply(200, { linkId: 'fresh', url: URL_ONCE, expiresAt: now + 7 * DAY, folderId: 'owner' })
    }
    mockState.links = mockState.links.filter((link) => link.linkId !== body['linkId'])
    return reply(200, { ok: true })
  },
}))

const writeText = jest.fn(async () => undefined)

beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText } })
})

beforeEach(() => {
  const made = Date.now() - DAY
  mockState.links = [{ linkId: 'older', createdAt: made, expiresAt: made + 7 * DAY, uploads: 3, remainingUploads: 37 }]
  mockState.posts = []
  mockState.listRefusal = null
  mockSnackbar.mockClear()
  writeText.mockClear()
})

describe('the photo link dialog (AGL-3957)', () => {
  it('lists, makes a link with its QR and address, copies it, and revokes it', async () => {
    render(<PhotoLinkDialog hostId="host-1" open onClose={() => undefined} />)

    // The open links, with what each has received; no address is shown for them.
    const [older] = await screen.findAllByTestId('photo-link-row')
    expect(older.textContent).toContain('3 photos received')
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull()
    expect(screen.getByText(/shown only once/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New link' }))
    await screen.findByRole('img', { name: 'Photo link QR code' })
    expect((screen.getByLabelText('Link') as HTMLInputElement).value).toBe(URL_ONCE)
    expect(screen.getByText(/Works for 7 days and takes up to 40 photos/).textContent).toContain('From the owner')
    await waitFor(() => expect(screen.getAllByTestId('photo-link-row')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(URL_ONCE)
    expect(mockSnackbar).toHaveBeenCalledWith('Link copied', expect.anything())

    // Revoking the link just made drops its code along with its row.
    const [freshRow] = screen.getAllByTestId('photo-link-row')
    fireEvent.click(within(freshRow).getByRole('button', { name: /Revoke/ }))
    await waitFor(() => expect(screen.getAllByTestId('photo-link-row')).toHaveLength(1))
    expect(screen.queryByRole('img', { name: 'Photo link QR code' })).toBeNull()

    expect(mockState.posts).toEqual([
      { hostId: 'host-1', action: 'list' },
      { hostId: 'host-1', action: 'create' },
      { hostId: 'host-1', action: 'list' },
      { hostId: 'host-1', action: 'revoke', linkId: 'fresh' },
      { hostId: 'host-1', action: 'list' },
    ])
  })

  it("shows the route's refusal and keeps New link disabled", async () => {
    mockState.listRefusal = { status: 403, error: 'Uploads are paused for this site' }
    render(<PhotoLinkDialog hostId="host-1" open onClose={() => undefined} />)
    await screen.findByText('Uploads are paused for this site')
    expect((screen.getByRole('button', { name: 'New link' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mockState.posts).toEqual([{ hostId: 'host-1', action: 'list' }])
  })

  it('says there are none when the site has no open link', async () => {
    mockState.links = []
    render(<PhotoLinkDialog hostId="host-1" open onClose={() => undefined} />)
    await screen.findByText('No open links.')
    expect((screen.getByRole('button', { name: 'New link' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
