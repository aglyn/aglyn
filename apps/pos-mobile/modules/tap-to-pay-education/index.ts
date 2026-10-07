/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

interface TapToPayEducationNative {
  isSupported(): boolean
  showHowToTap(): Promise<boolean>
}

const native =
  Platform.OS === 'ios' ? requireOptionalNativeModule<TapToPayEducationNative>('TapToPayEducation') : null

/** Whether Apple's own "How to Tap" content can be shown (iOS 18+). */
export function canShowAppleHowToTap(): boolean {
  try {
    return Boolean(native?.isSupported())
  } catch {
    return false
  }
}

/** Presents Apple's "How to Tap" content; false when it could not. */
export async function showAppleHowToTap(): Promise<boolean> {
  if (!native) return false
  try {
    return await native.showHowToTap()
  } catch {
    return false
  }
}
