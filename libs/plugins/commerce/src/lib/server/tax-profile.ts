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

import { registerPluginTaxProfile } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import { type FlatTaxRate, resolveFlatTaxCents, type TaxSettings } from '../model'
import { storefrontTaxModeOf } from './storefront-tax'

/**
 * The merchant's tax rule, published for every plugin that charges.
 *
 * A merchant sets tax once, in the store settings this plugin keeps
 * (`hosts/{hostId}/settings/store`, under `tax`). A plugin that sells
 * something else — an appointment — prices its own charge by asking the
 * tax-profile contract: for the site's rate for that kind of charge, read
 * here, and for these same two functions over it — one rounding rule, one
 * reading of a settled payment, wherever money is taken.
 *
 * Registered from BOTH server registrars, because a booking is priced in the
 * tenant app and confirmed by the console's billing webhook.
 */
export function registerCommerceTaxProfile(): void {
  registerPluginTaxProfile(
    {
      flatRate: (hostId, charge) => readFlatRate(hostId, charge),
      flatTax: (rate, chargeCents, fallbackLabel) =>
        resolveFlatTaxCents(
          rate as FlatTaxRate | undefined | null,
          chargeCents,
          fallbackLabel,
        ),
      taxModeOf: (settledPayment, manualTaxCents) =>
        storefrontTaxModeOf(settledPayment, manualTaxCents),
    },
    { pluginId: BUNDLE_ID },
  )
}

/**
 * The flat rates the store settings keep, by the kind of charge a caller
 * names. A kind not listed has no rate here, and answers `undefined`.
 */
const FLAT_RATE_CHARGES: Readonly<Record<string, keyof TaxSettings>> = {
  service: 'service',
  lodging: 'lodging',
}

/** One site's stored flat rate for a kind of charge, as stored. */
export async function readFlatRate(
  hostId: string,
  charge: string,
): Promise<unknown> {
  const field = FLAT_RATE_CHARGES[charge]
  if (!hostId || !field) return undefined
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('settings')
    .doc('store')
    .get()
  const tax = (snapshot.exists ? snapshot.get('tax') : undefined) as
    | TaxSettings
    | undefined
  return tax?.[field]
}
