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

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { validateOutreachComplianceSettings } from '../model/compliance-settings'
import type {
  OutreachSettingsResponse,
  OutreachSettingsSaveResponse,
} from '../model/outreach-api'
import {
  readOutreachComplianceSettingsDoc,
  writeOutreachComplianceSettings,
} from '../storage/compliance-settings-store'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachJsonBody,
} from './route-http'

/**
 * THE COMPLIANCE SETTINGS ROUTE (AGL-2980): `outreach/settings`.
 *
 * `GET ?orgId` answers the organization's settings with the defaults
 * applied; `POST` validates a save with the function the Compliance page
 * validates with and stores it. A save that changes something writes one
 * line to the organization's activity feed, because the footer every email
 * carries is a legal statement and who last changed it is worth knowing.
 */

/** The activity line a changed save writes. */
export const OUTREACH_SETTINGS_ACTIVITY = 'Updated Outreach compliance settings'

export function createOutreachSettingsRoute(deps: OutreachRouteDeps): PluginWebApiHandler {
  return async (request) => {
    if (request.method === 'GET') {
      const gate = await outreachRouteGate(
        request,
        new URL(request.url).searchParams.get('orgId'),
        deps.gate,
      )
      if (gate instanceof Response) return gate
      const settings = await readOutreachComplianceSettingsDoc(deps.firestore(), gate.orgId)
      return outreachOk({ ok: true, settings } satisfies OutreachSettingsResponse)
    }
    if (request.method !== 'POST') return outreachMethodNotAllowed('GET, POST')

    const body = await readOutreachJsonBody(request)
    const gate = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const { settings, issues } = validateOutreachComplianceSettings(body)
    if (issues.length) {
      return outreachRefusal(400, 'invalid-settings', issues[0].message, { issues })
    }
    const result = await writeOutreachComplianceSettings(deps.firestore(), {
      orgId: gate.orgId,
      settings,
      byUid: gate.uid,
      nowMs: deps.now(),
    })
    if (result.changed) {
      await deps.logOrgActivity(
        gate.orgId,
        { uid: gate.uid, email: gate.email },
        OUTREACH_SETTINGS_ACTIVITY,
        { type: 'org', id: gate.orgId },
      )
    }
    return outreachOk({
      ok: true,
      settings: result.settings,
      changed: result.changed,
    } satisfies OutreachSettingsSaveResponse)
  }
}
