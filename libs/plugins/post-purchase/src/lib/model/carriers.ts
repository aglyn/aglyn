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

import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'

/**
 * Carrier words and status words, both ways (AGL-3635). Pure.
 *
 * Carriers are FREE TEXT on an order ("UPS", "ups ground", "USPS Priority"),
 * so each vendor's code is found by a loose prefix match, and an unknown
 * carrier gets no code at all rather than a guess: AfterShip detects the
 * carrier from the number itself, and a Narvar link to the wrong carrier's
 * page is worse than none.
 */

function squash(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

interface CarrierRow {
  aliases: readonly string[]
  aftership: string
  narvar: string | null
}

const CARRIERS: readonly CarrierRow[] = [
  { aliases: ['usps', 'unitedstatespostalservice', 'uspostalservice'], aftership: 'usps', narvar: 'usps' },
  { aliases: ['ups', 'unitedparcelservice'], aftership: 'ups', narvar: 'ups' },
  { aliases: ['fedex', 'federalexpress'], aftership: 'fedex', narvar: 'fedex' },
  { aliases: ['dhlexpress', 'dhl'], aftership: 'dhl', narvar: 'dhl' },
  { aliases: ['canadapost', 'postescanada'], aftership: 'canada-post', narvar: null },
  { aliases: ['royalmail'], aftership: 'royal-mail', narvar: null },
  { aliases: ['australiapost', 'auspost'], aftership: 'australia-post', narvar: null },
]

function carrierRow(carrier: unknown): CarrierRow | null {
  const squashed = squash(carrier)
  if (!squashed) return null
  for (const row of CARRIERS) if (row.aliases.includes(squashed)) return row
  // Longest alias first, so "uspostalservice" is tried before "ups".
  const byLength = CARRIERS.flatMap((row) => row.aliases.map((alias) => ({ alias, row }))).sort(
    (a, b) => b.alias.length - a.alias.length,
  )
  return byLength.find(({ alias }) => squashed.startsWith(alias))?.row ?? null
}

/** AfterShip's courier slug, or `null` to let AfterShip detect it. */
export function aftershipSlugFor(carrier: unknown): string | null {
  return carrierRow(carrier)?.aftership ?? null
}

/** Narvar's carrier moniker, or `null` when this table does not know it. */
export function narvarCarrierFor(carrier: unknown): string | null {
  return carrierRow(carrier)?.narvar ?? null
}

/**
 * AfterShip's tag (and subtag) in the carrier-neutral word the seller
 * records, or `null` for one that says nothing new (`Pending`, `Expired`).
 */
export function aftershipTrackingStatus(tag: unknown, subtag?: unknown): PluginTrackingStatus | null {
  switch (String(tag ?? '')) {
    case 'InfoReceived':
      return 'pre_transit'
    case 'InTransit':
      return 'in_transit'
    case 'OutForDelivery':
    case 'AvailableForPickup':
      return 'out_for_delivery'
    case 'Delivered':
      return 'delivered'
    case 'AttemptFail':
      return 'exception'
    case 'Exception':
      // Exception_011 is AfterShip's "returned to sender".
      return String(subtag ?? '') === 'Exception_011' ? 'returned' : 'exception'
    default:
      return null
  }
}
