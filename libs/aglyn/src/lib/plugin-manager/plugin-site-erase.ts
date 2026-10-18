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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * A SERVER PROCESS DELETES A SITE THE WAY ITS ADMIN DOES (AGL-3936).
 *
 * Deleting a site is more than its documents: the erase itself
 * (`eraseHost`: Storage, the routing index, the org's `hosts` map and its
 * pooled seats, every member's projection, the Firestore tree), the site's
 * sending domain, which only the console holds the credentials to release,
 * the tenant's cached pages and names, and the record of it in the
 * workspace's feed and the staff audit. The console's delete route does all
 * of it in that order. A plugin with no request behind it — the AI beat
 * removing the empty site a cancelled guided start left — has no route to
 * call, and a partial delete of its own would strand whichever half it left
 * out. So the console registers its one implementation at boot
 * (`instrumentation.ts`), the same direction as `core.site-cache`, and a
 * plugin names the site and why.
 *
 * Authorization is the caller's. The implementation re-reads the site, and
 * refuses one in a consent group as the delete route does.
 *
 * A process with no implementation answers `{ erased: false, reason:
 * 'unavailable' }` from {@link erasePluginSite}, never a silent success: a
 * caller keeps whatever told it to delete, and tries again later.
 */

export interface PluginSiteEraseRequest {
  hostId: string
  /**
   * What the workspace's feed says happened, in its own words: "Removed an
   * empty site". The feed names the site beside it.
   */
  activity: string
  /** Why, for the staff audit and the log: `'ai-start-empty'`. */
  reason: string
  /**
   * The workspace the caller believes owns the site. A site that now belongs
   * to another workspace is not erased (`reason: 'moved'`).
   */
  orgId: string
}

export type PluginSiteEraseResult =
  | { erased: true }
  | {
      erased: false
      /**
       * `missing`: the site is already gone. `moved`: it belongs to another
       * workspace now. `consent-group`: its consent group still needs it.
       * `unavailable`: nothing is installed, or the erase failed.
       */
      reason: 'missing' | 'moved' | 'consent-group' | 'unavailable'
    }

export interface PluginSiteEraser {
  erase(request: PluginSiteEraseRequest): Promise<PluginSiteEraseResult>
}

/** One implementation: the app that holds the delete route's credentials. */
export const PLUGIN_SITE_ERASER = definePluginServiceContract<PluginSiteEraser>(
  'core.site-erase',
  { multiple: false },
)

export function registerPluginSiteEraser(
  eraser: PluginSiteEraser,
  options?: { pluginId?: string },
): void {
  if (typeof eraser?.erase !== 'function') {
    throw new Error('a site eraser needs an erase function')
  }
  registerPluginService(PLUGIN_SITE_ERASER, eraser, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Whether an implementation is installed. */
export function hasPluginSiteEraser(): boolean {
  return Boolean(resolvePluginService(PLUGIN_SITE_ERASER))
}

/**
 * Deletes one site through the app's implementation. Never throws: nothing
 * installed, or an implementation that threw, answers `unavailable` with
 * the reason logged.
 */
export async function erasePluginSite(
  request: PluginSiteEraseRequest,
): Promise<PluginSiteEraseResult> {
  const eraser = resolvePluginService(PLUGIN_SITE_ERASER)
  if (!eraser) {
    console.error(
      `[site-erase] no implementation is installed, so site ${request.hostId} ` +
        `was not deleted (${request.reason}). The app registers this at boot.`,
    )
    return { erased: false, reason: 'unavailable' }
  }
  try {
    return await eraser.erase(request)
  } catch (error) {
    console.error(`[site-erase] deleting site ${request.hostId} failed (${request.reason})`, error)
    return { erased: false, reason: 'unavailable' }
  }
}
