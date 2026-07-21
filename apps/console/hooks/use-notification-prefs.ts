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

import { useCallback, useEffect, useState } from 'react'

export interface NotificationAlertPrefs {
  /** Chime when a notification arrives. */
  sound: boolean
  /** Desktop notification while the tab is in the background. */
  desktop: boolean
  /** Unread count badge in the browser tab title. */
  tabBadge: boolean
}

export const NOTIFICATION_ALERT_PREFS_KEY = 'aglyn:notification-alerts'

const DEFAULTS: NotificationAlertPrefs = {
  // Off by default — a console that starts making noise unprompted is worse
  // than one you have to switch on. The tab badge is silent, so it leads.
  sound: false,
  desktop: false,
  tabBadge: true,
}

function read(): NotificationAlertPrefs {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_ALERT_PREFS_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<NotificationAlertPrefs>
    return {
      sound: parsed.sound ?? DEFAULTS.sound,
      desktop: parsed.desktop ?? DEFAULTS.desktop,
      tabBadge: parsed.tabBadge ?? DEFAULTS.tabBadge,
    }
  } catch {
    return DEFAULTS
  }
}

/**
 * Per-device notification alert settings (AGL-650).
 *
 * These live in localStorage rather than `users/{uid}.notificationPrefs`
 * (which holds the server-side category mutes) because every one of them is
 * a property of THIS browser: the desktop-notification permission is granted
 * per origin per device, and whether you want sound on your work laptop says
 * nothing about your phone.
 *
 * Reads lazily on mount rather than during render so server and client agree
 * on the first paint — localStorage is unavailable during SSR, and seeding
 * state from it directly would hydrate-mismatch.
 */
export function useNotificationAlertPrefs(): [
  NotificationAlertPrefs,
  (patch: Partial<NotificationAlertPrefs>) => void,
] {
  const [prefs, setPrefs] = useState<NotificationAlertPrefs>(DEFAULTS)

  useEffect(() => {
    setPrefs(read())
  }, [])

  const update = useCallback((patch: Partial<NotificationAlertPrefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch }
      try {
        window.localStorage.setItem(
          NOTIFICATION_ALERT_PREFS_KEY,
          JSON.stringify(next),
        )
      } catch {
        // Private mode / storage disabled — the setting just won't persist.
      }
      return next
    })
  }, [])

  return [prefs, update]
}

export default useNotificationAlertPrefs
