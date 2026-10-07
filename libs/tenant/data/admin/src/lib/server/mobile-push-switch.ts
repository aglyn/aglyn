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
 * Whether this deployment sends mobile push (AGL-3648).
 *
 * On unless `MOBILE_PUSH_ENABLED=0`: the variable is a kill switch, not an
 * opt-in, and it governs every push sender. Kept apart from the senders so
 * `notifyUsers` can ask before it loads one, and every caller reads the same
 * answer.
 */
export function mobilePushEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env['MOBILE_PUSH_ENABLED'] ?? '').trim() !== '0'
}

/**
 * Whether the Expo Push API relay may carry this deployment's push.
 *
 * Off unless `EXPO_PUSH_RELAY=1`. The Aglyn apps receive push from Apple Push
 * Notification service and Firebase Cloud Messaging directly, and Expo is not
 * on the Subprocessors list, so the relay sends only for an operator who opts
 * in and names Expo on their own list.
 */
export function expoPushRelayEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env['EXPO_PUSH_RELAY'] ?? '').trim() === '1'
}
