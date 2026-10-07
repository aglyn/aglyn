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

import type { DamApi, DamTransport, DeviceFile } from '@aglyn/mobile-core'
import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import * as ImagePicker from 'expo-image-picker'
import { Alert, Linking } from 'react-native'

/*==========================================
 * A PHOTO FROM THE DEVICE, INTO THE DAM.
 *
 * The camera or the photo library, behind the platform's permission prompt;
 * a refusal is said plainly, and once the platform will no longer ask, the
 * person is offered the Settings page where they can change it.
 *
 * The bytes travel without `expo-file-system`, which the app does not
 * install: a picked file's `uri` is fetched as a Blob, which React Native
 * reads straight from disk. A file over the signed threshold is PUT to its
 * signed URL as that Blob; a small one is read to base64 with FileReader,
 * from the original file rather than the picker's `base64` option, which
 * re-encodes to JPEG and would no longer match the type the route is told.
 *=========================================*/

export type PhotoSource = 'camera' | 'library'

/** Opens the camera or the photo library; null when cancelled or refused. */
export async function pickPhoto(source: PhotoSource): Promise<DeviceFile | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    const what = source === 'camera' ? 'the camera' : 'your photos'
    Alert.alert(
      source === 'camera' ? 'Camera access is off' : 'Photo access is off',
      `To add a photo, allow access to ${what} for this app.`,
      permission.canAskAgain
        ? [{ text: 'OK' }]
        : [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
    )
    return null
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: false })
  if (result.canceled || !result.assets?.length) return null
  const asset = result.assets[0]
  const contentType = asset.mimeType || 'image/jpeg'
  const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
  return {
    uri: asset.uri,
    fileName: asset.fileName || `photo-${Date.now()}.${extension}`,
    contentType,
    sizeBytes: typeof asset.fileSize === 'number' ? asset.fileSize : await sizeOf(asset.uri),
  }
}

/** A device file's size, read from its Blob when the picker did not say. */
async function sizeOf(uri: string): Promise<number> {
  const blob = await (await fetch(uri)).blob()
  return blob.size
}

/** A device file's bytes as base64 (no `data:` prefix). */
export async function readBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('The photo could not be read.'))
    reader.readAsDataURL(blob)
  })
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

/** PUTs a device file to a signed upload URL with exactly the content type it was minted for. */
export async function putFile(url: string, uri: string, contentType: string): Promise<void> {
  const blob = await (await fetch(uri)).blob()
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob })
  if (!response.ok) throw new Error(`The upload was refused (${response.status}). Try again.`)
}

/** The DAM transport over the app's console API client. */
export function damTransport(api: MobileApiClient): DamTransport {
  return { api: api as DamApi, putFile, readBase64 }
}
