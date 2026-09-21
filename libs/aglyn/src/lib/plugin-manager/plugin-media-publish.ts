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
 * WHO REFUSES TO LET A LIBRARY ASSET BE MADE PUBLIC (AGL-3080).
 *
 * "Publish file" in the media library gives an asset its permanent CDN URL
 * back. For most assets that is what the button is for. For a file somebody
 * is SELLING it is a giveaway: the public URL names the same object as every
 * signed link a buyer was handed, so stripping the signature off any of them
 * starts working again.
 *
 * The console knew that rule, which meant it knew what a product is, which
 * two of its fields hold paid media, and how a deleted one still counts. All
 * of that belongs to whatever sells things. So the plugin holding a reason
 * declares it, and the media route asks before it publishes.
 *
 * ## ⛔ A CHECK THAT DID NOT RUN IS NOT PERMISSION
 *
 * This is the money path, and every way it can be wrong points the same way:
 * towards publishing a file somebody paid for. So the shape is the opposite
 * of the usual one —
 *
 *  - a guard that THROWS is a refusal, not a guard to skip. Something it
 *    needed was unreadable, and "we could not check" and "nothing holds this"
 *    are different answers;
 *  - a guard that answers `complete: false` is a refusal for the same reason,
 *    even with no blocker to name;
 *  - and the CALLER must load the plugins' server surfaces before it asks.
 *    An unfilled registry answers "nobody refuses", which is the honest
 *    answer for a workspace with no store and the catastrophic one for a
 *    process that has not loaded commerce yet (AGL-3025). A caller that
 *    cannot load them must refuse rather than publish.
 *
 * `null` from {@link resolvePluginMediaPublishRefusal} therefore means only
 * one thing: every guard that exists ran, and none of them objected.
 *
 * ## Many guards, first refusal wins
 *
 * More than one plugin may sell access to a file, and the person reading the
 * refusal needs one sentence, not a list of every plugin's. The guards are
 * asked in registration order and the first refusal is the answer, because a
 * second reason changes nothing about what they have to do next: the asset
 * stays private either way, and the first blocker is as good a place to start
 * as any.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/** The asset a caller is about to make public. */
export interface PluginMediaPublishRequest {
  /**
   * The library it lives in: `hosts/{hostId}` for a site's own, or
   * `orgs/{orgId}` for one the whole organization shares.
   */
  base: string
  /** The asset's id in that library. */
  mediaId: string
  /**
   * The platform's media bucket, so a raw URL from any other bucket is never
   * mistaken for this asset. Absent where the caller has none to give.
   */
  bucket?: string
}

/** One thing a guard found that is still using the asset. */
export interface PluginMediaPublishBlocker {
  /** What a person reads: a product's name, a page's title. */
  label: string
  /** The document, for a caller that links back to it. */
  refId?: string
  /** The site holding it, where the plugin scopes per site. */
  hostId?: string
}

export interface PluginMediaPublishRefusal {
  /**
   * The sentence the person who pressed Publish reads. Customer-safe: the
   * caller may show it exactly as it stands, and it names nothing internal.
   */
  reason: string
  /** What is holding the asset. May be empty — see {@link complete}. */
  blockers: readonly PluginMediaPublishBlocker[]
  /**
   * False when a ceiling or a failure stopped the guard short. An incomplete
   * "nothing holds this" is not an answer anyone may publish on, so it is a
   * refusal with no blockers rather than a pass.
   */
  complete: boolean
}

export interface PluginMediaPublishGuard {
  /**
   * Answers a refusal, or `null` when nothing this plugin holds objects.
   *
   * ⚠️ A throw is a REFUSAL, handled by the resolver — a guard is not asked
   * to turn its own unreadable state into a sentence.
   */
  check(
    request: PluginMediaPublishRequest,
  ): Promise<PluginMediaPublishRefusal | null>
}

/** A guard with the plugin that registered it. */
export type ResolvedPluginMediaPublishGuard = {
  pluginId: string
  guard: PluginMediaPublishGuard
}

export const PLUGIN_MEDIA_PUBLISH_GUARDS =
  definePluginServiceContract<PluginMediaPublishGuard>(
    'core.media-publish-guard',
    { multiple: true },
  )

/**
 * Declares that this plugin has a reason an asset may not be made public.
 * The owner is the loader's marker when a register fn is running, else
 * `options.pluginId`.
 */
export function registerPluginMediaPublishGuard(
  guard: PluginMediaPublishGuard,
  options?: { pluginId?: string },
): void {
  if (typeof guard?.check !== 'function') {
    throw new Error('a media publish guard needs a check function')
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  registerPluginService(PLUGIN_MEDIA_PUBLISH_GUARDS, guard, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    // Keyed by owner so a plugin registering twice — a hot reload, a second
    // surface — replaces its own rather than being asked twice.
    ...(pluginId ? { key: pluginId } : {}),
  })
}

/** Every registered guard, with its plugin, in registration order. */
export function listPluginMediaPublishGuards(): ResolvedPluginMediaPublishGuard[] {
  return resolvePluginServices(PLUGIN_MEDIA_PUBLISH_GUARDS).map((entry) => ({
    pluginId: entry.pluginId,
    guard: entry.impl,
  }))
}

/**
 * The first reason this asset may not be made public, or `null` when every
 * guard ran and none objected.
 *
 * ⚠️ Read the module docblock before treating `null` as permission: it is
 * only an answer once the caller has loaded the plugins' server surfaces.
 */
export async function resolvePluginMediaPublishRefusal(
  request: PluginMediaPublishRequest,
): Promise<PluginMediaPublishRefusal | null> {
  for (const { pluginId, guard } of listPluginMediaPublishGuards()) {
    let verdict: PluginMediaPublishRefusal | null
    try {
      verdict = await guard.check(request)
    } catch (error) {
      // Fail closed, loudly. The asset stays private and somebody can find
      // out why; the alternative is a paid file published because a query
      // failed.
      console.error(
        `[media-publish] "${pluginId}" could not check ${request.base}/${request.mediaId}`,
        error,
      )
      return {
        reason:
          'We could not check everything that might be using this file, so ' +
          'it stays private. Try again in a moment.',
        blockers: [],
        complete: false,
      }
    }
    if (verdict && (verdict.blockers.length > 0 || !verdict.complete)) {
      return verdict
    }
  }
  return null
}
