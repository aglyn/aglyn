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
 * HOW A PLUGIN DROPS A SITE'S CACHED PAGES (AGL-3080).
 *
 * The shell hands this one down rather than up. Every other contract in this
 * directory is a plugin telling the shell something; this is the shell
 * telling plugins it can do something — purge the rendered HTML of a site —
 * because purging it takes the tenant's cache tags and revalidation paths,
 * which live in the app and are not a plugin's to know.
 *
 * ## The case, and why it is a kill switch rather than a nicety
 *
 * A marketplace plugin can be REVOKED. Revoking writes a stop on the
 * version, and the tenant refuses revoked bytes at render time — but a page
 * already rendered and cached does not re-render to find that out. So the
 * revoke has a second half: drop the cached pages of every site running it.
 * Without it a revoked plugin keeps executing in visitors' browsers for as
 * long as the cache holds, which is the whole failure the stop exists to
 * prevent.
 *
 * ## ⛔ AN ABSENT IMPLEMENTATION IS AN ANSWER, AND IT IS `complete: false`
 *
 * The registry is filled by the APP at boot. A process that has not filled
 * it resolves "no cache to drop" — indistinguishable, from the inside, from
 * a workspace whose sites were all already fresh. That is the AGL-3025 shape
 * and on this path it means a revoked plugin quietly kept serving.
 *
 * So there is no silent branch. {@link dropPluginSiteCache} always answers a
 * {@link PluginSiteCacheResult}, and `complete` is false whenever the drop
 * did not certainly happen — nothing registered, or the implementation
 * threw. A caller acts on that: the revoke itself must still stand (a plugin
 * left un-revoked because a cache purge failed is strictly worse), but the
 * reader has to be told the purge did not run, and the log has to carry it.
 *
 * ## The split, in one line
 *
 * The plugin knows WHICH sites — that is its own install pins, its own
 * collection. The shell knows HOW to drop one, and owns the fan-out policy:
 * the cap, the concurrency, and saying out loud when a cap truncated the
 * list. Neither half is guessable from the other side.
 */

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** What the caller wants dropped, and why. */
export interface PluginSiteCacheRequest {
  /**
   * The sites whose rendered pages must go. Duplicates are the caller's to
   * avoid or not — the implementation is free to collapse them.
   */
  hostIds: readonly string[]
  /**
   * Why, in a few words, for the fan-out's own logging: a truncated purge
   * is only debuggable if the record says what it was purging for.
   * `'marketplace listing revoked'`, not `'revoke'`.
   */
  reason: string
}

export interface PluginSiteCacheResult {
  /** Sites whose cached pages were dropped. */
  dropped: number
  /**
   * Sites deliberately left holding cached pages because the fan-out hit
   * its cap. Not an error — a decision the shell made and logged — but a
   * number a caller may want to surface, because those sites are still
   * serving what was just stopped.
   */
  skipped: number
  /**
   * Whether the drop certainly happened. FALSE when no implementation is
   * registered or one threw, and a caller must not read `dropped: 0` as
   * "there was nothing to drop" without checking this first.
   */
  complete: boolean
}

export interface PluginSiteCache {
  drop(request: PluginSiteCacheRequest): Promise<PluginSiteCacheResult>
}

/**
 * One implementation: the app's. Two would be two cache layers disagreeing
 * about whether a page is gone, and the second to register would be the one
 * nobody knew about.
 */
export const PLUGIN_SITE_CACHE = definePluginServiceContract<PluginSiteCache>(
  'core.site-cache',
  { multiple: false },
)

/**
 * Installs the app's implementation. Called once, at server boot, by the app
 * that owns the tenant's cache.
 *
 * `pluginId` is required from outside a plugin's register fn, as it is for
 * every service: the app passes its own marker, and the contract refuses an
 * anonymous registration rather than accepting one nothing can be traced to.
 */
export function registerPluginSiteCache(
  cache: PluginSiteCache,
  options?: { pluginId?: string },
): void {
  if (typeof cache?.drop !== 'function') {
    throw new Error('a site cache needs a drop function')
  }
  registerPluginService(PLUGIN_SITE_CACHE, cache, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Whether an implementation is installed — for a caller that wants to say so. */
export function hasPluginSiteCache(): boolean {
  return Boolean(resolvePluginService(PLUGIN_SITE_CACHE))
}

/**
 * Drops the cached pages of the named sites.
 *
 * NEVER THROWS and never silently succeeds: a failure comes back as
 * `complete: false` with the reason logged, because the callers are stop
 * paths that must complete their own work either way. Read `complete`
 * before reading `dropped`.
 */
export async function dropPluginSiteCache(
  request: PluginSiteCacheRequest,
): Promise<PluginSiteCacheResult> {
  const hostIds = [...new Set(request.hostIds.filter(Boolean))]
  if (!hostIds.length) {
    // Nothing asked for is the one case where "nothing dropped" is complete
    // on its own terms, whether or not anything is registered.
    return { dropped: 0, skipped: 0, complete: true }
  }
  const cache = resolvePluginService(PLUGIN_SITE_CACHE)
  if (!cache) {
    console.error(
      `[site-cache] no implementation is installed, so ${hostIds.length} ` +
        `site(s) keep their cached pages after: ${request.reason}. The app ` +
        'registers this at boot; a process that has not is serving stopped ' +
        'content.',
    )
    return { dropped: 0, skipped: 0, complete: false }
  }
  try {
    return await cache.drop({ ...request, hostIds })
  } catch (error) {
    console.error(
      `[site-cache] the drop failed after: ${request.reason}`,
      error,
    )
    return { dropped: 0, skipped: 0, complete: false }
  }
}
