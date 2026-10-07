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

import type { CatalogOffer, CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { DEFAULT_SALES_CHANNEL_SETTINGS, type SalesChannelSettings } from '../model/settings'

/** A store and its offers as core's catalog contract answers them, for this plugin's specs. */

export function makeStore(overrides: Partial<CatalogStore> = {}): CatalogStore {
  return {
    hostId: 'host-candles',
    name: 'Candle Co',
    origin: 'https://candles.example.com',
    currency: 'USD',
    productPagesServed: true,
    carrierPricedCountries: [],
    ...overrides,
  }
}

export function makeOffer(overrides: Partial<CatalogOffer> = {}): CatalogOffer {
  return {
    id: 'prod-1',
    groupId: 'prod-1',
    hasVariants: false,
    productId: 'prod-1',
    variantId: 'default',
    productName: 'Beeswax Candle',
    title: 'Beeswax Candle',
    description: 'Hand poured.',
    path: '/products/beeswax-candle',
    imageUrl: 'https://cdn.example.com/candle.jpg',
    additionalImageUrls: ['https://cdn.example.com/candle-2.jpg'],
    priceMinor: 1800,
    availability: 'in_stock',
    quantity: 12,
    kind: 'physical',
    subscriptionOnly: false,
    options: {},
    weightGrams: 400,
    shipping: [{ country: 'US', service: 'Standard', priceMinor: 495 }],
    ...overrides,
  }
}

export function makeSettings(overrides: Partial<SalesChannelSettings> = {}): SalesChannelSettings {
  return { ...DEFAULT_SALES_CHANNEL_SETTINGS, ...overrides }
}
