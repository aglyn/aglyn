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

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { SIGNED_UPLOAD_THRESHOLD_BYTES } from './media-upload-limits'
import { uploadHostImage } from './upload-host-image'

const answer = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
})
const small = new File(['hi'], 'logo.png', { type: 'image/png' })
const large = () => {
  const file = new File(['hi'], 'big.png', { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: SIGNED_UPLOAD_THRESHOLD_BYTES + 1 })
  return file
}
const bodyOf = (call: unknown[]) => JSON.parse(String((call[2] as { body: string }).body))

describe('uploadHostImage (AGL-4119)', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.clearAllMocks()
  })

  it('sends a small image in the request, to the site’s own library', async () => {
    mockFetch.mockResolvedValueOnce(answer(200, { mediaId: 'm1', url: 'https://cdn/m1' }))
    await expect(uploadHostImage(null, 'h1', small, 'image/png')).resolves.toEqual({
      mediaId: 'm1',
      url: 'https://cdn/m1',
    })
    expect(mockFetch.mock.calls[0][1]).toBe('/api/media/upload')
    expect(bodyOf(mockFetch.mock.calls[0])).toEqual({
      hostId: 'h1',
      fileName: 'logo.png',
      contentType: 'image/png',
      data: 'aGk=',
    })
  })

  it('throws the route’s own words when it is refused', async () => {
    mockFetch.mockResolvedValueOnce(answer(413, { error: 'Storage limit reached (250 MB)' }))
    await expect(uploadHostImage(null, 'h1', small, 'image/png')).rejects.toThrow('Storage limit reached (250 MB)')
  })

  it('sends a large image straight to storage, and finalizes it', async () => {
    mockFetch
      .mockResolvedValueOnce(answer(200, { mediaId: 'm2', uploadUrl: 'https://gcs/signed', contentType: 'image/png' }))
      .mockResolvedValueOnce(answer(200, { mediaId: 'm2', url: 'https://cdn/m2' }))
    const put = jest.fn(async () => ({ ok: true }))
    global.fetch = put as never
    await expect(uploadHostImage(null, 'h1', large(), 'image/png')).resolves.toEqual({
      mediaId: 'm2',
      url: 'https://cdn/m2',
    })
    expect(bodyOf(mockFetch.mock.calls[0])).toMatchObject({ hostId: 'h1', sizeBytes: SIGNED_UPLOAD_THRESHOLD_BYTES + 1 })
    expect(put.mock.calls[0]).toEqual(['https://gcs/signed', expect.objectContaining({ method: 'PUT' })])
    expect(mockFetch.mock.calls[1][2]).toMatchObject({ method: 'PATCH' })
    expect(bodyOf(mockFetch.mock.calls[1])).toEqual({ hostId: 'h1', mediaId: 'm2', fileName: 'big.png' })
  })

  it('fails when the bytes never reach storage', async () => {
    mockFetch.mockResolvedValueOnce(answer(200, { mediaId: 'm2', uploadUrl: 'https://gcs/signed' }))
    global.fetch = jest.fn(async () => ({ ok: false })) as never
    await expect(uploadHostImage(null, 'h1', large(), 'image/png')).rejects.toThrow('Upload failed')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
