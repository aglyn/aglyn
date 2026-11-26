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
 * HOW A VISITOR BUYS OR BOOKS A RECORD FROM ANOTHER PLUGIN'S ELEMENT
 * (AGL-4252).
 *
 * An events calendar shows a "Get tickets" button on a dated event; the
 * ticket is a store product, or a bookings service, that the calendar's
 * plugin may neither read nor post to by name. So the plugin that owns the
 * record kind answers the one question the button needs: what it is called,
 * what it costs as a reader sees it, and what pressing it does on the
 * published site.
 *
 * ## What pressing it does
 *
 * One of two things, both on the site's own origin and with the visitor's
 * own cookies, so the server that answers here never buys, books or holds
 * anything:
 *
 *  - `link`: open a page of the site (a booking page on its service, a
 *    product page);
 *  - `post`: send `body` as JSON to `endpoint`, one of the site's own
 *    `/api/…` doors; once it answers ok, raise `notify` on `window` (the
 *    owner's own "the cart changed" event, so its mini cart refreshes) and
 *    open `then` when there is one. The owner builds the body,
 *    so a date the element knows (`dayKey`) reaches the owner's own rule —
 *    a check-in item's use day, say — and is refused there, not here, when
 *    the record does not take one.
 *
 * ## Server-side, read for a published page
 *
 * `resolve` runs with the Admin SDK for a site's public door that already
 * decided the record is the site's to show. It answers `null` when the
 * record is gone or not sold online, which the element reads as "no button".
 *
 * One record kind, one owner: a second plugin offering a kind another already
 * offers is refused naming both. Reached by its own subpath, never the barrel.
 */

export interface PluginSiteOfferRequest {
  hostId: string
  /** The record's document id. */
  id: string
  /** The calendar day the visitor is buying for, `YYYY-MM-DD`, when known. */
  dayKey?: string
}

/** What pressing the offer's button does on the published site. */
export type PluginSiteOfferAction =
  | {
      kind: 'link'
      /** A site-relative path, with any query it needs. */
      href: string
    }
  | {
      kind: 'post'
      /** A site-relative `/api/…` path. */
      endpoint: string
      body: Readonly<Record<string, unknown>>
      /** A DOM event name raised on `window` once the post answers ok. */
      notify?: string
      /** What the element says once it has: "Added to your cart". */
      done?: string
      /** A site-relative page to open once the post answers ok. */
      then?: string
    }

export interface PluginSiteOffer {
  title: string
  /** One short line already worded for a visitor: a price, "Free". */
  caption?: string
  imageUrl?: string
  action: PluginSiteOfferAction
}

export interface PluginSiteOfferSource {
  /** `null` when the record is gone or cannot be bought or booked online. */
  resolve(request: PluginSiteOfferRequest): Promise<PluginSiteOffer | null>
}

export const PLUGIN_SITE_OFFERS =
  definePluginServiceContract<PluginSiteOfferSource>('core.site-offers', {
    multiple: true,
  })

/** Registers how `kind`'s records are bought or booked; the same owner again replaces its own. */
export function registerPluginSiteOffer(
  kind: string,
  source: PluginSiteOfferSource,
  options?: { pluginId?: string },
): void {
  const key = kind.trim()
  if (!key) throw new Error('a site offer needs a record kind')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_SITE_OFFERS).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `record kind "${key}" is already offered by "${incumbent.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_SITE_OFFERS, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

/** Whether a path is one of the site's own: starts with one slash, no scheme. */
export function isSiteRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    value.length <= 2048
  )
}

/** Whether an offer's action stays on the site's own origin. */
function actionIsSiteRelative(
  action: PluginSiteOfferAction | undefined,
): boolean {
  if (!action) return false
  if (action.kind === 'link') return isSiteRelativePath(action.href)
  return (
    isSiteRelativePath(action.endpoint) &&
    action.endpoint.startsWith('/api/') &&
    (action.then === undefined || isSiteRelativePath(action.then)) &&
    (action.notify === undefined ||
      /^[a-z][a-z0-9:._-]{0,63}$/i.test(action.notify))
  )
}

/**
 * The offer for one record, or `null` when no enabled plugin offers the kind,
 * the record is not there, the owner fails, or its action would leave the
 * site. `enabledPluginIds` is the site's enabled set: a switched-off store
 * offers nothing.
 */
export async function resolvePluginSiteOffer(
  kind: string,
  request: PluginSiteOfferRequest,
  enabledPluginIds?: readonly string[],
): Promise<PluginSiteOffer | null> {
  const key = kind.trim()
  const entry = resolvePluginServices(PLUGIN_SITE_OFFERS).find(
    (one) => one.key === key,
  )
  if (!entry) return null
  if (enabledPluginIds && !enabledPluginIds.includes(entry.pluginId))
    return null
  try {
    const offer = await entry.impl.resolve(request)
    return offer && actionIsSiteRelative(offer.action) ? offer : null
  } catch (error) {
    console.error(`[site-offers] "${key}" failed`, error)
    return null
  }
}
