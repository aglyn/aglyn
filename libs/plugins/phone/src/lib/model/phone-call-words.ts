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

import type { PhoneCall } from './phone.types'

/** How a call reads in the Inbox, the call log and the CRM timeline (AGL-4251). */
export function describeCallForTimeline(call: PhoneCall): string {
  const minutes = call.durationSec ? Math.max(1, Math.round(call.durationSec / 60)) : 0
  if (call.status === 'voicemail') {
    return call.voicemail?.transcript ? `Voicemail: ${call.voicemail.transcript}` : 'Left a voicemail'
  }
  if (call.status === 'missed' || call.status === 'no-answer') return 'Missed call'
  const way = call.direction === 'inbound' ? 'Incoming call' : 'Outgoing call'
  return minutes ? `${way}, ${minutes} min` : way
}
