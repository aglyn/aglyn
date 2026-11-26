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
import {
  formatMediaRef,
  MediaUploadError,
  type PickedMedia,
  type UploadMediaOptions,
} from '@aglyn/aglyn'
import {
  isAllowedUploadType,
  mediaPickerKindOf,
  normalizeUploadContentType,
  SIGNED_UPLOAD_THRESHOLD_BYTES,
} from './media-upload-limits'
import { AUDIO_RIGHTS_FIELD, MEDIA_UPLOAD_PURPOSE_FIELD } from './media-audio-rights'

/** A fetch that carries the signed-in user's ID token, as `authorizedFetch` does. */
export type AuthorizedFetch = (url: string, init: RequestInit) => Promise<Response>

/** A refusal's own words when the route gave some, else ours. */
async function refusalOf(response: Response, fallback: string): Promise<MediaUploadError> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown }
  return new MediaUploadError(
    typeof payload.error === 'string' && payload.error ? payload.error : fallback,
  )
}

function fileToBase64(file: Blob): Promise<string> {
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
 * One file into the organization's library, into a folder named by path,
 * WITHOUT the library on screen — the upload a plugin asks for through
 * `MediaPickerContext.uploadMedia` (a CRM call recording, filed on the
 * activity it records).
 *
 * The same three routes the library's own Upload button uses, in the same
 * order: the folder first (`ensure-folder-path`, created when missing), then
 * the direct route for a small file or the signed mint → PUT → finalize for
 * one past ~3 MB, which is every real call. Every refusal the server makes
 * — plan, storage, type, the audio confirmation — comes back as a
 * {@link MediaUploadError} in the server's own words.
 */
export async function uploadOrgMediaFile(input: {
  fetch: AuthorizedFetch
  orgId: string
  /** The site the upload is made from, for the org's Default sharing. */
  forHostId?: string | null
  file: File
  options: UploadMediaOptions
}): Promise<PickedMedia> {
  const { fetch: send, orgId, file, options } = input
  const contentType = normalizeUploadContentType(file.type, file.name)
  if (!isAllowedUploadType(contentType)) {
    throw new MediaUploadError(`"${file.name}" is not a file type the library takes.`)
  }
  if (options.kind && mediaPickerKindOf(contentType) !== options.kind) {
    throw new MediaUploadError(`"${file.name}" is not ${options.kind === 'audio' ? 'an audio file' : `a ${options.kind} file`}.`)
  }
  const site = input.forHostId ? { forHostId: input.forHostId } : {}
  const json = { 'Content-Type': 'application/json' }

  const folder = await send('/api/media/folders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      orgId,
      ...site,
      action: 'ensure-folder-path',
      path: options.folderPath,
    }),
  })
  if (!folder.ok) throw await refusalOf(folder, 'The folder could not be made.')
  const folderId = String(((await folder.json()) as { folderId?: unknown }).folderId ?? '') || null

  const extra = {
    ...(options.purpose ? { [MEDIA_UPLOAD_PURPOSE_FIELD]: options.purpose } : {}),
    ...(options.confirmed === true ? { [AUDIO_RIGHTS_FIELD]: true } : {}),
    ...(options.private ? { private: true } : {}),
  }

  let mediaId: string
  if (file.size > SIGNED_UPLOAD_THRESHOLD_BYTES) {
    const mint = await send('/api/media/upload-url', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        orgId,
        ...site,
        contentType,
        fileName: file.name,
        sizeBytes: file.size,
        folderId,
        ...extra,
      }),
    })
    if (!mint.ok) throw await refusalOf(mint, `Upload failed for "${file.name}".`)
    const minted = (await mint.json()) as {
      mediaId?: string
      uploadUrl?: string
      contentType?: string
    }
    if (!minted.uploadUrl || !minted.mediaId) {
      throw new MediaUploadError(`Upload failed for "${file.name}".`)
    }
    const put = await fetch(minted.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': minted.contentType ?? contentType },
      body: file,
    })
    if (!put.ok) throw new MediaUploadError(`Upload failed for "${file.name}" — try again.`)
    const finalize = await send('/api/media/upload-url', {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({
        orgId,
        ...site,
        mediaId: minted.mediaId,
        fileName: file.name,
        folderId,
        ...extra,
      }),
    })
    if (!finalize.ok) throw await refusalOf(finalize, `Upload failed for "${file.name}".`)
    mediaId = minted.mediaId
  } else {
    const response = await send('/api/media/upload', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        orgId,
        ...site,
        fileName: file.name,
        contentType,
        folderId,
        ...extra,
        data: await fileToBase64(file),
      }),
    })
    if (!response.ok) throw await refusalOf(response, `Upload failed for "${file.name}".`)
    const payload = (await response.json()) as { mediaId?: unknown }
    mediaId = String(payload.mediaId ?? '')
    if (!mediaId) throw new MediaUploadError(`Upload failed for "${file.name}".`)
  }

  const mediaScope = `org:${orgId}`
  return {
    url: formatMediaRef(mediaScope, mediaId) ?? '',
    fileName: file.name,
    contentType,
    mediaId,
    mediaScope,
    ...(options.private ? { private: true } : {}),
  }
}
