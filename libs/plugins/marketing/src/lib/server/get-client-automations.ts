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
import { compileClientAutomations, type RawHostAction } from '../model'
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
  /**
   * `actions` entitlement (AGL-577). Basic presentational steps
   * (menu/drawer/show-hide/class/nav/alert) always load; the advanced
   * client steps (overlay/showHtml/analytics) and server steps are
   * dropped when this is false. Server steps are re-checked server-side
   * on dispatch, so a false value here only trims the client payload.
   */
  actionsEntitled: boolean
  /** Business-tier gate for `runJs` steps (dropped when false). */
  allowJs: boolean
}): Promise<ClientAutomation[]> {
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('actions')
      .limit(50)
      .get()
    const actions: RawHostAction[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      action: doc.data() as Aglyn.HostAction,
    }))
    // Shared mapping (AGL-830): the same pure compiler the editor Preview
    // uses, so live and preview trim + shape automations identically.
    return compileClientAutomations(actions, {
      path: options.path,
      actionsEntitled: options.actionsEntitled,
      allowJs: options.allowJs,
    })
  } catch (error) {
    console.error(error)
    return []
  }
}

export default getClientAutomations
