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

import type { SiteStarterSummary } from '../plugin-manager/plugin-site-starters'

/**
 * A starter picked in "Choose your starter" (AGL-4049), as Create site
 * decides about it: whether a site can be created from it yet, and what the
 * create's refusal of it asks for. Pure, so every surface that offers the
 * picker — the console, the native apps — decides the same way.
 */

/**
 * What stands between a pick and Create site: nothing picked (`none`), or a
 * price the workspace has not paid (`purchase`); `null` when the site can be
 * created from it. `owned` is what the surface knows better than the
 * search's own answer (the person just paid, or the create still asked for
 * payment); absent, the summary's `owned` stands.
 */
export type SiteStarterPickBlock = 'none' | 'purchase'

export function siteStarterPickBlock(
  pick: SiteStarterSummary | null | undefined,
  owned?: boolean,
): SiteStarterPickBlock | null {
  if (!pick) return 'none'
  if (pick.priceUsd > 0 && !(owned ?? pick.owned === true)) return 'purchase'
  return null
}

/** What Create site does with a create that refused the starter it was asked for. */
export interface SiteStarterPickRefused {
  /** The pick stays: it can still be created from, once bought. */
  keep: boolean
  /** It is the price that stands in the way, so buying it is offered. */
  purchase: boolean
  /** The create's own words for why. */
  message: string
}

/**
 * The create's refusal of THIS pick, or `null` for a refusal about anything
 * else (the name, the address, the plan's site count), which Create site
 * answers as it always has. A refusal of a pick names its listing: a 402 is
 * a price to pay, and the pick stays with "Buy and continue"; anything else
 * (the release not open to the workspace, a starter that is gone, one with
 * more pages than the plan holds, an AI starter where the AI start is not
 * offered) clears the pick, with the reason said.
 */
export function readSiteStarterPickRefusal(
  status: number,
  payload: unknown,
  listingId: string,
): SiteStarterPickRefused | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = payload as Record<string, unknown>
  if (!listingId || body['listingId'] !== listingId) return null
  const error = body['error']
  const message = typeof error === 'string' && error.trim() ? error.trim() : 'That starter cannot be used.'
  if (status === 402) return { keep: true, purchase: true, message }
  return { keep: false, purchase: false, message }
}
