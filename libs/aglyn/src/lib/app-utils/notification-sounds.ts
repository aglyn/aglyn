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
 * The notification sounds a person picks from (Notification settings), the
 * same on every surface: the console's chime, the APNs `sound` the Apple apps
 * play and the Android notification channel.
 *
 * NO IMPORTS, on purpose: the native apps read this list through the
 * generated contracts, so it must stay a plain module.
 *
 * The audio is synthesized by `tools/notification-sounds/generate.py`, which
 * writes each sound to the three paths named here; the two lists name the
 * same ids.
 */

/** `users/{uid}.notificationSound`: the id of the sound the person picked. */
export const NOTIFICATION_SOUND_FIELD = 'notificationSound'

export interface NotificationSound {
  id: string
  label: string
  /** The console's file, served from `apps/console/public`. */
  web: string
  /** The file in both Apple apps' bundles, named in the APNs payload's `sound`. */
  apple: string
  /**
   * The Android raw resource and the notification channel that plays it. A
   * channel's sound cannot change once created, so each sound has its own.
   */
  android: string
}

function sound(id: string, label: string): NotificationSound {
  return {
    id,
    label,
    web: `/sounds/notifications/${id}.wav`,
    apple: `aglyn-${id}.caf`,
    android: `aglyn_sound_${id}`,
  }
}

/** In the order the picker lists them; the first is the default. */
export const NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  sound('xylophone', 'Xylophone'),
  sound('aglyn', 'Aglyn'),
  sound('tada', 'Ta-da'),
  sound('plink', 'Plink'),
  sound('arcade', 'Arcade'),
  sound('cowbell', 'Cowbell'),
  sound('bubbles', 'Bubbles'),
  sound('steel_pan', 'Steel pan'),
  sound('cash_register', 'Cash register'),
]

/** What a person hears before they pick one. */
export const DEFAULT_NOTIFICATION_SOUND = 'xylophone'

/** The stored pick as a sound, the default for no pick or an id no longer listed. */
export function notificationSound(value: unknown): NotificationSound {
  return (
    NOTIFICATION_SOUNDS.find((entry) => entry.id === value) ??
    (NOTIFICATION_SOUNDS.find((entry) => entry.id === DEFAULT_NOTIFICATION_SOUND) as NotificationSound)
  )
}
