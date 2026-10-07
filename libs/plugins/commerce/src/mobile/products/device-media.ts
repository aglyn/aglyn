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

import { getMobileConfig, mobileBrandName } from '@aglyn/mobile-core'
import * as ImagePicker from 'expo-image-picker'
import type { DamTransport, DeviceFile } from '../data/dam-upload'
import type { MobileApiClient } from '../data/context'

/*
 * The device side of a product photo (AGL-3621): the camera or the photo
 * library hands over a file, and the DAM upload in `data/dam-upload.ts`
 * moves it — as base64 through the upload route when small, or PUT straight
 * to a signed Storage URL when large, read from disk by the native fetch so
 * a 12-megapixel photo never sits in JS memory as text.
 */

async function blobOf(fileUri: string): Promise<Blob> {
  const response = await fetch(fileUri)
  return response.blob()
}

export function deviceDamTransport(api: MobileApiClient): DamTransport {
  return {
    api,
    async putFile(url, fileUri, contentType) {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: await blobOf(fileUri),
      })
      if (!response.ok) throw new Error('The photo did not finish uploading. Try again.')
    },
    async readBase64(fileUri) {
      const blob = await blobOf(fileUri)
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('The photo could not be read'))
        reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '')
        reader.readAsDataURL(blob)
      })
    },
  }
}

export type PhotoSource = 'camera' | 'library'

/**
 * A photo from the camera or the library, or null when the person backed
 * out. Throws when the camera is not allowed, with words to show them.
 */
export async function pickPhoto(source: PhotoSource): Promise<DeviceFile | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      throw new Error(`Camera access is off for ${mobileBrandName()}. Turn it on in Settings to take product photos.`)
    }
  }
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options)
  const asset = result.canceled ? null : result.assets?.[0]
  if (!asset) return null
  const contentType = asset.mimeType || 'image/jpeg'
  const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
  const sizeBytes = asset.fileSize || (await blobOf(asset.uri)).size
  return {
    uri: asset.uri,
    fileName: asset.fileName || `product-photo-${Date.now()}.${extension}`,
    contentType,
    sizeBytes,
  }
}

/**
 * What an `<Image>` loads for an address a product stores: a DAM `cdnPath`
 * is served by the console, so it is resolved against the console's origin.
 */
export function productImageUri(address: string | null | undefined): string | null {
  if (!address) return null
  if (/^https?:\/\//i.test(address)) return address
  if (!address.startsWith('/')) return null
  return `${getMobileConfig().consoleOrigin}${address}`
}
