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

import type { PhoneCall } from '../model/phone.types'
import { describeCallForTimeline } from '../model/phone-call-words'

/** "2:41 PM" today, "Mon 2:41 PM" this week, "Nov 3" before. */
export function formatPhoneTime(atMs: number, nowMs: number = Date.now()): string {
  if (!atMs) return ''
  const at = new Date(atMs)
  const now = new Date(nowMs)
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  if (nowMs - atMs < 6 * 24 * 60 * 60 * 1000) {
    return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
  }
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Missed call", "Incoming call, 3 min", "Voicemail". */
export function describePhoneCall(call: PhoneCall): string {
  return describeCallForTimeline(call)
}
