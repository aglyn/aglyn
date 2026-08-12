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
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * One of three per-render reads AGL-1302 left uncached (AGL-1440).
 *
 * The automations engine loads on every plan, so this query ran on every render
 * of every path on every site — and an empty result still bills one read. 60s
 * backstop; `revalidateTag(tenant-data:{hostId})` busts it on publish.
 *
 * ONLY the raw documents are cached. The compile below is deliberately outside,
 * and that is the whole safety argument for this cache: `compileClientAutomations`
 * drops the advanced and server steps for orgs without `actions`, and `runJs`
 * for orgs without `webhooks`. Caching a compiled result would pin one org's
 * plan verdict onto the entry — serving a downgraded org paid steps, or a
 * just-upgraded one the trimmed payload, until the tag was busted. The
 * documents are the same for every visitor and every plan; the trim is not.
 */
const HOST_ACTIONS_TTL_SECONDS = 60

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
    const actions = await withRenderCache({
      key: ['marketing-host-actions', options.hostId],
      revalidate: HOST_ACTIONS_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: () => readHostActions(options.hostId),
    })
    // Shared mapping (AGL-830): the same pure compiler the editor Preview
    // uses, so live and preview trim + shape automations identically. Run per
    // render, never cached — see `HOST_ACTIONS_TTL_SECONDS`.
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

/** The host's raw `actions` documents — pure published data, no plan in it. */
async function readHostActions(hostId: string): Promise<RawHostAction[]> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('actions')
    .limit(50)
    .get()
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    action: doc.data() as Aglyn.HostAction,
  }))
}

export default getClientAutomations
