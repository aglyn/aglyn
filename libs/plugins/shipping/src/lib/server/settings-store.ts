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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { pluginShipmentRecords } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import {
  isCompleteAddress,
  normalizeShippingHostSettings,
  type ShippingHostSettings,
} from '../model/shipping-settings'
import { orgRef } from './db'

/**
 * One site's settings: `orgs/{orgId}/shippingHostSettings/{hostId}`, under
 * the workspace rather than the site so no site rule's catch-all can let a
 * client write them. Read and written by the routes only.
 */

export function hostSettingsRef(orgId: string, hostId: string) {
  return orgRef(orgId).collection(SHIPPING_COLLECTIONS.hostSettings).doc(hostId)
}

export async function readHostSettings(orgId: string, hostId: string): Promise<ShippingHostSettings> {
  const snapshot = await hostSettingsRef(orgId, hostId).get()
  return normalizeShippingHostSettings(snapshot.exists ? snapshot.data() : undefined)
}

export async function writeHostSettings(
  orgId: string,
  hostId: string,
  value: unknown,
  uid: string,
): Promise<ShippingHostSettings> {
  const settings = normalizeShippingHostSettings(value)
  await hostSettingsRef(orgId, hostId).set({ ...settings, updatedAtMs: Date.now(), updatedByUid: uid })
  return settings
}

/**
 * Where a site ships from: the place it picked among those the seller
 * keeps, else the address it typed, else the seller's first complete place.
 * `null` when none is complete enough for a carrier.
 */
export async function resolveShipFrom(
  hostId: string,
  settings: ShippingHostSettings,
): Promise<PluginShippingAddress | null> {
  const places = (await pluginShipmentRecords()?.shipFromAddresses(hostId).catch(() => [])) ?? []
  const picked = settings.shipFromId
    ? places.find((place) => place.id === settings.shipFromId)?.address
    : undefined
  if (isCompleteAddress(picked)) return picked as PluginShippingAddress
  if (isCompleteAddress(settings.shipFromAddress)) return settings.shipFromAddress as PluginShippingAddress
  return places.find((place) => isCompleteAddress(place.address))?.address ?? null
}
