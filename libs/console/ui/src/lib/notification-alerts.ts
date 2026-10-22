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

import { notificationSound, type NotificationSound } from '@aglyn/aglyn/app-utils/notification-sounds'

/** Unread badge for the tab title; caps so the title stays readable. */
export function unreadBadge(count: number): string {
  if (!count || count < 1) return ''
  return count > 99 ? '(99+)' : `(${count})`
}

/**
 * The exact inverse of `unreadBadge`, anchored at the start of a title.
 *
 * `\+?` is not decoration — `unreadBadge` caps at `(99+)` above, so a regex
 * that only matched `\(\d+\)` would leave the badge on precisely the busiest
 * users' titles. The two must stay the same shape, which is why they live
 * three lines apart in one file rather than as a literal at each call site.
 */
const UNREAD_BADGE_PREFIX = /^\(\d+\+?\)\s+/

/**
 * Strip the unread-count tab badge from a title (AGL-2060).
 *
 * Two callers, and the reason they must share this:
 *
 * 1. `notifications-menu.component.tsx` — strips before re-applying, so the
 *    badge never compounds into `(1) (1) Aglyn`, and strips again on cleanup.
 * 2. `page-view-params.ts` — strips before the title is reported to GA4.
 *
 * The second is the one that bit us. GA4 reads `page_title` from
 * `document.title` at the instant the hit fires, so the badge — a per-user,
 * per-moment counter — became a reporting DIMENSION VALUE. One console page
 * arrived as three rows (6.2K / 2.2K / 1.7K), split by how many unread
 * notifications the user happened to have. Nothing is wrong with the badge;
 * it was simply never meant to be data.
 *
 * The badge feature stays. Only its reflection in analytics goes away.
 */
export function stripUnreadBadge(title: string): string {
  if (!title) return ''
  return title.replace(UNREAD_BADGE_PREFIX, '')
}

/**
 * Plays the person's notification sound (the default when none is given).
 *
 * The files are the ones the Apple and Android apps play for a push, so the
 * console and the apps sound alike. A notification arriving passively plays
 * only once the page has had a user interaction (sticky activation), which an
 * in-use console always has; a refusal is silent.
 */
export function playNotificationChime(sound: NotificationSound = notificationSound(undefined)): void {
  try {
    if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return
    const audio = new window.Audio(sound.web)
    audio.volume = 0.7
    void audio.play().catch((): undefined => undefined)
  } catch {
    // Autoplay policy, no audio device, or a locked-down page.
  }
}

/** Whether desktop notifications can be shown right now. */
export function desktopNotificationsGranted(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  )
}

/** Current permission, or 'unsupported' where the API is missing. */
export function desktopNotificationPermission():
  | NotificationPermission
  | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission
}

/** Prompt for permission; must be called from a user gesture. */
export async function requestDesktopNotifications(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export interface DesktopNotificationInput {
  title: string
  body?: string
  /** Deduplicates re-renders of the same notification. */
  tag?: string
  /** Followed when the notification is clicked. */
  onActivate?: () => void
  /**
   * Show even while the tab is visible. Only for the settings "Test" action:
   * the tab is by definition focused when you click it, so the normal
   * hidden-only rule would make a test silently do nothing.
   */
  force?: boolean
}

/**
 * Show a desktop notification, if permitted.
 *
 * Deliberately a no-op while the tab is visible: the in-app bell and chime
 * already cover that case, and duplicating them in the OS tray is the fastest
 * way to get notifications switched off entirely.
 */
export function showDesktopNotification(
  input: DesktopNotificationInput,
): boolean {
  if (!desktopNotificationsGranted()) return false
  if (!input.force && typeof document !== 'undefined' && !document.hidden) {
    return false
  }
  try {
    const notification = new Notification(input.title, {
      body: input.body,
      tag: input.tag,
      icon: '/_static/images/favicons/favicon.png',
    })
    notification.onclick = () => {
      try {
        window.focus()
        input.onActivate?.()
      } finally {
        notification.close()
      }
    }
    return true
  } catch {
    return false
  }
}
