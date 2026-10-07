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

import type { TransferResourcePreset } from '@aglyn/aglyn/data-transfer'

/*
 * THE SHIPPING PRESETS (AGL-3613): the orders a label tool still has to ship,
 * laid out under each tool's own column names so the file uploads without
 * remapping. Verified 2026-10-06 against each tool's help:
 *
 * - Pirate Ship takes any spreadsheet and maps its columns on the first
 *   upload; weight in ounces OR pounds, numbers only.
 * - Shippo's order CSV template (`shippo_sample_csv_v3.csv`).
 * - EasyPost's label CSV: `to_address.*`, `parcel.weight_oz`, `reference`.
 *   It also needs the sender, carrier and service, which a store's export
 *   cannot know; the guide says to add them before uploading.
 */
export const PIRATE_SHIP_ORDER_PRESET: TransferResourcePreset = {
  id: 'pirate-ship',
  label: 'Pirate Ship',
  description: 'Pirate Ship’s spreadsheet upload: one row per order to ship, weight in ounces.',
  fieldIds: ['orderRef', 'shipName', 'shipEmail', 'shipPhone', 'shipLine1', 'shipLine2', 'shipCity', 'shipState', 'shipPostalCode', 'shipCountry', 'weightOz', 'itemsToShip'],
  headers: {
    orderRef: 'Order ID',
    shipName: 'Name',
    shipEmail: 'Email',
    shipPhone: 'Phone',
    shipLine1: 'Address 1',
    shipLine2: 'Address 2',
    shipCity: 'City',
    shipState: 'State',
    shipPostalCode: 'Zip',
    shipCountry: 'Country',
    weightOz: 'Ounces',
    itemsToShip: 'Items',
  },
}

export const SHIPPO_ORDER_PRESET: TransferResourcePreset = {
  id: 'shippo',
  label: 'Shippo',
  description: 'Shippo’s order CSV: its column names, with the order weight in ounces.',
  fieldIds: ['orderRef', 'shipName', 'shipEmail', 'shipPhone', 'shipLine1', 'shipLine2', 'shipCity', 'shipState', 'shipPostalCode', 'shipCountry', 'weightOz', 'weightUnit', 'itemsToShip'],
  headers: {
    orderRef: 'Order Number',
    shipName: 'Recipient Name',
    shipEmail: 'Email',
    shipPhone: 'Phone',
    shipLine1: 'Street Line 1',
    shipLine2: 'Street Line 2',
    shipCity: 'City',
    shipState: 'State/Province',
    shipPostalCode: 'Zip/Postal Code',
    shipCountry: 'Country',
    weightOz: 'Order Weight',
    weightUnit: 'Order Weight Unit',
    itemsToShip: 'Item Title',
  },
}

export const EASYPOST_ORDER_PRESET: TransferResourcePreset = {
  id: 'easypost',
  label: 'EasyPost',
  description: 'EasyPost’s label CSV: the recipient and the parcel weight. Add your from address, carrier and service before uploading.',
  fieldIds: ['orderRef', 'shipName', 'shipPhone', 'shipEmail', 'shipLine1', 'shipLine2', 'shipCity', 'shipState', 'shipPostalCode', 'shipCountry', 'weightOz'],
  headers: {
    orderRef: 'reference',
    shipName: 'to_address.name',
    shipPhone: 'to_address.phone',
    shipEmail: 'to_address.email',
    shipLine1: 'to_address.street1',
    shipLine2: 'to_address.street2',
    shipCity: 'to_address.city',
    shipState: 'to_address.state',
    shipPostalCode: 'to_address.zip',
    shipCountry: 'to_address.country',
    weightOz: 'parcel.weight_oz',
  },
}

export const GENERIC_SHIPPING_ORDER_PRESET: TransferResourcePreset = {
  id: 'shipping',
  label: 'Shipping (any tool)',
  description: 'Every shipping column under its own name, for any tool that maps columns on upload.',
  fieldIds: ['orderRef', 'date', 'shipName', 'shipEmail', 'shipPhone', 'shipLine1', 'shipLine2', 'shipCity', 'shipState', 'shipPostalCode', 'shipCountry', 'itemsToShip', 'unitsToShip', 'weightOz', 'weightLb', 'total'],
}

/** The shipping presets, in the order the export dialog lists them. */
export const ORDER_SHIPPING_PRESETS: readonly TransferResourcePreset[] = [
  PIRATE_SHIP_ORDER_PRESET,
  SHIPPO_ORDER_PRESET,
  EASYPOST_ORDER_PRESET,
  GENERIC_SHIPPING_ORDER_PRESET,
]
