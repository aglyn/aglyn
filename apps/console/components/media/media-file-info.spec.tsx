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
 * The Details drawer's "File info" section (AGL-3331).
 *
 * What it must get right: a stored record is shown without a round trip;
 * an asset with no record is read once, not once per render; an edit is
 * sent as only what changed, with the digest the drawer was showing; and
 * a format that cannot take edits never offers one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MEDIA_EMBEDDED_METADATA_VERSION } from '@aglyn/aglyn/app-utils/media-embedded-fields'

const mockAuthorizedFetch = jest.fn()
const mockEnqueueSnackbar = jest.fn()
const mockConfirm = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

import { MediaFileInfo } from './media-file-info.component'

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  })

const record = (overrides: Record<string, unknown> = {}) => ({
  version: MEDIA_EMBEDDED_METADATA_VERSION,
  format: 'jpeg',
  writable: true,
  contentSha256: 'sha-1',
  fields: [
    {
      key: 'title',
      label: 'Title',
      group: 'description',
      value: 'Harbor',
      sources: ['xmp', 'iptc'],
      editable: true,
    },
    {
      key: 'make',
      label: 'Camera make',
      group: 'capture',
      value: 'Canon',
      sources: ['exif'],
      editable: true,
    },
    {
      key: 'exposure',
      label: 'Exposure',
      group: 'capture',
      value: '1/250 s',
      sources: ['exif'],
      editable: false,
    },
    {
      key: 'gps',
      label: 'GPS position',
      group: 'location',
      value: '37.774929,-122.419416',
      sources: ['exif'],
      editable: true,
    },
  ],
  ...overrides,
})

const media = (overrides: Record<string, unknown> = {}) => ({
  contentType: 'image/jpeg',
  sizeBytes: 2048,
  contentSha256: 'sha-1',
  ...overrides,
})

const renderInfo = (mediaDoc: Record<string, unknown>, onFileChanged = jest.fn()) =>
  render(
    <MediaFileInfo
      mediaId="m1"
      media={mediaDoc}
      scopeBody={{ orgId: 'org-1' }}
      user={{ uid: 'u1' }}
      onFileChanged={onFileChanged}
    />,
  )

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  mockEnqueueSnackbar.mockReset()
  mockConfirm.mockReset()
})

describe('MediaFileInfo', () => {
  it('shows a current stored record without asking the server', () => {
    renderInfo(media({ embeddedMetadata: record() }))
    expect(screen.getByText('Harbor')).toBeTruthy()
    expect(screen.getByText('1/250 s')).toBeTruthy()
    expect(screen.getByText('37.77493° N, 122.41942° W')).toBeTruthy()
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('reads an asset with no record once, even across re-renders', async () => {
    mockAuthorizedFetch.mockImplementation(() =>
      respond(200, { embeddedMetadata: record() }),
    )
    const view = renderInfo(media())
    view.rerender(
      <MediaFileInfo
        mediaId="m1"
        media={media()}
        scopeBody={{ orgId: 'org-1' }}
        user={{ uid: 'u1' }}
      />,
    )
    await screen.findByText('Harbor')
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    const [, path, init] = mockAuthorizedFetch.mock.calls[0]
    expect(path).toBe('/api/media/metadata')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      mediaId: 'm1',
      action: 'read',
    })
  })

  it('re-reads a record left over from bytes that were replaced', async () => {
    mockAuthorizedFetch.mockImplementation(() =>
      respond(200, { embeddedMetadata: record({ contentSha256: 'sha-2' }) }),
    )
    renderInfo(
      media({ contentSha256: 'sha-2', embeddedMetadata: record() }),
    )
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1))
  })

  it('never asks about a format with no reader', () => {
    renderInfo(media({ contentType: 'text/csv' }))
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    expect(screen.getByText('File info')).toBeTruthy()
  })

  it('sends only the changed field, with the digest it was showing', async () => {
    const onFileChanged = jest.fn()
    renderInfo(media({ embeddedMetadata: record() }), onFileChanged)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Harbor at dusk' },
    })
    mockAuthorizedFetch.mockImplementation(() =>
      respond(200, {
        embeddedMetadata: record({ contentSha256: 'sha-2' }),
        contentSha256: 'sha-2',
        contentHash: 'sha-2'.slice(0, 16),
        sizeBytes: 2100,
        url: 'https://example.test/new',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))
    await waitFor(() => expect(onFileChanged).toHaveBeenCalled())
    expect(JSON.parse(mockAuthorizedFetch.mock.calls[0][2].body)).toEqual({
      orgId: 'org-1',
      mediaId: 'm1',
      action: 'write',
      patch: { title: 'Harbor at dusk' },
      expectedSha256: 'sha-1',
    })
    expect(onFileChanged.mock.calls[0][0]).toMatchObject({
      contentSha256: 'sha-2',
      sizeBytes: 2100,
    })
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Saved into the file',
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('asks before erasing a location, and sends only the removal', async () => {
    mockConfirm.mockResolvedValue(undefined)
    mockAuthorizedFetch.mockImplementation(() =>
      respond(200, {
        embeddedMetadata: record({ fields: [] }),
        contentSha256: 'sha-2',
      }),
    )
    renderInfo(media({ embeddedMetadata: record() }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove location from file' }))
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalled())
    expect(mockConfirm).toHaveBeenCalled()
    expect(JSON.parse(mockAuthorizedFetch.mock.calls[0][2].body).patch).toEqual({
      gps: null,
    })
  })

  it('writes nothing when the location removal is declined', async () => {
    mockConfirm.mockRejectedValue(undefined)
    renderInfo(media({ embeddedMetadata: record() }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove location from file' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('offers no edit on a read-only file and says why', () => {
    renderInfo(
      media({
        contentType: 'video/mp4',
        embeddedMetadata: record({
          format: 'mp4',
          writable: false,
          readOnlyReason: 'Details inside a video file can be read here but not changed.',
          fields: [
            {
              key: 'title',
              label: 'Title',
              group: 'description',
              value: 'Launch film',
              sources: ['mp4'],
              editable: false,
            },
          ],
        }),
      }),
    )
    expect(screen.getByText('Launch film')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(
      screen.getByText('Details inside a video file can be read here but not changed.'),
    ).toBeTruthy()
  })

  it('surfaces a refused write without leaving edit mode', async () => {
    mockAuthorizedFetch.mockImplementation(() =>
      respond(409, { error: 'This file was changed elsewhere — reopen it first' }),
    )
    renderInfo(media({ embeddedMetadata: record() }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'This file was changed elsewhere — reopen it first',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    expect(screen.getByRole('button', { name: 'Save to file' })).toBeTruthy()
  })
})
