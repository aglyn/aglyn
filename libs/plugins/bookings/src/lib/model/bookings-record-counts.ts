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
  registerPluginRecordCountSource,
  type PluginRecordCountSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-counts'
import { collection } from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * How many bookings a site took, counted in the console for another plugin's
 * figure (AGL-3080) — a campaign's booking conversions out of all of them.
 * Every booking is the site's own.
 */
export const bookingRecordCountSource: PluginRecordCountSource = {
  query(firestore, request) {
    return request.hostId ? collection(firestore, 'hosts', request.hostId, 'bookings') : null
  },
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerBookingsRecordCounts(): void {
  registerPluginRecordCountSource('booking', bookingRecordCountSource, { pluginId: BUNDLE_ID })
}
