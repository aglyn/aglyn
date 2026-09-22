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

import { registerPluginContactCaptureWriter } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import type { PluginContactCaptureRequest } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * A plugin that keeps people, standing in for the one that does (AGL-3080).
 *
 * Bookings reports the people it meets — a booking request — through the contact-capture
 * contract and imports no record system, so its specs stand a writer up the
 * way the loader would. One plugin may not import another, which is why this
 * is here rather than borrowed from the CRM.
 *
 * What these specs certify is that the door REPORTS the right capture: the
 * address, the door's own word for itself, the stage floor and the consent.
 * That the real record system turns that into the same contact it always
 * wrote is held where both plugins can be reached — the CRM's own adapter
 * specs and the forms-door specs in `apps/tenant`.
 *
 * Returns the list the writer fills, in the order the doors reported them.
 */
export function standInRecordSystem(
  options: {
    /**
     * Start from no plugin services at all — the default. `false` keeps
     * whatever a spec already stood in beside it (a tax profile), because
     * the registry is one slot per service and a reset takes every slot.
     */
    reset?: boolean
  } = {},
): PluginContactCaptureRequest[] {
  if (options.reset !== false) resetPluginServicesForTests()
  const captured: PluginContactCaptureRequest[] = []
  registerPluginContactCaptureWriter(
    {
      capture: async (request) => {
        captured.push(request)
        return { ok: true, record: 'contact', contactId: `contact-${captured.length}`, created: true }
      },
    },
    { pluginId: 'record-system' },
  )
  return captured
}
