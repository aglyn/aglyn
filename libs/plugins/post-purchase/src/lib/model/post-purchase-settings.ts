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

import type { PostPurchaseVendor } from '../constants/bundle-common'

/**
 * One site's post-purchase services as the console sees them (AGL-3635):
 * switches and public settings only. A credential goes in through a write
 * and never comes back out; `connected` says one is stored.
 */
export interface PostPurchaseSettingsView {
  aftership: {
    enabled: boolean
    connected: boolean
    /** The store's AfterShip tracking page, `https:`, that buyers are sent to. */
    trackingPageUrl: string | null
  }
  route: {
    enabled: boolean
    connected: boolean
    /** Whether the protection box starts ticked in the cart. */
    defaultSelected: boolean
  }
  narvar: {
    enabled: boolean
    connected: boolean
    /** The retailer's Narvar moniker: the name in its tracking page's address. */
    retailerMoniker: string | null
  }
}

/** A change to one service. Absent fields are left as they are. */
export interface PostPurchaseSettingsWrite {
  vendor: PostPurchaseVendor
  enabled?: boolean
  /** Drops the stored credentials and switches the service off. */
  disconnect?: boolean
  /** AfterShip: the API key; Route: the secret token. */
  apiKey?: string
  /** AfterShip: the webhook secret that signs its tracking updates. */
  webhookSecret?: string
  trackingPageUrl?: string | null
  defaultSelected?: boolean
  /** Narvar: the account id and auth token its API takes. */
  accountId?: string
  authToken?: string
  retailerMoniker?: string | null
}

export const EMPTY_POST_PURCHASE_SETTINGS: PostPurchaseSettingsView = {
  aftership: { enabled: false, connected: false, trackingPageUrl: null },
  route: { enabled: false, connected: false, defaultSelected: false },
  narvar: { enabled: false, connected: false, retailerMoniker: null },
}

/** A tracking page base: `https:`, no query, no credentials. `null` when unusable. */
export function normalizeTrackingPageUrl(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
  return url.toString().replace(/\/+$/, '')
}

/** A Narvar retailer moniker: lower-case letters, digits and dashes. */
export function normalizeRetailerMoniker(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(text) ? text : null
}

/** What one order's services were told, as the order widget shows it. */
export interface PostPurchaseOrderView {
  protection: {
    status: 'registered' | 'registering' | 'cancelled' | 'failed'
    premiumCents: number
    policyId: string | null
    error: string | null
  } | null
  trackedParcels: Array<{ trackingNumber: string; vendor: PostPurchaseVendor; atMs: number }>
  narvar: { syncedAtMs: number; error: string | null } | null
}
