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
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import type { MobileApiClient } from './context'

/*
 * The site's media library, from the phone (AGL-3621): a photo goes into the
 * DAM through the console's own upload routes, and a photo that is already in
 * the DAM is REPLACED IN PLACE — same asset, same id, same CDN path, so every
 * page and product that shows it shows the new bytes. Nothing here uploads a
 * second copy of an asset that exists.
 *
 * Small files ride `/api/media/upload` as base64; anything over the signed
 * threshold is minted a signed Storage URL, PUT there by the app's file layer
 * (`putFile`, which reads the file from disk rather than through JS memory)
 * and finalized — the same two branches the console's library takes, at the
 * same threshold (`SIGNED_UPLOAD_THRESHOLD_BYTES`, held by `dam-upload.spec.ts`).
 */

/** `SIGNED_UPLOAD_THRESHOLD_BYTES` in `apps/console/utils/media-upload-limits.ts`. */
export const DAM_SIGNED_UPLOAD_THRESHOLD_BYTES = 3 * 1024 * 1024

/** A file on the device, as the camera or the photo library hands it over. */
export interface DeviceFile {
  uri: string
  fileName: string
  contentType: string
  sizeBytes: number
  /** The bytes as base64, when the picker already read them (small files). */
  base64?: string | null
}

export interface DamTransport {
  api: MobileApiClient
  /** PUTs a device file to a signed URL with exactly this content type. */
  putFile(url: string, fileUri: string, contentType: string): Promise<void>
  /** Reads a device file as base64, when the picker did not. */
  readBase64(fileUri: string): Promise<string>
}

export interface DamAsset {
  mediaId: string
  /** What a product stores: the asset's stable CDN path, else its URL. */
  url: string
}

/** The address a product keeps for an asset: `cdnPath` when it has one. */
async function storedAddress(
  firestore: Firestore,
  hostId: string,
  mediaId: string,
  fallback: string,
): Promise<string> {
  const snapshot = await getDoc(doc(firestore, 'hosts', hostId, 'media', mediaId)).catch(() => null)
  const cdnPath = snapshot?.data()?.['cdnPath']
  return typeof cdnPath === 'string' && cdnPath ? cdnPath : fallback
}

/** Adds a new asset to the site's library. Call once per photo; a retry reuses the result. */
export async function uploadMedia(
  transport: DamTransport,
  firestore: Firestore,
  input: { hostId: string; file: DeviceFile; folderId?: string | null },
): Promise<DamAsset> {
  const { hostId, file } = input
  const folderId = input.folderId ?? null
  let uploaded: { mediaId: string; url: string }
  if (file.sizeBytes > DAM_SIGNED_UPLOAD_THRESHOLD_BYTES) {
    const minted = await transport.api.request<{ mediaId: string; uploadUrl: string; contentType?: string }>(
      'media/upload-url',
      {
        method: 'POST',
        body: { hostId, contentType: file.contentType, fileName: file.fileName, sizeBytes: file.sizeBytes, folderId },
      },
    )
    await transport.putFile(minted.uploadUrl, file.uri, minted.contentType ?? file.contentType)
    uploaded = await transport.api.request('media/upload-url', {
      method: 'PATCH',
      body: { hostId, mediaId: minted.mediaId, fileName: file.fileName, folderId },
    })
  } else {
    uploaded = await transport.api.request('media/upload', {
      method: 'POST',
      body: {
        hostId,
        fileName: file.fileName,
        contentType: file.contentType,
        folderId,
        data: file.base64 || (await transport.readBase64(file.uri)),
      },
    })
  }
  return {
    mediaId: uploaded.mediaId,
    url: await storedAddress(firestore, hostId, uploaded.mediaId, uploaded.url),
  }
}

/**
 * The library asset a stored address names, or null when it names none (an
 * outside URL, or an asset since deleted). By `cdnPath` — the address
 * products store — and then by the raw `url` an older product may hold.
 */
export async function mediaForAddress(
  firestore: Firestore,
  hostId: string,
  address: string,
): Promise<{ mediaId: string; updatedAtMs?: number } | null> {
  if (!address) return null
  const media = collection(firestore, 'hosts', hostId, 'media')
  for (const field of ['cdnPath', 'url']) {
    const snapshot = await getDocs(query(media, where(field, '==', address), limit(1)))
    const found = snapshot.docs[0]
    if (found) {
      const updatedAt = found.data()['updatedAt'] as { toMillis?: () => number; seconds?: number } | undefined
      const updatedAtMs = updatedAt?.toMillis?.() ?? (updatedAt?.seconds ? updatedAt.seconds * 1000 : undefined)
      return { mediaId: found.id, ...(updatedAtMs ? { updatedAtMs } : {}) }
    }
  }
  return null
}

/**
 * Replaces an asset's bytes IN PLACE. `expectedUpdatedAtMs` refuses the
 * replace (409) when someone changed the asset since it was read.
 */
export async function replaceMedia(
  transport: DamTransport,
  input: { hostId: string; mediaId: string; file: DeviceFile; expectedUpdatedAtMs?: number },
): Promise<void> {
  const { hostId, mediaId, file } = input
  const precondition = input.expectedUpdatedAtMs ? { expectedUpdatedAtMs: input.expectedUpdatedAtMs } : {}
  if (file.sizeBytes > DAM_SIGNED_UPLOAD_THRESHOLD_BYTES) {
    const minted = await transport.api.request<{ uploadUrl: string; contentType?: string }>('media/replace', {
      method: 'PUT',
      body: { hostId, mediaId, contentType: file.contentType, fileName: file.fileName, sizeBytes: file.sizeBytes, ...precondition },
    })
    await transport.putFile(minted.uploadUrl, file.uri, minted.contentType ?? file.contentType)
    await transport.api.request('media/replace', {
      method: 'PATCH',
      body: { hostId, mediaId, fileName: file.fileName, ...precondition },
    })
    return
  }
  await transport.api.request('media/replace', {
    method: 'POST',
    body: {
      hostId,
      mediaId,
      contentType: file.contentType,
      fileName: file.fileName,
      data: file.base64 || (await transport.readBase64(file.uri)),
      ...precondition,
    },
  })
}
