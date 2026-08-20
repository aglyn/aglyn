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

import type { PluginConfigSchema } from '@aglyn/aglyn'

/**
 * The ceiling a register may discount to, when the merchant has not set one
 * (AGL-2161).
 *
 * 100, i.e. today's behaviour exactly. That is deliberate and is the one
 * number in this fix that is NOT a safety judgement:
 *
 * - A full comp is a legitimate register operation — a damaged item, a
 *   goodwill gesture, a staff meal — and every merchant on the platform has
 *   had it since POS shipped.
 * - Any lower default would change what merchants charge their own customers
 *   on the day it deployed, without them asking. Picking that number is a
 *   merchant policy decision, not a bug fix, and inventing one here would be
 *   the same class of mistake as inventing a billing rate.
 *
 * What AGL-2161 actually fixes is that there was no ceiling to set and no
 * refusal when one was exceeded: the request body's `discountPct` was clamped
 * into range and rung up, so a register sending `150` silently comped the
 * whole sale. The ceiling is now real, enforced server-side, refused rather
 * than clamped, and one config value away from being lower.
 */
export const POS_MAX_DISCOUNT_PCT_DEFAULT = 100

/**
 * Commerce plugin config schema (AGL-428 framework, AGL-2161 adopter).
 *
 * PURE DATA (type-only aglyn import), the same shape as bookings': the client
 * barrel registers it via '@aglyn/aglyn' and the /server entry via
 * '@aglyn/aglyn/server', so neither bundle drags in the other's barrel.
 *
 * `min`/`max` are not decoration — `mergePluginConfig` coerces a stored value
 * into the declared range and falls back to the default on junk, so the
 * ceiling itself cannot be forged out of bounds by a manager editing the
 * settings doc directly.
 */
export const COMMERCE_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: 'commerce',
  fields: [
    {
      key: 'posMaxDiscountPct',
      label: 'Maximum register discount (%)',
      type: 'number',
      min: 0,
      max: 100,
      description:
        'The largest discount the point of sale will accept on a sale. ' +
        'A register that asks for more is refused, and the sale is not rung ' +
        'up. Set to 0 to stop staff discounting at the register entirely.',
    },
  ],
  defaults: { posMaxDiscountPct: POS_MAX_DISCOUNT_PCT_DEFAULT },
}

/**
 * The ceiling for one org, read defensively (AGL-2161).
 *
 * Spelled here rather than at the call site so the POS route and any later
 * reader cannot disagree about what a missing or malformed value means. The
 * framework has already clamped and defaulted by the time this runs; the
 * second `Number.isFinite` guard is for the schema-less case, where
 * `getPluginConfig` returns the raw doc untouched.
 */
export function posMaxDiscountPct(
  config: Record<string, unknown> | null | undefined,
): number {
  const raw = Number(config?.['posMaxDiscountPct'])
  if (!Number.isFinite(raw)) return POS_MAX_DISCOUNT_PCT_DEFAULT
  return Math.min(100, Math.max(0, raw))
}
