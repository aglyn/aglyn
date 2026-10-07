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

import { openSecret, sealSecret } from '@aglyn/shared-util-tools/secret-box'
import { POST_PURCHASE_COLLECTIONS, type PostPurchaseVendor } from '../constants/bundle-common'
import {
  EMPTY_POST_PURCHASE_SETTINGS,
  normalizeRetailerMoniker,
  normalizeTrackingPageUrl,
  type PostPurchaseSettingsView,
  type PostPurchaseSettingsWrite,
} from '../model/post-purchase-settings'
import { offersVendor, type PostPurchaseConfig } from './config'
import { orgRef } from './db'

/**
 * ONE SITE'S SERVICES (AGL-3635), one document per site under
 * `postPurchaseHostSettings` in its workspace. Every credential is sealed under `POST_PURCHASE_TOKEN_KEY`
 * with a context naming this document and field, so a sealed value copied
 * onto another site's record refuses to open there. The console reads
 * {@link toSettingsView}, which never carries a credential back out.
 */

export interface StoredPostPurchaseSettings {
  orgId: string
  hostId: string
  aftership?: {
    enabled?: boolean
    sealedApiKey?: string
    sealedWebhookSecret?: string
    trackingPageUrl?: string | null
  }
  route?: {
    enabled?: boolean
    sealedToken?: string
    defaultSelected?: boolean
  }
  narvar?: {
    enabled?: boolean
    accountId?: string
    sealedAuthToken?: string
    retailerMoniker?: string | null
  }
  updatedAtMs?: number
  updatedBy?: string
}

export function settingsRef(orgId: string, hostId: string) {
  return orgRef(orgId).collection(POST_PURCHASE_COLLECTIONS.hostSettings).doc(hostId)
}

const sealContext = (orgId: string, hostId: string, field: string) =>
  `orgs/${orgId}/${POST_PURCHASE_COLLECTIONS.hostSettings}/${hostId}#${field}`

export async function readStoredSettings(orgId: string, hostId: string): Promise<StoredPostPurchaseSettings> {
  const snapshot = await settingsRef(orgId, hostId).get()
  return ((snapshot.data() as StoredPostPurchaseSettings | undefined) ?? { orgId, hostId }) as StoredPostPurchaseSettings
}

/** The console's view: switches and public settings, for the vendors the deployment offers. */
export function toSettingsView(stored: StoredPostPurchaseSettings, config: PostPurchaseConfig): PostPurchaseSettingsView {
  const aftershipConnected = Boolean(stored.aftership?.sealedApiKey && stored.aftership?.sealedWebhookSecret)
  const routeConnected = Boolean(stored.route?.sealedToken)
  const narvarConnected = Boolean(stored.narvar?.accountId && stored.narvar?.sealedAuthToken)
  return {
    aftership: offersVendor(config, 'aftership')
      ? {
          enabled: aftershipConnected && stored.aftership?.enabled === true,
          connected: aftershipConnected,
          trackingPageUrl: stored.aftership?.trackingPageUrl ?? null,
        }
      : EMPTY_POST_PURCHASE_SETTINGS.aftership,
    route: offersVendor(config, 'route')
      ? {
          enabled: routeConnected && stored.route?.enabled === true,
          connected: routeConnected,
          defaultSelected: stored.route?.defaultSelected === true,
        }
      : EMPTY_POST_PURCHASE_SETTINGS.route,
    narvar: offersVendor(config, 'narvar')
      ? {
          enabled: narvarConnected && stored.narvar?.enabled === true,
          connected: narvarConnected,
          retailerMoniker: stored.narvar?.retailerMoniker ?? null,
        }
      : EMPTY_POST_PURCHASE_SETTINGS.narvar,
  }
}

/** One service's opened credentials, when it is offered, connected and switched on. */
export type OpenedVendor<V extends PostPurchaseVendor> = V extends 'aftership'
  ? { apiKey: string; webhookSecret: string; trackingPageUrl: string | null }
  : V extends 'route'
    ? { token: string; defaultSelected: boolean }
    : { accountId: string; authToken: string; retailerMoniker: string | null }

function open(stored: StoredPostPurchaseSettings, config: PostPurchaseConfig, field: string, sealed: string | undefined): string | null {
  if (!sealed) return null
  try {
    return openSecret(sealed, config.keyring, { context: sealContext(stored.orgId, stored.hostId, field) }).plaintext
  } catch (error) {
    console.error(`[post-purchase] a stored ${field} for ${stored.hostId} did not open`, error)
    return null
  }
}

/**
 * The service's credentials, or `null` when the deployment does not offer
 * it, the site never connected it, or switched it off. `ignoreSwitch` opens a
 * connected service that is switched off — the webhook still verifies a
 * delivery for a parcel followed before the switch.
 */
export function openVendor<V extends PostPurchaseVendor>(
  stored: StoredPostPurchaseSettings,
  config: PostPurchaseConfig,
  vendor: V,
  options: { ignoreSwitch?: boolean } = {},
): OpenedVendor<V> | null {
  if (!offersVendor(config, vendor)) return null
  if (vendor === 'aftership') {
    const entry = stored.aftership
    if (!entry || (!options.ignoreSwitch && entry.enabled !== true)) return null
    const apiKey = open(stored, config, 'aftership.apiKey', entry.sealedApiKey)
    const webhookSecret = open(stored, config, 'aftership.webhookSecret', entry.sealedWebhookSecret)
    if (!apiKey || !webhookSecret) return null
    return { apiKey, webhookSecret, trackingPageUrl: entry.trackingPageUrl ?? null } as OpenedVendor<V>
  }
  if (vendor === 'route') {
    const entry = stored.route
    if (!entry || (!options.ignoreSwitch && entry.enabled !== true)) return null
    const token = open(stored, config, 'route.token', entry.sealedToken)
    if (!token) return null
    return { token, defaultSelected: entry.defaultSelected === true } as OpenedVendor<V>
  }
  const entry = stored.narvar
  if (!entry || (!options.ignoreSwitch && entry.enabled !== true) || !entry.accountId) return null
  const authToken = open(stored, config, 'narvar.authToken', entry.sealedAuthToken)
  if (!authToken) return null
  return { accountId: entry.accountId, authToken, retailerMoniker: entry.retailerMoniker ?? null } as OpenedVendor<V>
}

/** A refusal the console shows as is. */
export class SettingsRefusal extends Error {}

const credential = (value: unknown, max: number): string | null => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > max || /\s/.test(text)) throw new SettingsRefusal('That credential does not look right. Copy it again.')
  return text
}

/**
 * Applies one change. Pure but for the seal: the caller has checked the
 * member may make it and that the deployment offers the service, and writes
 * what this returns.
 */
export function applySettingsWrite(
  stored: StoredPostPurchaseSettings,
  write: PostPurchaseSettingsWrite,
  config: PostPurchaseConfig,
): StoredPostPurchaseSettings {
  const seal = (field: string, value: string) =>
    sealSecret(value, config.keyring.current, { context: sealContext(stored.orgId, stored.hostId, field) })
  const next: StoredPostPurchaseSettings = { ...stored }
  if (write.vendor === 'aftership') {
    if (write.disconnect) {
      next.aftership = { enabled: false, trackingPageUrl: stored.aftership?.trackingPageUrl ?? null }
      return next
    }
    const entry = { ...(stored.aftership ?? {}) }
    const apiKey = credential(write.apiKey, 200)
    const webhookSecret = credential(write.webhookSecret, 200)
    if (apiKey) entry.sealedApiKey = seal('aftership.apiKey', apiKey)
    if (webhookSecret) entry.sealedWebhookSecret = seal('aftership.webhookSecret', webhookSecret)
    if (write.trackingPageUrl !== undefined) {
      const url = normalizeTrackingPageUrl(write.trackingPageUrl)
      if (write.trackingPageUrl && !url) throw new SettingsRefusal('The tracking page must be an https:// address.')
      entry.trackingPageUrl = url
    }
    if (write.enabled !== undefined) entry.enabled = write.enabled === true
    if (entry.enabled && !(entry.sealedApiKey && entry.sealedWebhookSecret)) {
      throw new SettingsRefusal('Add your AfterShip API key and webhook secret first.')
    }
    next.aftership = entry
    return next
  }
  if (write.vendor === 'route') {
    if (write.disconnect) {
      next.route = { enabled: false, defaultSelected: stored.route?.defaultSelected === true }
      return next
    }
    const entry = { ...(stored.route ?? {}) }
    const token = credential(write.apiKey, 300)
    if (token) entry.sealedToken = seal('route.token', token)
    if (write.defaultSelected !== undefined) entry.defaultSelected = write.defaultSelected === true
    if (write.enabled !== undefined) entry.enabled = write.enabled === true
    if (entry.enabled && !entry.sealedToken) throw new SettingsRefusal('Add your Route secret token first.')
    next.route = entry
    return next
  }
  if (write.disconnect) {
    next.narvar = { enabled: false, retailerMoniker: stored.narvar?.retailerMoniker ?? null }
    return next
  }
  const entry = { ...(stored.narvar ?? {}) }
  const accountId = credential(write.accountId, 120)
  const authToken = credential(write.authToken, 300)
  if (accountId) entry.accountId = accountId
  if (authToken) entry.sealedAuthToken = seal('narvar.authToken', authToken)
  if (write.retailerMoniker !== undefined) {
    const moniker = normalizeRetailerMoniker(write.retailerMoniker)
    if (write.retailerMoniker && !moniker) {
      throw new SettingsRefusal('The retailer name is the lower-case word in your Narvar tracking page address.')
    }
    entry.retailerMoniker = moniker
  }
  if (write.enabled !== undefined) entry.enabled = write.enabled === true
  if (entry.enabled && !(entry.accountId && entry.sealedAuthToken)) {
    throw new SettingsRefusal('Add your Narvar account id and auth token first.')
  }
  next.narvar = entry
  return next
}
