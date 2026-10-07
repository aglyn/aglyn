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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A branded tracking page for a parcel, offered by another plugin
 * (AGL-3635).
 *
 * A seller links each shipment to the carrier's own tracker. A merchant who
 * follows parcels through a tracking service has a page of their own for it
 * — their logo, their help links, their other products — and wants buyers
 * sent there instead. A plugin that knows such a page registers here; the
 * seller asks before it draws a shipment for a buyer, and keeps the
 * carrier's link when nobody answers.
 *
 * The words are a parcel's: a site, the record it shipped for, a carrier and
 * a number. Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-tracking-pages`); it is not in the
 * barrel.
 */

export interface PluginTrackingPageRequest {
  hostId: string
  recordId: string
  /** The carrier as the record names it: free text. */
  carrier?: string | null
  trackingNumber: string
  signal?: AbortSignal
}

/** The page's URL, or `null` when this plugin has none for that parcel. */
export type PluginTrackingPageProvider = (request: PluginTrackingPageRequest) => Promise<string | null>

const PLUGIN_TRACKING_PAGES = definePluginServiceContract<PluginTrackingPageProvider>(
  'core.tracking-pages',
  { multiple: true },
)

/** Joins the providers. Re-registering under the same plugin replaces its own. */
export function registerPluginTrackingPage(
  provider: PluginTrackingPageProvider,
  options?: { pluginId?: string },
): void {
  const pluginId = getRegisteringPluginId() ?? options?.pluginId
  registerPluginService(PLUGIN_TRACKING_PAGES, provider, {
    ...(pluginId ? { pluginId } : {}),
  })
}

const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i

/**
 * The first provider's page for each parcel, asked together and given up
 * on after `timeoutMs`. Answers a map from tracking number to an `https:`
 * URL; a parcel no provider answered for is absent, and the seller keeps
 * its own link. Never throws.
 */
export async function resolvePluginTrackingPages(
  requests: ReadonlyArray<Omit<PluginTrackingPageRequest, 'signal'>>,
  options: { timeoutMs: number },
): Promise<Map<string, string>> {
  const pages = new Map<string, string>()
  const providers = resolvePluginServices(PLUGIN_TRACKING_PAGES)
  const asked = requests.filter((request) => String(request.trackingNumber ?? '').trim())
  if (!providers.length || !asked.length) return pages
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('late')
    }, Math.max(0, options.timeoutMs))
  })
  try {
    await Promise.all(
      asked.map(async (request) => {
        for (const entry of providers) {
          const answer = await Promise.race([
            entry.impl({ ...request, signal: controller.signal }).catch((error: unknown): null => {
              console.error(`[tracking-pages] provider "${entry.pluginId}" failed for ${request.hostId}`, error)
              return null
            }),
            deadline,
          ])
          if (answer === 'late') return
          if (typeof answer === 'string' && HTTPS_URL.test(answer.trim())) {
            pages.set(request.trackingNumber, answer.trim())
            return
          }
        }
      }),
    )
    return pages
  } finally {
    if (timer) clearTimeout(timer)
  }
}
