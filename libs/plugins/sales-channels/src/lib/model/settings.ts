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
 * A site's channel defaults (AGL-3637): what a feed says for a product that
 * leaves a field blank. Kept by this plugin in
 * `hosts/{hostId}/salesChannels/settings` and written only through its
 * settings route.
 */

export type ChannelCondition = 'new' | 'refurbished' | 'used'

export interface SalesChannelSettings {
  /**
   * The brand for a product with none of its own. Empty means the store's
   * name, which is the brand of a shop that makes what it sells.
   */
  defaultBrand: string
  /** The condition for a product with none of its own. */
  defaultCondition: ChannelCondition
  /** A Google product category for a product with none of its own. */
  defaultGoogleCategory: string
}

export const DEFAULT_SALES_CHANNEL_SETTINGS: SalesChannelSettings = {
  defaultBrand: '',
  defaultCondition: 'new',
  defaultGoogleCategory: '',
}

const clean = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Stored or posted settings made safe; never throws. */
export function normalizeSalesChannelSettings(value: unknown): SalesChannelSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const condition = String(raw['defaultCondition'] ?? '').trim().toLowerCase()
  return {
    defaultBrand: clean(raw['defaultBrand'], 70),
    defaultCondition:
      condition === 'refurbished' || condition === 'used' ? condition : 'new',
    defaultGoogleCategory: clean(raw['defaultGoogleCategory'], 750),
  }
}
