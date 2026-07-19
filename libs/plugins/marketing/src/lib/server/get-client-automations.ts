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

import * as Aglyn from '@aglyn/aglyn/server'
import * as MarketingModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * A site-event automation prepared for the page runtime (AGL-256): the
 * trigger config the client engine needs, its CLIENT steps, and whether
 * server steps exist (fired actions then dispatch to
 * /api/events/dispatch). Fail-open: errors return an empty list.
 */
export type { ClientAutomation } from '../model/site-contract'
import type { ClientAutomation } from '../model/site-contract'

export async function getClientAutomations(options: {
  hostId: string
  /** Leading-slash page path for pathPattern targeting. */
  path: string
  /** Business-tier gate for `runJs` steps (dropped when false). */
  allowJs: boolean
}): Promise<ClientAutomation[]> {
  const automations: ClientAutomation[] = []
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('actions')
      .limit(50)
      .get()
    for (const doc of snapshot.docs) {
      const action = doc.data() as Aglyn.HostAction
      if ((action as any).deletedAt || action.enabled === false) continue
      const event = String(action.trigger?.event ?? '')
      if (!Aglyn.isSiteEventType(event)) continue
      const pathPattern = action.trigger?.pathPattern?.trim()
      if (
        pathPattern &&
        !MarketingModel.overlayMatchesPath({ pathPatterns: [pathPattern] }, options.path)
      ) {
        continue
      }
      const clientSteps = (action.steps ?? []).filter(
        (step) =>
          Aglyn.isClientActionStep(step) &&
          (options.allowJs || step.type !== 'runJs'),
      )
      const hasServerSteps = (action.steps ?? []).some(
        (step) => !Aglyn.isClientActionStep(step),
      )
      if (!clientSteps.length && !hasServerSteps) continue
      automations.push({
        id: doc.id,
        event,
        ...(action.trigger?.selector
          ? { selector: action.trigger.selector }
          : {}),
        ...(Number(action.trigger?.threshold) > 0
          ? { threshold: Number(action.trigger.threshold) }
          : {}),
        ...(action.trigger?.oncePerVisitor === true
          ? { oncePerVisitor: true }
          : {}),
        ...(action.trigger?.oncePerSession === true
          ? { oncePerSession: true }
          : {}),
        ...(Number(action.trigger?.cooldownMinutes) >= 1
          ? { cooldownMinutes: Number(action.trigger?.cooldownMinutes) }
          : {}),
        // Repeatable UI choreography (AGL-562): menu/drawer interactions
        // fire on every occurrence instead of once per pageview.
        ...(action.trigger?.everyTime === true ? { everyTime: true } : {}),
        steps: clientSteps,
        hasServerSteps,
      })
    }
  } catch (error) {
    console.error(error)
  }
  return automations
}

export default getClientAutomations
