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
'use client'

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { SIGNED_UPLOAD_THRESHOLD_BYTES } from './media-upload-limits'

type UploadUser = { getIdToken?: () => Promise<string> } | null | undefined

const readBody = (response: Response) =>
  response.json().catch(() => null) as Promise<Record<string, unknown> | null>

const refused = (payload: Record<string, unknown> | null) =>
  new Error(String(payload?.['error'] ?? 'Upload failed'))

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * One image into a site's own media library, by the two doors the library
 * itself uses: the bytes in the request, or past the platform's body limit
 * (`SIGNED_UPLOAD_THRESHOLD_BYTES`) straight to storage on a signed URL.
 * Resolves to the stored asset, and throws with the route's words when it is
 * refused.
 */
export async function uploadHostImage(
  user: UploadUser,
  hostId: string,
  file: File,
  contentType: string,
): Promise<{ mediaId: string; url: string }> {
  const post = (path: string, method: string, body: Record<string, unknown>) =>
    authorizedFetch(user, path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, ...body }),
    })
  const finished = async (response: Response) => {
    const payload = await readBody(response)
    if (!response.ok || !payload?.['url']) throw refused(payload)
    return { mediaId: String(payload['mediaId']), url: String(payload['url']) }
  }
  if (file.size <= SIGNED_UPLOAD_THRESHOLD_BYTES) {
    return finished(
      await post('/api/media/upload', 'POST', {
        fileName: file.name,
        contentType,
        data: await fileToBase64(file),
      }),
    )
  }
  const mint = await post('/api/media/upload-url', 'POST', {
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
  })
  const minted = await readBody(mint)
  if (!mint.ok || !minted?.['uploadUrl']) throw refused(minted)
  const put = await fetch(String(minted['uploadUrl']), {
    method: 'PUT',
    // Must match the type the signed URL was minted for exactly.
    headers: { 'Content-Type': String(minted['contentType'] ?? contentType) },
    body: file,
  })
  if (!put.ok) throw new Error('Upload failed')
  return finished(
    await post('/api/media/upload-url', 'PATCH', {
      mediaId: minted['mediaId'],
      fileName: file.name,
    }),
  )
}

export default uploadHostImage
